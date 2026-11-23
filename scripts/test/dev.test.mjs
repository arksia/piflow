import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

it('coordinates complete protocol builds, retries failures and reaps consumers on interrupt', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-dev-'))
  const script = join(root, 'fixture.mjs')
  const runner = join(root, 'runner.mjs')
  const journal = join(root, 'journal')
  await Promise.all(['apps/server/src/runtime', 'packages/protocol/src'].map(path => mkdir(join(root, path), { recursive: true })))
  await writeFile(journal, '')
  await writeFile(script, `import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
    const name=process.argv[2];
    const log=event=>appendFileSync('journal', JSON.stringify({name,event,pid:process.pid})+'\\n');
    log('start');
    if(name==='build') {
      writeFileSync('protocol','partial');
      setTimeout(()=>{if(existsSync('fail')) {log('failed');process.exit(1)} writeFileSync('protocol','complete');log('done')},250);
    } else {
      if(readFileSync('protocol','utf8')!=='complete') process.exit(22);
      setInterval(()=>{},1000);
      process.on('SIGTERM',()=>{log('stop');process.exit(0)});
    }`)
  await writeFile(runner, `import {startDevelopment} from ${JSON.stringify(new URL('../dev.mjs', import.meta.url).href)};
    await startDevelopment({root:${JSON.stringify(root)},commands:Object.fromEntries(['build','web','server'].map(name=>[name,{args:[${JSON.stringify(script)},name]}]))});`)
  const child = spawn(process.execPath, [runner], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  let output = ''
  child.stdout.on('data', chunk => output += chunk)
  child.stderr.on('data', chunk => output += chunk)
  const entries = async () => (await readFile(journal, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const count = async (name, event) => (await entries()).filter(entry => entry.name === name && entry.event === event).length
  async function until(check) {
    for (let i = 0; i < 200; i++) {
      if (await check())
        return
      assert.equal(child.exitCode, null, output)
      await delay(20)
    }
    assert.fail(`development condition timed out: ${output}`)
  }
  const change = path => writeFile(join(root, path), String(Date.now()))
  try {
    await until(async () => await count('server', 'start') === 1 && await count('web', 'start') === 1)
    await change('apps/server/src/runtime/worker.ts')
    await until(async () => await count('server', 'start') === 2)
    assert.equal(await count('web', 'start'), 1)
    assert.equal(await count('build', 'start'), 1)
    await writeFile(join(root, 'fail'), 'yes')
    await change('packages/protocol/src/index.ts')
    await until(async () => await count('build', 'failed') === 1)
    assert.equal(await count('server', 'start'), 2)
    assert.equal(await count('web', 'stop'), 1)
    await change('apps/server/src/runtime/worker.ts')
    await until(async () => await count('build', 'failed') === 2)
    assert.equal(await count('server', 'start'), 2, 'server edits must not bypass a failed protocol build')
    await rm(join(root, 'fail'))
    await change('packages/protocol/src/index.ts')
    await until(async () => await count('web', 'start') === 2 && await count('server', 'start') === 3)
    const events = await entries()
    for (const [index, entry] of events.entries()) {
      if (entry.name !== 'build' && entry.event === 'start')
        assert.equal(events.slice(0, index).filter(value => value.name === 'build').at(-1).event, 'done')
    }
    await change('packages/protocol/src/index.ts')
    await until(async () => await count('build', 'start') === 5)
    child.kill('SIGINT')
    assert.deepEqual(await exited, [0, null])
    for (const { pid } of await entries()) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exited
    }
    for (const { pid } of await entries()) {
      try {
        process.kill(pid, 'SIGKILL')
      }
      catch { /* Already reaped. */ }
    }
    await rm(root, { recursive: true, force: true })
  }
})
