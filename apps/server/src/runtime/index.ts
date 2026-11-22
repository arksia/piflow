import type { FactsStore } from '../facts/store.ts'
import type { WorkerCommand, WorkerSession } from './messages.ts'
import { realpath } from 'node:fs/promises'
import { createProjectWorkers, WorkerLostError } from './project-workers.ts'

export interface ProjectSession extends WorkerSession { projectPath: string }

/** Host owns submission facts; child processes own only pi runtimes and native history. */
export function createProjectRuntime(options: Parameters<typeof createProjectWorkers>[0] & { facts: FactsStore }) {
  let recordingError: unknown
  function record<T>(work: () => T): T {
    try {
      return work()
    }
    catch (error) {
      recordingError = error
      throw error
    }
  }
  const owned = new Map<string, ProjectSession>()
  const workers = createProjectWorkers({ ...options, onLost(error) {
    const failures: unknown[] = []
    for (const session of owned.values()) {
      if (session.projectPath === error.projectPath) {
        try {
          record(() => options.facts.interruptSession(session.projectPath, session.sessionId))
        }
        catch (error) { failures.push(error) }
      }
    }
    options.onLost?.(error)
    if (failures.length)
      throw new AggregateError(failures, 'Cannot record interrupted Sessions')
  } })
  let closing = false
  let closePromise: Promise<void> | undefined
  const pending = new Set<Promise<unknown>>()
  const { facts } = options
  function admit() {
    if (recordingError)
      throw new Error('Runtime observation storage failed; new execution is disabled', { cause: recordingError })
    if (closing)
      throw new Error('Project runtime is closing')
  }
  return {
    async open(projectPath: string, config: Omit<Extract<WorkerCommand, { action: 'open' }>, 'action'> = {}): Promise<ProjectSession> {
      admit()
      const canonical = await realpath(projectPath)
      admit()
      const session = await workers.open(canonical, config)
      record(() => facts.registerSession(canonical, session.sessionId, session.sessionPath))
      const result = { ...session, projectPath: canonical }
      owned.set(session.sessionId, result)
      return result
    },
    submit(session: ProjectSession, text: string, streamingBehavior?: 'steer' | 'followUp') {
      admit()
      const target = owned.get(session.sessionId)
      if (!target || target.projectPath !== session.projectPath || target.generation !== session.generation || target.sessionPath !== session.sessionPath)
        throw new Error('Stale Session target')
      const fact = record(() => facts.beginSubmission({ ...session, text }))
      const completion = (async () => {
        let result: unknown
        try {
          result = await workers.command(session.projectPath, { action: 'prompt', ...session, text, streamingBehavior })
        }
        catch (error) {
          if (error instanceof WorkerLostError)
            record(() => facts.observeUncertain(fact.id))
          else record(() => facts.settleSubmission(fact.id, 'failed'))
          throw error
        }
        if (!result || typeof result !== 'object' || !('observation' in result)
          || (result.observation !== 'queued-or-handled' && result.observation !== 'prompt-returned')) {
          record(() => facts.observeUncertain(fact.id))
          throw new Error('Invalid worker prompt result; execution outcome is unknown')
        }
        if (result.observation === 'queued-or-handled')
          record(() => facts.observeQueued(fact.id))
        else
          record(() => facts.settleSubmission(fact.id, 'settled'))
        return facts.readSubmission(session.projectPath, fact.id)!
      })()
      pending.add(completion)
      void completion.then(() => pending.delete(completion), () => pending.delete(completion))
      return { submissionId: fact.id, completion }
    },
    abort: (session: ProjectSession) => workers.command(session.projectPath, { action: 'abort', ...session }),
    snapshot: (session: ProjectSession) => workers.command(session.projectPath, { action: 'snapshot', ...session }),
    async closeSession(session: ProjectSession) {
      await workers.command(session.projectPath, { action: 'closeSession', ...session })
      record(() => facts.interruptSession(session.projectPath, session.sessionId))
      if (owned.get(session.sessionId)?.generation === session.generation)
        owned.delete(session.sessionId)
    },
    terminate: workers.terminate,
    close() {
      closing = true
      closePromise ??= (async () => {
        await workers.close()
        await Promise.allSettled([...pending])
        for (const session of owned.values()) facts.interruptSession(session.projectPath, session.sessionId)
      })()
      return closePromise
    },
  }
}
