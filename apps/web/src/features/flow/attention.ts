import type { FlowActivityKind, FlowNode, SessionStatusRecord } from '@piflow/protocol'

export interface FlowAttentionItem {
  nodeId: string
  name: string
  sessionPath: string
  reason: 'needs_input' | 'failed'
  updatedAt: string
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

export const activityLabels: Record<FlowActivityKind, string> = {
  'running': '运行中',
  'latest-failure': '最新执行异常',
  'cancelled': '最近取消',
  'pending-review': '待审交付',
  'changes-requested': '需修改',
  'in-progress-review': '进行中交付',
  'unavailable-review': '执行证据不可用',
  'evidence-gap': '证据不完整',
}
