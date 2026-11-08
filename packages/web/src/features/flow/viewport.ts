export interface CanvasRect { x: number, y: number, width: number, height: number }
export interface CanvasViewport { x: number, y: number, zoom: number }

/** Focus keeps text readable; a full overview is an explicit, separate action. */
export function focusViewport(bounds: CanvasRect, size: { width: number, height: number }, minZoom = 0.85, maxZoom = 1.1): CanvasViewport {
  const zoom = Math.max(minZoom, Math.min(maxZoom, (size.width - 48) / Math.max(1, bounds.width), (size.height - 48) / Math.max(1, bounds.height)))
  return { x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }
}

/** Only pan enough to reveal the target after a panel or container resizes. */
export function revealViewport(bounds: CanvasRect, size: { width: number, height: number }, viewport: CanvasViewport): CanvasViewport {
  const left = bounds.x * viewport.zoom + viewport.x
  const top = bounds.y * viewport.zoom + viewport.y
  const width = bounds.width * viewport.zoom
  const height = bounds.height * viewport.zoom
  const adjust = (start: number, length: number, available: number) => length > available - 32
    ? available / 2 - start - length / 2
    : start < 16 ? 16 - start : Math.min(0, available - 16 - start - length)
  return { ...viewport, x: viewport.x + adjust(left, width, size.width), y: viewport.y + adjust(top, height, size.height) }
}
