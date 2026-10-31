import type { FlowMessageRecord, SubagentRun } from '@piflow/protocol'

export interface FlowEdgeActivity {
  messageId: string
  edgeId: string
  source: string
  target: string
  kind: 'request' | 'response' | 'error'
}

export function subagentEdgeId(run: Pick<SubagentRun, 'orchestratorId' | 'roleId'>): string {
  return `subagent:${JSON.stringify([run.orchestratorId, run.roleId])}`
}

export function changedRunActivities(previous: SubagentRun[], current: SubagentRun[]): FlowEdgeActivity[] {
  const before = new Map(previous.map(run => [run.id, run.status]))
  return current.flatMap((run) => {
    if (before.get(run.id) === run.status)
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
  runs: SubagentRun[],
  activities: FlowEdgeActivity[],
  nodes: { id: string, data: { agentId?: string, displayOwnerId?: string } }[],
): { id: string, source: string, target: string }[] {
  const edges = new Map<string, { id: string, source: string, target: string }>()
  for (const run of runs) {
    const id = subagentEdgeId(run)
    if (run.status !== 'running' && !activities.some(activity => activity.edgeId === id))
      continue
    const target = nodes.find(node => (node.data.agentId ?? node.id) === run.roleId && node.data.displayOwnerId === run.orchestratorId)
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
