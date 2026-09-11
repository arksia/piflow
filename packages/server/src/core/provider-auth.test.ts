import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createProviderAuthManager } from './provider-auth'

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
  await assert.rejects(manager.start('demo', 'api_key'))
  assert.equal(manager.cancel(started.operationId), true)
  assert.equal(manager.cancel(started.operationId), false)
})
