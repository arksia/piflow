export interface AgentConfiguration {
  roleLabel?: string
  rolePrompt?: string
  orchestrationEnabled?: boolean
}

/** Organization is independent of the user-authored communication edges. */
export interface FlowMembership {
  orchestratorId: string
  memberId: string
}

export class InvalidAgentConfiguration extends Error {}

export function parseAgentConfiguration(value: Record<string, unknown>): AgentConfiguration {
  const result: AgentConfiguration = {}
  for (const [key, max] of [['roleLabel', 80], ['rolePrompt', 8000]] as const) {
    if (value[key] === undefined)
      continue
    if (typeof value[key] !== 'string' || value[key].length > max)
      throw new InvalidAgentConfiguration(`invalid ${key}`)
    result[key] = value[key].trim()
  }
  if (value.orchestrationEnabled !== undefined) {
    if (typeof value.orchestrationEnabled !== 'boolean')
      throw new InvalidAgentConfiguration('invalid orchestrationEnabled')
    result.orchestrationEnabled = value.orchestrationEnabled
  }
  return result
}

export function parseFlowMemberships(value: unknown, nodes: readonly (AgentConfiguration & { id: string })[]): FlowMembership[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    throw new InvalidAgentConfiguration('成员关系必须是数组')
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('orchestratorId' in item) || !('memberId' in item)
      || typeof item.orchestratorId !== 'string' || typeof item.memberId !== 'string') {
      throw new InvalidAgentConfiguration('成员关系格式无效')
    }
    const { orchestratorId, memberId } = item
    const orchestrator = byId.get(orchestratorId)
    const member = byId.get(memberId)
    if (!orchestrator || !member)
      throw new InvalidAgentConfiguration('成员关系引用了不存在的 Agent')
    if (orchestratorId === memberId)
      throw new InvalidAgentConfiguration('Agent 不能成为自己的成员')
    if (!orchestrator.orchestrationEnabled)
      throw new InvalidAgentConfiguration('请先启用编排能力，再添加成员')
    if (member.orchestrationEnabled)
      throw new InvalidAgentConfiguration('编排者不能成为成员；启用编排能力前，请先移除该 Agent 的归属关系')
    const key = JSON.stringify([orchestratorId, memberId])
    if (seen.has(key))
      throw new InvalidAgentConfiguration('成员关系重复')
    seen.add(key)
    return { orchestratorId, memberId }
  })
}
