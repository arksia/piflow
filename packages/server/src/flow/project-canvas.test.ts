import assert from 'node:assert/strict'
import { it } from 'node:test'
import { parseLegacyModules, parseProjectCanvas, serializeProjectCanvas, UnsupportedProjectCanvasVersion } from '@piflow/protocol'

it('keeps unknown fields and defaults a missing brief', () => {
  const parsed = parseProjectCanvas({
    version: 1,
    owner: 'team',
    nodes: [
      { id: 'login', name: '登录', position: { x: 1, y: 2 }, kind: 'review' },
      { id: 'session', name: '会话', position: { x: 3, y: 4 } },
    ],
    links: [{ id: 'link', source: 'login', target: 'session' }],
  })

  assert.equal(parsed.canvas.nodes[0]?.brief, '')
  assert.deepEqual(parsed.canvas.nodes[0]?.position, { x: 1, y: 2 })
  assert.equal(parsed.extras.owner, 'team')
  assert.equal(parsed.nodeExtras.login?.kind, 'review')
  assert.throws(() => parseProjectCanvas({
    version: 1,
    nodes: [{ id: 'login', name: '登录', position: { x: 0, y: 0 } }],
    links: [{ id: 'link', source: 'login', target: 'login' }],
  }), /invalid canvas link/)
})

it('writes unknown fields back and refuses a newer version', () => {
  const parsed = parseProjectCanvas({
    version: 1,
    nodes: [{ id: 'login', name: '登录', brief: '边界', position: { x: 8, y: 9 }, kind: 'review' }],
    links: [],
    note: true,
  })
  const written = serializeProjectCanvas(parsed)

  assert.deepEqual(written, {
    version: 1,
    nodes: [{ id: 'login', name: '登录', brief: '边界', position: { x: 8, y: 9 }, kind: 'review' }],
    links: [],
    note: true,
  })
  assert.throws(() => parseProjectCanvas({ version: 2, nodes: [], links: [] }), UnsupportedProjectCanvasVersion)
  assert.throws(() => parseProjectCanvas({ version: '1', nodes: [], links: [] }), /invalid project canvas/)
  assert.equal(parseLegacyModules({
    version: 1,
    modules: [{ id: 'login', name: '登录' }],
    links: [],
  }).nodes[0]?.brief, '')
})
