import type { CanvasRect } from './viewport'

export interface FlowRoutePoint { x: number, y: number }
export interface FlowRouteNode extends FlowRoutePoint { id: string, size: number, bounds?: CanvasRect }
interface RouteEdge { id: string, source: string, target: string }

function obstacle(node: FlowRouteNode): CanvasRect {
  const rect = node.bounds ?? { x: node.x - node.size / 2, y: node.y - node.size / 2, width: node.size, height: node.size }
  return { x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 }
}
function clear(a: FlowRoutePoint, b: FlowRoutePoint, blocks: CanvasRect[]) {
  return !blocks.some(rect => a.x === b.x
    ? a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
    : a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width)
}
function simplify(points: FlowRoutePoint[]): FlowRoutePoint[] {
  const output: FlowRoutePoint[] = []
  for (const point of points) {
    const last = output.at(-1)
    if (last?.x === point.x && last.y === point.y)
      continue
    const before = output.at(-2)
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y)))
      output.pop()
    output.push(point)
  }
  return output
}

/** Search finite obstacle-side channels. Edge crossings are allowed; label crossings are avoided. */
function channelPath(start: FlowRoutePoint, end: FlowRoutePoint, blocks: CanvasRect[]): FlowRoutePoint[] {
  const direct = [start, { x: end.x, y: start.y }, end]
  if (direct.slice(1).every((point, i) => clear(direct[i]!, point, blocks)))
    return simplify(direct)
  const xs = [...new Set([start.x, end.x, ...blocks.flatMap(rect => [rect.x, rect.x + rect.width])])].sort((a, b) => a - b)
  const ys = [...new Set([start.y, end.y, ...blocks.flatMap(rect => [rect.y, rect.y + rect.height])])].sort((a, b) => a - b)
  const index = (x: number, y: number) => y * xs.length + x
  const point = (id: number) => ({ x: xs[id % xs.length]!, y: ys[Math.floor(id / xs.length)]! })
  const first = index(xs.indexOf(start.x), ys.indexOf(start.y))
  const target = index(xs.indexOf(end.x), ys.indexOf(end.y))
  const costs = new Map([[first, 0]])
  const parents = new Map<number, number>()
  const open = new Set([first])
  const closed = new Set<number>()
  while (open.size) {
    let best = -1
    let score = Infinity
    for (const id of open) {
      const p = point(id)
      const candidate = costs.get(id)! + Math.abs(p.x - end.x) + Math.abs(p.y - end.y)
      if (candidate < score) {
        best = id
        score = candidate
      }
    }
    if (best === target) {
      const result = [end]
      for (let id = target; parents.has(id);) {
        id = parents.get(id)!
        result.unshift(point(id))
      }
      return simplify(result)
    }
    open.delete(best)
    closed.add(best)
    const x = best % xs.length
    const y = Math.floor(best / xs.length)
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= xs.length || ny! >= ys.length)
        continue
      const next = index(nx!, ny!)
      if (closed.has(next) || !clear(point(best), point(next), blocks))
        continue
      const p = point(best)
      const q = point(next)
      const cost = costs.get(best)! + Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost)
        parents.set(next, best)
        open.add(next)
      }
    }
  }
  // ponytail: overlapping authored rectangles can enclose ports; preserve topology and mask labels.
  return simplify(direct)
}

export function routeGraphEdges(edges: RouteEdge[], nodes: FlowRouteNode[], laneGap = 8): Map<string, FlowRoutePoint[]> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const blocks = nodes.map(obstacle)
  const slots = new Map<string, string[]>()
  const plans = edges.flatMap((edge) => {
    const from = byId.get(edge.source < edge.target ? edge.source : edge.target)
    const to = byId.get(edge.source < edge.target ? edge.target : edge.source)
    if (!from || !to || from.id === to.id)
      return []
    const fromSide = to.x >= from.x ? 1 : -1
    const toSide = from.x >= to.x ? 1 : -1
    for (const [node, side] of [[from, fromSide], [to, toSide]] as const) {
      const key = `${node.id}:${side}`
      slots.set(key, [...slots.get(key) ?? [], edge.id].sort())
    }
    return [{ edge, from, to, fromSide, toSide }]
  })
  return new Map(plans.map(({ edge, from, to, fromSide, toSide }) => {
    const port = (node: FlowRouteNode, side: number) => {
      const group = slots.get(`${node.id}:${side}`)!
      const offset = (group.indexOf(edge.id) - (group.length - 1) / 2) * Math.min(laneGap, node.size * 0.5 / Math.max(1, group.length - 1))
      const rect = obstacle(node)
      const p = { x: node.x + side * node.size / 2, y: node.y + offset }
      return [p, { x: side > 0 ? rect.x + rect.width : rect.x, y: p.y }]
    }
    const [a, start] = port(from, fromSide) as [FlowRoutePoint, FlowRoutePoint]
    const [b, end] = port(to, toSide) as [FlowRoutePoint, FlowRoutePoint]
    const path = simplify([a, ...channelPath(start, end, blocks), b])
    return [edge.id, edge.source === from.id ? path : path.reverse()]
  }))
}

export function roundedOrthogonalPath(points: FlowRoutePoint[], radius = 8): string {
  const first = points[0]
  if (!first || points.length < 2)
    return ''
  const position = (point: FlowRoutePoint) => `${Math.round(point.x * 10) / 10} ${Math.round(point.y * 10) / 10}`
  let path = `M${position(first)}`
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!
    const corner = points[i]!
    const after = points[i + 1]!
    const distance = Math.min(radius, Math.hypot(corner.x - before.x, corner.y - before.y) / 2, Math.hypot(after.x - corner.x, after.y - corner.y) / 2)
    const p = { x: corner.x + Math.sign(before.x - corner.x) * distance, y: corner.y + Math.sign(before.y - corner.y) * distance }
    const q = { x: corner.x + Math.sign(after.x - corner.x) * distance, y: corner.y + Math.sign(after.y - corner.y) * distance }
    path += `L${position(p)}Q${position(corner)} ${position(q)}`
  }
  return `${path}L${position(points.at(-1)!)}`
}
