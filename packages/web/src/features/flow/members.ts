import type { FlowMembership, FlowPosition } from '@piflow/protocol'
import type { LayoutNode } from './layout'
import { nodeRect, overlaps } from './layout'

/** Display placements only. Never write this projection back as topology. */
export function memberPlacements(
  nodes: readonly LayoutNode[],
  memberships: readonly FlowMembership[],
  expanded: ReadonlySet<string>,
  moved: ReadonlySet<string>,
): Array<{ id: string, agentId: string, ownerId: string, reference: boolean, position: FlowPosition }> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const placed = new Set<string>()
  const placements = []
  const projectedMembers = new Set(memberships.filter(item => expanded.has(item.orchestratorId)).map(item => item.memberId))
  const occupied = nodes.filter(node => !projectedMembers.has(node.id) || moved.has(node.id)).map(nodeRect)
  for (const owner of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!expanded.has(owner.id))
      continue
    const members = memberships.filter(item => item.orchestratorId === owner.id && byId.has(item.memberId)).sort((a, b) => a.memberId.localeCompare(b.memberId))
    for (const item of members) {
      const reference = placed.has(item.memberId)
      const member = byId.get(item.memberId)!
      let position = member.position
      if (reference || !moved.has(item.memberId)) {
        const rect = nodeRect(member)
        // Finite occupied rectangles guarantee a free row after their maximum bottom edge.
        let y = owner.position.y
        const x = owner.position.x + nodeRect(owner).width + 64
        while (occupied.some(other => overlaps({ x, y, width: rect.width, height: rect.height }, other, 24)))
          y += rect.height + 32
        position = { x, y }
        occupied.push({ ...rect, ...position })
      }
      placements.push({ id: reference ? `member-reference:${JSON.stringify([owner.id, item.memberId])}` : item.memberId, agentId: item.memberId, ownerId: owner.id, reference, position })
      placed.add(item.memberId)
    }
  }
  return placements
}
