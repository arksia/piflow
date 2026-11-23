import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('../../', import.meta.url))
const run = promisify(execFile)
const node = process.env.PIFLOW_TEST_NODE ?? process.execPath
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

it('installs the actual tarball and runs authenticated Web, SDK workers, tools and recovery without checkout dependencies', { timeout: 240000 }, async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'piflow-installed-')))
  const project = join(directory, 'project 空间')
  const agent = join(directory, 'agent')
  const data = join(directory, 'data')
  await Promise.all([project, agent].map(path => mkdir(path)))
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', PI_OFFLINE: '1', PI_TELEMETRY: '0', INIT_CWD: '/misleading-package-manager-directory', PIFLOW_DATA_DIR: data, PI_CODING_AGENT_DIR: agent, PORT: '0', HOST: '127.0.0.1', PIFLOW_TOKEN: '0123456789abcdef0123456789abcdef' }
  await writeFile(join(directory, 'package.json'), '{"private":true}')
  const hosts = new Set()
  const providerRequests = []
  const provider = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    providerRequests.push(input)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.flushHeaders()
    const last = input.messages.at(-1)
    if (JSON.stringify(last).includes('hold'))
      return
    const delta = last.role === 'user' && JSON.stringify(last).includes('use bash')
      ? { tool_calls: [{ index: 0, id: 'bash-one', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'printf installed-tool-proof' }) } }] }
      : { content: 'installed worker reply' }
    for (const [part, finish] of [[delta, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']]) {
      response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })
  async function until(check, message) {
    for (let i = 0; i < 300; i++) {
      if (await check())
        return
      await delay(50)
    }
    assert.fail(message ?? 'condition timed out')
  }
  function launch(args = [project, '--no-open', '--port', '0'], overrides = {}) {
    const child = spawn(node, [join(directory, 'node_modules/piflow/dist/main.js'), ...args], { cwd: directory, env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] })
    hosts.add(child)
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    const exited = once(child, 'exit')
    return { child, exited, output: () => output }
  }
  async function start(args) {
    const host = launch(args)
    await until(() => /piflow · http:\/\/\S+/.test(host.output()) || host.child.exitCode !== null, `Host not ready: ${host.output()}`)
    const address = host.output().match(/piflow · (http:\/\/\S+)/)?.[1]
    assert.ok(address, host.output())
    return { ...host, address }
  }
  async function stop(host, signal = 'SIGTERM') {
    host.child.kill(signal)
    const [code, killedBy] = await Promise.race([host.exited, delay(20000, undefined, { ref: false }).then(() => {
      throw new Error(`Host shutdown timed out: ${host.output()}`)
    })])
    assert.equal(killedBy, null, host.output())
    assert.equal(code, 0, host.output())
    hosts.delete(host.child)
  }
  let host
  let cookie = ''
  async function http(path, method = 'GET', body, headers = {}) {
    return fetch(`${host.address}${path}`, { method, signal: AbortSignal.timeout(15000), headers: { cookie, ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  }
  function sessionUrl(session, action = '') {
    return `/api/execution/sessions/${session.sessionId}${action}?${new URLSearchParams({ projectPath: project, generation: session.generation })}`
  }
  async function authenticate() {
    const response = await http('/auth')
    assert.equal(response.status, 204)
    const header = response.headers.get('set-cookie')
    assert.match(header, /HttpOnly/)
    assert.match(header, /SameSite=Strict/i)
    cookie = header.split(';')[0]
  }
  async function json(response) {
    assert.ok(response.ok, await response.clone().text())
    return response.json()
  }
  async function fact(id) {
    return (await json(await http(`/api/submissions/${id}?${new URLSearchParams({ projectPath: project })}`))).submission
  }
  async function open(sessionPath) {
    return (await json(await http('/api/execution/sessions', 'POST', { projectPath: project, sessionPath, model: { provider: 'scripted', id: 'scripted' } }))).session
  }
  async function submit(session, text) {
    return (await json(await http(sessionUrl(session, '/prompt'), 'POST', { text }))).submissionId
  }
  try {
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', join(root, 'dist', `piflow-${manifest.version}.tgz`)], { cwd: directory, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    const installed = join(directory, 'node_modules/piflow')
    const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    assert.equal(pkg.version, manifest.version)
    assert.equal(pkg.dependencies.tsx, undefined)
    assert.ok(Object.values(pkg.dependencies).every(version => /^\d+\.\d+\.\d+/.test(version)))
    assert.equal(await realpath(installed), installed, 'installed package must not link back to checkout')
    const bin = join(directory, 'node_modules/.bin', process.platform === 'win32' ? 'piflow.cmd' : 'piflow')
    await access(bin)
    if (process.platform !== 'win32') {
      const version = await run(bin, ['--version'], { cwd: directory, env: { ...env, PATH: `${dirname(node)}:${env.PATH}` }, timeout: 15000 })
      assert.match(version.stdout, /piflow .*pi 1\.5\.2/)
    }
    for (const flag of ['--help', '--version']) {
      const check = launch([flag])
      assert.equal((await check.exited)[0], 0, check.output())
      assert.match(check.output(), flag === '--help' ? /Usage: piflow/ : /piflow .*pi 1\.5\.2/)
      assert.doesNotMatch(check.output(), /piflow ·/)
    }
    await assert.rejects(access(data))
    const invalid = launch(['--port', 'invalid'])
    assert.equal((await invalid.exited)[0], 1)
    assert.match(invalid.output(), /PORT must be/)
    await assert.rejects(access(data))
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
    await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { scripted: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'test', models: [{ id: 'scripted', contextWindow: 8192, maxTokens: 128 }] } } }))
    host = await start(['--no-open', '--port', '0'])
    await authenticate()
    assert.equal((await json(await http('/api/directories'))).listing.path, directory)
    await stop(host)
    cookie = ''
    host = await start()
    const page = await http('/')
    assert.equal(page.status, 200)
    const html = await page.text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1])
    assert.ok(assets.length >= 2)
    for (const asset of assets) assert.equal((await http(asset)).status, 200, asset)
    assert.equal((await http('/api/hello')).status, 401)
    await authenticate()
    assert.equal((await json(await http('/api/directories'))).listing.path, project)
    assert.equal((await http('/api/execution/sessions', 'POST', { projectPath: project }, { origin: 'https://untrusted.invalid' })).status, 403)
    const session = await open()
    const completed = await submit(session, 'use bash')
    await until(async () => (await fact(completed)).status === 'settled')
    assert.equal((await fact(completed)).observation, 'prompt-returned')
    const history = await readFile(session.sessionPath, 'utf8')
    assert.match(history, /installed-tool-proof/)
    assert.match(history, /installed worker reply/)
    assert.ok(providerRequests.some(input => input.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('installed-tool-proof'))))

    // Installed legacy extension entries must still load in the native pi CLI until P2.
    const bundle = join(directory, 'review.json')
    await writeFile(bundle, '{}')
    const piCli = join(directory, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')
    const extensionRun = run(node, [piCli, '--mode', 'json', '-p', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--provider', 'scripted', '--model', 'scripted', '--no-session', '-e', join(installed, 'dist/extensions/code-delivery.js'), '-e', join(installed, 'dist/extensions/review.js'), 'extension smoke test'], { cwd: project, env: { ...env, PIFLOW_REVIEW_BUNDLE: bundle }, timeout: 30000, killSignal: 'SIGKILL' })
    extensionRun.child.stdin.end()
    const extensions = await extensionRun
    assert.match(extensions.stdout, /installed worker reply/)
    const toolNames = providerRequests.at(-1).tools.map(tool => tool.function.name)
    for (const name of ['submit_code_delivery', 'read_review_context', 'submit_review_route']) assert.ok(toolNames.includes(name), toolNames.join(','))

    const interrupted = await submit(session, 'hold for shutdown')
    await until(() => providerRequests.some(input => JSON.stringify(input.messages.at(-1)).includes('hold for shutdown')))
    let workerPids = []
    if (process.platform !== 'win32') {
      workerPids = (await run('pgrep', ['-P', String(host.child.pid)])).stdout.trim().split(/\s+/).map(Number)
      assert.ok(workerPids.length)
    }
    await stop(host, 'SIGINT')
    for (const pid of workerPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    const requestCount = providerRequests.length
    host = await start()
    await authenticate()
    const outcome = await fact(interrupted)
    assert.equal(outcome.status, 'settled')
    assert.ok(['prompt-returned', 'execution-uncertain'].includes(outcome.observation))
    assert.equal((await fact(completed)).status, 'settled')
    const reopened = await open(session.sessionPath)
    assert.equal(reopened.sessionId, session.sessionId)
    assert.notEqual(reopened.generation, session.generation)
    await delay(100)
    assert.equal(providerRequests.length, requestCount, 'restart must never replay input')
    const crashed = await submit(reopened, 'hold for crash')
    await until(() => providerRequests.some(input => JSON.stringify(input.messages.at(-1)).includes('hold for crash')))
    if (process.platform !== 'win32')
      workerPids = (await run('pgrep', ['-P', String(host.child.pid)])).stdout.trim().split(/\s+/).map(Number)
    host.child.kill('SIGKILL')
    assert.deepEqual(await host.exited, [null, 'SIGKILL'])
    for (const pid of workerPids) {
      await until(() => {
        try {
          process.kill(pid, 0)
          return false
        }
        catch (error) { return error.code === 'ESRCH' }
      }, 'orphaned worker did not stop after Host crash')
    }
    const beforeRecovery = providerRequests.length
    host = await start()
    await authenticate()
    assert.equal((await fact(crashed)).observation, 'execution-uncertain')
    await open(session.sessionPath)
    await delay(100)
    assert.equal(providerRequests.length, beforeRecovery)
    await stop(host)

    for (const relative of ['dist/runtime/worker.js', 'dist/web/index.html']) {
      const path = join(installed, relative)
      const bytes = await readFile(path)
      for (const mode of ['missing', 'stale']) {
        if (mode === 'missing')
          await rm(path)
        else await writeFile(path, 'stale artifact')
        const corruptData = join(directory, 'never-open-data')
        const corrupt = launch(undefined, { PIFLOW_DATA_DIR: corruptData })
        assert.equal((await corrupt.exited)[0], 1)
        assert.doesNotMatch(corrupt.output(), /piflow ·/)
        await assert.rejects(access(corruptData))
        await writeFile(path, bytes)
      }
    }
    const dependency = join(directory, 'node_modules/fastify')
    await rename(dependency, `${dependency}-hidden`)
    try {
      const missing = launch(undefined, { PIFLOW_DATA_DIR: join(directory, 'missing-dependency-data') })
      assert.equal((await missing.exited)[0], 1)
      assert.match(missing.output(), /Cannot find package 'fastify'/)
      assert.doesNotMatch(missing.output(), /piflow ·/)
      await assert.rejects(access(join(directory, 'missing-dependency-data')))
    }
    finally { await rename(`${dependency}-hidden`, dependency) }
    t.diagnostic(`Installed piflow ${pkg.version}; execution Node: ${(await run(node, ['--version'])).stdout.trim()}; platform: ${process.platform}`)
  }
  finally {
    for (const child of hosts) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await once(child, 'exit')
      }
    }
    provider.closeAllConnections()
    await new Promise(resolve => provider.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
