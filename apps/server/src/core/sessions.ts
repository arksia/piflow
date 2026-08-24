import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AgentEvent, ChatMessage, DirectoryListing, FlowNode, ModelInfo, ServerMessage, SessionContext, SessionInfoLite, SessionState, SessionStatus, SessionStatusRecord } from '@piflow/protocol'
import type { FlowStore } from '../flow/store'
import { readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'
import { createFlowTools, formatFlowDirectory } from '../flow/tools'

type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>
type AgentSession = Awaited<ReturnType<typeof createAgentSession>>['session']
type AvailableModel = ReturnType<ModelRuntimeInstance['getAvailableSnapshot']>[number]

export interface ManagedSession {
  key: string
  cwd: string
  session: AgentSession
}

export interface SessionStore {
  createFreshSession: (cwd?: string, persist?: boolean) => Promise<ManagedSession>
  openSavedSession: (path: string) => Promise<ManagedSession | null>
  prompt: (managed: ManagedSession, text: string, streamingBehavior?: 'steer' | 'followUp') => Promise<void>
  get: (key: string) => ManagedSession | undefined
  listDirectories: (path: string) => Promise<DirectoryListing>
  listSessions: () => Promise<SessionInfoLite[]>
  getAvailableModels: () => Promise<ModelInfo[]>
  findModel: (provider: string, modelId: string) => AvailableModel | undefined
  getState: (managed: ManagedSession) => SessionState
  getStatusSnapshot: () => SessionStatusRecord[]
  publishError: (key: string, error: string) => void
}

interface CreateSessionStoreOptions {
  rootCwd: string
  modelRuntime: ModelRuntimeInstance
  flow: FlowStore
  publish: (message: ServerMessage) => void
}

const CONTEXT_EVENTS = new Set(['message_end', 'compaction_end', 'agent_settled'])

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const { rootCwd, modelRuntime, flow } = options
  const pool = new Map<string, ManagedSession>()
  const flowDirectories = new Map<string, string>()
  const statuses = new Map<string, SessionStatusRecord>()
  const publish = options.publish

  function setStatus(managed: ManagedSession, status: SessionStatus) {
    const record: SessionStatusRecord = {
      key: managed.key,
      sessionFile: managed.session.sessionFile ?? null,
      status,
      updatedAt: new Date().toISOString(),
    }
    const existing = statuses.get(managed.key)
    if (existing && existing.status === record.status && existing.sessionFile === record.sessionFile)
      return
    statuses.set(managed.key, record)
    publish({ type: 'status_delta', status: record })
  }

  function setStatusByKey(key: string, status: SessionStatus) {
    const managed = pool.get(key)
    if (!managed)
      return
    setStatus(managed, status)
  }

  function getStatusSnapshot(): SessionStatusRecord[] {
    return Array.from(statuses.values())
  }

  function publishError(key: string, error: string) {
    setStatusByKey(key, 'failed')
    publish({ type: 'error', error, session: key })
  }

  function toModelInfo(session: AgentSession): ModelInfo | null {
    const model = session.model
    return model ? { id: model.id, name: model.name, provider: model.provider } : null
  }

  function getState(managed: ManagedSession): SessionState {
    return {
      key: managed.key,
      sessionId: managed.session.sessionId,
      sessionFile: managed.session.sessionFile ?? null,
      isStreaming: managed.session.isStreaming,
      model: toModelInfo(managed.session),
      thinkingLevel: managed.session.thinkingLevel,
      thinkingLevels: managed.session.getAvailableThinkingLevels(),
      context: (managed.session.getContextUsage() ?? null) as SessionContext | null,
      messages: managed.session.messages as ChatMessage[],
    }
  }

  async function openSession(opts: { path?: string, cwd?: string, fresh?: boolean }): Promise<ManagedSession> {
    const key = opts.path ?? (opts.fresh ? `new:${crypto.randomUUID()}` : `new:${opts.cwd ?? rootCwd}`)
    const existing = pool.get(key)
    if (existing)
      return existing

    const cwd = opts.cwd ?? rootCwd
    const sessionManager = opts.path
      ? SessionManager.open(opts.path)
      : SessionManager.create(cwd)

    let managed: ManagedSession | undefined
    const { session } = await createAgentSession({
      cwd,
      sessionManager,
      modelRuntime,
      customTools: createFlowTools({
        flow,
        source: () => managed && toToolSession(managed),
        resolveTarget: async (node, projectPath) => {
          const target = await resolveFlowTarget(node, projectPath)
          return toToolSession(target)
        },
        onDispatchError: (target, error) => {
          if (target.sessionPath)
            publishError(target.sessionPath, String(error))
          else
            publish({ type: 'error', error: String(error) })
        },
      }),
    })

    managed = { key, cwd, session }
    pool.set(key, managed)
    if (session.sessionFile)
      pool.set(session.sessionFile, managed)
    setStatus(managed, 'idle')

    session.subscribe((event) => {
      if (event.type === 'agent_start' && managed)
        setStatus(managed, 'running')
      if (event.type === 'agent_settled' && managed) {
        const settledStatus = settledStatusFromMessages(managed.session.messages as ChatMessage[])
        setStatus(managed, settledStatus)
      }
      const context = CONTEXT_EVENTS.has(event.type)
        ? (session.getContextUsage() ?? null) as SessionContext | null
        : undefined
      publish({ type: 'event', session: key, event: event as AgentEvent, context })
    })

    return managed
  }

  function toToolSession(managed: ManagedSession) {
    return {
      cwd: managed.cwd,
      sessionPath: managed.session.sessionFile ?? null,
      messages: managed.session.messages as ChatMessage[],
      isStreaming: managed.session.isStreaming,
      prompt: async (text: string, followUp: boolean) => {
        await prompt(managed, text, followUp ? 'followUp' : undefined)
      },
    }
  }

  async function prompt(managed: ManagedSession, text: string, streamingBehavior?: 'steer' | 'followUp') {
    await injectFlowDirectory(managed)
    await managed.session.prompt(text, { streamingBehavior })
  }

  async function injectFlowDirectory(managed: ManagedSession) {
    const sessionPath = managed.session.sessionFile
    if (!sessionPath)
      return
    const directory = formatFlowDirectory(await flow.read(managed.cwd), sessionPath)
    if (directory === null || flowDirectories.get(sessionPath) === directory)
      return
    await managed.session.sendCustomMessage({
      customType: 'flow_directory',
      content: directory,
      display: false,
      details: {},
    }, managed.session.isStreaming ? { deliverAs: 'nextTurn' } : undefined)
    flowDirectories.set(sessionPath, directory)
  }

  async function resolveFlowTarget(node: FlowNode, projectPath: string): Promise<ManagedSession> {
    const target = await openSavedSession(node.sessionPath)
    if (!target || target.cwd !== projectPath)
      throw new Error('Flow target session is unavailable in this project')
    return target
  }

  async function listSessions(): Promise<SessionInfoLite[]> {
    const all = await SessionManager.listAll()
    return all
      .map(session => ({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name ?? null,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstMessage: session.firstMessage.slice(0, 120),
      }))
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
  }

  async function listDirectories(path: string): Promise<DirectoryListing> {
    const directory = await realpath(resolve(path))
    const info = await stat(directory)
    if (!info.isDirectory())
      throw new Error('path is not a directory')
    const entries = await readdir(directory, { withFileTypes: true })
    const directories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, path: join(directory, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = dirname(directory)
    return {
      path: directory,
      parent: parent === directory ? null : parent,
      directories,
    }
  }

  async function openSavedSession(path: string): Promise<ManagedSession | null> {
    const active = pool.get(path)
    if (active)
      return active
    const known = (await SessionManager.listAll()).find(session => session.path === path)
    if (!known)
      return null
    return openSession({ path: known.path, cwd: known.cwd })
  }

  async function createFreshSession(cwd?: string, persist = false): Promise<ManagedSession> {
    const resolvedCwd = typeof cwd === 'string' ? (await listDirectories(cwd)).path : rootCwd
    const managed = await openSession({ cwd: resolvedCwd, fresh: true })
    if (persist) {
      await persistEmptySession(managed.session.sessionManager)
      const sessionFile = managed.session.sessionFile
      if (sessionFile)
        pool.set(sessionFile, managed)
      setStatusByKey(managed.key, 'idle')
    }
    return managed
  }

  async function getAvailableModels(): Promise<ModelInfo[]> {
    return (await modelRuntime.getAvailable()).map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
    }))
  }

  function findModel(provider: string, modelId: string): AvailableModel | undefined {
    return modelRuntime
      .getAvailableSnapshot()
      .find(model => model.provider === provider && model.id === modelId)
  }

  return {
    createFreshSession,
    openSavedSession,
    prompt,
    get: key => pool.get(key),
    listDirectories,
    listSessions,
    getAvailableModels,
    findModel,
    getState,
    getStatusSnapshot,
    publishError,
  }
}

export function settledStatusFromMessages(messages: ChatMessage[]): 'idle' | 'failed' {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'assistant')
      return message.stopReason === 'error' ? 'failed' : 'idle'
  }
  return 'idle'
}

export async function persistEmptySession(sessionManager: SessionManager) {
  const path = sessionManager.getSessionFile()
  const header = sessionManager.getHeader()
  if (!path || !header)
    throw new Error('session cannot be persisted')
  const entries = [header, ...sessionManager.getEntries()]
  await writeFile(path, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, { flag: 'wx' })
  sessionManager.setSessionFile(path)
}
