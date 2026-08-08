import type {
  FlowDocument,
  FlowEdge,
  FlowMessageRecord,
  FlowNode,
  FlowTopology,
} from '@piflow/protocol'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const VERSION = 1 as const
const MAX_MESSAGES = 500

export interface FlowStore {
  read: (projectPath: string) => Promise<FlowDocument>
  replaceTopology: (projectPath: string, topology: FlowTopology) => Promise<FlowDocument>
  appendMessage: (projectPath: string, message: FlowMessageRecord) => Promise<FlowDocument>
}

export function createFlowStore(dataDir: string): FlowStore {
  const documents = new Map<string, FlowDocument>()
  const writes = new Map<string, Promise<void>>()

  async function normalizeProject(projectPath: string) {
    return realpath(projectPath)
  }

  function fileFor(projectPath: string) {
    const id = createHash('sha256').update(projectPath).digest('hex').slice(0, 24)
    return join(dataDir, 'flows', `${id}.json`)
  }

  function emptyDocument(projectPath: string): FlowDocument {
    return {
      version: VERSION,
      projectPath,
      nodes: [],
      edges: [],
      messages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    }
  }

  async function read(projectPath: string): Promise<FlowDocument> {
    const normalized = await normalizeProject(projectPath)
    const cached = documents.get(normalized)
    if (cached)
      return structuredClone(cached)
    let document = emptyDocument(normalized)
    try {
      document = parseDocument(JSON.parse(await readFile(fileFor(normalized), 'utf8')), normalized)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    documents.set(normalized, document)
    return structuredClone(document)
  }

  async function persist(document: FlowDocument) {
    const path = fileFor(document.projectPath)
    const previous = writes.get(document.projectPath) ?? Promise.resolve()
    const next = previous.then(async () => {
      await mkdir(join(dataDir, 'flows'), { recursive: true })
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    })
    writes.set(document.projectPath, next)
    try {
      await next
    }
    finally {
      if (writes.get(document.projectPath) === next)
        writes.delete(document.projectPath)
    }
  }

  async function replaceTopology(projectPath: string, topology: FlowTopology): Promise<FlowDocument> {
    const current = await read(projectPath)
    const parsed = parseTopology(topology)
    const document: FlowDocument = {
      ...current,
      ...parsed,
      updatedAt: new Date().toISOString(),
    }
    documents.set(document.projectPath, document)
    await persist(document)
    return structuredClone(document)
  }

  async function appendMessage(projectPath: string, message: FlowMessageRecord): Promise<FlowDocument> {
    const current = await read(projectPath)
    const document: FlowDocument = {
      ...current,
      messages: [...current.messages, parseMessage(message)].slice(-MAX_MESSAGES),
      updatedAt: new Date().toISOString(),
    }
    documents.set(document.projectPath, document)
    await persist(document)
    return structuredClone(document)
  }

  return { read, replaceTopology, appendMessage }
}

export function findNodeBySession(document: FlowDocument, sessionPath: string): FlowNode | undefined {
  return document.nodes.find(node => node.sessionPath === sessionPath)
}

export function listOutboundNodes(document: FlowDocument, sourceId: string): FlowNode[] {
  const targets = new Set(document.edges.filter(edge => edge.source === sourceId).map(edge => edge.target))
  return document.nodes.filter(node => targets.has(node.id))
}

export function canReadNode(document: FlowDocument, readerId: string, sourceId: string): boolean {
  return document.edges.some(edge => edge.source === sourceId && edge.target === readerId)
}

function parseDocument(value: unknown, projectPath: string): FlowDocument {
  if (!isRecord(value) || value.version !== VERSION || value.projectPath !== projectPath)
    throw new Error('invalid flow document')
  return {
    version: VERSION,
    projectPath,
    ...parseTopology(value),
    messages: asArray(value.messages).map(parseMessage),
    updatedAt: asString(value.updatedAt, 'updatedAt'),
  }
}

function parseTopology(value: unknown): FlowTopology {
  if (!isRecord(value))
    throw new Error('invalid flow topology')
  const nodes = asArray(value.nodes).map(parseNode)
  const nodeIds = new Set(nodes.map(node => node.id))
  if (nodeIds.size !== nodes.length)
    throw new Error('duplicate flow node')
  const sessionPaths = new Set(nodes.map(node => node.sessionPath))
  if (sessionPaths.size !== nodes.length)
    throw new Error('duplicate flow session')
  const edges = asArray(value.edges).map(parseEdge)
  if (new Set(edges.map(edge => edge.id)).size !== edges.length)
    throw new Error('duplicate flow edge')
  if (edges.some(edge => edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)))
    throw new Error('invalid flow edge endpoints')
  if (!isRecord(value.viewport))
    throw new Error('invalid flow viewport')
  const zoom = asNumber(value.viewport.zoom, 'viewport.zoom')
  return {
    nodes,
    edges,
    viewport: {
      x: asNumber(value.viewport.x, 'viewport.x'),
      y: asNumber(value.viewport.y, 'viewport.y'),
      zoom: Math.min(2, Math.max(0.2, zoom)),
    },
  }
}

function parseNode(value: unknown): FlowNode {
  if (!isRecord(value) || !isRecord(value.position))
    throw new Error('invalid flow node')
  const name = asString(value.name, 'node.name').trim()
  if (!name || name.length > 80)
    throw new Error('invalid flow node name')
  return {
    id: asString(value.id, 'node.id'),
    sessionPath: asString(value.sessionPath, 'node.sessionPath'),
    name,
    goal: asString(value.goal, 'node.goal').slice(0, 500),
    position: {
      x: asNumber(value.position.x, 'node.position.x'),
      y: asNumber(value.position.y, 'node.position.y'),
    },
    createdAt: asString(value.createdAt, 'node.createdAt'),
    updatedAt: asString(value.updatedAt, 'node.updatedAt'),
  }
}

function parseEdge(value: unknown): FlowEdge {
  if (!isRecord(value))
    throw new Error('invalid flow edge')
  return {
    id: asString(value.id, 'edge.id'),
    source: asString(value.source, 'edge.source'),
    target: asString(value.target, 'edge.target'),
    createdAt: asString(value.createdAt, 'edge.createdAt'),
  }
}

function parseMessage(value: unknown): FlowMessageRecord {
  if (!isRecord(value))
    throw new Error('invalid flow message')
  return {
    id: asString(value.id, 'message.id'),
    edgeId: asString(value.edgeId, 'message.edgeId'),
    source: asString(value.source, 'message.source'),
    target: asString(value.target, 'message.target'),
    chainId: asString(value.chainId, 'message.chainId'),
    hop: asNumber(value.hop, 'message.hop'),
    preview: asString(value.preview, 'message.preview').slice(0, 160),
    sentAt: asString(value.sentAt, 'message.sentAt'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new TypeError('expected array')
  return value
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string')
    throw new TypeError(`${name} must be a string`)
  return value
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${name} must be a finite number`)
  return value
}
