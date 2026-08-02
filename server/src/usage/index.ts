import type { Credential, ProviderUsageSnapshot, UsageAdapter } from './types.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { kimiCoding } from './kimi-coding.js'

// Add an adapter here to support usage reporting for another provider.
const adapters: UsageAdapter[] = [kimiCoding]

const cache = new Map<string, { at: number, data: ProviderUsageSnapshot | null }>()
const TTL = 30_000

async function readCredential(provider: string): Promise<Credential | null> {
  const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent')
  const auth = JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'))
  const c = auth[provider]
  if (!c)
    return null
  return { key: c.key ?? c.apiKey, access: c.access ?? c.token }
}

export async function getUsage(provider: string, fresh = false): Promise<ProviderUsageSnapshot | null> {
  const cached = cache.get(provider)
  if (!fresh && cached && Date.now() - cached.at < TTL)
    return cached.data

  const adapter = adapters.find(a => a.providers.includes(provider))
  const cred = adapter ? await readCredential(provider).catch(() => null) : null
  const data = adapter && cred ? await adapter.fetch(cred).catch(() => null) : null

  cache.set(provider, { at: Date.now(), data })
  return data
}
