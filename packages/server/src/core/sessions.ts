import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AgentSession,
  AgentSessionRuntime,
  ModelInfo,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type {
  DirectoryListing,
  ExtensionUIResponseBody,
  ForkPoint,
  ProjectTrustStatus,
  ServerMessage,
  SessionInfoLite,
  SessionState,
  SessionStatus,
  SessionStatusRecord,
} from '@piflow/protocol'
import type { FlowStore } from '../flow/store'
import { existsSync } from 'node:fs'
import { readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createExtensionUIContext } from '../extensions/extension-ui'
import { createFlowTools, formatFlowDirectory } from '../flow/tools'
import { toJsonEvent } from './json-event'

type ExtensionUI = ReturnType<typeof createExtensionUIContext>
type AvailableModel = ReturnType<ManagedSession['runtime']['services']['modelRuntime']['getAvailableSnapshot']>[number]

export interface ManagedSession {
  key: string
  cwd: string
  runtime: AgentSessionRuntime
  extensionUi: ExtensionUI
  unsubscribe?: () => void
  lastUsed: number
}

/** Thrown when a session mutation would invalidate active work or a dialog. */
export class SessionsStreamingError extends Error {
  constructor(public readonly keys: string[]) {
    super(`sessions are busy: ${keys.join(', ')}`)
    this.name = 'SessionsStreamingError'
  }
}

export interface SessionStore {
  createFreshSession: (cwd?: string, persist?: boolean) => Promise<ManagedSession>
  openSavedSession: (path: string) => Promise<ManagedSession | null>
  prompt: (managed: ManagedSession, text: string, streamingBehavior?: 'steer' | 'followUp') => Promise<void>
  get: (key: string) => ManagedSession | undefined
  listDirectories: (path: string) => Promise<DirectoryListing>
  listSessions: () => Promise<SessionInfoLite[]>
  getAvailableModels: (managed: ManagedSession) => Promise<ModelInfo[]>
  findModel: (managed: ManagedSession, provider: string, modelId: string) => AvailableModel | undefined
  getState: (managed: ManagedSession) => SessionState
  getStateSnapshot: () => SessionState[]
  getStatusSnapshot: () => SessionStatusRecord[]
  publishError: (key: string, error: string) => void
  reloadExtensions: (cwd?: string) => Promise<number>
  assertIdle: (cwd?: string) => void
  respondExtensionUi: (response: ExtensionUIResponseBody) => boolean
  renameSession: (path: string, name: string) => Promise<boolean>
  listForkPoints: (path: string) => Promise<ForkPoint[] | null>
  forkSession: (path: string, entryId: string) => Promise<ManagedSession | null>
  deleteSession: (path: string) => Promise<'deleted' | 'missing' | 'streaming'>
  getProjectTrust: (cwd: string) => ProjectTrustStatus
  trustProject: (cwd: string) => Promise<ProjectTrustStatus>
  disposeAll: () => Promise<void>
}

interface CreateSessionStoreOptions {
  rootCwd: string
  flow: FlowStore
  poolSize: number
  publish: (message: ServerMessage) => void
  agentDir?: string
}

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const { rootCwd, flow, poolSize } = options
  const agentDir = options.agentDir ?? getAgentDir()
  const trustStore = new ProjectTrustStore(agentDir)
  const pool = new Map<string, ManagedSession>()
  const opening = new Map<string, Promise<ManagedSession>>()
  const statuses = new Map<string, SessionStatusRecord>()
  const publish = options.publish

  function activeSessions(): ManagedSession[] {
    return [...new Set(pool.values())]
  }

  function aliases(managed: ManagedSession): string[] {
    return [...pool].flatMap(([key, value]) => value === managed ? [key] : [])
  }

  function remove(managed: ManagedSession) {
    for (const key of aliases(managed))
      pool.delete(key)
    statuses.delete(managed.key)
  }

  function touch(managed: ManagedSession) {
    managed.lastUsed = Date.now()
    const sessionFile = managed.runtime.session.sessionFile
    if (sessionFile)
      pool.set(sessionFile, managed)
  }

  function getRunStatus(session: AgentSession): SessionStatus {
    if (session.isStreaming)
      return 'running'
    return session.state.errorMessage === undefined ? 'idle' : 'failed'
  }

  function updateStatus(managed: ManagedSession) {
    const session = managed.runtime.session
    const status = getRunStatus(session)
    const needsInput = managed.extensionUi.hasPendingDialogs()
    const existing = statuses.get(managed.key)
    const record: SessionStatusRecord = {
      key: managed.key,
      sessionFile: session.sessionFile ?? null,
      status,
      needsInputAt: needsInput ? existing?.needsInputAt ?? new Date().toISOString() : null,
      updatedAt: existing?.status === status ? existing.updatedAt : new Date().toISOString(),
    }
    if (existing
      && existing.status === record.status
      && existing.sessionFile === record.sessionFile
      && existing.needsInputAt === record.needsInputAt) {
      return
    }
    statuses.set(managed.key, record)
    publish({ type: 'status_delta', status: record })
  }

  function getStatusSnapshot(): SessionStatusRecord[] {
    return [...statuses.values()]
  }

  function publishError(key: string, error: string) {
    const managed = pool.get(key)
    if (managed)
      updateStatus(managed)
    publish({ type: 'error', error, session: key })
  }

  function getState(managed: ManagedSession): SessionState {
    const session = managed.runtime.session
    const model = session.model
    return {
      key: managed.key,
      cwd: managed.cwd,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile ?? null,
      messages: session.messages,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      model: model
        ? {
            provider: model.provider,
            id: model.id,
            contextWindow: model.contextWindow,
            reasoning: model.reasoning,
          }
        : null,
      thinkingLevel: session.thinkingLevel,
      thinkingLevels: session.getAvailableThinkingLevels(),
      context: session.getContextUsage() ?? null,
      queue: {
        steering: [...session.getSteeringMessages()],
        followUp: [...session.getFollowUpMessages()],
      },
      extensionRequests: managed.extensionUi.snapshot(),
      error: session.state.errorMessage ?? null,
    }
  }

  function getStateSnapshot(): SessionState[] {
    return activeSessions().map(getState)
  }

  function bind(managed: ManagedSession, session: AgentSession) {
    const extensionUi = createExtensionUIContext(
      request => publish({ ...request, session: managed.key }),
      () => {
        updateStatus(managed)
        publish({ type: 'state', state: getState(managed) })
      },
    )
    managed.extensionUi = extensionUi
    managed.unsubscribe = session.subscribe((event) => {
      touch(managed)
      updateStatus(managed)
      publish({ type: 'event', session: managed.key, event: toJsonEvent(event), context: session.getContextUsage() ?? null })
      if (event.type === 'agent_settled')
        publish({ type: 'state', state: getState(managed) })
    })
    return session.bindExtensions({
      uiContext: extensionUi,
      mode: 'rpc',
      onError: error => publishError(managed.key, String(error)),
    })
  }

  function unbind(managed: ManagedSession) {
    managed.extensionUi.cancelPending()
    managed.unsubscribe?.()
    managed.unsubscribe = undefined
  }

  async function readMessages(path: string, cwd: string): Promise<AgentMessage[]> {
    const resident = pool.get(path)
    if (resident) {
      if (resident.cwd !== cwd)
        throw new Error('Flow session is not part of this project')
      return resident.runtime.session.messages
    }
    const manager = SessionManager.open(path)
    if (manager.getCwd() !== cwd)
      throw new Error('Flow session is not part of this project')
    return manager.buildSessionContext().messages
  }

  async function openSession(opts: { path?: string, cwd: string, key?: string }): Promise<ManagedSession> {
    const key = opts.key ?? opts.path ?? `new:${crypto.randomUUID()}`
    const existing = pool.get(key)
    if (existing) {
      touch(existing)
      return existing
    }
    const pending = opening.get(key)
    if (pending)
      return pending

    const promise = (async () => {
      let managed: ManagedSession | undefined
      const createRuntime = async ({
        cwd,
        agentDir: runtimeAgentDir,
        sessionManager,
        sessionStartEvent,
      }: Parameters<typeof createAgentSessionRuntime>[0] extends (options: infer T) => unknown ? T : never) => {
        const requiresTrust = hasTrustRequiringProjectResources(cwd)
        const projectTrusted = !requiresTrust || trustStore.get(cwd) === true
        const settingsManager = SettingsManager.create(cwd, runtimeAgentDir, { projectTrusted })
        const services = await createAgentSessionServices({
          cwd,
          agentDir: runtimeAgentDir,
          settingsManager,
          resourceLoaderReloadOptions: requiresTrust
            ? { resolveProjectTrust: async () => projectTrusted }
            : undefined,
        })
        const created = await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          customTools: createFlowTools({
            flow,
            source: () => managed ? toolSession(managed) : undefined,
            resolveTarget: async (node, projectPath) => {
              const target = await openSavedSession(node.sessionPath)
              if (!target || target.cwd !== projectPath)
                throw new Error('target Flow session is not part of this project')
              return toolSession(target)
            },
            readMessages: (node, projectPath) => readMessages(node.sessionPath, projectPath),
            onDispatchError: (target, error) => publishError(target.sessionPath ?? target.cwd, String(error)),
          }),
        })
        return { ...created, services, diagnostics: services.diagnostics }
      }

      const sessionManager = opts.path ? SessionManager.open(opts.path) : SessionManager.create(opts.cwd)
      const runtime = await createAgentSessionRuntime(createRuntime, {
        cwd: opts.cwd,
        agentDir,
        sessionManager,
      })
      managed = {
        key,
        cwd: runtime.cwd,
        runtime,
        extensionUi: undefined as unknown as ExtensionUI,
        lastUsed: Date.now(),
      }
      pool.set(key, managed)
      touch(managed)
      runtime.setBeforeSessionInvalidate(() => unbind(managed!))
      runtime.setRebindSession(async (session) => {
        managed!.cwd = runtime.cwd
        await bind(managed!, session)
        touch(managed!)
      })
      try {
        await bind(managed, runtime.session)
        updateStatus(managed)
        await evictIfNeeded(managed)
        return managed
      }
      catch (error) {
        remove(managed)
        await runtime.dispose()
        throw error
      }
    })()

    opening.set(key, promise)
    try {
      return await promise
    }
    finally {
      opening.delete(key)
    }
  }

  function toolSession(managed: ManagedSession) {
    const session = managed.runtime.session
    return {
      cwd: managed.cwd,
      sessionPath: session.sessionFile ?? null,
      messages: session.messages,
      isStreaming: session.isStreaming,
      prompt: (text: string, followUp: boolean) => prompt(managed, text, followUp ? 'followUp' : undefined),
    }
  }

  async function evictIfNeeded(exclude?: ManagedSession) {
    while (activeSessions().length > poolSize) {
      const candidate = activeSessions()
        .filter(managed => managed !== exclude
          && managed.runtime.session.isIdle
          && !!managed.runtime.session.sessionFile
          && existsSync(managed.runtime.session.sessionFile)
          && !managed.extensionUi.hasPendingDialogs())
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!candidate)
        return
      remove(candidate)
      unbind(candidate)
      await candidate.runtime.dispose()
    }
  }

  async function injectFlowDirectory(managed: ManagedSession) {
    const session = managed.runtime.session
    if (!session.sessionFile)
      return
    const directory = formatFlowDirectory(await flow.read(managed.cwd), session.sessionFile)
    if (directory) {
      await session.sendCustomMessage({
        customType: 'flow_directory',
        content: directory,
        display: false,
      })
    }
  }

  async function prompt(managed: ManagedSession, text: string, streamingBehavior?: 'steer' | 'followUp') {
    touch(managed)
    await injectFlowDirectory(managed)
    const session = managed.runtime.session
    if (streamingBehavior === 'steer')
      await session.steer(text)
    else if (streamingBehavior === 'followUp')
      await session.followUp(text)
    else
      await session.prompt(text)
  }

  async function listSessions(): Promise<SessionInfoLite[]> {
    const all = await SessionManager.listAll()
    return all
      .map(session => ({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name ?? null,
        parentSession: session.parentSessionPath ?? null,
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
    return { path: directory, parent: parent === directory ? null : parent, directories }
  }

  async function openSavedSession(path: string): Promise<ManagedSession | null> {
    const resident = pool.get(path)
    if (resident) {
      touch(resident)
      return resident
    }
    const known = (await SessionManager.listAll()).find(session => session.path === path)
    return known ? openSession({ path: known.path, cwd: known.cwd }) : null
  }

  async function createFreshSession(cwd?: string, persist = false): Promise<ManagedSession> {
    const resolvedCwd = typeof cwd === 'string' ? (await listDirectories(cwd)).path : rootCwd
    const manager = SessionManager.create(resolvedCwd)
    if (persist)
      await persistEmptySession(manager)
    return openSession({ path: persist ? manager.getSessionFile() : undefined, cwd: resolvedCwd })
  }

  async function getAvailableModels(managed: ManagedSession): Promise<ModelInfo[]> {
    touch(managed)
    return (await managed.runtime.services.modelRuntime.getAvailable()).map(model => ({
      provider: model.provider,
      id: model.id,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
    }))
  }

  function findModel(managed: ManagedSession, provider: string, modelId: string) {
    return managed.runtime.services.modelRuntime.getAvailableSnapshot()
      .find(model => model.provider === provider && model.id === modelId)
  }

  async function reloadExtensions(cwd?: string): Promise<number> {
    const affected = activeSessions().filter(managed => cwd === undefined || managed.cwd === cwd)
    assertIdle(cwd)
    for (const managed of affected) {
      managed.extensionUi.reset()
      await managed.runtime.session.reload()
      publish({ type: 'state', state: getState(managed) })
    }
    return affected.length
  }

  function assertIdle(cwd?: string) {
    const busy = activeSessions().filter(managed => (cwd === undefined || managed.cwd === cwd)
      && (!managed.runtime.session.isIdle || managed.extensionUi.hasPendingDialogs()))
    if (busy.length)
      throw new SessionsStreamingError(busy.map(managed => managed.key))
  }

  function respondExtensionUi(response: ExtensionUIResponseBody): boolean {
    const managed = pool.get(response.session)
    return managed?.extensionUi.respond(response) ?? false
  }

  async function renameSession(path: string, name: string): Promise<boolean> {
    const managed = pool.get(path)
    if (managed) {
      managed.runtime.session.setSessionName(name)
      return true
    }
    if (!existsSync(path))
      return false
    SessionManager.open(path).appendSessionInfo(name)
    return true
  }

  async function listForkPoints(path: string): Promise<ForkPoint[] | null> {
    const managed = pool.get(path)
    if (!managed && !existsSync(path))
      return null
    const manager = managed?.runtime.session.sessionManager ?? SessionManager.open(path)
    return manager.getEntries().flatMap((entry) => {
      const text = userMessageText(entry)
      return text ? [{ entryId: entry.id, text: text.slice(0, 120) }] : []
    })
  }

  async function forkSession(path: string, entryId: string): Promise<ManagedSession | null> {
    const managed = await openSavedSession(path)
    if (!managed)
      return null
    if (!managed.runtime.session.isIdle || managed.extensionUi.hasPendingDialogs())
      throw new SessionsStreamingError([managed.key])
    const previousKey = managed.key
    const result = await managed.runtime.fork(entryId)
    if (result.cancelled)
      return null
    const branchedPath = managed.runtime.session.sessionFile
    if (!branchedPath)
      throw new Error('fork did not create a persisted session')
    remove(managed)
    managed.key = branchedPath
    pool.set(branchedPath, managed)
    updateStatus(managed)
    statuses.delete(previousKey)
    publish({ type: 'state', state: getState(managed) })
    return managed
  }

  async function deleteSession(path: string): Promise<'deleted' | 'missing' | 'streaming'> {
    const managed = pool.get(path)
    if (managed) {
      if (!managed.runtime.session.isIdle || managed.extensionUi.hasPendingDialogs())
        return 'streaming'
      remove(managed)
      unbind(managed)
      await managed.runtime.dispose()
    }
    if (!existsSync(path))
      return managed ? 'deleted' : 'missing'
    await unlink(path)
    return 'deleted'
  }

  function getProjectTrust(cwd: string): ProjectTrustStatus {
    const requiresTrust = hasTrustRequiringProjectResources(cwd)
    return { cwd, requiresTrust, trusted: !requiresTrust || trustStore.get(cwd) === true }
  }

  async function trustProject(cwd: string): Promise<ProjectTrustStatus> {
    const busy = activeSessions().filter(managed => managed.cwd === cwd
      && (!managed.runtime.session.isIdle || managed.extensionUi.hasPendingDialogs()))
    if (busy.length)
      throw new SessionsStreamingError(busy.map(managed => managed.key))
    trustStore.set(cwd, true)
    for (const managed of activeSessions().filter(managed => managed.cwd === cwd)) {
      const sessionFile = managed.runtime.session.sessionFile
      const key = managed.key
      remove(managed)
      unbind(managed)
      await managed.runtime.dispose()
      if (sessionFile && existsSync(sessionFile))
        await openSession({ path: sessionFile, cwd, key })
      else
        await openSession({ cwd, key })
    }
    return getProjectTrust(cwd)
  }

  async function disposeAll() {
    const active = activeSessions()
    pool.clear()
    statuses.clear()
    await Promise.all(active.map(async (managed) => {
      unbind(managed)
      await managed.runtime.dispose()
    }))
  }

  return {
    createFreshSession,
    openSavedSession,
    prompt,
    get: (key) => {
      const managed = pool.get(key)
      if (managed)
        touch(managed)
      return managed
    },
    listDirectories,
    listSessions,
    getAvailableModels,
    findModel,
    getState,
    getStateSnapshot,
    getStatusSnapshot,
    publishError,
    reloadExtensions,
    assertIdle,
    respondExtensionUi,
    renameSession,
    listForkPoints,
    forkSession,
    deleteSession,
    getProjectTrust,
    trustProject,
    disposeAll,
  }
}

export function userMessageText(entry: SessionEntry): string | null {
  if (entry.type !== 'message' || entry.message.role !== 'user')
    return null
  const content = entry.message.content
  const text = typeof content === 'string'
    ? content
    : content.map(part => part.type === 'text' ? part.text : '').join(' ')
  return text.replace(/\s+/g, ' ').trim()
}

export function settledStatusFromMessages(messages: AgentMessage[]): 'idle' | 'failed' {
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
