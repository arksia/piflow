import type { FlowMessageRecord } from '@piflow/protocol'

export function activeDeliveryEdges(messages: FlowMessageRecord[]): Map<string, { source: string, target: string }> {
  const active = new Map<string, { source: string, target: string }>()
  for (const message of messages) {
    if (message.status === 'queued' || message.status === 'delivered')
      active.set(message.edgeId, { source: message.source, target: message.target })
  }
  return active
}

export function sameDeliveryState(left: FlowMessageRecord[], right: FlowMessageRecord[]): boolean {
  if (left.length !== right.length)
    return false
  return left.every((message, index) => message.id === right[index]?.id && message.status === right[index]?.status)
}
