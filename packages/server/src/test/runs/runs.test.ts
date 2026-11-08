import type { RunInput, RunMessage } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import { createSubagentRuns } from '../../runs'

function input(root: string): RunInput {
  return {
    projectPath: root,
    orchestratorId: 'main',
    orchestratorName: '主 Agent',
    roleId: 'code',
    roleName: 'Code',
    parentSessionPath: '/parent.jsonl',
    parentToolCallId: 'call',
    task: '检查测试失败后继续',
    configurationSnapshot: {
      cwd: root,
      roleName: 'Code',
      effectivePrompt: 'Check the code',
      model: 'provider/model',
      thinkingLevel: 'off',
      tools: ['read', 'bash'],
      memberRoleIds: ['code'],
    },
  }
}
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-runs-')))
  return { root, dataDir: join(root, 'data') }
}
it('records fast interleaved tool lifecycles, failures, output corrections and immutable input', async () => {
  const { root, dataDir } = await setup()
  const messages: RunMessage[] = []
  const cliEntry = join(root, 'pi.cjs')
  await writeFile(
    cliEntry,
    `
    const emit=e=>process.stdout.write(JSON.stringify(e)+'\\n');
    emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'草稿'}});
    emit({type:'tool_execution_start',toolCallId:'read',toolName:'read',args:{path:'a.ts'}});
    emit({type:'tool_execution_start',toolCallId:'test',toolName:'bash',args:{command:'pnpm test'}});
    emit({type:'tool_execution_end',toolCallId:'test',toolName:'bash',result:{content:[{type:'text',text:'测试失败'}]},isError:true,durationMs:12});
    emit({type:'tool_execution_end',toolCallId:'test',toolName:'bash',result:{content:[]},isError:true});
    emit({type:'tool_execution_end',toolCallId:'read',toolName:'read',result:{content:[{type:'text',text:'内容'}]},isError:false,durationMs:21});
    emit({type:'tool_execution_end',toolCallId:'orphan',toolName:'ls',result:{content:[]},isError:false});
    emit({type:'tool_execution_start',toolName:'read'});
    emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'已修正报告'}]}});
  `,
  )
  const runs = await createSubagentRuns({
    dataDir,
    cliEntry,
    publish: message => messages.push(message),
  })
  try {
    const config = input(root)
    const result = await runs.execute(config)
    config.configurationSnapshot.tools.push('write')
    assert.equal(result.status, 'succeeded')
    assert.equal(result.output, '已修正报告')
    const detail = await runs.read(root, result.runId)
    assert.equal(detail.failedToolCount, 1)
    assert.equal(detail.toolCount, 3)
    assert.equal('output' in detail, false)
    assert.deepEqual(detail.configurationSnapshot.tools, ['read', 'bash'])
    const tools = await runs.tools({ projectPath: root, runId: result.runId })
    assert.deepEqual(
      tools.tools.map(tool => tool.toolCallId),
      ['read', 'test', 'orphan'],
    )
    assert.equal(tools.tools[1]!.durationMs, 12)
    assert.equal(tools.tools[2]!.startedAt, undefined)
    assert.equal(tools.tools[2]!.incomplete, true)
    assert.match(
      (await runs.tool(root, result.runId, 'test')).outputPreview,
      /测试失败/,
    )
    assert.equal('inputPreview' in tools.tools[0]!, false)
    assert.ok(detail.diagnostics.some(text => text.includes('调用身份')))
    const output = await runs.output({
      projectPath: root,
      runId: result.runId,
    })
    assert.equal(output.reset, true)
    assert.equal(output.text, '已修正报告')
    const empty = await runs.output({
      projectPath: root,
      runId: result.runId,
      version: output.version,
      after: output.endOffset,
    })
    assert.equal(empty.text, '')
    assert.equal(empty.reset, false)
    const observed = messages.filter(
      message => message.type === 'run_updated',
    )
    assert.ok(
      observed.some(
        message =>
          message.run.progress?.phase === 'tool'
          && message.run.progress.toolName === 'read'
          && message.run.failedToolCount === 1,
      ),
    )
    assert.ok(
      observed.every(
        message =>
          !('output' in message.run)
          && !('configurationSnapshot' in message.run),
      ),
    )
    assert.deepEqual(
      observed.map(message => message.run.revision),
      [...observed.map(message => message.run.revision)].sort(
        (a, b) => a - b,
      ),
    )
    await assert.rejects(
      runs.read(await realpath(tmpdir()), result.runId),
      /不存在/,
    )
    await assert.rejects(runs.cancel(root, result.runId), /已结束/)
    await assert.rejects(
      runs.output({ projectPath: root, runId: result.runId, after: -1 }),
      /游标/,
    )
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('keeps concurrent runs separate, confirms cancellation and cleans temporary prompts', async () => {
  const { root, dataDir } = await setup()
  const cliEntry = join(root, 'pi.cjs')
  await writeFile(
    cliEntry,
    `
    const fs=require('node:fs'); const args=process.argv.slice(2);
    const prompt=args[args.indexOf('--append-system-prompt')+1];
    fs.writeFileSync(args.at(-1).includes('one')?'one.json':'two.json',JSON.stringify({args,prompt}));
    console.log(JSON.stringify({type:'tool_execution_start',toolCallId:'work',toolName:'bash',args:{command:'wait'}}));
    setInterval(()=>{},1000);
  `,
  )
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const runs = await createSubagentRuns({
    dataDir,
    cliEntry,
    publish: (message) => {
      if (message.type === 'run_updated' && message.changedTools?.length)
        started()
    },
  })
  try {
    const one = runs.execute({ ...input(root), task: 'one' })
    const two = runs.execute({ ...input(root), task: 'two' })
    await ready
    const page = await runs.list({ projectPath: root })
    assert.equal(page.activeRuns.length, 2)
    await runs.cancel(root, page.activeRuns[0]!.id)
    await runs.close()
    const results = await Promise.all([one, two])
    assert.ok(
      results.every(result =>
        ['interrupted', 'cancelled'].includes(result.status),
      ),
    )
    for (const name of ['one', 'two']) {
      // Cancellation may arrive before the second child starts.
      const invocation = await readFile(join(root, `${name}.json`), 'utf8')
        .then(JSON.parse)
        .catch(() => null)
      if (invocation) {
        assert.ok(invocation.args.includes('--no-session'))
        assert.ok(invocation.args.includes('--no-extensions'))
        await assert.rejects(readFile(invocation.prompt), { code: 'ENOENT' })
      }
    }
    const reopened = await createSubagentRuns({ dataDir })
    try {
      for (const run of (await reopened.list({ projectPath: root })).runs) {
        assert.notEqual(run.status, 'running')
        const tools = await reopened.tools({
          projectPath: root,
          runId: run.id,
        })
        assert.ok(tools.tools.every(tool => tool.status === 'interrupted'))
      }
    }
    finally {
      await reopened.close()
    }
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('migrates legacy records once and persists interruption without inventing completion time', async () => {
  const { root, dataDir } = await setup()
  await mkdir(join(dataDir, 'flows'), { recursive: true })
  const legacy = {
    ...input(root),
    id: 'legacy',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    output: 'partial',
  }
  const path = join(dataDir, 'flows', 'project.json')
  await writeFile(
    path,
    JSON.stringify({ projectPath: root, nodes: [], runs: [legacy] }),
  )
  const runs = await createSubagentRuns({ dataDir })
  let interruptedAt: string | undefined
  try {
    const detail = await runs.read(root, 'legacy')
    assert.equal(detail.status, 'interrupted')
    assert.equal(detail.completedAt, undefined)
    assert.equal(detail.lastObservedAt, legacy.createdAt)
    assert.equal(detail.historyAvailability, 'legacy')
    interruptedAt = detail.interruptedAt
    assert.ok(interruptedAt)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).runs, undefined)
    assert.equal(
      (await runs.output({ projectPath: root, runId: 'legacy' })).text,
      'partial',
    )
  }
  finally {
    await runs.close()
  }
  const again = await createSubagentRuns({ dataDir })
  try {
    assert.equal(
      (await again.read(root, 'legacy')).interruptedAt,
      interruptedAt,
    )
  }
  finally {
    await again.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('paginates tools and history without dropping active runs, and validates scoped cursors', async () => {
  const { root, dataDir } = await setup()
  const runs = await createSubagentRuns({
    dataDir,
    execute: async (_input, _signal, fact) => {
      for (let i = 0; i < 55; i++) {
        fact({
          type: 'tool_start',
          toolCallId: String(i),
          toolName: 'read',
          args: { path: 'a' },
        })
        fact({
          type: 'tool_end',
          toolCallId: String(i),
          toolName: 'read',
          result: {},
          isError: false,
        })
      }
      fact({ type: 'output', output: 'done', endOffset: 4 })
      return { output: 'done', cancelled: false, closed: true }
    },
  })
  try {
    const result = await runs.execute(input(root))
    const first = await runs.tools({ projectPath: root, runId: result.runId })
    assert.equal(first.tools.length, 50)
    const second = await runs.tools({
      projectPath: root,
      runId: result.runId,
      cursor: first.nextCursor!,
    })
    assert.equal(second.tools.length, 5)
    await assert.rejects(
      runs.tools({ projectPath: root, runId: result.runId, cursor: 'garbage' }),
      /游标/,
    )
    // Insert terminal fixtures directly to exercise ordering with identical timestamps.
    const database = new DatabaseSync(join(dataDir, 'runs.sqlite'))
    const fixture = await runs.read(root, result.runId)
    for (let i = 0; i < 55; i++) {
      const copy = {
        ...fixture,
        id: `history-${String(i).padStart(2, '0')}`,
        createdAt: fixture.createdAt,
      }
      database
        .prepare(
          'INSERT INTO runs(id,project_path,created_at,orchestrator_id,role_id,status,metadata) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          copy.id,
          root,
          copy.createdAt,
          copy.orchestratorId,
          copy.roleId,
          copy.status,
          JSON.stringify(copy),
        )
    }
    database.close()
    const page = await runs.list({ projectPath: root })
    assert.equal(page.runs.length, 50)
    const next = await runs.list({
      projectPath: root,
      cursor: page.nextCursor!,
    })
    assert.equal(next.runs.length, 6)
    assert.equal(
      new Set([...page.runs, ...next.runs].map(run => run.id)).size,
      56,
    )
    await assert.rejects(
      runs.list({
        projectPath: root,
        roleId: 'different',
        cursor: page.nextCursor!,
      }),
      /筛选/,
    )
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('keeps a single owner, rolls back failed records and preserves known execution success', async () => {
  const { root, dataDir } = await setup()
  let database: DatabaseSync | undefined
  const messages: RunMessage[] = []
  const runs = await createSubagentRuns({
    dataDir,
    publish: message => messages.push(message),
    execute: async (_input, signal, fact) => {
      database!.exec(`CREATE TRIGGER fail_tool BEFORE INSERT ON run_tools BEGIN SELECT RAISE(FAIL,'disk fault'); END`)
      fact({ type: 'tool_start', toolCallId: 'one', toolName: 'read', args: {} })
      assert.equal(signal.aborted, true)
      database!.exec('DROP TRIGGER fail_tool')
      return { output: '', cancelled: true, closed: true }
    },
  })
  try {
    await assert.rejects(createSubagentRuns({ dataDir }), /另一个 piflow 实例使用/)
    database = new DatabaseSync(join(dataDir, 'runs.sqlite'))
    const result = await runs.execute(input(root))
    assert.equal(result.status, 'interrupted')
    assert.match(result.recordingError!, /disk fault/)
    assert.equal((await runs.read(root, result.runId)).toolCount, 0)
    assert.equal((await runs.tools({ projectPath: root, runId: result.runId })).tools.length, 0)
    assert.ok(messages.some(message => message.type === 'run_recording_error'))
    database.close()
    database = undefined
    await runs.close()
    const reopened = await createSubagentRuns({ dataDir, execute: async () => {
      database!.exec(`CREATE TRIGGER fail_end BEFORE UPDATE ON runs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(FAIL,'terminal fault'); END`)
      return { output: 'done', cancelled: false, closed: true }
    } })
    try {
      database = new DatabaseSync(join(dataDir, 'runs.sqlite'))
      const success = await reopened.execute(input(root))
      assert.equal(success.status, 'succeeded')
      assert.match(success.recordingError!, /terminal fault/)
      assert.equal((await reopened.read(root, success.runId)).status, 'running')
      database.exec('DROP TRIGGER fail_end')
    }
    finally { await reopened.close() }
  }
  finally {
    database?.close()
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('bounds multibyte evidence and output, and treats preview failure as nonfatal', async () => {
  const { root, dataDir } = await setup()
  const runs = await createSubagentRuns({ dataDir, execute: async (_input, _signal, fact) => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    fact({ type: 'tool_start', toolCallId: 'unicode', toolName: 'read', args: '中文🙂'.repeat(3000) })
    fact({ type: 'tool_end', toolCallId: 'unicode', toolName: 'read', result: '输出🙂'.repeat(3000), isError: false })
    fact({ type: 'tool_start', toolCallId: 'circular', toolName: 'read', args: circular })
    fact({ type: 'tool_end', toolCallId: 'circular', toolName: 'read', result: {}, isError: false })
    const output = '🙂'.repeat(80001)
    fact({ type: 'output', output, endOffset: output.length })
    return { output, cancelled: false, closed: true }
  } })
  try {
    const result = await runs.execute(input(root))
    assert.equal(result.status, 'succeeded')
    const tool = await runs.tool(root, result.runId, 'unicode')
    assert.equal(tool.inputTruncated, true)
    assert.ok(Buffer.byteLength(tool.inputPreview) <= 8192)
    assert.equal(tool.inputPreview.includes('�'), false)
    assert.equal(tool.outputPreview.includes('�'), false)
    assert.equal((await runs.tool(root, result.runId, 'circular')).evidenceIncomplete, true)
    const output = await runs.output({ projectPath: root, runId: result.runId })
    assert.ok(output.text.length <= 160000)
    assert.equal(output.text, '🙂'.repeat(80000))
    assert.equal(output.truncated, true)
    assert.equal(output.baseOffset, 2)
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('confirms one cancellation without stopping another run and records process errors', async () => {
  const { root, dataDir } = await setup()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let count = 0
  const runs = await createSubagentRuns({ dataDir, execute: async (_input, signal, fact) => {
    if (++count === 2)
      started()
    await new Promise<void>((resolve) => {
      if (signal.aborted)
        resolve()
      else signal.addEventListener('abort', () => resolve(), { once: true })
    })
    fact({ type: 'closed' })
    return { output: '', cancelled: true, closed: true }
  } })
  try {
    const one = runs.execute({ ...input(root), task: 'one' })
    const two = runs.execute({ ...input(root), task: 'two' })
    await ready
    const target = (await runs.list({ projectPath: root })).runs.find(run => run.taskPreview === 'one')!
    await runs.cancel(root, target.id)
    assert.equal((await one).status, 'cancelled')
    assert.equal((await runs.list({ projectPath: root })).activeRuns.length, 1)
    await runs.close()
    assert.equal((await two).status, 'interrupted')
    const cliEntry = join(root, 'pi.cjs')
    await writeFile(cliEntry, `console.error('fatal CLI'); process.exitCode=7`)
    const failures = await createSubagentRuns({ dataDir, cliEntry })
    try {
      const failed = await failures.execute(input(root))
      assert.equal(failed.status, 'failed')
      assert.match(failed.error!, /fatal CLI/)
      await writeFile(cliEntry, `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'provider unavailable',content:[]}}))`)
      const provider = await failures.execute(input(root))
      assert.equal(provider.status, 'failed')
      assert.match(provider.error!, /provider unavailable/)
    }
    finally { await failures.close() }
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('retains native bash exit codes independently of tool status and scopes command pagination', async () => {
  const { createBashTool } = await import('@earendil-works/pi-coding-agent')
  const { root, dataDir } = await setup()
  const runs = await createSubagentRuns({ dataDir, execute: async (_input, _signal, fact) => {
    const bash = createBashTool(root)
    for (const [id, command] of [['ok', 'printf ok'], ['failed', 'printf failed; exit 7']] as const) {
      fact({ type: 'tool_start', toolCallId: id, toolName: 'bash', args: { command } })
      const result = await bash.execute(id, { command, timeout: 5 })
      fact({ type: 'tool_end', toolCallId: id, toolName: 'bash', result, isError: id === 'failed' })
    }
    fact({ type: 'tool_end', toolCallId: 'orphan', toolName: 'bash', result: { content: [{ type: 'text', text: 'exit code 0' }] }, isError: false })
    fact({ type: 'tool_start', toolCallId: 'unfinished', toolName: 'bash', args: { command: 'wait' } })
    fact({ type: 'closed', exitCode: 0, signal: null })
    return { output: 'done', cancelled: false, closed: true }
  } })
  try {
    const result = await runs.execute(input(root))
    const page = await runs.commands({ projectPath: root, runId: result.runId })
    assert.deepEqual(page.counts, { total: 4, nonzero: 1, unknown: 2 })
    assert.deepEqual(page.commands.map(command => command.commandExitCode), [0, 7, null, null])
    assert.equal(page.commands[2]!.commandPreview, null)
    assert.equal(page.commands[3]!.status, 'interrupted')
    assert.equal('command' in page.commands[0]!, false)
    const tool = await runs.tool(root, result.runId, 'failed')
    assert.equal(tool.command?.exitCodeSource, 'pi-structured-result')
    assert.equal(tool.command?.command, 'printf failed; exit 7')
    assert.equal((await runs.read(root, result.runId)).processExit?.exitCode, 0)
    assert.equal(result.status, 'succeeded')
    await assert.rejects(runs.commands({ projectPath: await realpath(tmpdir()), runId: result.runId }), /不存在/)
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('filters commands before paging and preserves real CLI close codes', async () => {
  const { root, dataDir } = await setup()
  const cliEntry = join(root, 'pi.cjs')
  await writeFile(cliEntry, `
    const emit=e=>console.log(JSON.stringify(e));
    for(let i=0;i<110;i++) {
      const toolName=i<55?'read':'bash', toolCallId=String(i);
      emit({type:'tool_execution_start', toolCallId, toolName, args:{command:'echo '+i}});
      emit({type:'tool_execution_end', toolCallId, toolName, result:{structuredContent:{exit_code:i===55?7:0}}, isError:i===55});
    }
    emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}]}});
    process.exitCode=9;
  `)
  const runs = await createSubagentRuns({ dataDir, cliEntry })
  try {
    const result = await runs.execute(input(root))
    const first = await runs.commands({ projectPath: root, runId: result.runId })
    assert.equal(first.commands.length, 50)
    assert.equal(first.commands[0]!.toolCallId, '55')
    const last = await runs.commands({ projectPath: root, runId: result.runId, cursor: first.nextCursor! })
    assert.equal(last.commands.length, 5)
    assert.deepEqual(first.counts, { total: 55, nonzero: 1, unknown: 0 })
    const detail = await runs.read(root, result.runId)
    assert.equal(detail.processExit?.exitCode, 9)
    assert.equal(detail.completedAt, detail.processExit?.closedAt)
    assert.equal(result.status, 'failed')
    await assert.rejects(runs.tools({ projectPath: root, runId: result.runId, cursor: first.nextCursor! }), /游标/)
    await assert.rejects(runs.commands({ projectPath: root, runId: result.runId, cursor: 'bad' }), /游标/)
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
