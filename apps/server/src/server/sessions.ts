import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type {
  AgentEvent,
  ChatMessage,
  DirectoryListing,
  ModelInfo,
  ServerMessage,
  SessionContext,
  SessionInfoLite,
  SessionState,
} from '@piflow/protocol'
import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'

type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>
type AgentSession = Awaited<ReturnType<typeof createAgentSession>>['session']
type AvailableModel = ReturnType<ModelRuntimeInstance['getAvailableSnapshot']>[number]

export interface ManagedSession {
  key: string
  session: AgentSession
}

export interface SessionStore {
  createFreshSession: (cwd?: string) => Promise<ManagedSession>
  openSavedSession: (path: string) => Promise<ManagedSession | null>
  get: (key: string) => ManagedSession | undefined
  listDirectories: (path: string) => Promise<DirectoryListing>
  listSessions: () => Promise<SessionInfoLite[]>
  getAvailableModels: () => Promise<ModelInfo[]>
  findModel: (provider: string, modelId: string) => AvailableModel | undefined
  getState: (managed: ManagedSession) => SessionState
}

interface CreateSessionStoreOptions {
  rootCwd: string
  modelRuntime: ModelRuntimeInstance
  publish: (message: ServerMessage) => void
}

const CONTEXT_EVENTS = new Set(['message_end', 'compaction_end', 'agent_settled'])

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const { rootCwd, modelRuntime, publish } = options
  const pool = new Map<string, ManagedSession>()

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

    const { session } = await createAgentSession({
      cwd,
      sessionManager,
      modelRuntime,
    })

    const managed: ManagedSession = { key, session }
    pool.set(key, managed)

    session.subscribe((event) => {
      const context = CONTEXT_EVENTS.has(event.type)
        ? (session.getContextUsage() ?? null) as SessionContext | null
        : undefined
      publish({ type: 'event', session: key, event: event as AgentEvent, context })
    })

    return managed
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
    const known = (await SessionManager.listAll()).find(session => session.path === path)
    if (!known)
      return null
    return openSession({ path: known.path, cwd: known.cwd })
  }

  async function createFreshSession(cwd?: string): Promise<ManagedSession> {
    const resolvedCwd = typeof cwd === 'string' ? (await listDirectories(cwd)).path : rootCwd
    return openSession({ cwd: resolvedCwd, fresh: true })
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
    get: key => pool.get(key),
    listDirectories,
    listSessions,
    getAvailableModels,
    findModel,
    getState,
  }
}
