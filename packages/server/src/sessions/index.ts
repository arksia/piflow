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
  FlowDocument,
  ForkPoint,
  ProjectTrustStatus,
  ServerMessage,
  SessionInfoLite,
  SessionState,
  SessionStatus,
  SessionStatusRecord,
} from '@piflow/protocol'
import type { FlowStore } from '../flow/store'
import type { Reviews } from '../reviews'
import type { ReviewGeneration } from '../reviews/generation'
import type { SubagentRuns } from '../runs'
import { existsSync } from 'node:fs'
import { readdir, realpath, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  resolveModelScopeWithDiagnostics,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createExtensionUIContext } from '../extensions/extension-ui'
import { conductorContext } from '../flow/conductor'
import { createDeliveries } from '../flow/delivery'
import { findNodeBySession } from '../flow/store'
import { createSubagentTools, orchestrationContext } from '../flow/subagents'
import { createFlowTools, formatFlowDirectory, moduleContext } from '../flow/tools'
import { toJsonEvent } from './json-event'

type ExtensionUI = ReturnType<typeof createExtensionUIContext>
type AvailableModel = ReturnType<ManagedSession['runtime']['services']['modelRuntime']['getAvailableSnapshot']>[number]

function modelInfo(model: AvailableModel) {
  return { provider: model.provider, id: model.id, contextWindow: model.contextWindow, reasoning: model.reasoning }
}

export interface ManagedSession {
  key: string
  cwd: string
  runtime: AgentSessionRuntime
  extensionUi: ExtensionUI
  unsubscribe?: () => void
  lastUsed: number
  modelDiagnostics: SessionState['modelDiagnostics']
}

/** Thrown when a session mutation would invalidate active work or a dialog. */
export class SessionsStreamingError extends Error {
  constructor(public readonly keys: string[]) {
    super(`sessions are busy: ${keys.join(', ')}`)
    this.name = 'SessionsStreamingError'
  }
}

export interface SessionStore {
  createFreshSession: (cwd?: string) => Promise<ManagedSession>
  startFlowNodePrompt: (projectPath: string, nodeId: string, text: string) => Promise<ManagedSession>
  startFlowConductorPrompt: (projectPath: string, text: string) => Promise<ManagedSession>
  openSavedSession: (path: string, options?: { refresh?: boolean }) => Promise<ManagedSession | null>
  prompt: (managed: ManagedSession, text: string, images?: NonNullable<import('@piflow/protocol').PromptRequest['images']>, streamingBehavior?: 'steer' | 'followUp') => Promise<void>
  compact: (managed: ManagedSession, instructions?: string) => Promise<void>
  abortCompaction: (managed: ManagedSession) => void
  setAutoCompaction: (managed: ManagedSession, enabled: boolean) => void
  get: (key: string) => ManagedSession | undefined
  listDirectories: (path: string) => Promise<DirectoryListing>
  listSessions: (options?: { includeFlow?: boolean }) => Promise<SessionInfoLite[]>
  getAvailableModels: (managed: ManagedSession) => Promise<ModelInfo[]>
  findModel: (managed: ManagedSession, provider: string, modelId: string) => AvailableModel | undefined
  getState: (managed: ManagedSession) => SessionState
  getStateSnapshot: () => SessionState[]
  getStatusSnapshot: () => SessionStatusRecord[]
  publishError: (key: string, error: string) => void
  reloadExtensions: (cwd?: string) => Promise<number>
  refreshProvider: (providerId: string) => Promise<number>
  assertProviderIdle: (providerId: string) => void
  assertIdle: (cwd?: string) => void
  respondExtensionUi: (response: ExtensionUIResponseBody) => boolean
  renameSession: (path: string, name: string) => Promise<boolean>
  listForkPoints: (path: string) => Promise<ForkPoint[] | null>
  forkSession: (path: string, entryId: string) => Promise<ManagedSession | null>
  getSessionTree: (path: string) => Promise<import('@piflow/protocol').SessionTreeResponse | null>
  navigateTree: (path: string, targetId: string) => Promise<ManagedSession | null>
  deleteSession: (path: string) => Promise<'deleted' | 'missing' | 'streaming'>
  getProjectTrust: (cwd: string) => ProjectTrustStatus
  trustProject: (cwd: string) => Promise<ProjectTrustStatus>
  disposeAll: () => Promise<void>
}

interface CreateSessionStoreOptions {
  runs?: SubagentRuns
  reviews?: Reviews
  reviewGeneration?: ReviewGeneration
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
  const creatingFlowSessions = new Map<string, Promise<ManagedSession>>()
  const creatingConductors = new Map<string, Promise<ManagedSession>>()
  const flowPromptQueues = new Map<string, Promise<void>>()
  const statuses = new Map<string, SessionStatusRecord>()
  const publish = options.publish
  const deliveries = createDeliveries(flow, async (node, projectPath) => {
    const managed = node.sessionPath
      ? await openSavedSession(node.sessionPath)
      : await createFlowNodeSession(projectPath, node.id)
    if (!managed || managed.cwd !== projectPath)
      return null
    const session = managed.runtime.session
    return {
      get isStreaming() {
        return session.isStreaming
      },
      prompt: async (text, followUp) => {
        try {
          await prompt(managed, text, undefined, followUp ? 'followUp' : undefined)
        }
        catch (error) {
          if (managed.runtime.session.messages.length === 0 && managed.runtime.session.sessionFile) {
            await flow.clearNodeSession(projectPath, node.id, managed.runtime.session.sessionFile).catch(() => {})
            remove(managed)
            unbind(managed)
            await managed.runtime.dispose()
          }
          throw error
        }
      },
    }
  })

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
      autoCompactionEnabled: session.autoCompactionEnabled,
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
      modelScope: session.scopedModels.map(scoped => ({
        model: modelInfo(scoped.model),
        ...(scoped.thinkingLevel ? { thinkingLevel: scoped.thinkingLevel } : {}),
      })),
      modelDiagnostics: managed.modelDiagnostics,
      stats: session.getSessionStats(),
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
      if (event.type === 'agent_settled' || event.type === 'compaction_end')
        publish({ type: 'state', state: getState(managed) })
      if (event.type === 'agent_settled') {
        const sessionFile = session.sessionFile
        if (sessionFile) {
          void deliveries.settle(managed.cwd, sessionFile, session.messages)
            .catch(error => publishError(managed.key, error instanceof Error ? error.message : String(error)))
        }
      }
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

  async function openSession(opts: { path?: string, cwd: string, key?: string, conductor?: boolean }): Promise<ManagedSession> {
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
        const sessionFile = sessionManager.getSessionFile()
        const conductor = Boolean(opts.conductor || (sessionFile && (await flow.read(cwd)).conductorPath === sessionFile))
        const services = await createAgentSessionServices({
          cwd,
          agentDir: runtimeAgentDir,
          settingsManager,
          resourceLoaderOptions: {
            extensionFactories: [{
              name: 'piflow-module',
              hidden: true,
              factory(pi) {
                pi.on('before_agent_start', async (event, ctx) => {
                  const activeFile = ctx.sessionManager.getSessionFile()
                  if (!activeFile)
                    return
                  const document = await flow.read(ctx.cwd)
                  if (document.conductorPath === activeFile) {
                    event.systemPromptOptions.contextFiles.push(conductorContext(await flow.readModules(ctx.cwd)))
                    return
                  }
                  const node = findNodeBySession(document, activeFile)
                  const context = node ? moduleContext(node) : null
                  if (context)
                    event.systemPromptOptions.contextFiles.push(context)
                  const orchestration = node ? orchestrationContext(document, node) : null
                  if (orchestration)
                    event.systemPromptOptions.contextFiles.push(orchestration)
                })
              },
            }],
          },
          resourceLoaderReloadOptions: requiresTrust
            ? { resolveProjectTrust: async () => projectTrusted }
            : undefined,
        })
        const created = await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          customTools: conductor
            ? []
            : [...createFlowTools({
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
              }), ...(options.runs
                ? createSubagentTools({
                    runs: options.runs,
                    reviews: options.reviews,
                    reviewGeneration: options.reviewGeneration,
                    agentDir: runtimeAgentDir,
                    flow,
                    isTrusted: cwd => !hasTrustRequiringProjectResources(cwd) || trustStore.get(cwd) === true,
                    source: () => managed
                      ? { cwd: managed.cwd, sessionPath: managed.runtime.session.sessionManager.getSessionFile() ?? null, model: managed.runtime.session.model ? `${managed.runtime.session.model.provider}/${managed.runtime.session.model.id}` : '', thinkingLevel: managed.runtime.session.thinkingLevel, tools: managed.runtime.session.getActiveToolNames() }
                      : undefined,
                  })
                : [])],
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
        modelDiagnostics: [...(runtime.diagnostics ?? [])],
      }
      const enabledModels = runtime.services.settingsManager.getEnabledModels()
      if (enabledModels?.length) {
        const { diagnostics } = await resolveModelScopeWithDiagnostics(enabledModels, runtime.services.modelRuntime)
        managed.modelDiagnostics = [...(managed.modelDiagnostics ?? []), ...diagnostics]
      }
      pool.set(key, managed)
      touch(managed)
      runtime.setBeforeSessionInvalidate(() => unbind(managed!))
      runtime.setRebindSession(async (session) => {
        managed!.cwd = runtime.cwd
        await bind(managed!, session)
        touch(managed!)
        const sessionFile = session.sessionFile
        if (sessionFile) {
          await deliveries.resume(managed!.cwd, sessionFile)
            .catch(error => publishError(managed!.key, error instanceof Error ? error.message : String(error)))
        }
      })
      try {
        await bind(managed, runtime.session)
        updateStatus(managed)
        await evictIfNeeded(managed)
        const sessionFile = managed.runtime.session.sessionFile
        if (sessionFile) {
          await deliveries.resume(managed.cwd, sessionFile)
            .catch(error => publishError(managed.key, error instanceof Error ? error.message : String(error)))
        }
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
      prompt: (text: string, followUp: boolean) => prompt(managed, text, undefined, followUp ? 'followUp' : undefined),
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
    const document = await flow.read(managed.cwd)
    if (document.conductorPath === session.sessionFile)
      return
    const directory = formatFlowDirectory(document, session.sessionFile)
    if (directory) {
      await session.sendCustomMessage({
        customType: 'flow_directory',
        content: directory,
        display: false,
      })
    }
  }

  async function prompt(managed: ManagedSession, text: string, images?: NonNullable<import('@piflow/protocol').PromptRequest['images']>, streamingBehavior?: 'steer' | 'followUp') {
    touch(managed)
    await injectFlowDirectory(managed)
    await managed.runtime.session.prompt(text, { images, streamingBehavior })
  }

  async function compact(managed: ManagedSession, instructions?: string) {
    const session = managed.runtime.session
    if (!session.isIdle)
      throw new SessionsStreamingError([managed.key])
    await session.compact(instructions?.trim() || undefined)
  }

  function abortCompaction(managed: ManagedSession) {
    managed.runtime.session.abortCompaction()
  }

  function setAutoCompaction(managed: ManagedSession, enabled: boolean) {
    managed.runtime.session.setAutoCompactionEnabled(enabled)
    publish({ type: 'state', state: getState(managed) })
  }

  async function listSessions({ includeFlow = false }: { includeFlow?: boolean } = {}): Promise<SessionInfoLite[]> {
    const all = (await SessionManager.listAll()).filter(session => existsSync(session.cwd))
    const flowDocuments = new Map<string, Promise<FlowDocument | null>>()
    const flowOf = (cwd: string) => {
      const pending = flowDocuments.get(cwd)
      if (pending)
        return pending
      const next = flow.read(cwd).catch(() => null)
      flowDocuments.set(cwd, next)
      return next
    }
    const sessions = await Promise.all(all.map(async (session) => {
      const document = await flowOf(session.cwd)
      if (!includeFlow && document && (document.conductorPath === session.path || document.nodes.some(node => node.sessionPath === session.path)))
        return null
      return {
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name ?? null,
        conductor: document?.conductorPath === session.path,
        parentSession: session.parentSessionPath ?? null,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstMessage: session.firstMessage.slice(0, 120),
      }
    }))
    return sessions.filter((session): session is NonNullable<typeof session> => session !== null).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
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

  async function openSavedSession(path: string, options: { refresh?: boolean } = {}): Promise<ManagedSession | null> {
    const resident = pool.get(path)
    if (resident) {
      if (options.refresh && resident.runtime.session.isIdle && !resident.extensionUi.hasPendingDialogs()) {
        remove(resident)
        unbind(resident)
        await resident.runtime.dispose()
        if (!existsSync(path))
          return null
        return openSession({ path, cwd: resident.cwd })
      }
      touch(resident)
      return resident
    }
    const known = (await SessionManager.listAll()).find(session => session.path === path)
    return known ? openSession({ path: known.path, cwd: known.cwd }) : null
  }

  async function createFreshSession(cwd?: string): Promise<ManagedSession> {
    const resolvedCwd = typeof cwd === 'string' ? (await listDirectories(cwd)).path : rootCwd
    return openSession({ cwd: resolvedCwd })
  }

  async function createFlowNodeSession(projectPath: string, nodeId: string): Promise<ManagedSession> {
    const document = await flow.read(projectPath)
    const node = document.nodes.find(item => item.id === nodeId)
    if (!node || node.kind === 'subagent-role')
      throw new Error('persistent Flow node not found')
    if (node.sessionPath) {
      const managed = await openSavedSession(node.sessionPath)
      if (!managed)
        throw new Error('Flow node session is unavailable')
      return managed
    }

    const key = `${document.projectPath}\0${nodeId}`
    const pending = creatingFlowSessions.get(key)
    if (pending)
      return pending
    const creating = (async () => {
      const latest = await flow.read(document.projectPath)
      const current = latest.nodes.find(item => item.id === nodeId)
      if (!current || current.kind === 'subagent-role')
        throw new Error('persistent Flow node not found')
      if (current.sessionPath) {
        const existing = await openSavedSession(current.sessionPath)
        if (!existing)
          throw new Error('Flow node session is unavailable')
        return existing
      }
      const managed = await createFreshSession(latest.projectPath)
      const path = managed.runtime.session.sessionFile
      if (!path)
        throw new Error('Flow session path is unavailable')
      try {
        await flow.bindNodeSession(latest.projectPath, nodeId, path)
      }
      catch (error) {
        unbind(managed)
        await managed.runtime.dispose()
        remove(managed)
        throw error
      }
      return managed
    })()
    creatingFlowSessions.set(key, creating)
    try {
      return await creating
    }
    finally {
      if (creatingFlowSessions.get(key) === creating)
        creatingFlowSessions.delete(key)
    }
  }

  async function createFlowConductorSession(projectPath: string): Promise<ManagedSession> {
    const document = await flow.read(projectPath)
    if (document.conductorPath) {
      const managed = await openSavedSession(document.conductorPath)
      if (!managed)
        throw new Error('Flow Conductor session is unavailable')
      return managed
    }
    const key = document.projectPath
    const pending = creatingConductors.get(key)
    if (pending)
      return pending
    const creating = (async () => {
      const latest = await flow.read(key)
      if (latest.conductorPath) {
        const existing = await openSavedSession(latest.conductorPath)
        if (!existing)
          throw new Error('Flow Conductor session is unavailable')
        return existing
      }
      const managed = await openSession({ cwd: latest.projectPath, conductor: true })
      const path = managed.runtime.session.sessionFile
      if (!path)
        throw new Error('Flow Conductor session path is unavailable')
      try {
        await flow.setConductor(latest.projectPath, path)
      }
      catch (error) {
        remove(managed)
        unbind(managed)
        await managed.runtime.dispose()
        throw error
      }
      return managed
    })()
    creatingConductors.set(key, creating)
    try {
      return await creating
    }
    finally {
      if (creatingConductors.get(key) === creating)
        creatingConductors.delete(key)
    }
  }

  async function startFlowNodePrompt(projectPath: string, nodeId: string, text: string): Promise<ManagedSession> {
    const managed = await createFlowNodeSession(projectPath, nodeId)
    enqueueFlowPrompt(managed, text, async (error) => {
      publishError(managed.key, error instanceof Error ? error.message : String(error))
      if (managed.runtime.session.messages.length === 0 && managed.runtime.session.sessionFile) {
        await flow.clearNodeSession(projectPath, nodeId, managed.runtime.session.sessionFile).catch(() => {})
        remove(managed)
        unbind(managed)
        await managed.runtime.dispose()
      }
    })
    return managed
  }

  async function startFlowConductorPrompt(projectPath: string, text: string): Promise<ManagedSession> {
    const managed = await createFlowConductorSession(projectPath)
    enqueueFlowPrompt(managed, text, async (error) => {
      publishError(managed.key, error instanceof Error ? error.message : String(error))
      if (managed.runtime.session.messages.length === 0 && managed.runtime.session.sessionFile) {
        await flow.clearConductor(projectPath, managed.runtime.session.sessionFile).catch(() => {})
        remove(managed)
        unbind(managed)
        await managed.runtime.dispose()
      }
    })
    return managed
  }

  function enqueueFlowPrompt(managed: ManagedSession, text: string, onError: (error: unknown) => Promise<void>) {
    const previous = flowPromptQueues.get(managed.key) ?? Promise.resolve()
    const task = previous.then(() => prompt(managed, text, undefined, managed.runtime.session.isStreaming ? 'followUp' : undefined))
    const settled = task.then(() => {}, () => {}).finally(() => {
      if (flowPromptQueues.get(managed.key) === settled)
        flowPromptQueues.delete(managed.key)
    })
    flowPromptQueues.set(managed.key, settled)
    void task.catch(error => onError(error))
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

  async function refreshProvider(providerId: string): Promise<number> {
    const affected = activeSessions().filter(managed =>
      managed.runtime.services.modelRuntime.getProvider(providerId) !== undefined)
    assertProviderIdle(providerId)
    for (const managed of affected) {
      await managed.runtime.services.modelRuntime.refresh({
        allowNetwork: true,
        force: true,
        providers: [providerId],
        signal: AbortSignal.timeout(15_000),
      })
      publish({ type: 'state', state: getState(managed) })
    }
    return affected.length
  }

  function assertProviderIdle(providerId: string) {
    const busy = activeSessions().filter(managed =>
      managed.runtime.services.modelRuntime.getProvider(providerId) !== undefined
      && (!managed.runtime.session.isIdle || managed.extensionUi.hasPendingDialogs()))
    if (busy.length)
      throw new SessionsStreamingError(busy.map(managed => managed.key))
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

  async function getSessionTree(path: string) {
    const managed = await openSavedSession(path)
    if (!managed)
      return null
    const manager = managed.runtime.session.sessionManager
    return { tree: manager.getTree(), leafId: manager.getLeafId() }
  }

  async function navigateTree(path: string, targetId: string) {
    const managed = await openSavedSession(path)
    if (!managed)
      return null
    if (managed.runtime.session.isStreaming || managed.extensionUi.hasPendingDialogs())
      throw new SessionsStreamingError([managed.key])
    const result = await managed.runtime.session.navigateTree(targetId, { summarize: false })
    if (result.cancelled)
      return managed
    publish({ type: 'state', state: getState(managed) })
    updateStatus(managed)
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
    startFlowNodePrompt,
    startFlowConductorPrompt,
    openSavedSession,
    prompt,
    compact,
    abortCompaction,
    setAutoCompaction,
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
    refreshProvider,
    assertProviderIdle,
    assertIdle,
    respondExtensionUi,
    renameSession,
    listForkPoints,
    forkSession,
    getSessionTree,
    navigateTree,
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
