import type { Node, NodeProps } from '@xyflow/react'
import styles from './styles.module.css'

export type FlowSessionNodeData = Record<string, unknown> & {
  sessionPath: string
  name: string
  goal: string
  status: 'idle' | 'running' | 'failed'
  isAnchor?: boolean
  onOpen: () => void
}

export type FlowCanvasNode = Node<FlowSessionNodeData, 'session'>

export default function FlowSessionNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const status = data.status === 'running' ? '运行中' : data.status === 'failed' ? '需要处理' : '空闲'

  return (
    <article className={`${styles.node} ${selected ? styles.selected : ''} ${data.isAnchor ? styles.anchor : ''}`}>
      <div className={styles.topline}>
        <span className={`${styles.statusDot} ${styles[data.status]}`} />
        <span className={styles.status}>{status}</span>
      </div>
      <h2>{data.name}</h2>
      {data.goal ? <p>{data.goal}</p> : <p className={styles.empty}>尚未设置目标</p>}
      <button className="nodrag" onClick={data.onOpen}>打开会话</button>
    </article>
  )
}
