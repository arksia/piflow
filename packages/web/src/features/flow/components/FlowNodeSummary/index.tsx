import type { FlowCanvasNode } from '../FlowSessionNode'
import { useReactFlow, useStore, useViewport } from '@xyflow/react'
import { ArrowUpRight, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import ProviderLogo from '../../../../components/ProviderLogo'
import { brandStyle } from '../../../../components/ProviderLogo/brand'
import { nodeGeometry } from '../../geometry'
import { summaryPlacement } from '../../summary'
import { revealViewport } from '../../viewport'
import styles from './styles.module.css'

interface Props {
  node: FlowCanvasNode
  ownerName?: string
  activity?: string
  onClose: () => void
  onDetails: () => void
  onRuns: () => void
}

export default function FlowNodeSummary({ node, ownerName, activity, onClose, onDetails, onRuns }: Props) {
  const viewport = useViewport()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  const flow = useReactFlow()
  const rootRef = useRef<HTMLElement>(null)
  const dockRevealRef = useRef('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const [summaryHeight, setSummaryHeight] = useState(240)
  const placement = summaryPlacement(nodeGeometry(node), viewport, { width, height }, summaryHeight)
  const { docked } = placement
  const data = node.data
  const status = data.needsInput ? '待回答' : data.status === 'running' ? '运行中' : data.status === 'failed' ? '失败' : data.unread ? '未读完成' : '空闲'
  useLayoutEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const root = rootRef.current
    if (!root)
      return
    // Center using the measured card before its first paint.
    setSummaryHeight(root.getBoundingClientRect().height)
    const observer = new ResizeObserver(() => setSummaryHeight(root.getBoundingClientRect().height))
    observer.observe(root)
    return () => observer.disconnect()
  }, [node.id])
  useLayoutEffect(() => {
    const measurement = `${node.id}:${width}:${height}:${summaryHeight}`
    if (dockRevealRef.current === measurement)
      return
    dockRevealRef.current = measurement
    if (docked) {
      const current = flow.getNode(node.id)
      if (current)
        void flow.setViewport(revealViewport(flow.getNodesBounds([current]), { width, height: Math.max(80, height - summaryHeight - 70) }, flow.getViewport()))
    }
  }, [flow, node.id, docked, width, height, summaryHeight])
  return (
    <section
      ref={rootRef}
      className={`${styles.summary} nodrag nopan nowheel`}
      style={{ ...brandStyle(data.brand ?? 'unknown'), left: placement.x, top: placement.y, width: placement.width, maxHeight: Math.max(100, docked ? Math.min(height - 80, height * 0.5) : height - 80) }}
      role="dialog"
      aria-label={`${data.name} 摘要`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
        if (event.key === 'Backspace' || event.key === 'Delete')
          event.stopPropagation()
      }}
    >
      <header className={styles.header}>
        <span className={styles.logo}><ProviderLogo brand={data.brand ?? 'unknown'} name={data.name} size={22} /></span>
        <div>
          <strong>{data.name}</strong>
          <small>{data.orchestrationEnabled ? '编排者' : data.kind === 'subagent-role' ? '可委派角色' : 'Agent'}</small>
        </div>
        <button ref={closeRef} type="button" aria-label="关闭节点摘要" onClick={onClose}><X size={15} /></button>
      </header>
      <div className={styles.body}>
        <p className={styles.status} data-status={data.needsInput ? 'needs-input' : data.status}>
          <i />
          {status}
        </p>
        {data.modelName ? <p className={styles.model}>{[data.provider, data.modelName].filter(Boolean).join(' · ')}</p> : null}
        {ownerName
          ? (
              <p className={styles.context}>
                调用者 ·
                {ownerName}
              </p>
            )
          : null}
        {data.goal || data.brief ? <p className={styles.goal}>{data.goal || data.brief}</p> : null}
        {activity ? <p className={styles.activity}>{activity}</p> : null}
      </div>
      <footer className={styles.footer}>
        <button type="button" onClick={onRuns}>运行记录</button>
        <button type="button" className={styles.primary} onClick={onDetails}>
          完整详情
          <ArrowUpRight size={13} />
        </button>
      </footer>
    </section>
  )
}
