import type { FlowMembership, FlowPosition } from '@piflow/protocol'

/** Display placements only. Never write this projection back as topology. */
export function memberPlacements(
  nodes: readonly { id: string, position: FlowPosition }[],
  memberships: readonly FlowMembership[],
  expanded: ReadonlySet<string>,
  moved: ReadonlySet<string>,
): Array<{ id: string, agentId: string, ownerId: string, reference: boolean, position: FlowPosition }> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const placed = new Set<string>()
  const placements = []
  for (const owner of nodes) {
    if (!expanded.has(owner.id))
      continue
    const members = memberships.filter(item => item.orchestratorId === owner.id && byId.has(item.memberId))
    const radius = Math.max(210, members.length * 205 / (2 * Math.PI))
    for (const [index, item] of members.entries()) {
      const reference = placed.has(item.memberId)
      const angle = -Math.PI / 4 + index * 2 * Math.PI / members.length
      const member = byId.get(item.memberId)!
      placements.push({
        id: reference ? `member-reference:${JSON.stringify([owner.id, item.memberId])}` : item.memberId,
        agentId: item.memberId,
        ownerId: owner.id,
        reference,
        position: !reference && moved.has(item.memberId)
          ? member.position
          : {
              x: owner.position.x + Math.cos(angle) * radius,
              y: owner.position.y + Math.sin(angle) * radius,
            },
      })
      placed.add(item.memberId)
    }
  }
  return placements
}
