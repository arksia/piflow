import type { ExecutionSession, ExecutionSnapshotResponse, SubmissionFactResponse } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { API_EXECUTION_SESSIONS_PATH } from '@piflow/protocol'
import { bootstrap } from '../../bootstrap.ts'
import { openDatabase } from '../../facts/database.ts'
import { WORKER_PROTOCOL } from '../../runtime/messages.ts'
import { loadConfig } from '../../server/config.ts'

it('uses authenticated HTTP with real workers, durable facts and native history across restart', { timeout: 30000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-worker-http-')))
  const project = join(root, 'project 空间')
  const other = join(root, 'other')
  const agentDir = join(root, 'agent')
  const webDist = join(root, 'web')
  await Promise.all([project, other, agentDir, webDist].map(path => mkdir(path)))
  await writeFile(join(webDist, 'index.html'), 'test web')
  let requests = 0
  let held = 0
  const provider = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests++
    const messages = JSON.parse(body).messages as { content: unknown }[]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.flushHeaders()
    if (JSON.stringify(messages.at(-1)?.content).includes('hold')) {
      held++
      return
    }
    for (const [delta, finish_reason] of [[{ content: 'worker reply' }, null], [{}, 'stop']]) {
      response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  assert.ok(address && typeof address !== 'string')
  const model = { provider: 'scripted', id: 'scripted' }
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { scripted: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-only', models: [{ id: 'scripted', contextWindow: 8192, maxTokens: 128 }] } } }))
  const config = { ...loadConfig({ INIT_CWD: project, PIFLOW_DATA_DIR: join(root, 'data'), PORT: '0', PIFLOW_TOKEN: '0123456789abcdef0123456789abcdef' }), webDist }
  const worker = process.env.PIFLOW_TEST_WORKER_ENTRY ? { entry: pathToFileURL(process.env.PIFLOW_TEST_WORKER_ENTRY) } : undefined
  let host = await bootstrap(config, { agentDir, worker })
  let cookie = ''
  async function http(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
    return fetch(`${host.address}${path}`, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  function sessionUrl(session: ExecutionSession, action = '', projectPath = session.projectPath, generation = session.generation) {
    return `${API_EXECUTION_SESSIONS_PATH}/${session.sessionId}${action}?${new URLSearchParams({ projectPath, generation })}`
  }
  function factUrl(id: string, projectPath = project) {
    return `/api/submissions/${id}?${new URLSearchParams({ projectPath })}`
  }
  async function open(sessionPath?: string) {
    const response = await http(API_EXECUTION_SESSIONS_PATH, 'POST', { projectPath: project, sessionPath, model })
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json() as { session: ExecutionSession }).session
  }
  async function fact(id: string) {
    const response = await http(factUrl(id))
    assert.equal(response.status, 200)
    return (await response.json() as SubmissionFactResponse).submission
  }
  async function submit(session: ExecutionSession, text: string, streamingBehavior?: string) {
    const response = await http(sessionUrl(session, '/prompt'), 'POST', { text, streamingBehavior })
    assert.equal(response.status, 202, await response.clone().text())
    return (await response.json() as { submissionId: string }).submissionId
  }
  async function until(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 200; i++) {
      if (await check())
        return
      await delay(20)
    }
    assert.fail('condition timed out')
  }
  try {
    const unauthorized = await http(API_EXECUTION_SESSIONS_PATH, 'POST', { projectPath: project })
    assert.equal(unauthorized.status, 401)
    const auth = await http('/auth')
    const authCookie = auth.headers.get('set-cookie')
    assert.match(authCookie!, /HttpOnly/)
    assert.match(authCookie!, /SameSite=Strict/i)
    cookie = authCookie!.split(';')[0]!
    assert.equal((await http(API_EXECUTION_SESSIONS_PATH, 'POST', { projectPath: project }, { origin: 'https://untrusted.invalid' })).status, 403)
    assert.equal((await http(API_EXECUTION_SESSIONS_PATH, 'POST', { projectPath: 42 })).status, 400)

    const session = await open()
    assert.equal(session.projectPath, project)
    const initial = await http(sessionUrl(session))
    assert.equal(initial.status, 200)
    assert.equal((await initial.json() as ExecutionSnapshotResponse).isIdle, true)
    assert.equal((await http(sessionUrl(session, '', other))).status, 404)
    for (const action of ['', '/prompt', '/abort']) {
      const stale = await http(sessionUrl(session, action, project, 'stale'), action ? 'POST' : 'GET', action === '/prompt' ? { text: 'must not execute' } : undefined)
      assert.equal(stale.status, 409)
      assert.equal((await stale.json() as { code: string }).code, 'stale-target')
    }
    assert.equal((await http(sessionUrl(session, '/prompt'), 'POST', { text: ' ' })).status, 400)
    assert.equal((await http(sessionUrl(session, '/prompt'), 'POST', { text: 'test', images: [] })).status, 400, 'unsupported fields must not be silently dropped')
    assert.equal((await http(sessionUrl(session, '/prompt'), 'POST', { text: 'test', streamingBehavior: 'invalid' })).status, 400)
    const oversized = await host.app.inject({ method: 'POST', url: sessionUrl(session, '/prompt'), headers: { cookie }, payload: { text: 'x'.repeat(2 * 1024 * 1024) } })
    assert.equal(oversized.statusCode, 413)
    assert.equal(requests, 0)

    const completedId = await submit(session, 'complete')
    await until(async () => (await fact(completedId)).status === 'settled')
    assert.equal((await fact(completedId)).observation, 'prompt-returned')
    assert.equal((await http(factUrl(completedId, other))).status, 404)
    const snapshot = await http(sessionUrl(session))
    assert.match(JSON.stringify(await snapshot.json()), /worker reply/)
    assert.match(await readFile(session.sessionPath, 'utf8'), /worker reply/, 'result is in native pi history')
    const wrongProject = await http(API_EXECUTION_SESSIONS_PATH, 'POST', { projectPath: other, sessionPath: session.sessionPath, model })
    assert.equal(wrongProject.status, 404)
    assert.equal((await wrongProject.json() as { code: string }).code, 'project-mismatch')
    assert.equal((await http(factUrl(completedId), 'GET', undefined, { cookie: '' })).status, 401)

    const abortedId = await submit(session, 'hold for abort')
    await until(() => held === 1)
    const busy = await http(sessionUrl(session), 'DELETE')
    assert.equal(busy.status, 409)
    assert.equal((await busy.json() as { code: string }).code, 'session-busy')
    assert.equal((await http(sessionUrl(session, '/abort'), 'POST')).status, 200)
    await until(async () => (await fact(abortedId)).status === 'settled')

    const interruptedId = await submit(session, 'hold for crash')
    await until(() => held === 2)
    const queuedId = await submit(session, 'next', 'followUp')
    await until(async () => (await fact(queuedId)).observation === 'queued-or-handled')
    await host.runtime.terminate(project)
    assert.equal((await fact(interruptedId)).observation, 'execution-uncertain')
    assert.equal((await fact(queuedId)).observation, 'execution-uncertain')
    assert.equal((await http(sessionUrl(session))).status, 503)
    const countBeforeRestart = requests
    await host.close()
    host = await bootstrap(config, { agentDir, worker })
    assert.equal((await fact(completedId)).status, 'settled')
    assert.equal((await fact(queuedId)).observation, 'execution-uncertain')
    assert.equal((await http(sessionUrl(session))).status, 404, 'reading history must not implicitly restart execution')
    const reopened = await open(session.sessionPath)
    assert.equal(reopened.sessionId, session.sessionId)
    assert.notEqual(reopened.generation, session.generation)
    assert.equal((await http(sessionUrl(session, '/abort'), 'POST')).status, 409)
    const recovered = await http(sessionUrl(reopened))
    assert.match(JSON.stringify(await recovered.json()), /worker reply/)
    await delay(50)
    assert.equal(requests, countBeforeRestart, 'reopen must not replay pending inputs')
    assert.equal((await http(sessionUrl(reopened), 'DELETE')).status, 200)
    assert.equal((await http(sessionUrl(reopened))).status, 404)
  }
  finally {
    await host.close()
    provider.closeAllConnections()
    await new Promise<void>(resolve => provider.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

it('stops an unresponsive worker before waiting for in-flight HTTP controls', { timeout: 10000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-http-stop-')))
  const entry = join(root, 'worker.mjs')
  const webDist = join(root, 'web')
  await mkdir(webDist)
  await writeFile(join(webDist, 'index.html'), 'test')
  await writeFile(entry, `import {writeFileSync} from 'node:fs';
    writeFileSync('worker-pid', String(process.pid));
    process.on('SIGTERM',()=>{});
    process.on('message', m => {
      if(m.type === 'init') process.send({version:${WORKER_PROTOCOL},workerId:m.workerId,type:'ready',nonce:m.nonce,projectPath:m.projectPath});
      else if(m.command.action === 'open') process.send({version:${WORKER_PROTOCOL},workerId:m.workerId,type:'result',id:m.id,ok:true,value:{sessionId:'hung',generation:'one',sessionPath:'hung.jsonl'}});
      else if(m.command.action === 'abort') writeFileSync('abort-received', 'yes');
    });`)
  const config = { ...loadConfig({ INIT_CWD: root, PIFLOW_DATA_DIR: join(root, 'data'), PORT: '0' }), webDist }
  const host = await bootstrap(config, { agentDir: join(root, 'agent'), worker: { entry: pathToFileURL(entry), stopTimeoutMs: 100 } })
  try {
    const session = await host.runtime.open(root)
    const url = `${API_EXECUTION_SESSIONS_PATH}/${session.sessionId}/abort?${new URLSearchParams({ projectPath: root, generation: session.generation })}`
    const control = fetch(`${host.address}${url}`, { method: 'POST', headers: { cookie: `piflow_token=${config.authToken}` }, signal: AbortSignal.timeout(5000) })
    // Verify the control reached the child before closing, without depending on a sleep race.
    let received = false
    for (let i = 0; i < 100; i++) {
      received = await readFile(join(root, 'abort-received'), 'utf8').then(() => true, () => false)
      if (received)
        break
      await delay(10)
    }
    assert.equal(received, true)
    await host.close()
    const response = await control
    assert.equal(response.status, 503)
    await response.text()
    const pid = Number(await readFile(join(root, 'worker-pid'), 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    const database = await openDatabase(config.dataDir)
    database.close()
  }
  finally {
    await host.close()
    await rm(root, { recursive: true, force: true })
  }
})
