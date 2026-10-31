import type { SessionInfoLite } from '@piflow/protocol'
import type { NewNodeDraft } from '../../flow/node-forms'
import { useState } from 'react'
import Button from '../Button'
import styles from '../flow-form.module.css'
import Select from '../Select'
import Textarea from '../Textarea'
import TextInput from '../TextInput'
import { useFormSubmit } from '../use-form-submit'

interface Props {
  sessions: SessionInfoLite[]
  busy: boolean
  onCreate: (draft: NewNodeDraft) => Promise<void>
  onClose: () => void
}

export default function FlowNodeForm({ sessions, busy, onCreate, onClose }: Props) {
  const [draft, setDraft] = useState<NewNodeDraft>(() => ({ id: crypto.randomUUID(), kind: 'subagent-role', name: '', goal: '', brief: '', rolePrompt: '', sessionPath: '' }))
  const { submitting, error, submit } = useFormSubmit(onClose)
  return (
    <form
      className={`${styles.panel} pf-absolute pf-z-5 pf-right-[16px] pf-overflow-y-auto`}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && draft.name.trim())
          void submit(() => onCreate(draft))
      }}
      aria-label="添加节点"
    >
      <label>
        执行类型
        <Select appearance="panel" value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as 'persistent' | 'subagent-role' }))}>
          <option value="subagent-role">Subagent 角色（独立任务上下文）</option>
          <option value="persistent">主 Agent（长期会话）</option>
        </Select>
      </label>
      <label>
        名称
        <TextInput appearance="panel" required maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="认证模块" autoFocus />
      </label>
      <label>
        当前目标
        <Textarea appearance="panel" maxLength={500} rows={3} value={draft.goal} onChange={event => setDraft(current => ({ ...current, goal: event.target.value }))} placeholder="可选" />
      </label>
      <label>
        Brief
        <Textarea appearance="panel" maxLength={8000} rows={5} value={draft.brief} onChange={event => setDraft(current => ({ ...current, brief: event.target.value }))} placeholder="这个节点固定带上的说明，类似仓库里的 AGENTS.md。可以留空。" />
      </label>
      <label>
        角色提示词
        <Textarea appearance="panel" maxLength={8000} rows={4} value={draft.rolePrompt} onChange={event => setDraft(current => ({ ...current, rolePrompt: event.target.value }))} placeholder="定义职责、工作方式和交付要求" />
      </label>
      {draft.kind === 'persistent'
        ? (
            <label>
              会话
              <Select appearance="panel" value={draft.sessionPath} onChange={event => setDraft(current => ({ ...current, sessionPath: event.target.value }))}>
                <option value="">新建干净会话</option>
                {sessions.map(session => <option key={session.path} value={session.path}>{session.name || session.firstMessage || session.path.split('/').pop() || session.path}</option>)}
              </Select>
            </label>
          )
        : null}
      {error ? <p className="pf-text-danger pf-text-[0.76rem]" role="alert">{error}</p> : null}
      <div className="pf-flex pf-justify-end pf-gap-2">
        <Button variant="ghost" size="panel" disabled={busy || submitting} onClick={onClose}>取消</Button>
        <Button type="submit" variant="accent" size="panel" disabled={busy || submitting || !draft.name.trim()}>添加</Button>
      </div>
    </form>
  )
}
