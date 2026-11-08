import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summaryPlacement } from './summary'

test('anchors a summary outside the full node label and docks when no side fits', () => {
  const canvas = { width: 900, height: 600 }
  const anchor = { x: 400, y: 450, width: 180, height: 160 }
  const right = summaryPlacement(anchor, canvas, 260)
  assert.ok(right.x >= anchor.x + anchor.width)
  assert.ok(right.y + 260 <= canvas.height - 12)
  const left = summaryPlacement({ ...anchor, x: 700 }, canvas, 260)
  assert.ok(left.x + left.width < 700)
  assert.equal(summaryPlacement({ ...anchor, x: -1200 }, canvas, 220).docked, true)
  const dock = summaryPlacement(anchor, { width: 360, height: 600 }, 220)
  assert.equal(dock.docked, true)
  assert.ok(dock.x >= 12 && dock.x + dock.width <= 348)
})
