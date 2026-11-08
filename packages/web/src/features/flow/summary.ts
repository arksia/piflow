import type { NodeGeometry } from './geometry'
import type { CanvasViewport } from './viewport'

/** Project the icon once; center the unscaled card beside it, or reserve a bottom dock. */
export function summaryPlacement(icon: Pick<NodeGeometry, 'x' | 'y' | 'size'>, viewport: CanvasViewport, canvas: { width: number, height: number }, height: number) {
  const width = Math.min(280, Math.max(0, canvas.width - 24))
  const x = icon.x * viewport.zoom + viewport.x
  const y = icon.y * viewport.zoom + viewport.y
  const offset = icon.size * viewport.zoom / 2 + 18
  const right = x + offset
  const left = x - offset - width
  const candidates = x < canvas.width / 2 ? [right, left] : [left, right]
  const side = candidates.find(candidate => candidate >= 12 && candidate + width <= canvas.width - 12)
  if (canvas.width >= 520 && side !== undefined) {
    return { x: side, y: Math.max(12, Math.min(y - height / 2, canvas.height - height - 12)), width, docked: false }
  }
  return { x: (canvas.width - width) / 2, y: Math.max(12, canvas.height - height - 52), width, docked: true }
}
