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

/** Finite relaxation of an undirected component. No leader, depth or ongoing animation. */
function relaxGroup(nodes: LayoutNode[], links: readonly { source: string, target: string }[]) {
  const gap = 36
  const ideal = Math.max(200, ...nodes.map(node => Math.max(nodeRect(node).width, nodeRect(node).height) + gap))
  const radius = nodes.length > 1 ? ideal * Math.sqrt(nodes.length) / 2 : 0
  const points = nodes.map((node, i) => {
    const angle = 0.37 + i * Math.PI * 2 / nodes.length
    return { node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, dx: 0, dy: 0 }
  })
  const byId = new Map(points.map(point => [point.node.id, point]))
  const edges = links.filter(link => byId.has(link.source) && byId.has(link.target) && link.source !== link.target)
  // ponytail: bounded O(iterations × nodes²) for project-sized graphs; never run on status updates.
  for (let step = 0; step < 180; step++) {
    for (const point of points) {
      point.dx = -point.x * 0.55
      point.dy = -point.y * 0.55
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      for (const b of points.slice(i + 1)) {
        const x = a.x - b.x
        const y = a.y - b.y
        const distance = Math.max(1, Math.hypot(x, y))
        const force = ideal * ideal / distance
        a.dx += x / distance * force
        a.dy += y / distance * force
        b.dx -= x / distance * force
        b.dy -= y / distance * force
      }
    }
    for (const link of edges) {
      const a = byId.get(link.source)!
      const b = byId.get(link.target)!
      const x = a.x - b.x
      const y = a.y - b.y
      const distance = Math.max(1, Math.hypot(x, y))
      const force = distance * distance / ideal
      a.dx -= x / distance * force
      a.dy -= y / distance * force
      b.dx += x / distance * force
      b.dy += y / distance * force
    }
    const temperature = ideal * 0.16 * (1 - step / 180) ** 2 + 0.2
    for (const point of points) {
      const magnitude = Math.max(1, Math.hypot(point.dx, point.dy))
      point.x += point.dx / magnitude * Math.min(magnitude, temperature)
      point.y += point.dy / magnitude * Math.min(magnitude, temperature)
    }
  }
  // Final full-rectangle projection guarantees labels stay apart, including unusually tall cards.
  const occupied: CanvasRect[] = []
  return points.map((point) => {
    const rect = nodeRect(point.node)
    const origin = { x: point.x - rect.width / 2, y: point.y - rect.height / 2 }
    let position = origin
    for (let ring = 1; occupied.some(other => overlaps({ ...rect, ...position }, other, gap)); ring++) {
      // Search expanding square rings around the relaxed point; a free position always exists.
      const count = ring * 8
      for (let slot = 0; slot < count; slot++) {
        const side = Math.floor(slot / (ring * 2))
        const offset = slot % (ring * 2) - ring
        const x = side === 0 ? -ring : side === 2 ? ring : side === 1 ? offset : -offset
        const y = side === 1 ? -ring : side === 3 ? ring : side === 2 ? offset : -offset
        position = { x: origin.x + x * 24, y: origin.y + y * 24 }
        if (!occupied.some(other => overlaps({ ...rect, ...position }, other, gap)))
          break
      }
    }
    const placed = { ...rect, ...position }
    occupied.push(placed)
    return { id: point.node.id, ...placed }
  })
}

/** Only authored relations contribute to a deterministic two-dimensional graph layout. */
export function arrangeNodes(nodes: readonly LayoutNode[], links: readonly { source: string, target: string }[]): Map<string, FlowPosition> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]))
  for (const { source, target } of links) {
    if (source === target || !byId.has(source) || !byId.has(target))
      continue
    neighbors.get(source)!.add(target)
    neighbors.get(target)!.add(source)
  }
  const stableLinks = [...neighbors].flatMap(([source, targets]) => [...targets].filter(target => source < target).map(target => ({ source, target }))).sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
  const remaining = new Set([...byId.keys()].sort())
  const groups: LayoutNode[][] = []
  while (remaining.size) {
    const queue = [remaining.values().next().value!]
    remaining.delete(queue[0]!)
    for (let i = 0; i < queue.length; i++) {
      for (const other of [...neighbors.get(queue[i]!)!].sort()) {
        if (remaining.delete(other))
          queue.push(other)
      }
    }
    groups.push(queue.sort().map(id => byId.get(id)!))
  }
  groups.sort((a, b) => b.length - a.length || a[0]!.id.localeCompare(b[0]!.id))
  const output = new Map<string, FlowPosition>()
  const packed: CanvasRect[] = []
  for (const group of groups) {
    const arranged = relaxGroup(group, stableLinks)
    const left = Math.min(...arranged.map(node => node.x))
    const top = Math.min(...arranged.map(node => node.y))
    const width = Math.max(...arranged.map(node => node.x + node.width)) - left
    const height = Math.max(...arranged.map(node => node.y + node.height)) - top
    const xs = [32, ...packed.map(rect => rect.x + rect.width + 64)]
    const ys = [32, ...packed.map(rect => rect.y + rect.height + 64)]
    let placement = { x: 32, y: 32, width, height }
    let best = Infinity
    for (const x of xs) {
      for (const y of ys) {
        const candidate = { x, y, width, height }
        if (packed.some(other => overlaps(candidate, other, 64)))
          continue
        const w = Math.max(x + width, ...packed.map(rect => rect.x + rect.width))
        const h = Math.max(y + height, ...packed.map(rect => rect.y + rect.height))
        const score = w * h * (1 + Math.abs(Math.log(w / h / 1.5)) * 0.35)
        if (score < best) {
          best = score
          placement = candidate
        }
      }
    }
    packed.push(placement)
    for (const node of arranged)
      output.set(node.id, { x: placement.x + node.x - left, y: placement.y + node.y - top })
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
