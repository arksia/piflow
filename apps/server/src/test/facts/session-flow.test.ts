import type { SseHub } from '../../server/sse.ts'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import { openDatabase } from '../../facts/database.ts'
import { createFactsStore } from '../../facts/store.ts'
import { createFlowStore } from '../../flow/store.ts'
import { httpAuth } from '../../plugins/auth.ts'
import { sessionRoutes } from '../../routes/sessions.ts'
import { submissionRoutes } from '../../routes/submissions.ts'
import { createSessionStore } from '../../sessions/index.ts'

const token = '0123456789abcdef0123456789abcdef'

it('runs an authenticated web submission through pi and reads back its fact and native result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-session-facts-'))
  const agentDir = join(root, 'agent')
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  const provider = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' })
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: { content: 'scripted result' }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  assert.ok(address && typeof address !== 'string')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      openai: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: 'openai-completions',
        apiKey: 'test',
        models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
      },
    },
  }))
  process.env.PI_CODING_AGENT_DIR = agentDir
  const database = await openDatabase(join(root, 'data'))
  const facts = createFactsStore(database)
  const sessions = createSessionStore({ rootCwd: root, agentDir, facts, flow: createFlowStore(join(root, 'data')), poolSize: 2, publish: () => {} })
  const app = Fastify({ logger: false })
  await app.register(httpAuth, { authToken: token, isLoopback: true })
  await app.register(sessionRoutes, { sessions, sse: { broadcast() {} } as unknown as SseHub })
  await app.register(submissionRoutes, { sessions })
  try {
    const auth = await app.inject({ method: 'GET', url: '/auth' })
    const cookie = String(auth.headers['set-cookie']).split(';')[0]
    const created = await app.inject({ headers: { cookie }, method: 'POST', payload: { cwd: root }, url: '/api/sessions/new' })
    assert.equal(created.statusCode, 200, created.body)
    const key = created.json().state.key as string
    const managed = sessions.get(key)
    assert.ok(managed)
    const model = sessions.findModel(managed, 'openai', 'scripted')
    assert.ok(model)
    await managed.runtime.session.setModel(model)

    const accepted = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { text: 'private user request' },
      url: `/api/sessions/${encodeURIComponent(key)}/prompt`,
    })
    assert.equal(accepted.statusCode, 202, accepted.body)
    const { submissionId } = accepted.json() as { submissionId: string }
    assert.ok(submissionId)

    let fact: { status: string } | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await app.inject({ headers: { cookie }, method: 'GET', url: `/api/submissions/${submissionId}?projectPath=${encodeURIComponent(root)}` })
      assert.equal(response.statusCode, 200, response.body)
      fact = response.json().submission
      if (fact?.status !== 'accepted')
        break
      await delay(25)
    }
    assert.equal(fact?.status, 'settled')
    const messages = sessions.getState(managed).messages
    assert.ok(messages.some(message => message.role === 'assistant'
      && Array.isArray(message.content)
      && message.content.some((part: { type: string, text?: string }) => part.type === 'text' && part.text === 'scripted result')))
    const unauthorized = await app.inject({ method: 'GET', url: `/api/submissions/${submissionId}?projectPath=${encodeURIComponent(root)}` })
    assert.equal(unauthorized.statusCode, 401)
  }
  finally {
    await app.close()
    await sessions.disposeAll()
    database.close()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
    if (previousAgentDir === undefined)
      delete process.env.PI_CODING_AGENT_DIR
    else
      process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})
