import type { Node, NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Bot, ChevronDown, ChevronUp, Network } from 'lucide-react'
import styles from './styles.module.css'

export type FlowSessionNodeData = Record<string, unknown> & {
  agentId?: string
  displayOwnerId?: string
  referenceLabel?: string
  memberSummary?: { total: number, running: number, failed: number }
  membersExpanded?: boolean
  onToggleMembers?: () => void
  kind?: 'persistent' | 'subagent-role'
  roleModel?: string
  sessionPath: string
  name: string
  modelName?: string
  orchestrationEnabled?: boolean
  goal: string
  brief?: string
  status: 'idle' | 'running' | 'failed'
  needsInput: boolean
  unread?: boolean
  isCurrent?: boolean
  isAnchor?: boolean
  isDimmed?: boolean
  isStreaming?: boolean
  onOpen: () => void
}

export type FlowCanvasNode = Node<FlowSessionNodeData, 'session'>

function nodeAttention(data: FlowSessionNodeData) {
  if (data.needsInput)
    return { kind: 'needsInput' as const, label: '待回答' }
  if (data.status === 'failed')
    return { kind: 'failed' as const, label: '失败' }
  if (data.status === 'running')
    return { kind: 'running' as const, label: '运行中' }
  if (data.unread)
    return { kind: 'unread' as const, label: '已完成' }
  return null
}

export default function FlowSessionNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const attention = nodeAttention(data)
  const modelName = data.modelName || '模型未加载'
  const statusKind = attention?.kind ?? 'idle'

  return (
    <div className="pf-relative pf-w-[172px]">
      <button
        type="button"
        className={[
          `${styles.node} pf-relative pf-grid pf-min-h-[128px] pf-gap-[8px] pf-p-[8px_7px] pf-text-center`,
          `pf-cursor-pointer ${selected ? styles.selected : ''} ${data.isCurrent ? styles.current : ''}`,
          `${data.isAnchor ? styles.anchor : ''} ${data.isDimmed ? styles.dimmed : ''}`,
        ].join(' ')}
        data-status={statusKind}
        aria-label={`${data.name}，${modelName}，${attention?.label ?? (data.isCurrent ? '当前会话' : '空闲')}`}
        aria-expanded={Boolean(selected)}
      >
        <div className={`${styles.agentIcon} pf-relative pf-grid pf-w-[51px] pf-h-[51px] pf-place-items-center pf-bg-surface`} aria-hidden="true">
          <Handle className={styles.hiddenHandle} type="target" position={Position.Top} isConnectable={false} />
          <Handle className={styles.hiddenHandle} type="source" position={Position.Top} isConnectable={false} />
          {data.orchestrationEnabled ? <Network size={23} strokeWidth={1.8} /> : <Bot size={23} strokeWidth={1.8} />}
          {attention
            ? <span className={`${styles.statusMark} pf-absolute pf-right-[-4px] pf-bottom-[-4px] pf-w-[12px] pf-h-[12px] pf-rounded-[50%] ${styles[attention.kind]}`} />
            : null}
        </div>
        <div className={`${styles.identity} pf-flex pf-w-full pf-min-w-0 pf-flex-col pf-items-center pf-gap-0.5`}>
          <h2 className="pf-m-0 pf-max-w-full pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-text-[0.86rem] pf-font-semibold pf-leading-[1.35] pf-text-[var(--c-ink)]" title={data.name}>{data.name}</h2>
          <p title={modelName}>{modelName}</p>
          {attention
            ? <span className={`${styles.status} pf-w-max pf-max-w-full pf-overflow-hidden pf-text-[0.68rem] pf-leading-[1.2] pf-text-ellipsis pf-whitespace-nowrap ${styles[statusKind]}`}>{attention.label}</span>
            : data.isCurrent
              ? <span className={`${styles.status} pf-w-max pf-max-w-full pf-overflow-hidden pf-text-[0.68rem] pf-leading-[1.2] pf-text-ellipsis pf-whitespace-nowrap ${styles.currentStatus}`}>当前会话</span>
              : null}
        </div>
      </button>
      {data.referenceLabel ? <span className="pf-block pf-text-muted pf-text-[0.63rem] pf-text-center">{data.referenceLabel}</span> : null}
      {data.memberSummary
        ? (
            <button
              type="button"
              className={`${styles.members} pf-flex pf-w-full pf-justify-center pf-items-center pf-gap-[3px] pf-p-[3px] pf-rounded-[5px] pf-bg-surface pf-text-muted pf-text-[0.63rem] nodrag nopan`}
              disabled={!data.memberSummary.total}
              aria-expanded={Boolean(data.membersExpanded)}
              aria-label={`${data.membersExpanded ? '折叠' : '展开'} ${data.name} 的成员`}
              onClick={(event) => {
                event.stopPropagation()
                data.onToggleMembers?.()
              }}
            >
              {data.membersExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {data.memberSummary.total}
              {' '}
              成员 ·
              {data.memberSummary.running}
              {' '}
              运行 ·
              {data.memberSummary.failed}
              {' '}
              失败
            </button>
          )
        : null}
    </div>
  )
}
