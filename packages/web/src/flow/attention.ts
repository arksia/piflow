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

export type SessionAttentionKind = 'needs_input' | 'failed' | 'running' | 'unread'

export function sessionAttention(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
  unread?: ReadonlySet<string>,
): { kind: SessionAttentionKind, label: string } | null {
  const status = statuses[sessionPath]
  if (status?.needsInputAt)
    return { kind: 'needs_input', label: '待回答' }
  if (status?.status === 'failed')
    return { kind: 'failed', label: '失败' }
  if (status?.status === 'running')
    return { kind: 'running', label: '运行中' }
  if (unread?.has(sessionPath))
    return { kind: 'unread', label: '已完成' }
  return null
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
