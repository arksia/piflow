import type { FlowDocument, FlowNode } from '@piflow/protocol'

export type NewNodeDraft = Required<Pick<FlowNode, 'id' | 'kind' | 'name' | 'goal' | 'brief' | 'rolePrompt' | 'sessionPath'>>
export type NodeConfigurationDraft = Required<Pick<FlowNode, 'kind' | 'brief' | 'roleLabel' | 'rolePrompt' | 'model' | 'tools' | 'orchestrationEnabled'>> & { memberIds: string[] }

export function addDraftNode(document: FlowDocument, draft: NewNodeDraft, sessionPath: string, position: FlowNode['position']): FlowDocument {
  if (!draft.name.trim())
    throw new Error('请输入节点名称')
  const existing = document.nodes.find(node => node.id === draft.id)
  const now = new Date().toISOString()
  const node: FlowNode = {
    ...draft,
    name: draft.name.trim(),
    goal: draft.goal.trim(),
    brief: draft.brief.trim(),
    rolePrompt: draft.rolePrompt.trim(),
    orchestrationEnabled: draft.kind === 'persistent',
    sessionPath: draft.kind === 'subagent-role' ? '' : sessionPath,
    position: existing?.position ?? position,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return { ...document, nodes: existing ? document.nodes.map(item => item.id === node.id ? node : item) : [...document.nodes, node] }
}

export function configureNode(document: FlowDocument, id: string, draft: NodeConfigurationDraft): FlowDocument {
  const existing = document.nodes.find(node => node.id === id)
  if (!existing)
    throw new Error('该节点已不在画布中')
  if (draft.kind === 'persistent' && document.memberships?.some(item => item.memberId === id))
    throw new Error('该 Agent 仍属于其他编排者，请先移除归属关系，再启用编排能力。')
  if (draft.kind === 'subagent-role' && document.edges.some(edge => edge.source === id || edge.target === id))
    throw new Error('请先移除该节点的通信边，再将它改为 Subagent 角色。')
  if (draft.kind !== (existing.kind ?? 'persistent') && document.runs?.some(run => run.roleId === id || run.orchestratorId === id))
    throw new Error('该节点已有运行记录，请新建另一种执行类型的节点；原运行记录将保留。')
  return {
    ...document,
    memberships: [
      ...(document.memberships ?? []).filter(item => item.orchestratorId !== id),
      ...(draft.kind === 'persistent' && draft.orchestrationEnabled ? draft.memberIds.map(memberId => ({ orchestratorId: id, memberId })) : []),
    ],
    nodes: document.nodes.map(node => node.id === id
      ? { ...node, kind: draft.kind, sessionPath: draft.kind === 'subagent-role' ? '' : node.sessionPath, brief: draft.brief.trim(), roleLabel: draft.roleLabel.trim(), rolePrompt: draft.rolePrompt.trim(), model: draft.model.trim(), tools: draft.tools, orchestrationEnabled: draft.kind === 'persistent' && draft.orchestrationEnabled, updatedAt: new Date().toISOString() }
      : node),
  }
}
