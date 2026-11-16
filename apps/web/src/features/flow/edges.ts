import type { FlowMessageRecord, RunSummary } from '@piflow/protocol'

export interface FlowEdgeActivity {
  messageId: string
  edgeId: string
  source: string
  target: string
  kind: 'request' | 'response' | 'error'
  count?: number
  observedAt?: number
}

export function subagentEdgeId(run: Pick<RunSummary, 'orchestratorId' | 'roleId' | 'purpose'>): string {
  return `subagent:${JSON.stringify([run.orchestratorId, run.roleId, ...(run.purpose === 'review-analysis' ? [run.purpose] : [])])}`
}

export function changedRunActivities(previous: RunSummary[], current: RunSummary[]): FlowEdgeActivity[] {
  const before = new Map(previous.map(run => [run.id, run.status]))
  return current.flatMap((run) => {
    if (before.get(run.id) === run.status || (!before.has(run.id) && run.status !== 'running'))
      return []
    return [{
      messageId: run.id,
      edgeId: subagentEdgeId(run),
      source: run.orchestratorId,
      target: run.roleId,
      kind: run.status === 'running' ? 'request' as const : run.status === 'succeeded' ? 'response' as const : 'error' as const,
    }]
  })
}

/** Display-only calls; shared roles resolve to the reference beside the calling main Agent. */
export function subagentCallEdges(
  runs: RunSummary[],
  activities: FlowEdgeActivity[],
  nodes: { id: string, data: { agentId?: string, displayOwnerId?: string, runPurpose?: RunSummary['purpose'] } }[],
): { id: string, source: string, target: string }[] {
  const edges = new Map<string, { id: string, source: string, target: string }>()
  for (const run of runs) {
    const id = subagentEdgeId(run)
    if (run.status !== 'running' && !activities.some(activity => activity.edgeId === id))
      continue
    const target = nodes.find(node => (node.data.agentId ?? node.id) === run.roleId && node.data.displayOwnerId === run.orchestratorId && (node.data.runPurpose ?? 'task') === (run.purpose ?? 'task'))
      ?? nodes.find(node => node.id === run.roleId)
    if (target && nodes.some(node => node.id === run.orchestratorId))
      edges.set(id, { id, source: run.orchestratorId, target: target.id })
  }
  return [...edges.values()]
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

/** One bounded pulse per edge/direction, aggregating arrivals for 500ms. */
export function aggregateActivities(previous: FlowEdgeActivity[], incoming: FlowEdgeActivity[], now: number): FlowEdgeActivity[] {
  const result = previous.filter(item => now - (item.observedAt ?? 0) < 1200)
  for (const item of incoming) {
    const index = result.findIndex(other => other.edgeId === item.edgeId && other.source === item.source && other.kind === item.kind)
    const old = result[index]
    const next = old && now - (old.observedAt ?? 0) < 500
      ? { ...old, count: (old.count ?? 1) + (item.count ?? 1) }
      : { ...item, count: item.count ?? 1, observedAt: now }
    if (index < 0)
      result.push(next)
    else result[index] = next
  }
  return result
}
