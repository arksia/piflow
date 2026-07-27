import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { getUsage } from './usage/index.js'

it('bypasses cached provider usage after a completed turn', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'piflow-usage-'))
  const previousDir = process.env.PI_CODING_AGENT_DIR
  const previousFetch = globalThis.fetch
  let remaining = 90

  try {
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ 'kimi-coding': { key: 'test' } }))
    process.env.PI_CODING_AGENT_DIR = dir
    globalThis.fetch = async () => new Response(JSON.stringify({
      limits: [{ detail: { limit: 100, used: 100 - remaining, remaining } }],
    }))

    const initial = await getUsage('kimi-coding')
    remaining = 70
    const cached = await getUsage('kimi-coding')
    const refreshed = await getUsage('kimi-coding', true)

    assert.equal(initial?.windows[0]?.remaining, 90)
    assert.equal(cached?.windows[0]?.remaining, 90)
    assert.equal(refreshed?.windows[0]?.remaining, 70)
  }
  finally {
    globalThis.fetch = previousFetch
    if (previousDir === undefined)
      delete process.env.PI_CODING_AGENT_DIR
    else
      process.env.PI_CODING_AGENT_DIR = previousDir
    await rm(dir, { recursive: true, force: true })
  }
})
