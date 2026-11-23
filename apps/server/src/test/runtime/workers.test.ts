import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { openDatabase } from '../../facts/database.ts'
import { createFactsStore } from '../../facts/store.ts'
import { createProjectRuntime } from '../../runtime/index.ts'
import { WORKER_PROTOCOL } from '../../runtime/messages.ts'
import { createProjectWorkers, WorkerLostError } from '../../runtime/project-workers.ts'

it('isolates Session aborts and project crashes using real SDK worker processes', { timeout: 30000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-workers-')))
  const agentDir = join(root, 'agent')
  const a = join(root, 'a')
  const b = join(root, 'b')
  await Promise.all([mkdir(agentDir), mkdir(a), mkdir(b)])
  const release = new Map<string, () => void>()
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const messages = JSON.parse(body).messages as { role: string, content: unknown }[]
    const text = JSON.stringify(messages.at(-1)?.content)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.flushHeaders()
    release.set(text, () => {
      response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: { content: 'done' }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { scripted: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test', models: [{ id: 'scripted', contextWindow: 8192, maxTokens: 128 }] } } }))
  const lost: WorkerLostError[] = []
  const events: string[] = []
  const database = await openDatabase(join(root, 'data'))
  const facts = createFactsStore(database)
  const workers = createProjectRuntime({ entry: process.env.PIFLOW_TEST_WORKER_ENTRY ? pathToFileURL(process.env.PIFLOW_TEST_WORKER_ENTRY) : undefined, facts, dataDir: root, agentDir, onLost: error => lost.push(error), onEvent: (project, event) => events.push(`${project}:${event.sessionId}`) })
  try {
    const model = { provider: 'scripted', id: 'scripted' }
    const [one, two, other] = await Promise.all([workers.open(a, { model }), workers.open(a, { model }), workers.open(b, { model })])
    assert.notEqual(one.sessionId, two.sessionId)
    const firstSubmission = workers.submit(one, 'one')
    const first = firstSubmission.completion
    const secondSubmission = workers.submit(two, 'two')
    const second = secondSubmission.completion
    const third = workers.submit(other, 'other').completion
    const secondResult = second.catch(error => error)
    await until(() => release.size === 3)
    await workers.abort(one)
    await first
    const snapshot = await workers.snapshot(two) as { isIdle: boolean }
    assert.equal(snapshot.isIdle, false)
    await assert.rejects(workers.abort({ ...two, generation: 'stale' }), /Stale/)
    const queued = workers.submit(two, 'later', 'followUp')
    const queuedFact = await queued.completion
    assert.equal(queuedFact.status, 'accepted')
    assert.equal(queuedFact.observation, 'queued-or-handled')
    await workers.terminate(a)
    await assert.rejects(workers.snapshot(two), /explicitly reopen/)
    assert.equal(facts.readSubmission(a, queued.submissionId)?.observation, 'execution-uncertain')
    assert.ok(await secondResult instanceof WorkerLostError)
    assert.equal(facts.readSubmission(a, secondSubmission.submissionId)?.observation, 'execution-uncertain')
    assert.equal(facts.readSubmission(a, secondSubmission.submissionId)?.settledAt, null)
    const finishOther = [...release].find(([key]) => key.includes('other'))?.[1]
    assert.ok(finishOther)
    finishOther()
    await third
    const completed = await workers.snapshot(other) as { messages: unknown[], isIdle: boolean }
    assert.equal(completed.isIdle, true)
    assert.match(JSON.stringify(completed.messages), /done/)
    assert.ok(events.some(event => event.includes(one.sessionId)))
    assert.ok(lost.some(error => error.projectPath === a))
    const previous = release.size
    const reopened = await workers.open(a, { sessionPath: two.sessionPath, model })
    await delay(50)
    assert.equal(release.size, previous, 'reopening history must not replay the prompt')
    assert.notEqual(reopened.generation, two.generation)
    assert.throws(() => workers.submit(two, 'stale'), /Stale/)
    await workers.closeSession(reopened)
    assert.throws(() => workers.submit(reopened, 'closed'), /not open/)
    const fresh = await workers.open(a, { sessionPath: two.sessionPath, model })
    database.db.exec(`CREATE TRIGGER reject_submission BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'disk failure fixture'); END`)
    assert.throws(() => workers.submit(fresh, 'must not execute'), /disk failure fixture/)
    await assert.rejects(workers.open(a), /observation storage failed/)
    assert.throws(() => workers.submit(other, 'must not execute either'), /observation storage failed/)
    assert.equal(release.size, previous, 'failed persistence must prevent execution')
    await Promise.all([workers.close(), workers.close()])
    await assert.rejects(workers.open(b), /closing|observation storage failed/)
  }
  finally {
    await workers.close()
    database.close()
    for (const finish of release.values()) finish()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

it('keeps one project writer until the previous worker has exited', { timeout: 30000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-worker-lease-')))
  const options = { dataDir: root, agentDir: join(root, 'agent'), entry: process.env.PIFLOW_TEST_WORKER_ENTRY ? pathToFileURL(process.env.PIFLOW_TEST_WORKER_ENTRY) : undefined }
  const owner = createProjectWorkers(options)
  const contender = createProjectWorkers(options)
  try {
    const session = await owner.open(root)
    await assert.rejects(contender.open(root), /lease|disconnected|exited/)
    await contender.close()
    assert.equal((await owner.command(root, { action: 'snapshot', ...session }) as { isIdle: boolean }).isIdle, true)
    await owner.close()
    const replacement = createProjectWorkers(options)
    try {
      const reopened = await replacement.open(root, { sessionPath: session.sessionPath })
      assert.notEqual(reopened.generation, session.generation)
    }
    finally { await replacement.close() }
  }
  finally {
    await Promise.all([owner.close(), contender.close()])
    await rm(root, { recursive: true, force: true })
  }
})

it('does not settle a submission from an unrecognized worker result', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-worker-result-')))
  const script = join(root, 'worker.mjs')
  await writeFile(script, `process.on('message', m => {
    const base = {version:${WORKER_PROTOCOL}, workerId:m.workerId};
    if(m.type === 'init') process.send({...base, type:'ready', nonce:m.nonce, projectPath:m.projectPath});
    else process.send({...base, type:'result', id:m.id, ok:true, value:m.command.action === 'open' ? {sessionId:'test',generation:'test',sessionPath:'test.jsonl'} : null});
  });`)
  const database = await openDatabase(root)
  const facts = createFactsStore(database)
  const runtime = createProjectRuntime({ dataDir: root, agentDir: root, facts, entry: pathToFileURL(script) })
  try {
    const session = await runtime.open(root)
    const submission = runtime.submit(session, 'test')
    await assert.rejects(submission.completion, /execution outcome is unknown/)
    const fact = facts.readSubmission(root, submission.submissionId)
    assert.equal(fact?.status, 'accepted')
    assert.equal(fact?.observation, 'execution-uncertain')
    assert.equal(fact?.settledAt, null)
  }
  finally {
    await runtime.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects boot failures, late ready, IPC loss and missing executables without retaining children', { timeout: 15000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-worker-fault-')))
  const script = join(root, 'worker.mjs')
  await writeFile(script, `import {writeFileSync} from 'node:fs';
    writeFileSync('worker-pid',String(process.pid));
    process.on('SIGTERM',()=>{});
    process.on('message', m => {
    if(m.type === 'init') {
      if(m.projectPath.endsWith('invalid')) { process.stderr.write('x'.repeat(20000)); process.send({version:${WORKER_PROTOCOL},workerId:m.workerId,type:'ready',nonce:'wrong',projectPath:m.projectPath}); return; }
      if(m.projectPath.endsWith('disconnect')) { process.disconnect(); return; }
      setTimeout(() => { if(process.connected) process.send({version:${WORKER_PROTOCOL},workerId:m.workerId,type:'ready',nonce:m.nonce,projectPath:m.projectPath}) }, 150);
    }
  }); setInterval(()=>{},1000);`)
  try {
    const missing = createProjectWorkers({ dataDir: root, agentDir: root, execPath: join(root, 'missing'), stopTimeoutMs: 100 })
    await assert.rejects(missing.open(root), /Cannot start|exited|init failed/)
    await missing.close()
    const late = createProjectWorkers({ dataDir: root, agentDir: root, entry: pathToFileURL(script), startTimeoutMs: 50, stopTimeoutMs: 100 })
    await assert.rejects(late.open(root), /timed out/)
    await late.close()
    const latePid = Number(await readFile(join(root, 'worker-pid'), 'utf8'))
    assert.throws(() => process.kill(latePid, 0), { code: 'ESRCH' })
    const invalidPath = join(root, 'invalid')
    await mkdir(invalidPath)
    const invalid = createProjectWorkers({ dataDir: root, agentDir: root, entry: pathToFileURL(script), stopTimeoutMs: 100 })
    await assert.rejects(invalid.open(invalidPath), (error: Error) => error.message.includes('handshake') && Buffer.byteLength(error.message) < 9000)
    await invalid.close()
    const disconnectPath = join(root, 'disconnect')
    await mkdir(disconnectPath)
    const disconnected = createProjectWorkers({ dataDir: root, agentDir: root, entry: pathToFileURL(script), stopTimeoutMs: 100 })
    await assert.rejects(disconnected.open(disconnectPath), /disconnected|exited/)
    await disconnected.close()
    const closing = createProjectWorkers({ dataDir: root, agentDir: root, entry: pathToFileURL(script), stopTimeoutMs: 100 })
    const opening = closing.open(root).catch(error => error)
    await delay(20)
    await closing.close()
    assert.ok(await opening instanceof Error)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check())
      return
    await delay(20)
  }
  assert.fail('condition timed out')
}
