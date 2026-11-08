import type { FlowDocument, FlowPosition } from '@piflow/protocol'
import type { CanvasRect } from './viewport'
import { NODE_HEIGHT, NODE_WIDTH } from './geometry'

export interface LayoutNode { id: string, position: FlowPosition, orchestrationEnabled?: boolean, measured?: { width?: number, height?: number } }
export function overlaps(a: CanvasRect, b: CanvasRect, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}
export function nodeRect(node: LayoutNode): CanvasRect {
  return { ...node.position, width: node.measured?.width ?? NODE_WIDTH, height: node.measured?.height ?? NODE_HEIGHT }
}

/** Authored relations only. Deterministic BFS columns, with disconnected groups packed in rows. */
export function arrangeNodes(nodes: readonly LayoutNode[], links: readonly { source: string, target: string }[]): Map<string, FlowPosition> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]))
  for (const { source, target } of links) {
    if (source === target || !byId.has(source) || !byId.has(target))
      continue
    neighbors.get(source)!.add(target)
    neighbors.get(target)!.add(source)
  }
  const sorted = [...nodes].sort((a, b) => Number(!!b.orchestrationEnabled) - Number(!!a.orchestrationEnabled) || neighbors.get(b.id)!.size - neighbors.get(a.id)!.size || a.id.localeCompare(b.id))
  const remaining = new Set(sorted.map(node => node.id))
  const output = new Map<string, FlowPosition>()
  let packX = 32
  let packY = 32
  let rowHeight = 0
  // ponytail: a deterministic shelf pack for project-sized graphs; no continuously moving force layout.
  for (const root of sorted) {
    if (!remaining.has(root.id))
      continue
    const levels: LayoutNode[][] = []
    const queue = [{ id: root.id, depth: 0 }]
    remaining.delete(root.id)
    for (let i = 0; i < queue.length; i++) {
      const { id, depth } = queue[i]!
      ;(levels[depth] ??= []).push(byId.get(id)!)
      for (const other of [...neighbors.get(id)!].sort()) {
        if (remaining.delete(other))
          queue.push({ id: other, depth: depth + 1 })
      }
    }
    const widths = levels.map(level => Math.max(...level.map(node => nodeRect(node).width)))
    const heights = levels.map(level => level.reduce((sum, node) => sum + nodeRect(node).height + 32, -32))
    const width = widths.reduce((sum, value) => sum + value + 72, -72)
    const height = Math.max(...heights)
    if (packX > 32 && packX + width > 1000) {
      packX = 32
      packY += rowHeight + 64
      rowHeight = 0
    }
    let x = packX
    levels.forEach((level, index) => {
      let y = packY + (height - heights[index]!) / 2
      for (const node of level) {
        output.set(node.id, { x, y })
        y += nodeRect(node).height + 32
      }
      x += widths[index]! + 72
    })
    packX += width + 80
    rowHeight = Math.max(rowHeight, height)
  }
  return output
}

/** Configuration/runtime updates do not invalidate undo; authored edits do. */
export function layoutFingerprint(document: Pick<FlowDocument, 'nodes' | 'edges' | 'memberships'>) {
  return JSON.stringify([
    document.nodes.map(node => [node.id, node.position.x, node.position.y]).sort(),
    document.edges.map(edge => [edge.id, edge.source, edge.target]).sort(),
    (document.memberships ?? []).map(item => [item.orchestratorId, item.memberId]).sort(),
  ])
}
