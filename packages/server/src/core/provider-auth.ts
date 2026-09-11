import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AuthEvent, AuthPrompt, AuthType, ProviderAuthEvent, ProviderAuthPrompt, ServerMessage } from '@piflow/protocol'
import { randomUUID } from 'node:crypto'

interface PendingPrompt {
  id: string
  prompt: ProviderAuthPrompt['prompt']
  resolve: (value: string) => void
  reject: (error: Error) => void
}

interface Operation {
  providerId: string
  abort: AbortController
  prompt?: PendingPrompt
}

interface AuthInteraction {
  signal?: AbortSignal
  prompt: (prompt: AuthPrompt) => Promise<string>
  notify: (event: AuthEvent) => void
}

export interface ProviderAuthManager {
  start: (providerId: string, type: AuthType) => Promise<{ operationId: string, prompt?: ProviderAuthPrompt }>
  respond: (operationId: string, promptId: string, value: string) => boolean
  cancel: (operationId: string) => boolean
}

function withoutSignal(prompt: AuthPrompt): ProviderAuthPrompt['prompt'] {
  const { signal: _signal, ...safePrompt } = prompt
  return safePrompt as ProviderAuthPrompt['prompt']
}

export function createProviderAuthManager(runtime: ModelRuntime, publish: (message: ServerMessage) => void): ProviderAuthManager {
  const operations = new Map<string, Operation>()

  function emit(operationId: string, event: ProviderAuthEvent) {
    publish({ type: 'provider_auth', operationId, event })
  }

  async function start(providerId: string, type: AuthType) {
    if (operations.size > 0)
      throw new Error('provider authentication already in progress')
    const provider = runtime.getProvider(providerId)
    if (!provider)
      throw new Error(`provider not found: ${providerId}`)
    if (type === 'api_key' && !provider.auth.apiKey?.login)
      throw new Error(`provider does not support API key login: ${providerId}`)
    if (type === 'oauth' && !provider.auth.oauth)
      throw new Error(`provider does not support OAuth login: ${providerId}`)

    const operationId = randomUUID()
    const operation: Operation = { providerId, abort: new AbortController() }
    operations.set(operationId, operation)
    const interaction: AuthInteraction = {
      signal: operation.abort.signal,
      prompt: prompt => new Promise<string>((resolve, reject) => {
        const pending: PendingPrompt = { id: randomUUID(), prompt: withoutSignal(prompt), resolve, reject }
        operation.prompt = pending
        emit(operationId, { type: 'prompt', prompt: { id: pending.id, prompt: pending.prompt } satisfies ProviderAuthPrompt })
      }),
      notify: event => emit(operationId, event),
    }
    void runtime.login(providerId, type, interaction)
      .then(() => emit(operationId, { type: 'completed' }))
      .catch(error => emit(operationId, { type: 'failed', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => operations.delete(operationId))
    await new Promise<void>(resolve => setImmediate(resolve))
    return { operationId, ...(operation.prompt ? { prompt: { id: operation.prompt.id, prompt: operation.prompt.prompt } } : {}) }
  }

  function respond(operationId: string, promptId: string, value: string) {
    const operation = operations.get(operationId)
    if (!operation?.prompt || operation.prompt.id !== promptId)
      return false
    const prompt = operation.prompt
    operation.prompt = undefined
    prompt.resolve(value)
    return true
  }

  function cancel(operationId: string) {
    const operation = operations.get(operationId)
    if (!operation)
      return false
    operations.delete(operationId)
    operation.abort.abort()
    operation.prompt?.reject(new Error('authentication cancelled'))
    operation.prompt = undefined
    return true
  }

  return { start, respond, cancel }
}
