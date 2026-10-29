import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { FlowTopology } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { LEGACY_MODULES_FILE, PROJECT_CANVAS_FILE, UnsupportedProjectCanvasVersion } from '@piflow/protocol'
import { canAccessNode, createFlowStore, findConnection, listConnectedNodes } from '../../flow/store'
import { formatFlowDirectory, moduleContext, searchMessages } from '../../flow/tools'

it('persists topology without allowing topology updates to erase message history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')
  const topology = fixtureTopology(root)

  try {
    const store = createFlowStore(dataDir)
    await store.replaceTopology(root, topology, { commitGraph: true })
    await store.appendMessage(root, {
      id: 'message-1',
      edgeId: 'a-b',
      source: 'a',
      target: 'b',
      body: 'Please review this change',
      preview: 'Please review this change',
      sentAt: new Date().toISOString(),
      status: 'replied',
      read: true,
      reminded: false,
    })
    const canvasFile = join(root, PROJECT_CANVAS_FILE)
    const beforeMove = await readFile(canvasFile, 'utf8')
    await store.replaceTopology(root, { ...topology, nodes: [], edges: [], viewport: { x: 12, y: 24, zoom: 1.2 } })
    assert.equal(await readFile(canvasFile, 'utf8'), beforeMove)

    const restored = await createFlowStore(dataDir).read(root)
    assert.equal(restored.messages.length, 1)
    assert.equal(restored.nodes.length, topology.nodes.length)
    assert.deepEqual(restored.viewport, { x: 12, y: 24, zoom: 1.2 })
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('uses connections as symmetric discovery and context boundaries', () => {
  const document = {
    version: 1 as const,
    projectPath: '/project',
    messages: [],
    updatedAt: new Date().toISOString(),
    ...fixtureTopology('/project'),
  }

  assert.deepEqual(listConnectedNodes(document, 'a').map(node => node.id), ['b'])
  assert.deepEqual(listConnectedNodes(document, 'b').map(node => node.id), ['a'])
  assert.equal(canAccessNode(document, 'a', 'b'), true)
  assert.equal(canAccessNode(document, 'b', 'a'), true)
  assert.equal(canAccessNode(document, 'c', 'a'), false)
  assert.equal(findConnection(document, 'b', 'a')?.id, 'a-b')

  const directoryA = formatFlowDirectory(document, join('/project', 'a.jsonl'))
  assert.match(directoryA ?? '', /Peers:\n- b \| Module B/)
  assert.doesNotMatch(directoryA ?? '', /Isolated/)

  const directoryB = formatFlowDirectory(document, join('/project', 'b.jsonl'))
  assert.match(directoryB ?? '', /Peers:\n- a \| Module A/)

  const withBrief = {
    ...document,
    nodes: document.nodes.map(node => node.id === 'b' ? { ...node, brief: 'Owns login and session cookies.' } : node),
  }
  assert.match(formatFlowDirectory(withBrief, join('/project', 'a.jsonl')) ?? '', /Owns login and session cookies/)
  assert.deepEqual(moduleContext({ brief: '  负责登录边界  ' }), { path: 'piflow-module.md', content: '负责登录边界' })
  assert.equal(moduleContext({ brief: '  ' }), null)
})

it('remembers an emptied canvas so reopening does not look like a new project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')

  try {
    const store = createFlowStore(dataDir)
    assert.equal((await store.readState(root)).stored, false)
    await store.replaceTopology(root, { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const reopened = await createFlowStore(dataDir).readState(root)
    assert.equal(reopened.stored, true)
    assert.equal(reopened.document.nodes.length, 0)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a second edge between the same peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const topology = fixtureTopology(root)

  try {
    const store = createFlowStore(join(root, 'data'))
    await assert.rejects(
      store.replaceTopology(root, {
        ...topology,
        edges: [
          ...topology.edges,
          { id: 'b-a', source: 'b', target: 'a', createdAt: new Date().toISOString() },
        ],
      }),
      /duplicate flow connection/,
    )
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('writes the module graph into the project and leaves bindings local', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')
  const topology = fixtureTopology(root)

  try {
    const store = createFlowStore(dataDir)
    await store.replaceTopology(root, {
      ...topology,
      nodes: topology.nodes.map(node => node.id === 'a' ? { ...node, brief: 'Owns login.' } : node),
    }, { commitGraph: true })
    const projectFile = join(root, PROJECT_CANVAS_FILE)
    const first = await readFile(projectFile, 'utf8')
    assert.match(first, /Owns login\./)
    assert.doesNotMatch(first, /sessionPath|viewport|projectPath/)

    await store.replaceTopology(root, { ...topology, nodes: topology.nodes.map(node => node.id === 'a' ? { ...node, brief: 'Owns login.' } : node), viewport: { x: 3, y: 4, zoom: 1 } })
    assert.equal(await readFile(projectFile, 'utf8'), first)

    const beforeMessage = await readFile(projectFile, 'utf8')
    await store.appendMessage(root, {
      id: 'message-1',
      edgeId: 'a-b',
      source: 'a',
      target: 'b',
      body: 'hello',
      preview: 'hello',
      sentAt: new Date().toISOString(),
      status: 'replied',
      read: true,
      reminded: false,
    })
    assert.equal(await readFile(projectFile, 'utf8'), beforeMessage)

    const edited = JSON.parse(first) as { nodes: Array<{ id: string, brief?: string, customKind?: string }> }
    const moduleA = edited.nodes.find(module => module.id === 'a')
    if (!moduleA)
      throw new Error('missing module')
    moduleA.brief = 'From the repo.'
    moduleA.customKind = 'review'
    await writeFile(projectFile, `${JSON.stringify(edited, null, 2)}\n`)
    const reopened = await createFlowStore(dataDir).read(root)
    assert.equal(reopened.nodes.find(node => node.id === 'a')?.brief, 'From the repo.')
    assert.equal(reopened.nodes.find(node => node.id === 'a')?.sessionPath, join(root, 'a.jsonl'))

    await createFlowStore(dataDir).replaceTopology(root, {
      ...topology,
      nodes: reopened.nodes,
      edges: reopened.edges,
      viewport: reopened.viewport,
    }, { commitGraph: true })
    assert.match(await readFile(projectFile, 'utf8'), /"customKind": "review"/)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('accepts a conductor draft and drops a session card that is not a module', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')
  const now = new Date().toISOString()

  try {
    const normalized = (await createFlowStore(dataDir).readState(root)).document.projectPath
    const id = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
    await mkdir(join(dataDir, 'flows'), { recursive: true })
    await writeFile(join(dataDir, 'flows', `${id}.json`), `${JSON.stringify({
      version: 1,
      projectPath: normalized,
      nodes: [{
        id: 'seed',
        sessionPath: join(root, 'seed.jsonl'),
        name: '临时',
        goal: '',
        brief: '',
        position: { x: 0, y: 0 },
        createdAt: now,
        updatedAt: now,
      }],
      edges: [],
      messages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    }, null, 2)}\n`)
    const accepted = await createFlowStore(dataDir).acceptConductor(normalized, {
      modules: [{ id: 'new:login', name: '登录', brief: '负责登录边界' }],
      links: [],
    })
    assert.equal(accepted.nodes.length, 1)
    assert.equal(accepted.nodes[0]?.name, '登录')
    assert.equal(accepted.nodes[0]?.sessionPath, '')
    assert.notEqual(accepted.nodes[0]?.id, 'seed')
    const written = await readFile(join(root, PROJECT_CANVAS_FILE), 'utf8')
    assert.match(written, /负责登录边界/)
    assert.doesNotMatch(written, /sessionPath/)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('opens a committed module graph with no local binding and will not rewrite a newer version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const projectFile = join(root, PROJECT_CANVAS_FILE)

  try {
    await mkdir(join(root, '.piflow'))
    await writeFile(projectFile, `${JSON.stringify({
      version: 1,
      nodes: [{ id: 'login', name: '登录', brief: '会话边界', position: { x: 10, y: 20 } }],
      links: [],
    }, null, 2)}\n`)
    const opened = await createFlowStore(join(root, 'data')).readState(root)
    assert.equal(opened.stored, true)
    assert.equal(opened.document.nodes[0]?.sessionPath, '')
    assert.equal(opened.document.nodes[0]?.brief, '会话边界')
    assert.deepEqual(opened.document.nodes[0]?.position, { x: 10, y: 20 })

    const newer = `${JSON.stringify({ version: 2, modules: [], links: [], future: true }, null, 2)}\n`
    await writeFile(projectFile, newer)
    const store = createFlowStore(join(root, 'fresh'))
    await assert.rejects(store.read(root), UnsupportedProjectCanvasVersion)
    await assert.rejects(store.replaceTopology(root, { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }), UnsupportedProjectCanvasVersion)
    assert.equal(await readFile(projectFile, 'utf8'), newer)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('moves modules.json into canvas.json and keeps the local position', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')
  const now = new Date().toISOString()

  try {
    const normalized = (await createFlowStore(dataDir).readState(root)).document.projectPath
    const id = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
    await mkdir(join(root, '.piflow'), { recursive: true })
    await mkdir(join(dataDir, 'flows'), { recursive: true })
    await writeFile(join(root, LEGACY_MODULES_FILE), `${JSON.stringify({
      version: 1,
      modules: [{ id: 'login', name: '登录', brief: '会话边界', customKind: 'review' }],
      links: [],
    }, null, 2)}\n`)
    await writeFile(join(dataDir, 'flows', `${id}.json`), `${JSON.stringify({
      version: 1,
      projectPath: normalized,
      nodes: [{
        id: 'login',
        sessionPath: join(root, 'login.jsonl'),
        name: '登录',
        goal: '本地目标',
        brief: '会被仓库盖掉',
        position: { x: 40, y: 50 },
        createdAt: now,
        updatedAt: now,
      }],
      edges: [],
      messages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    }, null, 2)}\n`)
    const opened = await createFlowStore(dataDir).read(root)
    assert.equal(opened.nodes[0]?.brief, '会话边界')
    assert.equal(opened.nodes[0]?.goal, '本地目标')
    assert.deepEqual(opened.nodes[0]?.position, { x: 40, y: 50 })
    assert.match(await readFile(join(root, PROJECT_CANVAS_FILE), 'utf8'), /"customKind": "review"/)
    await assert.rejects(readFile(join(root, LEGACY_MODULES_FILE), 'utf8'))
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reads a delivery written before status existed as already finished', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')

  try {
    const normalized = (await createFlowStore(dataDir).readState(root)).document.projectPath
    const id = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
    const now = new Date().toISOString()
    await mkdir(join(dataDir, 'flows'), { recursive: true })
    await writeFile(join(dataDir, 'flows', `${id}.json`), `${JSON.stringify({
      version: 1,
      projectPath: normalized,
      nodes: [],
      edges: [],
      messages: [{
        id: 'old',
        edgeId: 'a-b',
        source: 'a',
        target: 'b',
        chainId: 'chain-1',
        hop: 2,
        preview: 'hello from before',
        sentAt: now,
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    })}\n`)
    const restored = await createFlowStore(dataDir).read(root)
    assert.equal(restored.messages[0]?.status, 'replied')
    assert.equal(restored.messages[0]?.body, 'hello from before')
    assert.equal(restored.messages[0]?.read, false)
    assert.equal('chainId' in (restored.messages[0] ?? {}), false)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('drops finished deliveries before a waiting one when the log is full', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')

  try {
    const store = createFlowStore(dataDir)
    const now = new Date().toISOString()
    for (let index = 0; index < 500; index++) {
      await store.appendMessage(root, {
        id: `done-${index}`,
        edgeId: 'a-b',
        source: 'a',
        target: 'b',
        body: 'done',
        preview: 'done',
        sentAt: now,
        status: 'failed',
        read: false,
        reminded: false,
      })
    }
    await store.appendMessage(root, {
      id: 'waiting',
      edgeId: 'a-b',
      source: 'a',
      target: 'b',
      body: 'still waiting',
      preview: 'still waiting',
      sentAt: now,
      status: 'queued',
      read: false,
      reminded: false,
    })
    const restored = await store.read(root)
    assert.equal(restored.messages.length, 500)
    assert.equal(restored.messages.some(message => message.id === 'done-0'), false)
    assert.equal(restored.messages.at(-1)?.id, 'waiting')

    const updated = await store.updateMessage(root, 'waiting', message => ({ ...message, status: 'delivered', read: true }))
    assert.equal(updated?.status, 'delivered')
    assert.equal(updated?.read, true)
    assert.equal((await store.read(root)).messages.at(-1)?.status, 'delivered')
    assert.equal(await store.updateMessage(root, 'missing', () => null), null)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('searches messages by exact text and returns newest matches first', () => {
  const messages = [
    { role: 'user', content: 'Context corruption decision from yesterday' },
    { role: 'assistant', content: '上下文已经腐化' },
    { role: 'assistant', content: 'Context changed before unrelated corruption appeared' },
    { role: 'assistant', content: 'Latest CONTEXT CORRUPTION decision' },
  ] as unknown as AgentMessage[]

  const results = searchMessages(messages, 'context corruption')

  assert.deepEqual(results.map(result => result.messageIndex), [3, 0])
  assert.equal('score' in results[0]!, false)
  assert.deepEqual(searchMessages(messages, '上下文已经').map(result => result.messageIndex), [1])
})

function fixtureTopology(root: string): FlowTopology {
  const now = new Date().toISOString()
  return {
    nodes: [
      { id: 'a', sessionPath: join(root, 'a.jsonl'), name: 'Module A', goal: '', position: { x: 0, y: 0 }, createdAt: now, updatedAt: now },
      { id: 'b', sessionPath: join(root, 'b.jsonl'), name: 'Module B', goal: '', position: { x: 400, y: 0 }, createdAt: now, updatedAt: now },
      { id: 'c', sessionPath: join(root, 'c.jsonl'), name: 'Isolated', goal: '', position: { x: 0, y: 300 }, createdAt: now, updatedAt: now },
    ],
    edges: [{ id: 'a-b', source: 'a', target: 'b', createdAt: now }],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

it('persists Agent roles and multi-owner memberships independently of communication edges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-agents-'))
  try {
    const dataDir = join(root, 'local')
    const topology = fixtureTopology(root)
    topology.nodes = topology.nodes.map(node => ({
      ...node,
      kind: node.id === 'b' ? 'subagent-role' as const : 'persistent' as const,
      sessionPath: node.id === 'b' ? '' : node.sessionPath,
      orchestrationEnabled: node.id !== 'b',
      roleLabel: node.id === 'b' ? '测试' : '编排者',
      rolePrompt: node.id === 'b' ? '验证验收标准' : '拆解任务',
    }))
    topology.edges = []
    topology.memberships = [
      { orchestratorId: 'a', memberId: 'b' },
      { orchestratorId: 'c', memberId: 'b' },
    ]
    const store = createFlowStore(dataDir)
    await store.replaceTopology(root, topology, { commitGraph: true })
    const restored = await createFlowStore(dataDir).read(root)
    assert.deepEqual(restored.memberships, topology.memberships)
    assert.equal(restored.nodes.find(node => node.id === 'b')?.rolePrompt, '验证验收标准')
    assert.deepEqual(restored.edges, topology.edges)
    const shared = await createFlowStore(join(root, 'another-local')).read(root)
    assert.deepEqual(shared.memberships, topology.memberships)
    assert.equal(shared.nodes.find(node => node.id === 'b')?.roleLabel, '测试')
    assert.equal(shared.nodes.find(node => node.id === 'a')?.orchestrationEnabled, true)
    assert.equal(shared.nodes[0]?.sessionPath, '')

    await store.replaceTopology(root, { ...topology, memberships: [], nodes: topology.nodes.map(node => ({ ...node, rolePrompt: '不应从视口保存覆盖配置' })) })
    assert.deepEqual((await store.read(root)).memberships, topology.memberships)
    assert.equal((await store.read(root)).nodes.find(node => node.id === 'b')?.rolePrompt, '验证验收标准')

    await assert.rejects(store.replaceTopology(root, {
      ...topology,
      nodes: topology.nodes.map(node => ({ ...node, orchestrationEnabled: true })),
    }, { commitGraph: true }), /Subagent 角色不能启用编排能力/)
    await assert.rejects(store.replaceTopology(root, {
      ...topology,
      memberships: [{ orchestratorId: 'a', memberId: 'missing' }],
    }, { commitGraph: true }), /不存在的 Agent/)
    assert.deepEqual((await store.read(root)).memberships, topology.memberships)
    assert.match(moduleContext(restored.nodes.find(node => node.id === 'b')!)?.content ?? '', /用户角色指令\n验证验收标准/)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
