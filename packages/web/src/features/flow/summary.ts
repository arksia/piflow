import type { CanvasRect } from './viewport'

/** A summary never sits over its anchor. Narrow canvases reserve a bottom dock. */
export function summaryPlacement(anchor: CanvasRect, canvas: { width: number, height: number }, height: number) {
  const width = Math.min(280, Math.max(0, canvas.width - 24))
  const gap = 16
  const right = anchor.x + anchor.width + gap
  const left = anchor.x - width - gap
  if (canvas.width >= 520 && ((right >= 12 && right + width <= canvas.width - 12) || (left >= 12 && left + width <= canvas.width - 12))) {
    return { x: right >= 12 && right + width <= canvas.width - 12 ? right : left, y: Math.max(12, Math.min(anchor.y, canvas.height - height - 12)), width, docked: false }
  }
  return { x: (canvas.width - width) / 2, y: Math.max(12, canvas.height - height - 52), width, docked: true }
}
