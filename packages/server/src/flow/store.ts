import type {
  ConductorDraft,
  FlowDocument,
  FlowEdge,
  FlowMembership,
  FlowMessageRecord,
  FlowNode,
  FlowTopology,
  LegacyModules,
  ProjectCanvasDocument,
  SubagentRun,
} from '@piflow/protocol'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InvalidAgentConfiguration, LEGACY_MODULES_FILE, mergeConductorDraft, parseAgentConfiguration, parseFlowMemberships, parseLegacyModules, parseProjectCanvas, PROJECT_CANVAS_FILE, PROJECT_CANVAS_VERSION, serializeProjectCanvas } from '@piflow/protocol'

const VERSION = 1 as const
const MAX_MESSAGES = 500

export interface FlowStore {
  read: (projectPath: string) => Promise<FlowDocument>
  readState: (projectPath: string) => Promise<{ document: FlowDocument, stored: boolean }>
  replaceTopology: (projectPath: string, topology: FlowTopology, options?: { commitGraph?: boolean }) => Promise<FlowDocument>
  appendMessage: (projectPath: string, message: FlowMessageRecord) => Promise<FlowDocument>
  updateMessage: (projectPath: string, id: string, mutate: (message: FlowMessageRecord, messages: readonly FlowMessageRecord[]) => FlowMessageRecord | null) => Promise<FlowMessageRecord | null>
  saveRun: (projectPath: string, run: SubagentRun) => Promise<void>
  readModules: (projectPath: string) => Promise<{ nodes: Array<{ id: string, name: string, brief: string }> }>
  setConductor: (projectPath: string, sessionPath: string) => Promise<void>
  acceptConductor: (projectPath: string, draft: ConductorDraft) => Promise<FlowDocument>
}

interface CachedFlow {
  document: FlowDocument
  stored: boolean
  project: ProjectCanvasDocument | null
}

export function createFlowStore(dataDir: string): FlowStore {
  const documents = new Map<string, CachedFlow>()
  const writes = new Map<string, Promise<void>>()
  const updates = new Map<string, Promise<void>>()

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

  function remember(document: FlowDocument, stored: boolean, project: ProjectCanvasDocument | null) {
    documents.set(document.projectPath, {
      document,
      stored,
      project: project ? structuredClone(project) : null,
    })
  }

  async function readProject(projectPath: string, local: FlowDocument | null): Promise<ProjectCanvasDocument | null> {
    const canvasPath = join(projectPath, PROJECT_CANVAS_FILE)
    try {
      return parseProjectCanvas(JSON.parse(await readFile(canvasPath, 'utf8')))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    let legacyText: string
    try {
      legacyText = await readFile(join(projectPath, LEGACY_MODULES_FILE), 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
    const legacy = parseLegacyModules(JSON.parse(legacyText))
    const positions = new Map(local?.nodes.map(node => [node.id, node.position]) ?? [])
    const project = canvasFromLegacy(legacy, (id, index) => positions.get(id) ?? gridPosition(index))
    await mkdir(join(projectPath, '.piflow'), { recursive: true })
    await writeAtomic(canvasPath, `${JSON.stringify(serializeProjectCanvas(project), null, 2)}\n`)
    await unlink(join(projectPath, LEGACY_MODULES_FILE))
    return project
  }

  async function readState(projectPath: string) {
    const normalized = await normalizeProject(projectPath)
    const cached = documents.get(normalized)
    if (cached)
      return { document: structuredClone(cached.document), stored: cached.stored }
    let local: FlowDocument | null = null
    try {
      local = parseDocument(JSON.parse(await readFile(fileFor(normalized), 'utf8')), normalized)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const project = await readProject(normalized, local)
    const base = local ?? emptyDocument(normalized)
    const document = project ? applyCanvas(base, project) : base
    const stored = local !== null || project !== null
    remember(document, stored, project)
    return { document: structuredClone(document), stored }
  }

  async function read(projectPath: string): Promise<FlowDocument> {
    return (await readState(projectPath)).document
  }

  function update<T>(projectPath: string, task: () => Promise<T>) {
    const previous = updates.get(projectPath) ?? Promise.resolve()
    const run = previous.then(task, task)
    updates.set(projectPath, run.then(() => {}, () => {}))
    return run
  }

  async function persist(document: FlowDocument, project: ProjectCanvasDocument | null) {
    const path = fileFor(document.projectPath)
    const previous = writes.get(document.projectPath) ?? Promise.resolve()
    const next = previous.then(async () => {
      await mkdir(join(dataDir, 'flows'), { recursive: true })
      await writeAtomic(path, `${JSON.stringify(document, null, 2)}\n`)
      if (!project)
        return
      const projectFile = join(document.projectPath, PROJECT_CANVAS_FILE)
      const text = `${JSON.stringify(serializeProjectCanvas(project), null, 2)}\n`
      const current = await readFile(projectFile, 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return null
        throw error
      })
      if (current === text)
        return
      await mkdir(join(document.projectPath, '.piflow'), { recursive: true })
      await writeAtomic(projectFile, text)
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

  async function replaceTopology(projectPath: string, topology: FlowTopology, options?: { commitGraph?: boolean }): Promise<FlowDocument> {
    const normalized = await normalizeProject(projectPath)
    return update(normalized, async () => {
      const current = await readState(normalized)
      const parsed = parseTopology(topology)
      if (options?.commitGraph) {
        for (const node of parsed.nodes) {
          const previous = current.document.nodes.find(item => item.id === node.id)
          if (previous && (previous.kind ?? 'persistent') !== (node.kind ?? 'persistent')
            && current.document.runs?.some(run => run.roleId === node.id || run.orchestratorId === node.id)) {
            throw new InvalidAgentConfiguration('该节点已有运行记录，请新建另一种执行类型的节点')
          }
        }
      }
      const project = documents.get(normalized)?.project ?? null
      const projectIds = new Set(project?.canvas.nodes.map(node => node.id) ?? [])
      const now = new Date().toISOString()
      if (!options?.commitGraph) {
        const incoming = new Map(parsed.nodes.map(node => [node.id, node]))
        const nodes = current.document.nodes.map((node) => {
          const next = incoming.get(node.id)
          if (!next)
            return node
          if (projectIds.has(node.id))
            return { ...node, sessionPath: node.kind === 'subagent-role' ? '' : next.sessionPath, goal: next.goal }
          return next
        })
        for (const node of parsed.nodes) {
          if (!nodes.some(item => item.id === node.id) && !projectIds.has(node.id))
            nodes.push(node)
        }
        const document: FlowDocument = { ...current.document, nodes, viewport: parsed.viewport, updatedAt: now }
        remember(document, true, project)
        await persist(document, null)
        return structuredClone(document)
      }
      const localOnly = new Set(current.document.nodes.filter(node => !projectIds.has(node.id)).map(node => node.id))
      const committed = parsed.nodes.filter(node => !localOnly.has(node.id))
      const committedIds = new Set(committed.map(node => node.id))
      const committedEdges = parsed.edges.filter(edge => committedIds.has(edge.source) && committedIds.has(edge.target))
      const document: FlowDocument = {
        ...current.document,
        nodes: [...committed, ...parsed.nodes.filter(node => localOnly.has(node.id))],
        edges: parsed.edges,
        memberships: parsed.memberships,
        viewport: parsed.viewport,
        updatedAt: now,
      }
      const nextProject = projectFromNodes(committed, committedEdges, project, parsed.memberships)
      remember(document, true, nextProject)
      await persist(document, nextProject)
      return structuredClone(document)
    })
  }

  async function appendMessage(projectPath: string, message: FlowMessageRecord): Promise<FlowDocument> {
    const normalized = await normalizeProject(projectPath)
    return update(normalized, async () => {
      const current = await readState(normalized)
      const document: FlowDocument = {
        ...current.document,
        messages: retainMessages([...current.document.messages, parseMessage(message)]),
        updatedAt: new Date().toISOString(),
      }
      remember(document, true, documents.get(normalized)?.project ?? null)
      await persist(document, null)
      return structuredClone(document)
    })
  }

  async function updateMessage(projectPath: string, id: string, mutate: (message: FlowMessageRecord, messages: readonly FlowMessageRecord[]) => FlowMessageRecord | null): Promise<FlowMessageRecord | null> {
    const normalized = await normalizeProject(projectPath)
    return update(normalized, async () => {
      const current = await readState(normalized)
      const index = current.document.messages.findIndex(message => message.id === id)
      const currentMessage = current.document.messages[index]
      if (!currentMessage)
        return null
      const next = mutate(currentMessage, current.document.messages)
      if (!next)
        return null
      const messages = current.document.messages.slice()
      messages[index] = parseMessage(next)
      const retained = retainMessages(messages)
      const document: FlowDocument = {
        ...current.document,
        messages: retained,
        updatedAt: new Date().toISOString(),
      }
      remember(document, true, documents.get(normalized)?.project ?? null)
      await persist(document, null)
      return retained.find(message => message.id === id) ?? null
    })
  }

  async function saveRun(projectPath: string, run: SubagentRun): Promise<void> {
    const normalized = await normalizeProject(projectPath)
    await update(normalized, async () => {
      const current = await readState(normalized)
      const runs = [...(current.document.runs ?? []).filter(item => item.id !== run.id), structuredClone(run)]
      const document = { ...current.document, runs, updatedAt: new Date().toISOString() }
      const project = documents.get(normalized)?.project ?? null
      await persist(document, null)
      remember(document, true, project)
    })
  }

  async function readModules(projectPath: string): Promise<{ nodes: Array<{ id: string, name: string, brief: string }> }> {
    const normalized = await normalizeProject(projectPath)
    await readState(normalized)
    const nodes = documents.get(normalized)?.project?.canvas.nodes ?? []
    return { nodes: nodes.map(node => ({ id: node.id, name: node.name, brief: node.brief })) }
  }

  async function setConductor(projectPath: string, sessionPath: string): Promise<void> {
    const normalized = await normalizeProject(projectPath)
    await update(normalized, async () => {
      const current = await readState(normalized)
      const document: FlowDocument = {
        ...current.document,
        conductorPath: sessionPath,
        updatedAt: new Date().toISOString(),
      }
      remember(document, true, documents.get(normalized)?.project ?? null)
      await persist(document, null)
    })
  }

  async function acceptConductor(projectPath: string, draft: ConductorDraft): Promise<FlowDocument> {
    const normalized = await normalizeProject(projectPath)
    return update(normalized, async () => {
      const current = await readState(normalized)
      const previous = documents.get(normalized)?.project ?? null
      const merged = mergeConductorDraft(
        {
          modules: (previous?.canvas.nodes ?? []).map(node => ({ id: node.id, name: node.name, brief: node.brief })),
          links: previous?.canvas.links ?? [],
        },
        draft,
        () => crypto.randomUUID(),
      )
      if (!merged)
        throw new Error('invalid conductor draft')
      const document = layoutModules({ ...current.document, updatedAt: new Date().toISOString() }, merged)
      const project = projectFromNodes(document.nodes, document.edges, previous, document.memberships)
      remember(document, true, project)
      await persist(document, project)
      return structuredClone(document)
    })
  }

  return { saveRun, read, readState, replaceTopology, appendMessage, updateMessage, readModules, setConductor, acceptConductor }
}

function applyCanvas(document: FlowDocument, project: ProjectCanvasDocument): FlowDocument {
  const localNodes = new Map(document.nodes.map(node => [node.id, node]))
  const localEdges = new Map(document.edges.map(edge => [edge.id, edge]))
  const committedIds = new Set(project.canvas.nodes.map(node => node.id))
  const nodes: FlowNode[] = project.canvas.nodes.map((node) => {
    const local = localNodes.get(node.id)
    return {
      id: node.id,
      name: node.name,
      goal: local?.goal ?? '',
      brief: node.brief,
      ...parseAgentConfiguration({ ...node }),
      sessionPath: node.kind === 'subagent-role' ? '' : local?.sessionPath ?? '',
      position: node.position,
      createdAt: local?.createdAt ?? document.updatedAt,
      updatedAt: local?.updatedAt ?? document.updatedAt,
    }
  })
  for (const local of document.nodes) {
    if (!committedIds.has(local.id))
      nodes.push(local)
  }
  const edges = [
    ...project.canvas.links.map(link => ({
      id: link.id,
      source: link.source,
      target: link.target,
      createdAt: localEdges.get(link.id)?.createdAt ?? document.updatedAt,
    })),
    ...document.edges.filter(edge => !committedIds.has(edge.source) || !committedIds.has(edge.target)),
  ]
  const memberships = [
    ...(project.canvas.memberships ?? []),
    ...(document.memberships ?? []).filter(item => !committedIds.has(item.orchestratorId) || !committedIds.has(item.memberId)),
  ]
  return { ...document, nodes, edges, memberships: parseFlowMemberships(memberships, nodes) }
}

function projectFromNodes(nodes: FlowNode[], edges: FlowEdge[], previous: ProjectCanvasDocument | null, memberships?: FlowMembership[]): ProjectCanvasDocument {
  const nodeExtras = previous?.nodeExtras ?? {}
  const linkExtras = previous?.linkExtras ?? {}
  return {
    canvas: {
      version: PROJECT_CANVAS_VERSION,
      memberships: (memberships ?? []).filter(item => nodes.some(node => node.id === item.orchestratorId) && nodes.some(node => node.id === item.memberId)),
      nodes: nodes.map(node => ({
        id: node.id,
        name: node.name,
        brief: node.brief?.trim() ?? '',
        ...parseAgentConfiguration({ ...node }),
        position: node.position,
      })),
      links: edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    },
    extras: { ...previous?.extras },
    nodeExtras: Object.fromEntries(nodes.map(node => [node.id, { ...(nodeExtras[node.id] ?? {}) }])),
    linkExtras: Object.fromEntries(edges.map(edge => [edge.id, { ...(linkExtras[edge.id] ?? {}) }])),
  }
}

function canvasFromLegacy(legacy: LegacyModules, positionFor: (id: string, index: number) => { x: number, y: number }): ProjectCanvasDocument {
  return {
    canvas: {
      version: PROJECT_CANVAS_VERSION,
      nodes: legacy.nodes.map((node, index) => ({
        id: node.id,
        name: node.name,
        brief: node.brief,
        position: positionFor(node.id, index),
      })),
      links: legacy.links.map(link => ({ id: link.id, source: link.source, target: link.target })),
    },
    extras: legacy.extras,
    nodeExtras: Object.fromEntries(legacy.nodes.map(node => [node.id, node.extras])),
    linkExtras: Object.fromEntries(legacy.links.map(link => [link.id, link.extras])),
  }
}

function gridPosition(index: number): { x: number, y: number } {
  return { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 180 }
}

async function writeAtomic(path: string, text: string) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

export function findNodeBySession(document: FlowDocument, sessionPath: string): FlowNode | undefined {
  return document.nodes.find(node => node.sessionPath === sessionPath)
}

export function listConnectedNodes(document: FlowDocument, nodeId: string): FlowNode[] {
  const peerIds = new Set(document.edges.flatMap((edge) => {
    if (edge.source === nodeId)
      return [edge.target]
    if (edge.target === nodeId)
      return [edge.source]
    return []
  }))
  return document.nodes.filter(node => peerIds.has(node.id))
}

export function findConnection(document: FlowDocument, firstId: string, secondId: string): FlowEdge | undefined {
  return document.edges.find(edge => (
    (edge.source === firstId && edge.target === secondId)
    || (edge.source === secondId && edge.target === firstId)
  ))
}

export function canAccessNode(document: FlowDocument, readerId: string, sourceId: string): boolean {
  return findConnection(document, readerId, sourceId) !== undefined
}

function parseRuns(value: unknown): SubagentRun[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    throw new Error('invalid subagent runs')
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.orchestratorId !== 'string' || typeof item.roleId !== 'string'
      || typeof item.parentSessionPath !== 'string' || typeof item.parentToolCallId !== 'string' || typeof item.task !== 'string'
      || typeof item.output !== 'string' || typeof item.createdAt !== 'string' || !isRecord(item.configurationSnapshot)
      || !['running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(String(item.status))) {
      throw new Error('invalid subagent run')
    }
    const run = item as unknown as SubagentRun
    return run.status === 'running'
      ? { ...run, status: 'interrupted' as const, completedAt: new Date().toISOString(), error: '服务重启，运行已中断；请检查结果后重新委派。' }
      : run
  })
}

function parseDocument(value: unknown, projectPath: string): FlowDocument {
  if (!isRecord(value) || value.version !== VERSION || value.projectPath !== projectPath)
    throw new Error('invalid flow document')
  return {
    version: VERSION,
    projectPath,
    ...parseTopology(value),
    runs: parseRuns(value.runs),
    messages: asArray(value.messages).map(parseMessage),
    conductorPath: typeof value.conductorPath === 'string' ? value.conductorPath : undefined,
    updatedAt: asString(value.updatedAt, 'updatedAt'),
  }
}

function layoutModules(document: FlowDocument, modules: { modules: Array<{ id: string, name: string, brief: string }>, links: Array<{ id: string, source: string, target: string }> }): FlowDocument {
  const localNodes = new Map(document.nodes.map(node => [node.id, node]))
  const localEdges = new Map(document.edges.map(edge => [edge.id, edge]))
  const kept = new Set(modules.modules.map(module => module.id))
  const maxX = document.nodes.filter(node => kept.has(node.id)).reduce((max, node) => Math.max(max, node.position.x), 0)
  let added = 0
  return {
    ...document,
    memberships: (document.memberships ?? []).filter(item => kept.has(item.orchestratorId) && kept.has(item.memberId)),
    nodes: modules.modules.map((module) => {
      const local = localNodes.get(module.id)
      if (local)
        return { ...local, name: module.name, brief: module.brief }
      added += 1
      return {
        id: module.id,
        sessionPath: '',
        name: module.name,
        goal: '',
        brief: module.brief,
        position: { x: maxX + added * 280, y: 80 },
        createdAt: document.updatedAt,
        updatedAt: document.updatedAt,
      }
    }),
    edges: modules.links.map(link => ({
      id: link.id,
      source: link.source,
      target: link.target,
      createdAt: localEdges.get(link.id)?.createdAt ?? document.updatedAt,
    })),
  }
}

function parseTopology(value: unknown): FlowTopology {
  if (!isRecord(value))
    throw new Error('invalid flow topology')
  const nodes = asArray(value.nodes).map(parseNode)
  const nodeIds = new Set(nodes.map(node => node.id))
  if (nodeIds.size !== nodes.length)
    throw new Error('duplicate flow node')
  const sessionPaths = nodes.map(node => node.sessionPath).filter(path => path !== '')
  if (new Set(sessionPaths).size !== sessionPaths.length)
    throw new Error('duplicate flow session')
  const edges = asArray(value.edges).map(parseEdge)
  if (new Set(edges.map(edge => edge.id)).size !== edges.length)
    throw new Error('duplicate flow edge')
  if (edges.some(edge => edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)))
    throw new Error('invalid flow edge endpoints')
  if (edges.some(edge => nodes.some(node => node.kind === 'subagent-role' && (node.id === edge.source || node.id === edge.target))))
    throw new InvalidAgentConfiguration('通信边只能连接长期 Agent；角色通过 subagent 调用')
  if (new Set(edges.map(connectionKey)).size !== edges.length)
    throw new Error('duplicate flow connection')
  if (!isRecord(value.viewport))
    throw new Error('invalid flow viewport')
  const zoom = asNumber(value.viewport.zoom, 'viewport.zoom')
  return {
    nodes,
    edges,
    memberships: parseFlowMemberships(value.memberships, nodes),
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
  if (value.kind === 'subagent-role' && value.sessionPath !== '')
    throw new InvalidAgentConfiguration('Subagent 角色不能绑定长期会话')
  return {
    id: asString(value.id, 'node.id'),
    sessionPath: asString(value.sessionPath, 'node.sessionPath'),
    name,
    goal: asString(value.goal, 'node.goal').slice(0, 500),
    brief: typeof value.brief === 'string' ? value.brief.trim().slice(0, 8000) : '',
    ...parseAgentConfiguration(value),
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

function connectionKey(edge: FlowEdge): string {
  return [edge.source, edge.target].sort().join('\0')
}

function parseMessage(value: unknown): FlowMessageRecord {
  if (!isRecord(value))
    throw new Error('invalid flow message')
  const preview = asString(value.preview, 'message.preview').slice(0, 160)
  const reply = typeof value.reply === 'string' ? value.reply.slice(0, 12_000) : undefined
  return {
    id: asString(value.id, 'message.id'),
    edgeId: asString(value.edgeId, 'message.edgeId'),
    source: asString(value.source, 'message.source'),
    target: asString(value.target, 'message.target'),
    body: typeof value.body === 'string' ? value.body.slice(0, 12_000) : preview,
    preview,
    sentAt: asString(value.sentAt, 'message.sentAt'),
    status: parseStatus(value.status),
    read: value.read === true,
    reminded: value.reminded === true,
    ...(reply ? { reply } : {}),
  }
}

function parseStatus(value: unknown): FlowMessageRecord['status'] {
  if (value === 'queued' || value === 'delivered' || value === 'replied' || value === 'failed')
    return value
  // ponytail: a record from before status exists is already finished
  return 'replied'
}

function retainMessages(messages: FlowMessageRecord[]): FlowMessageRecord[] {
  if (messages.length <= MAX_MESSAGES)
    return messages
  const kept: FlowMessageRecord[] = []
  let drop = messages.length - MAX_MESSAGES
  for (const message of messages) {
    const open = message.status === 'queued' || message.status === 'delivered'
    if (!open && drop > 0) {
      drop -= 1
      continue
    }
    kept.push(message)
  }
  return kept
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
