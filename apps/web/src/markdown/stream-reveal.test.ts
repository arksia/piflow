import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextRevealLength } from './stream-reveal'
import { rehypeStreamingText } from './streaming-text'

test('stream catches bursts, preserves Unicode and reaches exact final output', () => {
  const text = '中文 👩‍💻 **stream**\n'.repeat(100)
  let visible = nextRevealLength(text, 0, 32)
  assert.ok(text.length - visible <= 600)
  for (let frame = 0; visible < text.length; frame++) {
    assert.ok(frame < 100, 'presentation queue must drain promptly')
    const next = nextRevealLength(text, visible, 32)
    assert.ok(next > visible && next <= text.length)
    assert.ok(!/[\uD800-\uDBFF]$/.test(text.slice(0, next)))
    visible = next
  }
  assert.equal(text.slice(0, visible), text)
  assert.equal(nextRevealLength('hi', 2, 32), 2)
})

test('cursor stays after trailing code instead of returning to an earlier paragraph', () => {
  const paragraph = { type: 'element', tagName: 'p', children: [{ type: 'text', value: 'Introduction' }] }
  const code = { type: 'element', tagName: 'pre', children: [{ type: 'element', tagName: 'code', children: [{ type: 'text', value: 'code' }] }] }
  const tree = { type: 'root', children: [paragraph, code] }
  rehypeStreamingText({ tail: true })(tree)
  assert.equal(paragraph.children.length, 1)
  assert.equal(tree.children.at(-1)?.tagName, 'stream-tail')
})
