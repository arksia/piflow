import type { CanvasRect } from './viewport'

export const NODE_WIDTH = 164
export const NODE_HEIGHT = 154
export const NODE_PADDING = 10
export function iconSize(node: { kind?: string, orchestrationEnabled?: boolean }) {
  return node.orchestrationEnabled ? 52 : node.kind === 'subagent-role' ? 40 : 46
}
export interface NodeGeometry {
  id: string
  x: number
  y: number
  size: number
  bounds: CanvasRect
}
export function nodeGeometry(node: { id: string, position: { x: number, y: number }, measured?: { width?: number, height?: number }, data: { kind?: string, orchestrationEnabled?: boolean } }): NodeGeometry {
  const size = iconSize(node.data)
  const width = node.measured?.width ?? NODE_WIDTH
  return { id: node.id, x: node.position.x + width / 2, y: node.position.y + NODE_PADDING + size / 2, size, bounds: { ...node.position, width, height: node.measured?.height ?? NODE_HEIGHT } }
}
