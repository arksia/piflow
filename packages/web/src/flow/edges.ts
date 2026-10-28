import type { FlowMessageRecord } from '@piflow/protocol'

export interface FlowEdgeActivity {
  messageId: string
  edgeId: string
  source: string
  target: string
  kind: 'request' | 'response' | 'error'
}

export interface FlowRoutePoint {
  x: number
  y: number
}

export interface FlowRouteObstacle {
  x: number
  y: number
  width: number
  height: number
}

export function routeOrthogonalPoints(source: FlowRoutePoint, target: FlowRoutePoint, obstacles: FlowRouteObstacle[], clearance = 20): FlowRoutePoint[] {
  const expanded = obstacles.map(rect => ({
    left: rect.x - clearance,
    right: rect.x + rect.width + clearance,
    top: rect.y - clearance,
    bottom: rect.y + rect.height + clearance,
  }))
  const sourceToTarget = [source, { x: target.x, y: source.y }, target]
  const targetToSource = [source, { x: source.x, y: target.y }, target]
  const candidates: FlowRoutePoint[][] = [sourceToTarget, targetToSource]
  const xLanes = [...new Set([
    (source.x + target.x) / 2,
    ...expanded.flatMap(rect => [rect.left, rect.right]),
  ])].sort((a, b) => Math.abs(a - (source.x + target.x) / 2) - Math.abs(b - (source.x + target.x) / 2)).slice(0, 8)
  const yLanes = [...new Set([
    (source.y + target.y) / 2,
    ...expanded.flatMap(rect => [rect.top, rect.bottom]),
  ])].sort((a, b) => Math.abs(a - (source.y + target.y) / 2) - Math.abs(b - (source.y + target.y) / 2)).slice(0, 8)

  for (const x of xLanes)
    candidates.push([source, { x, y: source.y }, { x, y: target.y }, target])
  for (const y of yLanes)
    candidates.push([source, { x: source.x, y }, { x: target.x, y }, target])
  for (const y1 of yLanes) {
    for (const x of xLanes) {
      for (const y2 of yLanes)
        candidates.push([source, { x: source.x, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: target.x, y: y2 }, target])
    }
  }

  const viable = candidates.map(simplifyRoute).filter(points => routeIsClear(points, expanded))
  if (viable.length)
    return viable.sort((a, b) => routeCost(a) - routeCost(b))[0]!

  const xs = [...new Set([source.x, target.x, ...expanded.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b)
  const ys = [...new Set([source.y, target.y, ...expanded.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b)
  const start = ys.indexOf(source.y) * xs.length + xs.indexOf(source.x)
  const end = ys.indexOf(target.y) * xs.length + xs.indexOf(target.x)
  const pointAt = (id: number) => ({ x: xs[id % xs.length]!, y: ys[Math.floor(id / xs.length)]! })
  const distance = new Map([[start, 0]])
  const previous = new Map<number, number>()
  const open = new Set([start])
  const closed = new Set<number>()
  // Candidate lanes cover ordinary canvases; search the full grid only for crowded routes.
  while (open.size) {
    let current = start
    let best = Infinity
    for (const id of open) {
      const point = pointAt(id)
      const score = distance.get(id)! + Math.abs(target.x - point.x) + Math.abs(target.y - point.y)
      if (score < best) {
        current = id
        best = score
      }
    }
    if (current === end) {
      const route = [target]
      while (current !== start) {
        current = previous.get(current)!
        route.unshift(pointAt(current))
      }
      return simplifyRoute(route)
    }
    open.delete(current)
    closed.add(current)
    const column = current % xs.length
    const row = Math.floor(current / xs.length)
    const neighbors = [
      ...(column > 0 ? [current - 1] : []),
      ...(column < xs.length - 1 ? [current + 1] : []),
      ...(row > 0 ? [current - xs.length] : []),
      ...(row < ys.length - 1 ? [current + xs.length] : []),
    ]
    for (const next of neighbors) {
      if (closed.has(next))
        continue
      const from = pointAt(current)
      const to = pointAt(next)
      if (!routeIsClear([from, to], expanded))
        continue
      const cost = distance.get(current)! + Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
      if (cost >= (distance.get(next) ?? Infinity))
        continue
      distance.set(next, cost)
      previous.set(next, current)
      open.add(next)
    }
  }
  // Overlapping nodes can enclose an endpoint; retain its connection when no clear route exists.
  return simplifyRoute(sourceToTarget)
}

export function roundedOrthogonalPath(points: FlowRoutePoint[], radius = 10): string {
  if (points.length < 2)
    return ''
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const corner = points[index]!
    const next = points[index + 1]!
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    const offset = Math.min(radius, incoming / 2, outgoing / 2)
    const before = { x: corner.x + Math.sign(previous.x - corner.x) * offset, y: corner.y + Math.sign(previous.y - corner.y) * offset }
    const after = { x: corner.x + Math.sign(next.x - corner.x) * offset, y: corner.y + Math.sign(next.y - corner.y) * offset }
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`
  }
  const end = points.at(-1)!
  return `${path} L ${end.x} ${end.y}`
}

function simplifyRoute(points: FlowRoutePoint[]): FlowRoutePoint[] {
  const result: FlowRoutePoint[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (previous && previous.x === point.x && previous.y === point.y)
      continue
    const beforePrevious = result.at(-2)
    if (beforePrevious && previous && ((beforePrevious.x === previous.x && previous.x === point.x) || (beforePrevious.y === previous.y && previous.y === point.y)))
      result[result.length - 1] = point
    else
      result.push(point)
  }
  return result
}

function routeIsClear(points: FlowRoutePoint[], obstacles: Array<{ left: number, right: number, top: number, bottom: number }>) {
  return points.slice(1).every((point, index) => {
    const previous = points[index]!
    return obstacles.every((rect) => {
      if (previous.y === point.y)
        return !(previous.y > rect.top && previous.y < rect.bottom && Math.max(Math.min(previous.x, point.x), rect.left) < Math.min(Math.max(previous.x, point.x), rect.right))
      if (previous.x === point.x)
        return !(previous.x > rect.left && previous.x < rect.right && Math.max(Math.min(previous.y, point.y), rect.top) < Math.min(Math.max(previous.y, point.y), rect.bottom))
      return false
    })
  })
}

function routeCost(points: FlowRoutePoint[]) {
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += Math.abs(points[index]!.x - points[index - 1]!.x) + Math.abs(points[index]!.y - points[index - 1]!.y)
  }
  return length + Math.max(0, points.length - 2) * 24
}

export function changedDeliveryActivities(previous: FlowMessageRecord[], current: FlowMessageRecord[]): FlowEdgeActivity[] {
  const before = new Map(previous.map(message => [message.id, message.status]))
  const activities: FlowEdgeActivity[] = []
  for (const message of current) {
    const oldStatus = before.get(message.id)
    let kind: FlowEdgeActivity['kind'] | undefined
    if (oldStatus === undefined)
      kind = message.status === 'queued' || message.status === 'delivered' ? 'request' : message.status === 'replied' ? 'response' : 'error'
    else if (oldStatus !== message.status)
      kind = message.status === 'replied' ? 'response' : message.status === 'failed' ? 'error' : undefined
    if (kind)
      activities.push({ messageId: message.id, edgeId: message.edgeId, source: message.source, target: message.target, kind })
  }
  return activities
}

export function sameDeliveryState(left: FlowMessageRecord[], right: FlowMessageRecord[]): boolean {
  if (left.length !== right.length)
    return false
  return left.every((message, index) => message.id === right[index]?.id && message.status === right[index]?.status)
}
