import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeGeometry } from './geometry'
import { summaryPlacement } from './summary'

const viewport = { x: 0, y: 0, zoom: 1 }

test('centers the measured summary beside the icon rather than the full node label', () => {
  const node = { id: 'a', position: { x: 598.4553, y: 343.5019 }, data: {} }
  const icon = nodeGeometry(node)
  const viewport = { x: -197.045, y: 61.225, zoom: 1.1 }
  const placement = summaryPlacement(icon, viewport, { width: 734, height: 805 }, 265)
  assert.equal(placement.docked, false)
  assert.ok(Math.abs(placement.y + 265 / 2 - (icon.y * viewport.zoom + viewport.y)) < 1e-9)
  assert.ok(Math.abs(icon.x * viewport.zoom + viewport.x - icon.size * viewport.zoom / 2 - (placement.x + placement.width) - 18) < 1e-9)
  const tallerLabel = nodeGeometry({ ...node, measured: { width: 164, height: 320 } })
  assert.deepEqual(summaryPlacement(tallerLabel, viewport, { width: 734, height: 805 }, 265), placement)
})

test('prefers the side toward the canvas center', () => {
  const canvas = { width: 1000, height: 700 }
  const left = { x: 350, y: 350, size: 46 }
  const right = { ...left, x: 650 }
  assert.equal(summaryPlacement(left, viewport, canvas, 240).x, 391)
  assert.equal(summaryPlacement(right, viewport, canvas, 240).x, 329)
})

test('projects pan and zoom once while keeping the card size and screen gap fixed', () => {
  const canvas = { width: 1200, height: 800 }
  const icon = { x: 300, y: 150, size: 46 }
  for (const zoom of [0.2, 0.5, 1, 2]) {
    const viewport = { x: 90, y: 200, zoom }
    const placement = summaryPlacement(icon, viewport, canvas, 200)
    const center = icon.x * zoom + viewport.x
    assert.equal(placement.width, 280)
    assert.equal(placement.y + 100, icon.y * zoom + viewport.y)
    const gap = center < canvas.width / 2
      ? placement.x - center - icon.size * zoom / 2
      : center - icon.size * zoom / 2 - placement.x - placement.width
    assert.ok(Math.abs(gap - 18) < 1e-9)
  }
})

test('clamps at vertical edges and recenters when measured content height changes', () => {
  const canvas = { width: 1000, height: 600 }
  assert.equal(summaryPlacement({ x: 300, y: 10, size: 46 }, viewport, canvas, 260).y, 12)
  assert.equal(summaryPlacement({ x: 300, y: 590, size: 46 }, viewport, canvas, 260).y, 328)
  const icon = { x: 300, y: 300, size: 46 }
  assert.equal(summaryPlacement(icon, viewport, canvas, 200).y, 200)
  assert.equal(summaryPlacement(icon, viewport, canvas, 300).y, 150)
})

test('docks in narrow canvases, when neither side fits, and for offscreen icons', () => {
  const icon = { x: 300, y: 300, size: 46 }
  for (const canvas of [{ width: 360, height: 600 }, { width: 520, height: 600 }]) {
    const dock = summaryPlacement(icon, viewport, canvas, 220)
    assert.equal(dock.docked, true)
    assert.ok(dock.x >= 12 && dock.x + dock.width <= canvas.width - 12)
  }
  assert.equal(summaryPlacement({ ...icon, x: -1200 }, viewport, { width: 900, height: 600 }, 220).docked, true)
})
