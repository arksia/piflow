import type { CanvasRect } from './viewport'
import { NODE_LABEL_GAP } from './geometry'

export interface FlowRoutePoint { x: number, y: number }
export interface FlowRouteNode extends FlowRoutePoint { id: string, size: number, bounds?: CanvasRect }
interface RouteEdge { id: string, source: string, target: string }
type Side = 'left' | 'right' | 'top' | 'bottom'
interface Port { side: Side, points: FlowRoutePoint[] }

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
    if (before && last && ((before.x === last.x && last.x === point.x && (last.y - before.y) * (point.y - last.y) >= 0) || (before.y === last.y && last.y === point.y && (last.x - before.x) * (point.x - last.x) >= 0)))
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

function ports(node: FlowRouteNode, offset = 0): Port[] {
  const rect = obstacle(node)
  const half = node.size / 2
  const bottom = { x: node.x + offset, y: node.y + half }
  const base: Port[] = [
    { side: 'left', points: [{ x: node.x - half, y: node.y + offset }, { x: rect.x, y: node.y + offset }] },
    { side: 'right', points: [{ x: node.x + half, y: node.y + offset }, { x: rect.x + rect.width, y: node.y + offset }] },
    { side: 'top', points: [{ x: node.x + offset, y: node.y - half }, { x: node.x + offset, y: rect.y }] },
  ]
  if (!node.bounds || node.bounds.y + node.bounds.height <= bottom.y + NODE_LABEL_GAP) {
    base.push({ side: 'bottom', points: [bottom, { x: bottom.x, y: rect.y + rect.height }] })
  }
  else {
    // Leave the icon vertically, then use the real gap above its label to escape either side.
    const elbow = { x: bottom.x, y: bottom.y + NODE_LABEL_GAP / 2 }
    for (const x of [rect.x, rect.x + rect.width])
      base.push({ side: 'bottom', points: [bottom, elbow, { x, y: elbow.y }] })
  }
  return base
}

function simplePaths(start: FlowRoutePoint, end: FlowRoutePoint): FlowRoutePoint[][] {
  const x = (start.x + end.x) / 2
  const y = (start.y + end.y) / 2
  return [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x, y: start.y }, { x, y: end.y }, end],
    [start, { x: start.x, y }, { x: end.x, y }, end],
  ]
}

function pathCost(points: FlowRoutePoint[]) {
  return points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i]!.x) + Math.abs(point.y - points[i]!.y), 0) + Math.max(0, points.length - 2) * 16
}

function facingCost(node: FlowRouteNode, other: FlowRouteNode, side: Side) {
  const dx = other.x - node.x
  const dy = other.y - node.y
  const toward = side === 'left' ? -dx : side === 'right' ? dx : side === 'top' ? -dy : dy
  return 64 * (1 - toward / (Math.hypot(dx, dy) || 1))
}

function chooseRoute(from: FlowRouteNode, to: FlowRouteNode, fromPorts: Port[], toPorts: Port[], nodes: FlowRouteNode[]) {
  const blocks = nodes.map(obstacle)
  const foreignFrom = nodes.filter(node => node.id !== from.id).map(obstacle)
  const foreignTo = nodes.filter(node => node.id !== to.id).map(obstacle)
  const clearPath = (points: FlowRoutePoint[], obstacles: CanvasRect[]) => points.slice(1).every((point, i) => clear(points[i]!, point, obstacles))
  const candidates = fromPorts.flatMap(a => toPorts.flatMap((b) => {
    const start = a.points.at(-1)!
    const end = b.points.at(-1)!
    const exitsClear = clearPath(a.points, foreignFrom) && clearPath(b.points, foreignTo)
    const facing = facingCost(from, to, a.side) + facingCost(to, from, b.side)
    return simplePaths(start, end).map((middle) => {
      const path = simplify([...a.points, ...middle, ...b.points.slice().reverse()])
      return { a, b, path, clear: exitsClear && clearPath(middle, blocks), exitsClear, cost: pathCost(path) + facing }
    })
  })).sort((a, b) => a.cost - b.cost)
  const simple = candidates.find(candidate => candidate.clear)
  if (simple)
    return simple
  // ponytail: search once per blocked edge, not once for each of the 25 port pairs.
  const best = candidates.find(candidate => candidate.exitsClear) ?? candidates[0]!
  const middle = channelPath(best.a.points.at(-1)!, best.b.points.at(-1)!, blocks)
  return { ...best, path: simplify([...best.a.points, ...middle, ...best.b.points.slice().reverse()]) }
}

export function routeGraphEdges(edges: RouteEdge[], nodes: FlowRouteNode[], laneGap = 8): Map<string, FlowRoutePoint[]> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const slots = new Map<string, { id: string, order: number }[]>()
  const plans = edges.slice().sort((a, b) => a.id.localeCompare(b.id)).flatMap((edge) => {
    const from = byId.get(edge.source < edge.target ? edge.source : edge.target)
    const to = byId.get(edge.source < edge.target ? edge.target : edge.source)
    if (!from || !to || from.id === to.id)
      return []
    const route = chooseRoute(from, to, ports(from), ports(to), nodes)
    for (const [node, other, side] of [[from, to, route.a.side], [to, from, route.b.side]] as const) {
      const key = `${node.id}:${side}`
      const order = side === 'left' || side === 'right' ? other.y : other.x
      slots.set(key, [...slots.get(key) ?? [], { id: edge.id, order }].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)))
    }
    return [{ edge, from, to, route, fromSide: route.a.side, toSide: route.b.side }]
  })
  return new Map(plans.map(({ edge, from, to, route, fromSide, toSide }) => {
    const port = (node: FlowRouteNode, side: Side) => {
      const group = slots.get(`${node.id}:${side}`)!
      const offset = (group.findIndex(item => item.id === edge.id) - (group.length - 1) / 2) * Math.min(laneGap, node.size * 0.5 / Math.max(1, group.length - 1))
      return ports(node, offset).filter(port => port.side === side)
    }
    const { path } = slots.get(`${from.id}:${fromSide}`)!.length === 1 && slots.get(`${to.id}:${toSide}`)!.length === 1
      ? route
      : chooseRoute(from, to, port(from, fromSide), port(to, toSide), nodes)
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
