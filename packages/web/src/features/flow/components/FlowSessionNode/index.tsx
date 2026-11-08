import type { Node, NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { ProviderBrand } from '../../../../components/ProviderLogo/brand'
import { Handle, Position } from '@xyflow/react'
import { ChevronDown, ChevronUp, CircleAlert, Clock3, GitBranch, Link2, Network } from 'lucide-react'
import ProviderLogo from '../../../../components/ProviderLogo'
import { brandStyle } from '../../../../components/ProviderLogo/brand'
import { iconSize, NODE_HEIGHT, NODE_PADDING, NODE_WIDTH } from '../../geometry'
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
  provider?: string
  brand?: ProviderBrand
  orchestrationEnabled?: boolean
  goal: string
  brief?: string
  status: 'idle' | 'running' | 'failed'
  needsInput: boolean
  unread?: boolean
  isAnchor?: boolean
  isDimmed?: boolean
  isStreaming?: boolean
  summaryOpen?: boolean
  onHover?: (id: string | null) => void
  onActivate?: (displayId: string) => void
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
    return { kind: 'unread' as const, label: '未读完成' }
  return null
}

export default function FlowSessionNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  const attention = nodeAttention(data)
  const size = iconSize(data)
  const identity = data.orchestrationEnabled ? '编排者' : data.kind === 'subagent-role' ? '角色' : 'Agent'
  return (
    <div className={`${styles.root} ${data.isDimmed ? styles.dimmed : ''}`} style={{ ...brandStyle(data.brand ?? 'unknown'), '--node-width': `${NODE_WIDTH}px`, '--node-height': `${NODE_HEIGHT}px`, '--node-padding': `${NODE_PADDING}px`, '--icon-size': `${size}px` } as CSSProperties}>
      <button
        type="button"
        className={`${styles.node} ${selected ? styles.selected : ''} ${data.isAnchor ? styles.anchor : ''}`}
        data-status={attention?.kind ?? 'idle'}
        data-flow-node={id}
        aria-label={[data.name, identity, data.referenceLabel, data.provider, data.modelName, attention?.label ?? '空闲'].filter(Boolean).join('，')}
        aria-expanded={Boolean(data.summaryOpen)}
        onPointerEnter={event => event.pointerType === 'mouse' && data.onHover?.(id)}
        onPointerLeave={() => data.onHover?.(null)}
        onFocus={() => data.onHover?.(id)}
        onBlur={() => data.onHover?.(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            data.onActivate?.(id)
          }
        }}
      >
        <span className={styles.agentIcon} aria-hidden="true">
          <Handle className={styles.hiddenHandle} type="target" position={Position.Top} isConnectable={false} />
          <Handle className={styles.hiddenHandle} type="source" position={Position.Top} isConnectable={false} />
          <ProviderLogo brand={data.brand ?? 'unknown'} name={data.name} size={size * 0.52} />
          {data.orchestrationEnabled ? <span className={styles.identityMark}><Network size={10} /></span> : data.kind === 'subagent-role' ? <span className={styles.identityMark}><GitBranch size={10} /></span> : null}
          {attention ? <span className={`${styles.statusMark} ${styles[attention.kind]}`}>{attention.kind === 'failed' ? <CircleAlert size={12} /> : attention.kind === 'needsInput' ? <Clock3 size={12} /> : null}</span> : null}
        </span>
        <span className={styles.identity}>
          <span className={styles.name} title={data.name}>{data.name}</span>
          {data.modelName ? <span className={styles.model} title={data.modelName}>{data.modelName}</span> : null}
          {attention ? <span className={`${styles.status} ${styles[attention.kind]}`}>{attention.label}</span> : null}
          {data.referenceLabel
            ? (
                <span className={styles.reference}>
                  <Link2 size={10} />
                  {data.referenceLabel}
                </span>
              )
            : null}
        </span>
      </button>
      {data.memberSummary?.total
        ? (
            <button
              type="button"
              className={`${styles.members} nodrag nopan`}
              aria-expanded={Boolean(data.membersExpanded)}
              aria-label={`${data.membersExpanded ? '折叠' : '展开'} ${data.name} 的成员`}
              onClick={(event) => {
                event.stopPropagation()
                data.onToggleMembers?.()
              }}
            >
              {data.membersExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {data.memberSummary.total}
              {' '}
              成员
              {data.memberSummary.running ? ` · ${data.memberSummary.running} 运行` : ''}
              {data.memberSummary.failed ? ` · ${data.memberSummary.failed} 失败` : ''}
            </button>
          )
        : null}
    </div>
  )
}
