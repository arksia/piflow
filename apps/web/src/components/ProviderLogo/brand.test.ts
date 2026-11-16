import assert from 'node:assert/strict'
import { it } from 'node:test'
import { configuredModel, providerBrand } from './brand'

it('resolves explicit provider identity without guessing brands from model names', () => {
  assert.equal(providerBrand('anthropic'), 'claude')
  assert.equal(providerBrand('openai-codex'), 'openai')
  assert.equal(providerBrand('google-gemini-cli'), 'gemini')
  assert.equal(providerBrand('openrouter'), 'unknown')
  assert.equal(providerBrand('custom-openai-proxy'), 'unknown')
  assert.equal(providerBrand(), 'unknown')
  assert.deepEqual(configuredModel('anthropic/claude-4', []), { provider: 'anthropic', id: 'claude-4' })
  assert.equal(configuredModel('claude-custom', []), undefined)
  const models = [{ provider: 'custom', id: 'shared' }, { provider: 'openai', id: 'shared' }]
  assert.equal(configuredModel('shared', models), undefined)
  assert.deepEqual(configuredModel('custom/shared', models), models[0])
})
