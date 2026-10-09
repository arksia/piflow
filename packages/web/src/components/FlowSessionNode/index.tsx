import type { Node, NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import styles from './styles.module.css'

export type FlowSessionNodeData = Record<string, unknown> & {
  sessionPath: string
  name: string
  goal: string
  status: 'idle' | 'running' | 'failed'
  needsInput: boolean
  unread?: boolean
  isCurrent?: boolean
  isAnchor?: boolean
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

  return (
    <article className={`${styles.node} ${selected ? styles.selected : ''} ${data.isCurrent ? styles.current : ''} ${data.isAnchor ? styles.anchor : ''}`}>
      <Handle className={styles['hidden-handle']} type="target" position={Position.Left} isConnectable={false} />
      <div className={styles.topline}>
        {attention
          ? (
              <>
                <span className={`${styles.statusDot} ${styles[attention.kind]}`} />
                <span className={`${styles.status} ${styles[attention.kind]}`}>{attention.label}</span>
              </>
            )
          : <span className={styles.status}> </span>}
      </div>
      <h2>{data.name}</h2>
      {data.goal ? <p>{data.goal}</p> : <p className={styles.empty}>尚未设置目标</p>}
      <button type="button" className="nodrag" onClick={data.onOpen}>打开会话</button>
      <Handle className={styles['hidden-handle']} type="source" position={Position.Right} isConnectable={false} />
    </article>
  )
}
