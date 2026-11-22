import type { ChildProcess } from 'node:child_process'
import type { WorkerCommand, WorkerMessage, WorkerSession } from './messages.ts'
import { Buffer } from 'node:buffer'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { isWorkerMessage, WORKER_PROTOCOL } from './messages.ts'

export class WorkerLostError extends Error {
  constructor(public readonly projectPath: string, public readonly workerId: string, message: string) {
    super(message)
  }
}

interface WorkerOptions {
  agentDir: string
  dataDir: string
  onEvent?: (projectPath: string, event: Extract<WorkerMessage, { type: 'event' }>) => void
  onLost?: (error: WorkerLostError) => void
  /** Explicit artifact entry also permits executable fault fixtures in lifecycle tests. */
  entry?: URL
  execPath?: string
  startTimeoutMs?: number
  stopTimeoutMs?: number
}

/** A project owns a process; no replacement writer is admitted before confirmed exit. */
export function createProjectWorkers(options: WorkerOptions) {
  const workers = new Map<string, ReturnType<typeof spawnProject>>()
  const resolving = new Set<Promise<unknown>>()
  let closing = false
  let closePromise: Promise<void> | undefined
  async function project(path: string, allowStart: boolean) {
    if (closing)
      throw new Error('Project workers are closing')
    const normalized = await realpath(path)
    if (!(await stat(normalized)).isDirectory())
      throw new Error('Project must be a directory')
    if (closing)
      throw new Error('Project workers are closing')
    let worker = workers.get(normalized)
    if (!worker && !allowStart)
      throw new WorkerLostError(normalized, 'unavailable', 'Project worker is no longer available; explicitly reopen the Session')
    if (!worker) {
      worker = spawnProject(normalized, options)
      workers.set(normalized, worker)
      const owned = worker
      void worker.exited.then(() => {
        if (workers.get(normalized) === owned)
          workers.delete(normalized)
      })
    }
    await worker.ready
    return worker
  }
  async function command(path: string, command: WorkerCommand): Promise<unknown> {
    const task = project(path, command.action === 'open')
    resolving.add(task)
    try {
      return await (await task).request(command)
    }
    finally { resolving.delete(task) }
  }
  return {
    command,
    async open(path: string, config: Omit<Extract<WorkerCommand, { action: 'open' }>, 'action'> = {}): Promise<WorkerSession> {
      const result = await command(path, { action: 'open', ...config })
      if (!result || typeof result !== 'object' || !('sessionId' in result) || typeof result.sessionId !== 'string'
        || !('generation' in result) || typeof result.generation !== 'string' || !('sessionPath' in result) || typeof result.sessionPath !== 'string') {
        throw new Error('Invalid worker Session result')
      }
      return { sessionId: result.sessionId, generation: result.generation, sessionPath: result.sessionPath }
    },
    async terminate(path: string) {
      const canonical = await realpath(path)
      const worker = workers.get(canonical)
      if (worker)
        await worker.terminate('Project execution forcibly interrupted')
    },
    close() {
      closing = true
      closePromise ??= (async () => {
        // Stop processes that are still booting immediately, without waiting for ready.
        const results = await Promise.allSettled([...workers.values()].map(worker => worker.close()))
        await Promise.allSettled([...resolving])
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
        if (errors.length)
          throw new AggregateError(errors, 'Project worker exit could not be confirmed')
      })()
      return closePromise
    },
  }
}

function spawnProject(projectPath: string, options: WorkerOptions) {
  const workerId = crypto.randomUUID()
  const nonce = crypto.randomUUID()
  const stopTimeout = options.stopTimeoutMs ?? 5000
  const entry = options.entry ?? new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)
  const child: ChildProcess = fork(fileURLToPath(entry), [], {
    cwd: projectPath,
    execPath: options.execPath ?? process.execPath,
    // Production JS needs no loader. Development uses the installed tsx loader explicitly.
    execArgv: entry.pathname.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  })
  let state: 'starting' | 'ready' | 'stopping' | 'exited' = 'starting'
  let diagnostics = Buffer.alloc(0)
  const pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // A close during startup may precede its caller awaiting ready.
  void ready.catch(() => {})
  let resolveExit!: () => void
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  let closePromise: Promise<void> | undefined
  let lost = false
  let expectedExit = false
  let startDeadline: ReturnType<typeof setTimeout> | undefined
  function fail(message: string) {
    const error = new WorkerLostError(projectPath, workerId, `${message}${diagnostics.length ? `\n${diagnostics.toString('utf8')}` : ''}`)
    rejectReady(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
    if (!lost) {
      lost = true
      try {
        options.onLost?.(error)
      }
      catch (observerError) { console.error('[piflow] worker loss observer failed', observerError) }
    }
  }
  function append(chunk: Buffer) {
    diagnostics = Buffer.concat([diagnostics, chunk.subarray(-8192)]).subarray(-8192)
  }
  child.stdout!.on('data', append)
  child.stderr!.on('data', append)
  function confirmExit() {
    if (state === 'exited')
      return
    state = 'exited'
    clearTimeout(startDeadline)
    if (!expectedExit || pending.size)
      fail('Project worker exited; pending execution outcome is unknown')
    child.stdout?.destroy()
    child.stderr?.destroy()
    resolveExit()
  }
  child.once('exit', confirmExit)
  child.once('error', (error) => {
    fail(`Cannot start or communicate with project worker: ${error.message}`)
    if (!child.pid)
      confirmExit()
    else void terminate('Worker process error').catch(report)
  })
  child.once('disconnect', () => {
    if (state !== 'exited' && state !== 'stopping')
      void terminate('Project worker IPC disconnected').catch(report)
  })
  function report(error: unknown) {
    console.error('[piflow] worker cleanup failed', error)
  }
  startDeadline = setTimeout(() => void terminate('Project worker ready timed out').catch(report), options.startTimeoutMs ?? 15000)
  child.on('message', (raw: unknown) => {
    if (!isWorkerMessage(raw) || raw.workerId !== workerId) {
      void terminate('Invalid project worker protocol').catch(report)
      return
    }
    if (raw.type === 'ready') {
      if (state !== 'starting')
        return
      if (raw.nonce !== nonce || raw.projectPath !== projectPath) {
        void terminate('Invalid project worker handshake').catch(report)
        return
      }
      state = 'ready'
      clearTimeout(startDeadline)
      resolveReady()
    }
    else if (raw.type === 'result') {
      const waiter = pending.get(raw.id)
      if (!waiter)
        return
      pending.delete(raw.id)
      if (raw.ok)
        waiter.resolve(raw.value)
      else waiter.reject(new Error(raw.error))
    }
    else if (state === 'ready') {
      try {
        options.onEvent?.(projectPath, raw)
      }
      catch (error) { console.error('[piflow] worker event observer failed', error) }
    }
  })
  child.send({ version: WORKER_PROTOCOL, workerId, type: 'init', nonce, projectPath, agentDir: resolve(options.agentDir), leasePath: join(resolve(options.dataDir), 'worker-leases', `${createHash('sha256').update(projectPath).digest('hex')}.sqlite`) }, (error) => {
    if (error)
      void terminate('Project worker init failed').catch(report)
  })
  function request(command: WorkerCommand): Promise<unknown> {
    if (state !== 'ready')
      return Promise.reject(new WorkerLostError(projectPath, workerId, 'Project worker is not accepting commands'))
    const id = crypto.randomUUID()
    const result = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    child.send({ version: WORKER_PROTOCOL, workerId, type: 'command', id, command }, (error) => {
      if (error)
        void terminate('Project worker command delivery failed; execution outcome is unknown').catch(report)
    })
    return result
  }
  async function waitForExit(ms: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([exited.then(() => true), new Promise<false>((resolve) => {
        timeout = setTimeout(resolve, ms, false)
      })])
    }
    finally { clearTimeout(timeout) }
  }
  async function killAndConfirm() {
    if (state === 'exited')
      return
    child.kill('SIGTERM')
    if (await waitForExit(stopTimeout))
      return
    child.kill('SIGKILL')
    if (!await waitForExit(stopTimeout))
      throw new WorkerLostError(projectPath, workerId, 'Worker exit unconfirmed; project remains unavailable')
  }
  function terminate(reason: string) {
    if (state !== 'exited') {
      state = 'stopping'
      clearTimeout(startDeadline)
      fail(reason)
    }
    closePromise ??= killAndConfirm()
    return closePromise
  }
  function close() {
    if (closePromise)
      return closePromise
    if (state !== 'ready')
      return terminate('Host closed during worker startup')
    const stopped = request({ action: 'shutdown' })
    state = 'stopping'
    closePromise = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const ack = await Promise.race([stopped.then(() => true, () => false), new Promise<false>((resolve) => {
          timeout = setTimeout(resolve, stopTimeout, false)
        })])
        if (ack && child.connected) {
          expectedExit = true
          child.disconnect()
        }
        if (ack && await waitForExit(stopTimeout))
          return
        fail('Worker graceful shutdown was not confirmed')
        await killAndConfirm()
      }
      finally { clearTimeout(timeout) }
    })()
    return closePromise
  }
  return { ready, exited, request, close, terminate }
}
