import type { EvidenceTarget, FlowActivityCounts, FlowActivityKind, FlowActivityPage } from '@piflow/protocol'
import type { FlowAttentionItem } from '../../attention'
import { ChevronDown, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { activityLabels } from '../../attention'
import styles from './styles.module.css'

const counters: [keyof FlowActivityCounts, FlowActivityKind][] = [['running', 'running'], ['pendingReviews', 'pending-review'], ['changesRequested', 'changes-requested'], ['latestFailures', 'latest-failure'], ['cancelled', 'cancelled'], ['inProgressReviews', 'in-progress-review'], ['unavailableReviews', 'unavailable-review'], ['uncoveredChanges', 'evidence-gap']]

export default function FlowAttention({ owners, page, counts, sessions, loading, stale, error, kind, onKind, onMore, onRefresh, onEvidence, onSession }: {
  owners: Record<string, string>
  page: FlowActivityPage | null
  counts?: FlowActivityCounts
  sessions: FlowAttentionItem[]
  loading: boolean
  stale: boolean
  error: string | null
  kind?: FlowActivityKind
  onKind: (kind?: FlowActivityKind) => void
  onMore: () => void
  onRefresh: () => void
  onEvidence: (target: EvidenceTarget) => void
  onSession: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className={styles.attention} aria-label="项目与协作组关注事项">
      <div className={styles.bar}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          关注
          <ChevronDown size={12} />
        </button>
        <div className={styles.counters}>
          {sessions.length
            ? (
                <button type="button" onClick={() => setOpen(true)}>
                  会话待处理
                  {sessions.length}
                </button>
              )
            : null}
          {counts
            ? counters.filter(([key]) => counts[key]).map(([key, category]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    setOpen(true)
                    onKind(category)
                  }}
                >
                  {activityLabels[category]}
                  {' '}
                  {counts[key]}
                </button>
              ))
            : null}
          {error || stale ? <span>{error ? '未同步，保留上次结果' : loading ? '同步中…' : '待同步'}</span> : counts && !Object.values(counts).some(Boolean) && !sessions.length ? <span>暂无待处理记录</span> : null}
        </div>
        <button type="button" disabled={loading} aria-label="同步关注事项" onClick={onRefresh}><RefreshCw size={13} /></button>
      </div>
      {open
        ? (
            <div className={styles.panel}>
              <div className={styles.filters}>
                <select aria-label="关注分类" value={kind ?? ''} onChange={event => onKind((event.target.value || undefined) as FlowActivityKind | undefined)}>
                  <option value="">全部分类</option>
                  {Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <span>已看、跳过和排除均不代表批准</span>
                <button type="button" aria-label="收起关注事项" onClick={() => setOpen(false)}><X size={13} /></button>
              </div>
              {error
                ? (
                    <p role="alert">
                      {error}
                      <button type="button" onClick={onRefresh}>重试</button>
                    </p>
                  )
                : null}
              <div className={styles.items}>
                {!kind
                  ? sessions.map(item => (
                      <button type="button" key={item.nodeId} className={styles.item} onClick={() => onSession(item.nodeId)}>
                        <span>{item.reason === 'needs_input' ? '待回答' : '会话失败'}</span>
                        <strong>{item.name}</strong>
                        <small>打开对应会话</small>
                      </button>
                    ))
                  : null}
                {page?.items.map(item => (
                  <button type="button" key={item.id} className={styles.item} onClick={() => onEvidence(item.target)}>
                    <span>
                      {item.orchestratorId ? owners[item.orchestratorId] ?? '已移除的编排者' : '未归属交付'}
                      {' '}
                      ·
                      {activityLabels[item.kind]}
                      {' '}
                      ·
                      {' '}
                      {item.count}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                    <time>{new Date(item.updatedAt).toLocaleString()}</time>
                  </button>
                ))}
                {page && !page.items.length ? <p>此分类暂无记录；不表示代码已通过审查。</p> : null}
                {page?.nextCursor ? <button type="button" disabled={loading} onClick={onMore}>{loading ? '加载中…' : '加载更多'}</button> : null}
              </div>
            </div>
          )
        : null}
    </section>
  )
}
