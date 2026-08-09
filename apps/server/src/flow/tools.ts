import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ChatMessage, FlowNode } from '@piflow/protocol'
import type { FlowStore } from './store'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { canReadNode, findNodeBySession, listOutboundNodes } from './store'

const MAX_HOPS = 8
const MAX_RESULTS = 8
const FLOW_META = /<!-- piflow:chain=([\w-]+);hop=(\d+) -->/

interface ToolSession {
  cwd: string
  sessionPath: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  prompt: (text: string, followUp: boolean) => Promise<void>
}

interface CreateFlowToolsOptions {
  flow: FlowStore
  source: () => ToolSession | undefined
  resolveTarget: (node: FlowNode, projectPath: string) => Promise<ToolSession>
  onDispatchError: (error: unknown) => void
}

export function createFlowTools(options: CreateFlowToolsOptions): ToolDefinition[] {
  const listConnections = defineTool({
    name: 'list_flow_connections',
    label: 'Flow connections',
    description: 'List only the Flow nodes this session is explicitly connected to. Outgoing nodes can receive messages. Incoming nodes can be searched for context.',
    promptSnippet: 'Inspect explicitly connected Flow nodes and their direction',
    promptGuidelines: [
      'Flow nodes are isolated unless the user connects them. Never assume another node exists; call list_flow_connections to discover authorized neighbors.',
      'Use search_flow_context when an incoming node may contain relevant prior work. Do not guess what another node decided.',
    ],
    parameters: Type.Object({}),
    async execute() {
      const { document, node } = await getSourceContext(options)
      const outgoing = listOutboundNodes(document, node.id).map(publicNode)
      const incomingIds = new Set(document.edges.filter(edge => edge.target === node.id).map(edge => edge.source))
      const incoming = document.nodes.filter(candidate => incomingIds.has(candidate.id)).map(publicNode)
      return textResult(JSON.stringify({ outgoing, incoming }, null, 2))
    },
  })

  const sendMessage = defineTool({
    name: 'send_flow_message',
    label: 'Send Flow message',
    description: 'Send an explicit task or result to a directly connected outgoing Flow node. The target runs immediately when idle or receives a follow-up when busy.',
    promptSnippet: 'Send a deliberate message to an authorized downstream Flow node',
    promptGuidelines: [
      'Send only information the target needs. Do not paste your complete conversation or tool history.',
      `A user-started collaboration chain allows at most ${MAX_HOPS} inter-node messages.`,
    ],
    parameters: Type.Object({
      targetNodeId: Type.String({ description: 'Node id returned by list_flow_connections' }),
      message: Type.String({ minLength: 1, maxLength: 12_000, description: 'Focused task, question, or result to deliver' }),
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const sourceSession = requireSource(options)
      const { document, node: sourceNode } = await getSourceContext(options)
      const targetNode = listOutboundNodes(document, sourceNode.id).find(node => node.id === params.targetNodeId)
      if (!targetNode)
        throw new Error('target is not connected by an outgoing Flow edge')
      const edge = document.edges.find(edge => edge.source === sourceNode.id && edge.target === targetNode.id)
      if (!edge)
        throw new Error('Flow edge not found')

      const chain = readChain(sourceSession.messages)
      const hop = chain.hop + 1
      if (hop > MAX_HOPS)
        throw new Error(`Flow chain reached its ${MAX_HOPS}-message limit; ask the user before continuing`)

      const message = params.message.trim()
      await options.flow.appendMessage(document.projectPath, {
        id: crypto.randomUUID(),
        edgeId: edge.id,
        source: sourceNode.id,
        target: targetNode.id,
        chainId: chain.id,
        hop,
        preview: message,
        sentAt: new Date().toISOString(),
      })

      const target = await options.resolveTarget(targetNode, document.projectPath)
      const envelope = [
        `Message from Flow node "${sourceNode.name}":`,
        '',
        message,
        '',
        `<!-- piflow:chain=${chain.id};hop=${hop} -->`,
      ].join('\n')
      void target.prompt(envelope, target.isStreaming).catch(options.onDispatchError)
      return textResult(`Message sent to ${targetNode.name} (${hop}/${MAX_HOPS} in this collaboration chain).`)
    },
  })

  const searchContext = defineTool({
    name: 'search_flow_context',
    label: 'Search Flow context',
    description: 'Search message history in one directly connected incoming Flow node. Returns bounded excerpts and stable message indexes; use read_flow_context to inspect source text before relying on it.',
    promptSnippet: 'Search an authorized upstream Flow conversation without importing it wholesale',
    promptGuidelines: [
      'Search results are indexes, not final evidence. Read relevant source messages with read_flow_context.',
      'Use specific keywords and file names. Try a second query when the first wording may miss the concept.',
    ],
    parameters: Type.Object({
      sourceNodeId: Type.String({ description: 'Incoming node id returned by list_flow_connections' }),
      query: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    async execute(_toolCallId, params) {
      const { document, node: reader } = await getSourceContext(options)
      if (!canReadNode(document, reader.id, params.sourceNodeId))
        throw new Error('source is not connected by an incoming Flow edge')
      const sourceNode = document.nodes.find(node => node.id === params.sourceNodeId)
      if (!sourceNode)
        throw new Error('source Flow node not found')
      const source = await options.resolveTarget(sourceNode, document.projectPath)
      const results = searchMessages(source.messages, params.query)
      return textResult(JSON.stringify({ source: publicNode(sourceNode), results }, null, 2))
    },
  })

  const readContext = defineTool({
    name: 'read_flow_context',
    label: 'Read Flow context',
    description: 'Read an exact message and a small surrounding window from one directly connected incoming Flow node. Use message indexes returned by search_flow_context.',
    promptSnippet: 'Read exact upstream source messages by stable index',
    parameters: Type.Object({
      sourceNodeId: Type.String({ description: 'Incoming node id returned by list_flow_connections' }),
      messageIndex: Type.Integer({ minimum: 0 }),
      radius: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, default: 1 })),
    }),
    async execute(_toolCallId, params) {
      const { document, node: reader } = await getSourceContext(options)
      if (!canReadNode(document, reader.id, params.sourceNodeId))
        throw new Error('source is not connected by an incoming Flow edge')
      const sourceNode = document.nodes.find(node => node.id === params.sourceNodeId)
      if (!sourceNode)
        throw new Error('source Flow node not found')
      const source = await options.resolveTarget(sourceNode, document.projectPath)
      if (params.messageIndex >= source.messages.length)
        throw new Error('message index is outside the source session')
      const radius = params.radius ?? 1
      const start = Math.max(0, params.messageIndex - radius)
      const end = Math.min(source.messages.length, params.messageIndex + radius + 1)
      const messages = source.messages.slice(start, end).map((message, offset) => ({
        messageIndex: start + offset,
        role: message.role,
        text: messageText(message).slice(0, 12_000),
      }))
      return textResult(JSON.stringify({ source: publicNode(sourceNode), messages }, null, 2))
    },
  })

  return [listConnections, sendMessage, searchContext, readContext]
}

export function formatFlowDirectory(document: Awaited<ReturnType<FlowStore['read']>>, sessionPath: string): string | null {
  const node = findNodeBySession(document, sessionPath)
  if (!node)
    return null
  const incomingIds = new Set(document.edges.filter(edge => edge.target === node.id).map(edge => edge.source))
  const incoming = document.nodes.filter(candidate => incomingIds.has(candidate.id))
  const outgoing = listOutboundNodes(document, node.id)
  return [
    'Flow connection directory updated. Connections are explicit capability boundaries.',
    'Incoming nodes may be searched with search_flow_context. Outgoing nodes may receive send_flow_message.',
    '',
    'Incoming:',
    ...directoryLines(incoming),
    'Outgoing:',
    ...directoryLines(outgoing),
  ].join('\n')
}

async function getSourceContext(options: CreateFlowToolsOptions) {
  const source = requireSource(options)
  if (!source.sessionPath)
    throw new Error('Flow tools require a persisted pi session')
  const document = await options.flow.read(source.cwd)
  const node = findNodeBySession(document, source.sessionPath)
  if (!node)
    throw new Error('this session is not on the current project Flow canvas')
  return { document, node }
}

function requireSource(options: CreateFlowToolsOptions): ToolSession {
  const source = options.source()
  if (!source)
    throw new Error('Flow session is not ready')
  return source
}

function publicNode(node: FlowNode) {
  return { id: node.id, name: node.name, goal: node.goal }
}

function directoryLines(nodes: FlowNode[]) {
  return nodes.length
    ? nodes.map(node => `- ${node.id} | ${node.name} | ${node.goal.slice(0, 160) || 'No current goal'}`)
    : ['- None']
}

function readChain(messages: ChatMessage[]): { id: string, hop: number } {
  for (let index = messages.length - 1; index >= 0; index--) {
    const match = messageText(messages[index]!).match(FLOW_META)
    if (match?.[1] && match[2])
      return { id: match[1], hop: Number(match[2]) }
    if (messages[index]?.role === 'user')
      break
  }
  return { id: crypto.randomUUID(), hop: 0 }
}

export function searchMessages(messages: ChatMessage[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle)
    return []

  return messages
    .map((message, messageIndex) => {
      const text = messageText(message)
      const lower = text.toLocaleLowerCase()
      const first = lower.indexOf(needle)
      if (first < 0)
        return null
      const start = Math.max(0, first - 120)
      return {
        messageIndex,
        role: message.role,
        excerpt: text.slice(start, start + 360),
      }
    })
    .filter(result => result !== null)
    .sort((a, b) => b.messageIndex - a.messageIndex)
    .slice(0, MAX_RESULTS)
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string')
    return message.content
  if (Array.isArray(message.content)) {
    return message.content.flatMap((block) => {
      if (block.type === 'text')
        return block.text
      if (block.type === 'toolCall')
        return `${block.name} ${block.arguments ? JSON.stringify(block.arguments) : ''}`
      return []
    }).join('\n')
  }
  return [message.command, message.output, message.errorMessage].filter(Boolean).join('\n')
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} }
}
