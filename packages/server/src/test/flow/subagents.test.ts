import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { SubagentRun } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { createFlowStore } from '../../flow/store'
import { runSubagentProcess } from '../../flow/subagent-process'
import { cancelSubagentRun, createSubagentTools, orchestrationContext } from '../../flow/subagents'

const emptyContext = {} as Parameters<ToolDefinition['execute']>[4]

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piflow-subagent-test-'))
  const flow = createFlowStore(join(root, 'data'))
  const now = new Date().toISOString()
  const common = { goal: '', brief: '', position: { x: 0, y: 0 }, createdAt: now, updatedAt: now }
  await flow.replaceTopology(root, {
    nodes: [
      { ...common, id: 'main', name: '主 Agent', sessionPath: '/main', orchestrationEnabled: true, kind: 'persistent' },
      { ...common, id: 'other', name: '另一主 Agent', sessionPath: '/other', orchestrationEnabled: true, kind: 'persistent' },
      { ...common, id: 'role', name: '测试', sessionPath: '', kind: 'subagent-role', rolePrompt: '检查边界条件', tools: ['read', 'bash'] },
    ],
    memberships: [{ orchestratorId: 'main', memberId: 'role' }, { orchestratorId: 'other', memberId: 'role' }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }, { commitGraph: true })
  return { root, flow }
}

it('delegates to shared roles with isolated snapshots, returns results, and never creates topology', async () => {
  const { root, flow } = await setup()
  try {
    const before = await flow.read(root)
    const guidance = orchestrationContext(before, before.nodes[0]!)
    assert.match(guidance!.content, /integrate subagent results/)
    assert.match(guidance!.content, /"defaultMember":true/)
    assert.equal(orchestrationContext(before, before.nodes[2]!), null)
    let sessionPath = '/main'
    const tools = createSubagentTools({
      flow,
      agentDir: root,
      isTrusted: () => true,
      source: () => ({ cwd: root, sessionPath, model: 'provider/model', thinkingLevel: 'medium', tools: ['read'] }),
      execute: async (run, _signal, progress) => {
        assert.deepEqual(run.configurationSnapshot.tools, ['read'])
        assert.equal(run.configurationSnapshot.model, 'provider/model')
        assert.match(run.configurationSnapshot.effectivePrompt, /检查边界条件/)
        await progress('检查中')
        return { output: '验证通过', cancelled: false }
      },
    })
    const call = tools.find(tool => tool.name === 'subagent')!
    const one = await call.execute('call-1', { roleId: 'role', task: '检查登录' }, undefined, undefined, emptyContext)
    assert.match(JSON.stringify(one.content), /验证通过/)
    sessionPath = '/other'
    await call.execute('call-2', { roleId: 'role', task: '检查退出' }, undefined, undefined, emptyContext)
    const after = await flow.read(root)
    assert.equal(after.runs?.length, 2)
    assert.notEqual(after.runs![0]!.id, after.runs![1]!.id)
    assert.deepEqual(after.runs?.map(run => run.orchestratorId), ['main', 'other'])
    assert.deepEqual(after.runs?.map(run => run.parentToolCallId), ['call-1', 'call-2'])
    assert.ok(after.runs?.every(run => run.status === 'succeeded'))
    assert.deepEqual(after.nodes, before.nodes)
    assert.deepEqual(after.edges, [])
    assert.deepEqual(after.memberships, before.memberships)
    const disk = await createFlowStore(join(root, 'data')).read(root)
    assert.deepEqual(disk.runs, after.runs)
    const sharedFile = JSON.parse(await readFile(join(root, '.piflow/canvas.json'), 'utf8'))
    assert.equal(sharedFile.runs, undefined)
    await assert.rejects(call.execute('bad', { roleId: 'other', task: '不应委派给主 Agent' }, undefined, undefined, emptyContext), /target must/)
    assert.equal((await flow.read(root)).runs?.length, 2)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('persists two concurrent calls independently while one is cancelled', async () => {
  const { root, flow } = await setup()
  let markStarted!: () => void
  let releaseCalls!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const released = new Promise<void>((resolve) => {
    releaseCalls = resolve
  })
  let count = 0
  try {
    const call = createSubagentTools({
      flow,
      agentDir: root,
      isTrusted: () => true,
      source: () => ({ cwd: root, sessionPath: '/main', model: 'provider/model', thinkingLevel: 'off', tools: [] }),
      execute: async (run, signal, progress) => {
        await progress(`partial:${run.task}`, { phase: 'thinking' })
        if (++count === 2)
          markStarted()
        await released
        return { output: run.task, cancelled: signal.aborted }
      },
    }).find(tool => tool.name === 'subagent')!
    const calls = [call.execute('one', { roleId: 'role', task: 'one' }, undefined, undefined, emptyContext), call.execute('two', { roleId: 'role', task: 'two' }, undefined, undefined, emptyContext)]
    await started
    const document = await flow.read(root)
    assert.equal(document.runs?.filter(run => run.status === 'running').length, 2)
    assert.equal(cancelSubagentRun(document.projectPath, document.runs![0]!.id), true)
    releaseCalls()
    await Promise.all(calls)
    const after = await flow.read(root)
    assert.deepEqual(after.runs?.map(run => run.status).sort(), ['cancelled', 'succeeded'])
    assert.deepEqual(after.runs?.map(run => run.output).sort(), ['one', 'two'])
    assert.deepEqual(after.edges, [])
  }
  finally {
    releaseCalls()
    await rm(root, { recursive: true, force: true })
  }
})

it('records cancellation and failure, rejects untrusted calls, and exposes interrupted runs after restart', async () => {
  const { root, flow } = await setup()
  try {
    let trusted = false
    let seen: SubagentRun | undefined
    const tools = createSubagentTools({
      flow,
      agentDir: root,
      isTrusted: () => trusted,
      source: () => ({ cwd: root, sessionPath: '/main', model: 'provider/model', thinkingLevel: 'off', tools: ['read'] }),
      execute: async (run, signal) => {
        seen = structuredClone(run)
        assert.equal(cancelSubagentRun('/unrelated-project', run.id), false)
        assert.equal(cancelSubagentRun((await flow.read(root)).projectPath, run.id), true)
        return { output: '部分结果', cancelled: signal.aborted }
      },
    })
    const call = tools.find(tool => tool.name === 'subagent')!
    await assert.rejects(call.execute('untrusted', { roleId: 'role', task: 'test' }, undefined, undefined, emptyContext), /Trust this project/)
    assert.equal((await flow.read(root)).runs?.length ?? 0, 0)
    trusted = true
    await call.execute('cancel', { roleId: 'role', task: 'test' }, undefined, undefined, emptyContext)
    assert.equal((await flow.read(root)).runs?.[0]?.status, 'cancelled')
    assert.equal(cancelSubagentRun(root, seen!.id), false)
    await flow.saveRun(root, { ...seen!, id: 'crashed', status: 'running' })
    const disk = await createFlowStore(join(root, 'data')).read(root)
    assert.equal(disk.runs?.find(run => run.id === 'crashed')?.status, 'interrupted')
    assert.equal(disk.runs?.find(run => run.id === seen!.id)?.status, 'cancelled')
    const failure = createSubagentTools({
      flow,
      agentDir: root,
      isTrusted: () => true,
      source: () => ({ cwd: root, sessionPath: '/main', model: 'provider/model', thinkingLevel: 'off', tools: [] }),
      execute: async () => { throw new Error('provider unavailable') },
    }).find(tool => tool.name === 'subagent')!
    const result = await failure.execute('fail', { roleId: 'role', task: 'test' }, undefined, undefined, emptyContext)
    assert.match(JSON.stringify(result.content), /provider unavailable/)
    assert.equal((await flow.read(root)).runs?.at(-1)?.status, 'failed')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('runs a real isolated JSON child process and handles output, failure, cancellation, and prompt cleanup', async () => {
  const { root, flow } = await setup()
  try {
    let snapshot: SubagentRun | undefined
    const call = createSubagentTools({
      flow,
      agentDir: root,
      isTrusted: () => true,
      source: () => ({ cwd: root, sessionPath: '/main', model: 'provider/model', thinkingLevel: 'off', tools: ['read'] }),
      execute: async (run) => {
        snapshot = run
        return { output: 'ready', cancelled: false }
      },
    }).find(tool => tool.name === 'subagent')!
    await call.execute('capture', { roleId: 'role', task: '@literal-is-not-a-file' }, undefined, undefined, emptyContext)
    // Resolve the installed ESM-only pi package even when no child needs to start.
    assert.equal((await runSubagentProcess(snapshot!, AbortSignal.abort(), async () => {})).cancelled, true)
    const cliEntry = join(root, 'fake-pi.cjs')
    await writeFile(cliEntry, `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      const prompt = args[args.indexOf('--append-system-prompt')+1];
      fs.writeFileSync('invocation.json', JSON.stringify({args, prompt, content:fs.readFileSync(prompt,'utf8')}));
      process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'真实子进程输出'}]}})+'\\n');
    `)
    const progress: string[] = []
    const outcome = await runSubagentProcess(snapshot!, new AbortController().signal, async (text) => {
      progress.push(text)
    }, { cliEntry })
    assert.equal(outcome.output, '真实子进程输出')
    assert.equal(outcome.error, undefined)
    assert.equal(progress.length, 1)
    const invocation = JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8'))
    assert.ok(invocation.args.includes('--no-session'))
    assert.ok(invocation.args.includes('--no-extensions'))
    assert.ok(invocation.args.includes('--no-mcp'))
    assert.equal(invocation.args.at(-1), 'Task: @literal-is-not-a-file')
    assert.match(invocation.content, /检查边界条件/)
    await assert.rejects(readFile(invocation.prompt), { code: 'ENOENT' })
    await writeFile(cliEntry, `
      const emit = event => process.stdout.write(JSON.stringify(event)+'\\n');
      emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'流式输出'}});
      setTimeout(() => emit({type:'tool_execution_start',toolName:'read'}), 300);
      setTimeout(() => emit({type:'tool_execution_end',toolName:'read'}), 600);
      setTimeout(() => emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'流式输出完成'}]}}), 900);
    `)
    const streamed: { output: string, phase?: string }[] = []
    const streaming = await runSubagentProcess(snapshot!, new AbortController().signal, async (output, progress) => {
      streamed.push({ output, phase: progress?.phase })
    }, { cliEntry })
    assert.equal(streaming.output, '流式输出完成')
    assert.ok(streamed.some(item => item.output === '流式输出' && item.phase === 'responding'))
    assert.ok(streamed.some(item => item.phase === 'tool'))
    await writeFile(cliEntry, 'process.stderr.write(\'model unavailable\');process.exit(2)')
    assert.match((await runSubagentProcess(snapshot!, new AbortController().signal, async () => {}, { cliEntry })).error!, /model unavailable/)
    await writeFile(cliEntry, 'console.log(JSON.stringify({type:\'message_end\',message:{role:\'assistant\',content:[],stopReason:\'error\',errorMessage:\'quota exceeded\'}}))')
    assert.equal((await runSubagentProcess(snapshot!, new AbortController().signal, async () => {}, { cliEntry })).error, 'quota exceeded')
    await writeFile(cliEntry, 'console.log(JSON.stringify({type:\'message_end\',message:{role:\'assistant\',content:[{type:\'text\',text:\'running\'}]}}));setInterval(()=>{},1000)')
    const controller = new AbortController()
    const cancelled = await runSubagentProcess(snapshot!, controller.signal, async () => {
      controller.abort()
    }, { cliEntry })
    assert.equal(cancelled.cancelled, true)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
