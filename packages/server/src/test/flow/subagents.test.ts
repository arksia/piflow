import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { createFlowStore } from '../../flow/store'
import { createSubagentTools, orchestrationContext } from '../../flow/subagents'
import { createSubagentRuns } from '../../runs'

const emptyContext = {} as Parameters<ToolDefinition['execute']>[4]
it('delegates with immutable snapshots and independent history without changing topology', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-subagent-'))
  const flow = createFlowStore(join(root, 'data'))
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), execute: async (input, _signal, fact) => {
    assert.deepEqual(input.configurationSnapshot.tools, input.configurationSnapshot.delivery ? ['read', 'submit_code_delivery'] : ['read'])
    if (input.configurationSnapshot.delivery)
      assert.match(input.configurationSnapshot.effectivePrompt, /Code delivery evidence/)
    assert.match(input.configurationSnapshot.effectivePrompt, /检查边界条件/)
    fact({ type: 'output', output: '验证通过', endOffset: 4 })
    return { output: '验证通过', cancelled: false, closed: true }
  } })
  try {
    const common = { goal: '', brief: '', position: { x: 0, y: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await flow.replaceTopology(root, { nodes: [
      { ...common, id: 'main', name: '主 Agent', sessionPath: '/main', orchestrationEnabled: true, kind: 'persistent' },
      { ...common, id: 'role', name: '测试', sessionPath: '', kind: 'subagent-role', rolePrompt: '检查边界条件', tools: ['read', 'bash'] },
    ], memberships: [{ orchestratorId: 'main', memberId: 'role' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, { commitGraph: true })
    const before = await flow.read(root)
    assert.match(orchestrationContext(before, before.nodes[0]!)!.content, /integrate subagent results/)
    let trusted = false
    const tools = createSubagentTools({ flow, runs, isTrusted: () => trusted, source: () => ({ cwd: root, sessionPath: '/main', model: 'provider/model', thinkingLevel: 'medium', tools: ['read'] }) })
    const call = tools.find(tool => tool.name === 'subagent')!
    await assert.rejects(call.execute('untrusted', { roleId: 'role', task: '检查登录' }, undefined, undefined, emptyContext), /Trust this project/)
    trusted = true
    const result = await call.execute('call-1', { roleId: 'role', task: '检查登录' }, undefined, undefined, emptyContext)
    assert.match(JSON.stringify(result.content), /验证通过/)
    assert.equal((result.details as { run?: unknown }).run, undefined)
    const history = await runs.list({ projectPath: root })
    assert.equal(history.runs.length, 1)
    assert.equal(history.runs[0]!.parentToolCallId, 'call-1')
    assert.equal(history.runs[0]!.status, 'succeeded')
    const after = await flow.read(root)
    assert.deepEqual(after, before)
    assert.equal('runs' in after, false)
    assert.equal(JSON.parse(await readFile(join(root, '.piflow/flow.json'), 'utf8')).runs, undefined)
    const code = await call.execute('code-call', { roleId: 'role', task: '检查交付', delivery: 'code' }, undefined, undefined, emptyContext)
    assert.match(JSON.stringify(code.content), /missing/)
    assert.deepEqual(await flow.read(root), before)
    await assert.rejects(call.execute('invalid', { roleId: 'main', task: 'test' }, undefined, undefined, emptyContext), /target must/)
  }
  finally {
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
