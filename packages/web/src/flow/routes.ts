export interface FlowRoutePoint {
  x: number
  y: number
}

export interface FlowRouteNode extends FlowRoutePoint {
  id: string
  size: number
}

interface RouteEdge {
  id: string
  source: string
  target: string
}

type Turn = 'h' | 'v' | 'hv' | 'vh'

interface RoutePlan {
  edge: RouteEdge
  from: FlowRouteNode
  to: FlowRouteNode
  turn: Turn
  fromOffset: number
  toOffset: number
}

/**
 * Route free-layout nodes with short elbows and shared-side lanes.
 */
export function routeGraphEdges(edges: RouteEdge[], nodes: FlowRouteNode[], laneGap = 8): Map<string, FlowRoutePoint[]> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const groups = new Map<string, Array<{ plan: RoutePlan, end: 'from' | 'to', order: number }>>()
  const plans: RoutePlan[] = []
  function addLane(node: FlowRouteNode, side: string, plan: RoutePlan, end: 'from' | 'to', order: number) {
    const key = JSON.stringify([node.id, side])
    const lanes = groups.get(key) ?? []
    lanes.push({ plan, end, order })
    groups.set(key, lanes)
  }
  for (const edge of edges) {
    // All piflow nodes are peers; canonical order makes routing independent of message direction.
    const from = byId.get(edge.source < edge.target ? edge.source : edge.target)
    const to = byId.get(edge.source < edge.target ? edge.target : edge.source)
    if (!from || !to)
      continue
    let turn: Turn = 'hv'
    if (Math.abs(to.x - from.x) < 1)
      turn = 'v'
    else if (Math.abs(to.y - from.y) < 1)
      turn = 'h'
    else if (collisionCount(elbow(from, to, 'vh'), nodes, from.id, to.id) < collisionCount(elbow(from, to, 'hv'), nodes, from.id, to.id))
      turn = 'vh'
    const plan: RoutePlan = { edge, from, to, turn, fromOffset: 0, toOffset: 0 }
    plans.push(plan)
    const startVertical = turn === 'v' || turn === 'vh'
    const endVertical = turn === 'v' || turn === 'hv'
    const firstLength = Math.abs(startVertical ? to.y - from.y : to.x - from.x)
    const secondLength = Math.abs(startVertical ? to.x - from.x : to.y - from.y)
    const straight = turn === 'v' || turn === 'h'
    const startOrder = straight ? 0 : Math.sign(startVertical ? to.x - from.x : to.y - from.y)
    const endOrder = straight ? 0 : Math.sign(endVertical ? from.x - to.x : from.y - to.y)
    addLane(from, startVertical ? (to.y > from.y ? 'bottom' : 'top') : (to.x > from.x ? 'right' : 'left'), plan, 'from', startOrder * (100_000 - firstLength))
    addLane(to, endVertical ? (from.y > to.y ? 'bottom' : 'top') : (from.x > to.x ? 'right' : 'left'), plan, 'to', endOrder * (100_000 - secondLength))
  }
  for (const lanes of groups.values()) {
    if (lanes.length < 2)
      continue
    const first = lanes[0]!
    const size = first.end === 'from' ? first.plan.from.size : first.plan.to.size
    const gap = Math.min(laneGap, size * 0.6 / (lanes.length - 1))
    lanes.sort((a, b) => a.order - b.order)
    lanes.forEach((lane, index) => {
      const offset = (index - (lanes.length - 1) / 2) * gap
      if (lane.end === 'from')
        lane.plan.fromOffset = offset
      else
        lane.plan.toOffset = offset
    })
  }
  return new Map(plans.map(({ edge, from, to, turn, fromOffset, toOffset }) => {
    let points: FlowRoutePoint[]
    if (turn === 'v') {
      const x = from.x + (fromOffset || toOffset)
      points = [{ x, y: from.y }, { x, y: to.y }]
    }
    else if (turn === 'h') {
      const y = from.y + (fromOffset || toOffset)
      points = [{ x: from.x, y }, { x: to.x, y }]
    }
    else {
      const start = { x: from.x + (turn === 'vh' ? fromOffset : 0), y: from.y + (turn === 'hv' ? fromOffset : 0) }
      const end = { x: to.x + (turn === 'hv' ? toOffset : 0), y: to.y + (turn === 'vh' ? toOffset : 0) }
      points = elbow(start, end, turn)
    }
    return [edge.id, edge.source === from.id ? points : points.reverse()]
  }))
}

function elbow(from: FlowRoutePoint, to: FlowRoutePoint, turn: 'vh' | 'hv'): FlowRoutePoint[] {
  return [from, turn === 'vh' ? { x: from.x, y: to.y } : { x: to.x, y: from.y }, to]
}

function collisionCount(points: FlowRoutePoint[], nodes: FlowRouteNode[], fromId: string, toId: string) {
  let count = 0
  for (const node of nodes) {
    if (node.id === fromId || node.id === toId)
      continue
    const padding = node.size / 2 + 6
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!
      const to = points[index]!
      if (Math.min(from.x, to.x) - padding < node.x && node.x < Math.max(from.x, to.x) + padding && Math.min(from.y, to.y) - padding < node.y && node.y < Math.max(from.y, to.y) + padding)
        count++
    }
  }
  return count
}

export function roundedOrthogonalPath(points: FlowRoutePoint[], radius = 8): string {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || points.length < 2)
    return ''
  const round = (value: number) => Math.round(value * 10) / 10
  const position = (point: FlowRoutePoint) => `${round(point.x)} ${round(point.y)}`
  if (points.length === 2 || Math.abs(last.x - first.x) < 1 || Math.abs(last.y - first.y) < 1)
    return `M${position(first)}L${position(last)}`
  const corner = points[1]!
  const offset = Math.min(radius, Math.abs(last.x - first.x), Math.abs(last.y - first.y))
  if (offset < 0.5)
    return `M${position(first)}L${position(last)}`
  const before = { x: corner.x + Math.sign(first.x - corner.x) * offset, y: corner.y + Math.sign(first.y - corner.y) * offset }
  const after = { x: corner.x + Math.sign(last.x - corner.x) * offset, y: corner.y + Math.sign(last.y - corner.y) * offset }
  return `M${position(first)}L${position(before)}Q${position(corner)} ${position(after)}L${position(last)}`
}
