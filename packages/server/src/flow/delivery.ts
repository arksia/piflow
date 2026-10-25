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

function describeDelivery(message: FlowMessageRecord, targetName: string): string {
  if (message.status === 'queued')
    return `Queued for ${targetName}. Delivery ${message.id} is waiting outside the session.`
  if (message.status === 'delivered')
    return `Delivered to ${targetName}. Delivery ${message.id} is in the transcript and waiting for a reply.`
  if (message.status === 'failed')
    return `Delivery ${message.id} to ${targetName} failed.`
  return `Delivery ${message.id} to ${targetName} already has a reply.`
}
