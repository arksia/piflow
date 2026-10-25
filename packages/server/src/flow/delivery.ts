import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { FlowDocument, FlowMessageRecord, FlowNode } from '@piflow/protocol'
import type { FlowStore } from './store'
import { findConnection, findNodeBySession, listConnectedNodes } from './store'

export interface DeliverySession {
  isStreaming: boolean
  prompt: (text: string, followUp: boolean) => Promise<void>
}

export interface Deliveries {
  /** Returns the delivery's state now. Does not wait for a reply. */
  send: (projectPath: string, sourceSessionPath: string, targetNodeId: string, body: string) => Promise<string>
  /** Records the one reply and writes it into the sender session. */
  reply: (projectPath: string, sessionPath: string, deliveryId: string, body: string) => Promise<string>
  /** The target run ended. Reminds once, or fails the delivery and admits the next. */
  settle: (projectPath: string, sessionPath: string, messages: AgentMessage[]) => Promise<void>
  /** Hands the oldest waiting delivery to an idle session, including after restart. */
  resume: (projectPath: string, sessionPath: string) => Promise<void>
}

export function createDeliveries(
  flow: FlowStore,
  open: (node: FlowNode, projectPath: string) => Promise<DeliverySession | null>,
): Deliveries {
  async function claim(projectPath: string, id: string): Promise<FlowMessageRecord | null> {
    return flow.updateMessage(projectPath, id, (message, messages) => {
      if (message.status !== 'queued')
        return null
      if (messages.some(item => item.target === message.target && item.status === 'delivered'))
        return null
      return { ...message, status: 'delivered', read: true }
    })
  }

  async function failAndWake(projectPath: string, id: string, error: unknown) {
    const failed = await flow.updateMessage(projectPath, id, (message) => {
      if (message.status !== 'queued' && message.status !== 'delivered')
        return null
      return { ...message, status: 'failed' }
    })
    if (!failed)
      return
    const document = await flow.read(projectPath)
    const source = document.nodes.find(node => node.id === failed.source)
    if (!source)
      return
    const session = await openSession(source, projectPath)
    if (!session)
      return
    const target = document.nodes.find(node => node.id === failed.target)
    const reason = error instanceof Error ? error.message : String(error)
    const text = `Delivery ${failed.id} to ${target?.name ?? failed.target} failed: ${reason}`
    void session.prompt(text, session.isStreaming).catch(() => {})
  }

  async function openSession(node: FlowNode, projectPath: string): Promise<DeliverySession | null> {
    try {
      return await open(node, projectPath)
    }
    catch {
      return null
    }
  }

  async function admit(projectPath: string, target: FlowNode) {
    const document = await flow.read(projectPath)
    const next = nextQueuedMessage(document, target.id)
    if (!next)
      return
    const session = await openSession(target, projectPath)
    if (!session || session.isStreaming)
      return
    const claimed = await claim(projectPath, next.id)
    if (!claimed)
      return
    const source = document.nodes.find(node => node.id === claimed.source)
    const text = inboundText(source?.name ?? claimed.source, claimed.id, claimed.body)
    try {
      const pending = session.prompt(text, false)
      void pending.catch((error) => {
        void failAndWake(projectPath, claimed.id, error)
      })
    }
    catch (error) {
      await flow.updateMessage(projectPath, claimed.id, (message) => {
        if (message.status !== 'delivered')
          return null
        return { ...message, status: 'failed' }
      })
      void error
    }
  }

  async function nodeFor(projectPath: string, sessionPath: string): Promise<FlowNode | undefined> {
    if (!sessionPath)
      return undefined
    const document = await flow.read(projectPath)
    if (document.conductorPath === sessionPath)
      return undefined
    return findNodeBySession(document, sessionPath)
  }

  return {
    async send(projectPath, sourceSessionPath, targetNodeId, body) {
      const document = await flow.read(projectPath)
      const source = findNodeBySession(document, sourceSessionPath)
      if (!source)
        throw new Error('this session is not on the current project Flow canvas')
      const target = listConnectedNodes(document, source.id).find(node => node.id === targetNodeId)
      if (!target)
        throw new Error('target is not a connected Flow peer')
      const edge = findConnection(document, source.id, target.id)
      if (!edge)
        throw new Error('Flow edge not found')
      const text = body.trim()
      if (!text)
        throw new Error('message is empty')
      const id = crypto.randomUUID()
      await flow.appendMessage(projectPath, {
        id,
        edgeId: edge.id,
        source: source.id,
        target: target.id,
        body: text,
        preview: text.slice(0, 160),
        sentAt: new Date().toISOString(),
        status: 'queued',
        read: false,
        reminded: false,
      })
      await admit(projectPath, target)
      const saved = (await flow.read(projectPath)).messages.find(message => message.id === id)
      if (!saved)
        throw new Error('flow delivery was not saved')
      return describeDelivery(saved, target.name)
    },

    async reply(projectPath, sessionPath, deliveryId, body) {
      const text = body.trim()
      if (!text)
        throw new Error('reply is empty')
      const node = await nodeFor(projectPath, sessionPath)
      if (!node)
        throw new Error('this session is not on the current project Flow canvas')
      const document = await flow.read(projectPath)
      const delivery = document.messages.find(message => message.id === deliveryId)
      if (!delivery || delivery.target !== node.id)
        throw new Error('delivery is not waiting on this node')
      if (delivery.status === 'replied')
        throw new Error('delivery already has a reply')
      if (delivery.status !== 'delivered')
        throw new Error('delivery is not in the transcript')
      const source = document.nodes.find(item => item.id === delivery.source)
      if (!source)
        throw new Error('sender node is gone')
      const sender = await openSession(source, projectPath)
      if (!sender)
        throw new Error('sender session is not available')
      const recorded = await flow.updateMessage(projectPath, deliveryId, (message) => {
        if (message.status !== 'delivered' || message.target !== node.id)
          return null
        return { ...message, status: 'replied', reply: text }
      })
      if (!recorded)
        throw new Error('delivery already has a reply')
      try {
        const pending = sender.prompt(replyText(node.name, deliveryId, text), sender.isStreaming)
        void pending.catch(() => {})
      }
      catch (error) {
        await flow.updateMessage(projectPath, deliveryId, (message) => {
          if (message.status !== 'replied')
            return null
          const { reply: _dropped, ...rest } = message
          return { ...rest, status: 'delivered' }
        })
        throw error instanceof Error ? error : new Error('sender session did not accept the reply')
      }
      return `Reply recorded for ${deliveryId}.`
    },

    async settle(projectPath, sessionPath, messages) {
      const node = await nodeFor(projectPath, sessionPath)
      if (!node)
        return
      const document = await flow.read(projectPath)
      const active = document.messages.find(message => message.target === node.id && message.status === 'delivered')
      if (!active) {
        await admit(projectPath, node)
        return
      }
      if (active.reminded)
        return
      if (!hasAssistantText(messages, active.id)) {
        await failAndWake(projectPath, active.id, new Error('the run ended without assistant text'))
        await admit(projectPath, node)
        return
      }
      const session = await openSession(node, projectPath)
      if (!session || session.isStreaming)
        return
      const reminded = await flow.updateMessage(projectPath, active.id, (message) => {
        if (message.status !== 'delivered' || message.reminded)
          return null
        return { ...message, reminded: true }
      })
      if (!reminded)
        return
      try {
        const pending = session.prompt(reminderText(active.id), false)
        void pending.catch(() => {})
      }
      catch {
        // The reminder flag is already set, so a later settle does not send another.
      }
    },

    async resume(projectPath, sessionPath) {
      const node = await nodeFor(projectPath, sessionPath)
      if (!node)
        return
      await admit(projectPath, node)
    },
  }
}

function nextQueuedMessage(document: FlowDocument, targetId: string): FlowMessageRecord | undefined {
  if (document.messages.some(message => message.target === targetId && message.status === 'delivered'))
    return undefined
  return document.messages
    .filter(message => message.target === targetId && message.status === 'queued')
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.id.localeCompare(right.id))[0]
}

function inboundText(sourceName: string, id: string, body: string): string {
  return [
    `Message from Flow node "${sourceName}".`,
    `Delivery ${id}.`,
    '',
    body,
    '',
    'Reply with reply_flow_message and this delivery id.',
  ].join('\n')
}

function reminderText(id: string): string {
  return `Reply to delivery ${id} with reply_flow_message. That delivery is still waiting.`
}

function replyText(fromName: string, id: string, body: string): string {
  return `Reply from Flow node "${fromName}" for delivery ${id}:\n\n${body}`
}

function hasAssistantText(messages: AgentMessage[], deliveryId: string): boolean {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user' && textOf(message).includes(deliveryId)) {
      start = index
      break
    }
  }
  if (start < 0)
    return false
  for (let index = start + 1; index < messages.length; index++) {
    const message = messages[index]
    if (message?.role === 'assistant' && textOf(message).trim())
      return true
  }
  return false
}

function textOf(message: AgentMessage): string {
  if (!('content' in message))
    return ''
  if (typeof message.content === 'string')
    return message.content
  if (!Array.isArray(message.content))
    return ''
  return message.content.flatMap((block) => {
    if (typeof block === 'object' && block && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string')
      return [block.text]
    return []
  }).join('\n')
}

function describeDelivery(message: FlowMessageRecord, targetName: string): string {
  if (message.status === 'queued')
    return `Queued for ${targetName}. Delivery ${message.id} is waiting outside the session.`
  if (message.status === 'delivered')
    return `Delivered to ${targetName}. Delivery ${message.id} is in the transcript and waiting for a reply.`
  if (message.status === 'failed')
    return `Delivery ${message.id} to ${targetName} failed.`
  return `Delivery ${message.id} to ${targetName} already has a reply.`
}
