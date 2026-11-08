import type { CodeDeliveryDeclaration, RunInput } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { createSubagentRuns } from '../../runs'
import { CODE_DELIVERY_TOOL, parseCodeDelivery } from '../../runs/delivery'

const declaration = (): CodeDeliveryDeclaration => ({ outcome: 'completed', summary: '已完成', changes: [], artifacts: [], checks: [{ name: '测试', claimedStatus: 'passed', toolCallIds: ['failed', 'unknown', 'read'], note: '' }], unresolved: ['仍需人工审阅'] })
export function codeInput(root: string): RunInput {
  return { projectPath: root, orchestratorId: 'main', orchestratorName: 'Main', roleId: 'code', roleName: 'Code', parentSessionPath: '/parent', parentToolCallId: 'call', task: 'Fix code', configurationSnapshot: { roleName: 'Code', cwd: root, effectivePrompt: '', model: 'a/b', thinkingLevel: 'off', tools: [], memberRoleIds: [], delivery: { kind: 'code', version: 1 } } }
}
it('preserves bounded complete declarations, evidence references, revisions and later activity', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-delivery-')))
  const messages: unknown[] = []
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), publish: message => messages.push(message), execute: async (_input, _signal, fact) => {
    fact({ type: 'tool_start', toolCallId: 'failed', toolName: 'bash', args: { command: 'pnpm test' } })
    fact({ type: 'tool_end', toolCallId: 'failed', toolName: 'bash', result: { structuredContent: { exit_code: 1 } }, isError: true })
    fact({ type: 'tool_start', toolCallId: 'read', toolName: 'read', args: {} })
    fact({ type: 'tool_end', toolCallId: 'read', toolName: 'read', result: {}, isError: false })
    const report = declaration()
    report.changes = Array.from({ length: 12 }, () => '改'.repeat(300))
    fact({ type: 'tool_end', toolCallId: 'report', toolName: CODE_DELIVERY_TOOL, result: { details: { codeDelivery: report } }, isError: false })
    fact({ type: 'tool_start', toolCallId: 'later', toolName: 'read', args: {} })
    fact({ type: 'tool_end', toolCallId: 'invalid', toolName: CODE_DELIVERY_TOOL, result: { details: { codeDelivery: { ...report, readyToMerge: true } } }, isError: false })
    fact({ type: 'closed', exitCode: 0 })
    return { output: 'done', cancelled: false, closed: true }
  } })
  let runId = ''
  try {
    const result = await runs.execute(codeInput(root))
    runId = result.runId
    assert.equal(result.status, 'succeeded')
    assert.equal(result.delivery?.declaration, 'submitted')
    assert.deepEqual(result.delivery?.unresolved, ['仍需人工审阅'])
    const detail = await runs.delivery(root, runId)
    assert.equal(detail.record?.declaration?.value.changes.length, 12)
    assert.equal(detail.record?.declaration?.subsequentToolActivity, true)
    assert.match(detail.record?.lastDeclarationError ?? '', /无效/)
    assert.deepEqual(detail.checkReferences.map(reference => [reference.toolCallId, reference.linked, reference.exitCode]), [['failed', true, 1], ['unknown', false, null], ['read', false, null]])
    const tool = await runs.tool(root, runId, 'report')
    assert.equal(tool.deliveryDeclaration?.changes.length, 12)
    assert.equal(JSON.stringify(await runs.tools({ projectPath: root, runId })).includes('deliveryDeclaration'), false)
    assert.equal(JSON.stringify(messages).includes('readyToMerge'), false)
    assert.equal(JSON.stringify(messages).includes('仍需人工审阅'), false)
    await assert.rejects(runs.delivery(await realpath(tmpdir()), runId), /不存在/)
  }
  finally { await runs.close() }
  const again = await createSubagentRuns({ dataDir: join(root, 'data') })
  try {
    assert.equal((await again.delivery(root, runId)).record?.declaration?.value.summary, '已完成')
  }
  finally {
    await again.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('validates declaration bounds and explicitly loads only the fixed extension', async () => {
  assert.throws(() => parseCodeDelivery({ ...declaration(), summary: 'a'.repeat(2001) }), /无效/)
  assert.throws(() => parseCodeDelivery({ ...declaration(), changes: Array.from({ length: 20 }, () => '中'.repeat(1000)) }), /32 KiB/)
  assert.throws(() => parseCodeDelivery({ ...declaration(), unresolved: Array.from({ length: 21 }).fill('issue') }), /无效/)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-extension-')))
  try {
    await mkdir(join(root, '.pi', 'extensions'), { recursive: true })
    await writeFile(join(root, '.pi', 'extensions', 'evil.ts'), 'throw new Error("PROJECT_EXTENSION_LOADED")')
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, 'agent'), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [fileURLToPath(new URL('../../runs/code-delivery-extension.ts', import.meta.url))] })
    await loader.reload()
    const loaded = loader.getExtensions()
    assert.deepEqual(loaded.errors, [])
    assert.equal(loaded.extensions.length, 1)
    assert.deepEqual([...loaded.extensions[0]!.tools.keys()], [CODE_DELIVERY_TOOL])
    const tool = loaded.extensions[0]!.tools.get(CODE_DELIVERY_TOOL)!.definition
    const report = await tool.execute('submit', declaration(), undefined, undefined, {} as never)
    assert.deepEqual((report.details as { codeDelivery: unknown }).codeDelivery, declaration())
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
it('allows the declaration tool with no base tools and migrates schema 1 without inventing evidence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-declaration-cli-')))
  const dataDir = join(root, 'data')
  const cliEntry = join(root, 'pi.cjs')
  await writeFile(cliEntry, `require('node:fs').writeFileSync('args.json',JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}]}}))`)
  const runs = await createSubagentRuns({ dataDir, cliEntry })
  let runId = ''
  try {
    const result = await runs.execute(codeInput(root))
    runId = result.runId
    assert.equal(result.delivery?.declaration, 'missing')
    const args = JSON.parse(await readFile(join(root, 'args.json'), 'utf8')) as string[]
    assert.equal(args[args.indexOf('--tools') + 1], CODE_DELIVERY_TOOL)
    assert.ok(args.includes('--no-extensions'))
    assert.ok(args.includes('-e'))
    assert.equal(args.includes('--no-tools'), false)
  }
  finally { await runs.close() }
  const db = new DatabaseSync(join(dataDir, 'runs.sqlite'))
  db.exec('DROP TABLE run_deliveries; PRAGMA user_version=1;')
  db.close()
  const again = await createSubagentRuns({ dataDir })
  try {
    const detail = await again.delivery(root, runId)
    assert.equal(detail.availability, 'not-captured')
    assert.equal((await again.read(root, runId)).status, 'succeeded')
  }
  finally {
    await again.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('creates delivery records atomically and does not replace a valid declaration with failed storage', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-delivery-fault-')))
  const dataDir = join(root, 'data')
  let db: DatabaseSync
  const runs = await createSubagentRuns({ dataDir, execute: async (_input, signal, fact) => {
    fact({ type: 'tool_end', toolCallId: 'first', toolName: CODE_DELIVERY_TOOL, result: { details: { codeDelivery: declaration() } }, isError: false })
    db.exec(`CREATE TRIGGER reject_delivery BEFORE UPDATE ON run_deliveries BEGIN SELECT RAISE(FAIL,'delivery fault'); END`)
    fact({ type: 'tool_end', toolCallId: 'second', toolName: CODE_DELIVERY_TOOL, result: { details: { codeDelivery: { ...declaration(), summary: 'should rollback' } } }, isError: false })
    assert.equal(signal.aborted, true)
    db.exec('DROP TRIGGER reject_delivery')
    return { output: '', cancelled: true, closed: true }
  } })
  db = new DatabaseSync(join(dataDir, 'runs.sqlite'))
  try {
    db.exec(`CREATE TRIGGER reject_initial BEFORE INSERT ON run_deliveries BEGIN SELECT RAISE(FAIL,'initial fault'); END`)
    await assert.rejects(runs.execute(codeInput(root)), /initial fault/)
    assert.equal((await runs.list({ projectPath: root })).runs.length, 0)
    db.exec('DROP TRIGGER reject_initial')
    const result = await runs.execute(codeInput(root))
    assert.equal(result.status, 'interrupted')
    assert.match(result.recordingError!, /delivery fault/)
    assert.equal((await runs.delivery(root, result.runId)).record?.declaration?.value.summary, '已完成')
    assert.equal((await runs.read(root, result.runId)).toolCount, 1)
    await assert.rejects(runs.tool(root, result.runId, 'second'), /不存在/)
  }
  finally {
    db.close()
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('observes concurrent runs in one Git workspace without attributing their changes', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-delivery-shared-')))
  const project = join(root, 'project')
  await mkdir(project)
  await exec('git', ['-C', project, 'init', '-b', 'main'])
  await writeFile(join(project, 'baseline.txt'), 'pre-existing')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let ready!: () => void
  const started = new Promise<void>((resolve) => {
    ready = resolve
  })
  let count = 0
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), execute: async (input, _signal, fact) => {
    await writeFile(join(project, `${input.task}.txt`), input.task)
    if (++count === 2)
      ready()
    await gate
    fact({ type: 'closed', exitCode: 0 })
    return { output: 'done', cancelled: false, closed: true }
  } })
  try {
    const one = runs.execute({ ...codeInput(project), task: 'one' })
    const two = runs.execute({ ...codeInput(project), task: 'two' })
    await started
    release()
    const results = await Promise.all([one, two])
    for (const result of results) {
      const detail = await runs.delivery(project, result.runId)
      assert.equal(detail.record?.before.state, 'recorded')
      assert.equal(detail.record?.after.state, 'recorded')
      assert.deepEqual(detail.record?.concurrentRunIds, results.filter(item => item.runId !== result.runId).map(item => item.runId))
      const before = detail.record!.before
      assert.ok(before.state === 'recorded' && before.files.some(file => file.path === 'baseline.txt'))
      const after = detail.record!.after
      assert.ok(after.state === 'recorded' && after.files.some(file => file.path === 'one.txt') && after.files.some(file => file.path === 'two.txt'))
      assert.equal(detail.processExit?.exitCode, 0)
    }
    const controller = new AbortController()
    controller.abort()
    const cancelled = await runs.execute(codeInput(project), controller.signal)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(count, 2)
    assert.equal((await runs.delivery(project, cancelled.runId)).record?.after.state, 'not-captured')
  }
  finally {
    release()
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('keeps confirmed close facts when restart interrupts final delivery persistence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-delivery-recovery-')))
  const dataDir = join(root, 'data')
  let db: DatabaseSync
  const runs = await createSubagentRuns({ dataDir, execute: async (_input, _signal, fact) => {
    fact({ type: 'closed', exitCode: 0 })
    db.exec(`CREATE TRIGGER reject_final BEFORE UPDATE ON runs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(FAIL,'final fault'); END`)
    return { output: 'done', cancelled: false, closed: true }
  } })
  db = new DatabaseSync(join(dataDir, 'runs.sqlite'))
  let runId = ''
  let completedAt: string | undefined
  try {
    const result = await runs.execute(codeInput(root))
    runId = result.runId
    assert.equal(result.status, 'succeeded')
    assert.match(result.recordingError!, /final fault/)
    const last = await runs.read(root, runId)
    assert.equal(last.status, 'running')
    assert.equal(last.progress?.phase, 'collecting')
    completedAt = last.completedAt
    assert.ok(completedAt)
    db.exec('DROP TRIGGER reject_final')
  }
  finally {
    db.close()
    await runs.close()
  }
  const again = await createSubagentRuns({ dataDir })
  try {
    const recovered = await again.read(root, runId)
    assert.equal(recovered.status, 'interrupted')
    assert.equal(recovered.completedAt, completedAt)
    assert.equal(recovered.processExit?.exitCode, 0)
    assert.equal((await again.delivery(root, runId)).record?.after.state, 'not-captured')
  }
  finally {
    await again.close()
    await rm(root, { recursive: true, force: true })
  }
})
