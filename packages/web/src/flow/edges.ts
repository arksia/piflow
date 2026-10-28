import type { FlowMessageRecord } from '@piflow/protocol'

export interface FlowEdgeActivity {
  messageId: string
  edgeId: string
  source: string
  target: string
  kind: 'request' | 'response' | 'error'
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
