import type { FlowNode, SessionStatus, SessionStatusRecord } from '@piflow/protocol'

export interface FlowAttentionItem {
  nodeId: string
  name: string
  sessionPath: string
  reason: 'needs_input' | 'failed'
  updatedAt: string
}

export function sessionStatusFor(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
): SessionStatus {
  return statuses[sessionPath]?.status ?? 'idle'
}

export function sessionNeedsInputFor(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
): boolean {
  return Boolean(statuses[sessionPath]?.needsInputAt)
}

export function flowAttentionItems(
  nodes: FlowNode[],
  statuses: Record<string, SessionStatusRecord>,
): FlowAttentionItem[] {
  return nodes
    .flatMap<FlowAttentionItem>((node) => {
      const status = statuses[node.sessionPath]
      if (status?.needsInputAt) {
        return [{
          nodeId: node.id,
          name: node.name,
          sessionPath: node.sessionPath,
          reason: 'needs_input',
          updatedAt: status.needsInputAt,
        }]
      }
      return status?.status === 'failed'
        ? [{ nodeId: node.id, name: node.name, sessionPath: node.sessionPath, reason: 'failed', updatedAt: status.updatedAt }]
        : []
    })
    .sort((a, b) => {
      const priority = Number(a.reason === 'failed') - Number(b.reason === 'failed')
      return priority || a.updatedAt.localeCompare(b.updatedAt)
    })
}
