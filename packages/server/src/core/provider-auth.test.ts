import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ServerMessage } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createProviderAuthManager, ProviderAuthBusyError } from './provider-auth'

it('bridges native login prompts and never publishes the answer', async () => {
  let answer = ''
  const messages: unknown[] = []
  const runtime = {
    getProvider: () => ({ id: 'demo', auth: { apiKey: { login: async (interaction: { prompt: (prompt: { type: 'secret', message: string }) => Promise<string> }) => {
      answer = await interaction.prompt({ type: 'secret', message: 'API key' })
      return { type: 'api_key' as const }
    } } } }),
    login: async (_providerId: string, _type: string, interaction: { prompt: (prompt: { type: 'secret', message: string }) => Promise<string> }) => {
      answer = await interaction.prompt({ type: 'secret', message: 'API key' })
    },
  } as unknown as ModelRuntime
  const manager = createProviderAuthManager(runtime, message => messages.push(message))
  const started = await manager.start('demo', 'api_key')
  assert.equal(started.prompt?.prompt.type, 'secret')
  assert.equal(manager.respond(started.operationId, started.prompt!.id, 'secret-value'), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(answer, 'secret-value')
  assert.equal(JSON.stringify(messages).includes('secret-value'), false)
})

it('serializes auth operations and supports cancellation', async () => {
  const runtime = {
    getProvider: () => ({ id: 'demo', auth: { apiKey: { login: true } } }),
    login: async () => new Promise(() => {}),
  } as unknown as ModelRuntime
  const manager = createProviderAuthManager(runtime, () => {})
  const started = await manager.start('demo', 'api_key')
  await assert.rejects(manager.start('demo', 'api_key'), ProviderAuthBusyError)
  assert.equal(manager.cancel(started.operationId), true)
  assert.equal(manager.cancel(started.operationId), false)
})

it('publishes a safe failure when native login rejects', async () => {
  const messages: Array<Extract<ServerMessage, { type: 'provider_auth' }>> = []
  const runtime = {
    getProvider: () => ({ id: 'demo', auth: { apiKey: { login: true } } }),
    login: async () => { throw new Error('invalid credentials') },
  } as unknown as ModelRuntime
  const manager = createProviderAuthManager(runtime, message => messages.push(message))
  await manager.start('demo', 'api_key')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(messages.at(-1), { type: 'provider_auth', operationId: messages[0].operationId, event: { type: 'failed', message: 'invalid credentials' } })
})

it('notifies the host after credentials are stored', async () => {
  let completed = ''
  const runtime = {
    getProvider: () => ({ id: 'demo', auth: { apiKey: { login: true } } }),
    login: async () => ({ type: 'api_key' as const }),
  } as unknown as ModelRuntime
  const manager = createProviderAuthManager(runtime, () => {}, (providerId) => {
    completed = providerId
  })
  await manager.start('demo', 'api_key')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, 'demo')
})
