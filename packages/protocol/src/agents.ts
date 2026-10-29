export interface AgentConfiguration {
  kind?: 'persistent' | 'subagent-role'
  roleLabel?: string
  rolePrompt?: string
  model?: string
  tools?: string[]
  orchestrationEnabled?: boolean
}

export interface SubagentRun {
  id: string
  orchestratorId: string
  roleId: string
  parentSessionPath: string
  parentToolCallId: string
  task: string
  configurationSnapshot: {
    roleName: string
    effectivePrompt: string
    model: string
    thinkingLevel: string
    tools: string[]
    cwd: string
    memberRoleIds: string[]
  }
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  output: string
  progress?: { phase: 'thinking' | 'responding' | 'tool', toolName?: string }
  error?: string
  createdAt: string
  completedAt?: string
}

/** Organization is independent of the user-authored communication edges. */
export interface FlowMembership {
  orchestratorId: string
  memberId: string
}

export class InvalidAgentConfiguration extends Error {}

export function parseAgentConfiguration(value: Record<string, unknown>): AgentConfiguration {
  const result: AgentConfiguration = {}
  if (value.kind !== undefined) {
    if (value.kind !== 'persistent' && value.kind !== 'subagent-role')
      throw new InvalidAgentConfiguration('节点执行类型无效')
    result.kind = value.kind
  }
  for (const [key, max] of [['roleLabel', 80], ['rolePrompt', 8000], ['model', 200]] as const) {
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
  if (value.tools !== undefined) {
    const allowed = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
    if (!Array.isArray(value.tools) || value.tools.some(tool => typeof tool !== 'string' || !allowed.includes(tool)))
      throw new InvalidAgentConfiguration('Subagent 工具仅支持 read、bash、edit、write、grep、find、ls')
    result.tools = [...new Set(value.tools as string[])]
  }
  if (result.kind === 'subagent-role' && result.orchestrationEnabled)
    throw new InvalidAgentConfiguration('Subagent 角色不能启用编排能力')
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
    if (orchestrator.kind === 'subagent-role' || !orchestrator.orchestrationEnabled)
      throw new InvalidAgentConfiguration('请先启用编排能力，再添加成员')
    if (member.orchestrationEnabled)
      throw new InvalidAgentConfiguration('编排者不能成为成员；启用编排能力前，请先移除该 Agent 的归属关系')
    if (member.kind !== 'subagent-role')
      throw new InvalidAgentConfiguration('成员必须是 Subagent 角色，不能是长期 Agent')
    const key = JSON.stringify([orchestratorId, memberId])
    if (seen.has(key))
      throw new InvalidAgentConfiguration('成员关系重复')
    seen.add(key)
    return { orchestratorId, memberId }
  })
}
