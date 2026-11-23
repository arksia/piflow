import type { Static } from 'typebox'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { WORKER_PROTOCOL } from './version.ts'

export { WORKER_PROTOCOL } from './version.ts'
const commandErrorCode = Type.Union([
  Type.Literal('session-not-open'),
  Type.Literal('stale-target'),
  Type.Literal('session-busy'),
  Type.Literal('model-not-found'),
  Type.Literal('project-mismatch'),
  Type.Literal('execution-failed'),
])
export class RuntimeCommandError extends Error {
  constructor(public readonly code: Static<typeof commandErrorCode>, message: string) {
    super(message)
  }
}
const identity = { version: Type.Literal(WORKER_PROTOCOL), workerId: Type.String({ minLength: 1 }) }
const target = { sessionId: Type.String({ minLength: 1 }), generation: Type.String({ minLength: 1 }) }
const command = Type.Union([
  Type.Object({ action: Type.Literal('open'), sessionPath: Type.Optional(Type.String()), model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })) }),
  Type.Object({ action: Type.Literal('prompt'), ...target, text: Type.String(), streamingBehavior: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) }),
  Type.Object({ action: Type.Literal('abort'), ...target }),
  Type.Object({ action: Type.Literal('snapshot'), ...target }),
  Type.Object({ action: Type.Literal('closeSession'), ...target }),
  Type.Object({ action: Type.Literal('shutdown') }),
])
export type WorkerCommand = Static<typeof command>
export interface SessionTarget { sessionId: string, generation: string }
export interface WorkerSession extends SessionTarget { sessionPath: string }
const hostMessage = Type.Union([
  Type.Object({ ...identity, type: Type.Literal('init'), nonce: Type.String(), projectPath: Type.String(), agentDir: Type.String(), leasePath: Type.String() }),
  Type.Object({ ...identity, type: Type.Literal('command'), id: Type.String(), command }),
])
const workerMessage = Type.Union([
  Type.Object({ ...identity, type: Type.Literal('ready'), nonce: Type.String(), projectPath: Type.String() }),
  Type.Object({ ...identity, type: Type.Literal('result'), id: Type.String(), ok: Type.Literal(true), value: Type.Unknown() }),
  Type.Object({ ...identity, type: Type.Literal('result'), id: Type.String(), ok: Type.Literal(false), code: commandErrorCode, error: Type.String() }),
  Type.Object({ ...identity, type: Type.Literal('event'), ...target, event: Type.Unknown() }),
])
export type HostMessage = Static<typeof hostMessage>
export type WorkerMessage = Static<typeof workerMessage>
export const isHostMessage = (value: unknown): value is HostMessage => Value.Check(hostMessage, value)
export const isWorkerMessage = (value: unknown): value is WorkerMessage => Value.Check(workerMessage, value)
