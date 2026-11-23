import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import type { HostMessage, WorkerCommand, WorkerMessage } from './messages.ts'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, hasTrustRequiringProjectResources, ProjectTrustStore, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { toJsonEvent } from '../sessions/json-event.ts'
import { isHostMessage, RuntimeCommandError, WORKER_PROTOCOL } from './messages.ts'

if (!process.send)
  throw new Error('Project worker requires a private parent IPC channel')
let init: Extract<HostMessage, { type: 'init' }> | undefined
let closing = false
let lease: DatabaseSync | undefined
const sessions = new Map<string, { runtime: AgentSessionRuntime, generation: string, unsubscribe: () => void }>()
const pending = new Set<Promise<unknown>>()
const closingSessions = new Set<string>()
const opening = new Map<string, Promise<unknown>>()
let shutdown: Promise<void> | undefined

function send(message: WorkerMessage) {
  if (process.connected) {
    process.send!(message, (error) => {
      if (error)
        void close()
    })
  }
}
function close() {
  if (shutdown)
    return shutdown
  closing = true
  shutdown = (async () => {
    await Promise.allSettled([...opening.values()])
    await Promise.allSettled([...sessions.values()].map(entry => entry.runtime.session.abort()))
    await Promise.allSettled([...pending])
    await Promise.all([...sessions.values()].map(async (entry) => {
      entry.unsubscribe()
      await entry.runtime.dispose()
    }))
    sessions.clear()
    lease?.close()
    lease = undefined
  })()
  return shutdown
}
process.once('disconnect', () => {
  // Parent loss must never leave an unattended writer. Extensions can block cleanup;
  // an independent timer bounds the cooperative path when the event loop is responsive.
  const deadline = setTimeout(() => process.exit(1), 5000)
  void close().then(() => {
    clearTimeout(deadline)
    process.exit(0)
  }, () => process.exit(1))
})
const bootDeadline = setTimeout(() => process.exit(1), 10000)

async function execute(command: WorkerCommand): Promise<unknown> {
  if (!init || closing)
    throw new Error('Project worker is not accepting work')
  if (command.action === 'shutdown') {
    await close()
    return null
  }
  if (command.action === 'open') {
    const path = command.sessionPath
    if (path) {
      const existing = [...sessions.values()].find(entry => entry.runtime.session.sessionFile === path)
      if (existing && closingSessions.has(existing.runtime.session.sessionId))
        throw new RuntimeCommandError('session-busy', 'Session is closing')
      if (existing)
        return { sessionId: existing.runtime.session.sessionId, sessionPath: path, generation: existing.generation }
      const pendingOpen = opening.get(path)
      if (pendingOpen)
        return pendingOpen
    }
    const key = path ?? crypto.randomUUID()
    const task = (async () => {
      const { projectPath, agentDir } = init!
      const manager = path ? SessionManager.open(path) : SessionManager.create(projectPath, join(agentDir, 'sessions', encodeURIComponent(projectPath)))
      if (await realpath(manager.getCwd()) !== projectPath)
        throw new RuntimeCommandError('project-mismatch', 'Session is not part of this project')
      const runtime = await createAgentSessionRuntime(async (options) => {
        const trusted = !hasTrustRequiringProjectResources(options.cwd) || new ProjectTrustStore(agentDir).get(options.cwd) === true
        const services = await createAgentSessionServices({
          cwd: options.cwd,
          agentDir,
          settingsManager: SettingsManager.create(options.cwd, agentDir, { projectTrusted: trusted }),
          resourceLoaderReloadOptions: { resolveProjectTrust: async () => trusted },
        })
        const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager })
        return { ...created, services, diagnostics: services.diagnostics }
      }, { cwd: projectPath, agentDir, sessionManager: manager })
      try {
        if (closing)
          throw new Error('Project worker is closing')
        if (command.model) {
          const model = runtime.services.modelRuntime.getAvailableSnapshot().find(model => model.provider === command.model!.provider && model.id === command.model!.id)
          if (!model)
            throw new RuntimeCommandError('model-not-found', 'Model not found')
          await runtime.session.setModel(model)
        }
        const sessionId = runtime.session.sessionId
        if (sessions.has(sessionId))
          throw new Error('Session already open')
        const generation = crypto.randomUUID()
        const unsubscribe = runtime.session.subscribe(event => send({ version: WORKER_PROTOCOL, workerId: init!.workerId, type: 'event', sessionId, generation, event: toJsonEvent(event) }))
        sessions.set(sessionId, { runtime, generation, unsubscribe })
        return { sessionId, generation, sessionPath: runtime.session.sessionFile! }
      }
      catch (error) {
        await runtime.dispose()
        throw error
      }
    })()
    opening.set(key, task)
    try {
      return await task
    }
    finally { opening.delete(key) }
  }
  const entry = sessions.get(command.sessionId)
  if (!entry || closingSessions.has(command.sessionId) || entry.generation !== command.generation)
    throw new RuntimeCommandError('stale-target', 'Stale Session target')
  switch (command.action) {
    case 'prompt': {
      const queued = !entry.runtime.session.isIdle
      await entry.runtime.session.prompt(command.text, { streamingBehavior: command.streamingBehavior })
      return { observation: queued ? 'queued-or-handled' : 'prompt-returned' }
    }
    case 'abort':
      await entry.runtime.session.abort()
      return { idle: entry.runtime.session.isIdle }
    case 'snapshot':
      return { messages: entry.runtime.session.messages, isIdle: entry.runtime.session.isIdle, sessionPath: entry.runtime.session.sessionFile }
    case 'closeSession':
      if (!entry.runtime.session.isIdle)
        throw new RuntimeCommandError('session-busy', 'Session is busy')
      closingSessions.add(command.sessionId)
      entry.unsubscribe()
      await entry.runtime.dispose()
      sessions.delete(command.sessionId)
      closingSessions.delete(command.sessionId)
      return null
  }
}
process.on('message', (raw: unknown) => {
  if (!isHostMessage(raw)) {
    process.disconnect()
    return
  }
  if (raw.type === 'init') {
    if (init) {
      process.disconnect()
      return
    }
    init = raw
    const boot = (async () => {
      await mkdir(dirname(raw.leasePath), { recursive: true, mode: 0o700 })
      if (closing)
        return
      lease = new DatabaseSync(raw.leasePath)
      lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
      clearTimeout(bootDeadline)
      send({ version: WORKER_PROTOCOL, workerId: raw.workerId, type: 'ready', nonce: raw.nonce, projectPath: raw.projectPath })
    })()
    void boot.catch((error) => {
      console.error('Cannot acquire project execution lease', error)
      process.disconnect()
    })
    return
  }
  if (!init || raw.workerId !== init.workerId) {
    process.disconnect()
    return
  }
  const task = execute(raw.command)
  // Shutdown waits for admitted operations, never for its own completion.
  if (raw.command.action !== 'shutdown')
    pending.add(task)
  void task.then(
    value => send({ version: WORKER_PROTOCOL, workerId: raw.workerId, type: 'result', id: raw.id, ok: true, value }),
    error => send({ version: WORKER_PROTOCOL, workerId: raw.workerId, type: 'result', id: raw.id, ok: false, code: error instanceof RuntimeCommandError ? error.code : 'execution-failed', error: String(error).slice(0, 2000) }),
  ).finally(() => pending.delete(task))
})
