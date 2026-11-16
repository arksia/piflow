import type { FlowMembership, FlowPosition, RunSummary } from '@piflow/protocol'
import type { FlowCanvasNode } from './components/FlowSessionNode'
import { subagentEdgeId } from './edges'
import { arrangeNodes, nodeRect, overlaps } from './layout'

/** Authored membership projected into one view, never written back as topology. */
export function projectMembers(nodes: FlowCanvasNode[], memberships: FlowMembership[], ownerId: string | null, saved: Record<string, FlowPosition> = {}, runs: RunSummary[] = []) {
  if (!ownerId)
    return { nodes: nodes.filter(node => node.data.kind !== 'subagent-role'), edges: [] }
  const ids = new Set(memberships.filter(item => item.orchestratorId === ownerId).map(item => item.memberId))
  const members = nodes.filter(node => node.id === ownerId || (ids.has(node.id) && node.data.kind === 'subagent-role'))
  for (const run of runs.filter(item => item.orchestratorId === ownerId)) {
    const analysis = run.purpose === 'review-analysis'
    const existing = members.some(node => (node.data.agentId ?? node.id) === run.roleId && (node.data.runPurpose ?? 'task') === (run.purpose ?? 'task'))
    if (existing)
      continue
    const known = !analysis && nodes.find(node => node.id === run.roleId && node.data.kind === 'subagent-role')
    members.push(known
      ? { ...known, data: { ...known.data, referenceLabel: '非默认成员' } }
      : { id: analysis ? `analysis:${JSON.stringify([ownerId, run.roleId])}` : run.roleId, type: 'session', position: { x: 0, y: 0 }, data: { name: analysis ? '审查路线分析' : run.roleName, sessionPath: '', goal: analysis ? '只读分析固定源码，生成需求审查路线' : '仅保留运行证据', kind: 'subagent-role', agentId: run.roleId, runPurpose: run.purpose ?? 'task', evidenceOnly: true, referenceLabel: analysis ? '临时分析' : '角色已移除', status: 'idle', needsInput: false, onOpen() {} } })
  }
  const edges = members.filter(node => node.id !== ownerId).map(node => ({ id: subagentEdgeId({ orchestratorId: ownerId, roleId: node.data.agentId ?? node.id, purpose: node.data.runPurpose }), source: ownerId, target: node.id }))
  const positions = Object.keys(saved).length ? new Map(Object.entries(saved)) : arrangeNodes(members, edges)
  const occupied = members.filter(node => positions.has(node.id)).map(node => ({ ...nodeRect(node), ...positions.get(node.id)! }))
  const projected = members.map((node) => {
    let position = positions.get(node.id)
    if (!position) {
      const rect = nodeRect(node)
      position = { x: 32, y: 32 }
      while (occupied.some(other => overlaps({ ...rect, ...position }, other, 36)))
        position = { x: position.x, y: position.y + rect.height + 36 }
      occupied.push({ ...rect, ...position })
    }
    const shared = memberships.filter(item => item.memberId === node.id).length > 1
    return { ...node, position, deletable: false, data: { ...node.data, displayOwnerId: node.id === ownerId ? undefined : ownerId, referenceLabel: node.data.referenceLabel ?? (shared ? '共享角色' : undefined) } }
  })
  return { nodes: projected, edges }
}
