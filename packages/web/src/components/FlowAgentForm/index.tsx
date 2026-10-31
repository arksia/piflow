import type { FlowDocument, FlowNode } from '@piflow/protocol'
import type { NodeConfigurationDraft } from '../../flow/node-forms'
import { useState } from 'react'
import Button from '../Button'
import styles from '../flow-form.module.css'
import Select from '../Select'
import Textarea from '../Textarea'
import TextInput from '../TextInput'
import { useFormSubmit } from '../use-form-submit'

const ROLE_TEMPLATES = [
  { label: '程序员', prompt: '你负责实现代码。先理解需求和现有实现，再完成范围明确的改动，验证行为，并汇报结果、测试与剩余风险。' },
  { label: '产品经理', prompt: '你负责澄清用户目标、边界和验收标准。将需求拆成可执行工作，明确依赖与优先级；有不确定性时先提出关键问题。' },
  { label: '测试', prompt: '你负责验证功能与质量。根据验收标准覆盖关键路径、失败路径和边界条件，提供可复现的问题步骤与验证结论。' },
]

interface Props {
  document: FlowDocument
  node: FlowNode
  busy: boolean
  onSave: (draft: NodeConfigurationDraft) => Promise<void>
  onClose: () => void
}

export default function FlowAgentForm({ document, node, busy, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<NodeConfigurationDraft>(() => ({
    kind: node.kind ?? 'persistent',
    brief: node.brief ?? '',
    roleLabel: node.roleLabel ?? '',
    rolePrompt: node.rolePrompt ?? '',
    model: node.model ?? '',
    tools: node.tools ?? ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
    orchestrationEnabled: Boolean(node.orchestrationEnabled),
    memberIds: (document.memberships ?? []).filter(item => item.orchestratorId === node.id).map(item => item.memberId),
  }))
  const { submitting, error, submit } = useFormSubmit(onClose)
  return (
    <form
      className={`${styles.panel} pf-absolute pf-z-5 pf-right-[16px] pf-overflow-y-auto`}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) {
          void submit(() => onSave(draft))
        }
      }}
      aria-label="Agent 配置"
    >
      <strong>Agent 配置</strong>
      <label>
        执行类型
        <Select appearance="panel" value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as 'persistent' | 'subagent-role' }))}>
          <option value="persistent">长期 Agent</option>
          <option value="subagent-role">Subagent 角色（每次调用独立执行）</option>
        </Select>
      </label>
      {draft.kind === 'subagent-role'
        ? (
            <>
              <label>
                模型
                <TextInput appearance="panel" value={draft.model} maxLength={200} onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} placeholder="留空继承主 Agent；或 provider/model-id" />
              </label>
              <fieldset className="pf-min-w-0 pf-m-[0_0_12px] pf-p-[10px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-text-muted pf-text-[0.75rem]">
                <legend>角色工具范围</legend>
                <p>实际执行取角色配置与主 Agent 已启用工具的交集。</p>
                {['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'].map(tool => (
                  <label className={styles.toggleField} key={tool}>
                    <input type="checkbox" checked={draft.tools.includes(tool)} onChange={event => setDraft(current => ({ ...current, tools: event.target.checked ? [...current.tools, tool] : current.tools.filter(item => item !== tool) }))} />
                    {tool}
                  </label>
                ))}
              </fieldset>
            </>
          )
        : null}
      <label>
        从角色模板开始
        <Select
          appearance="panel"
          defaultValue=""
          onChange={(event) => {
            const template = ROLE_TEMPLATES.find(item => item.label === event.target.value)
            if (template) {
              setDraft(current => ({ ...current, roleLabel: template.label, rolePrompt: template.prompt }))
            }
          }}
        >
          <option value="">自定义（选择模板将替换当前角色提示词）</option>
          {ROLE_TEMPLATES.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}
        </Select>
      </label>
      <label>
        角色名称
        <TextInput appearance="panel" autoFocus maxLength={80} value={draft.roleLabel} onChange={event => setDraft(current => ({ ...current, roleLabel: event.target.value }))} placeholder="例如：程序员、产品经理、测试" />
      </label>
      <label>
        角色提示词
        <Textarea appearance="panel" maxLength={8000} rows={5} value={draft.rolePrompt} onChange={event => setDraft(current => ({ ...current, rolePrompt: event.target.value }))} placeholder="定义职责、工作方式和交付要求；从下次运行开始生效。" />
      </label>
      <label className={styles.toggleField}>
        <input type="checkbox" checked={draft.orchestrationEnabled} disabled={draft.kind === 'subagent-role' || Boolean(document.memberships?.some(item => item.memberId === node.id))} onChange={event => setDraft(current => ({ ...current, orchestrationEnabled: event.target.checked }))} />
        启用编排能力
      </label>
      {document.memberships?.some(item => item.memberId === node.id) ? <p className="pf-text-muted pf-text-[0.75rem]">启用前请先从所属编排者的成员列表中移除该 Agent。</p> : null}
      {draft.kind === 'persistent' && draft.orchestrationEnabled
        ? (
            <fieldset className="pf-min-w-0 pf-m-[0_0_12px] pf-p-[10px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-text-muted pf-text-[0.75rem]">
              <legend>成员（不创建通信连接）</legend>
              {document.nodes.filter(member => member.id !== node.id && member.kind === 'subagent-role').map(member => (
                <label key={member.id} className={styles.toggleField}>
                  <input type="checkbox" checked={draft.memberIds.includes(member.id)} onChange={event => setDraft(current => ({ ...current, memberIds: event.target.checked ? [...current.memberIds, member.id] : current.memberIds.filter(id => id !== member.id) }))} />
                  {member.name}
                </label>
              ))}
              {!document.nodes.some(member => member.id !== node.id && member.kind === 'subagent-role') ? <p>先在画布上添加 Subagent 角色。</p> : null}
            </fieldset>
          )
        : null}
      <label>
        Brief
        <Textarea appearance="panel" maxLength={8000} rows={8} value={draft.brief} onChange={event => setDraft(current => ({ ...current, brief: event.target.value }))} placeholder="这个节点固定带上的说明，类似仓库里的 AGENTS.md。可以留空。" />
      </label>
      {error ? <p className="pf-text-danger pf-text-[0.76rem]" role="alert">{error}</p> : null}
      <div className="pf-flex pf-justify-end pf-gap-2">
        <Button variant="ghost" size="panel" disabled={busy || submitting} onClick={onClose}>取消</Button>
        <Button type="submit" variant="accent" size="panel" disabled={busy || submitting}>保存</Button>
      </div>
    </form>
  )
}
