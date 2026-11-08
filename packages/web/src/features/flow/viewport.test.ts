import assert from 'node:assert/strict'
import { it } from 'node:test'
import { focusViewport, revealViewport } from './viewport'

it('focuses readable nodes inside the actual remaining canvas', () => {
  const bounds = { x: 1100, y: 50, width: 172, height: 150 }
  const size = { width: 576, height: 672 }
  const view = focusViewport(bounds, size)
  assert.ok(view.zoom >= 0.85)
  assert.equal((bounds.x + bounds.width / 2) * view.zoom + view.x, size.width / 2)
  const revealed = revealViewport(bounds, { width: 320, height: 672 }, view)
  assert.equal(revealed.zoom, view.zoom)
  assert.ok(bounds.x * revealed.zoom + revealed.x >= 16)
  assert.ok((bounds.x + bounds.width) * revealed.zoom + revealed.x <= 304)
  assert.deepEqual(revealViewport(bounds, size, view), view)
})

it('does not shrink text to fit far away neighbors and handles tiny containers', () => {
  assert.equal(focusViewport({ x: 0, y: 0, width: 4000, height: 1000 }, { width: 600, height: 500 }).zoom, 0.85)
  const view = revealViewport({ x: 0, y: 0, width: 172, height: 150 }, { width: 100, height: 80 }, { x: 0, y: 0, zoom: 1 })
  assert.equal(view.x + 86, 50)
  assert.equal(view.y + 75, 40)
})
