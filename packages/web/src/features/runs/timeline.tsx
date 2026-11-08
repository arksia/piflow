import type { RunSummary } from '@piflow/protocol'
import { RUN_STATUS_LABELS } from '@piflow/protocol'
import { Activity, Check, CircleHelp, Square, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import styles from './styles.module.css'
import { formatDuration, runEnd, runLanes, runPlacement, timelineRange, timelineTicks } from './time'

const statusIcons = { running: Activity, succeeded: Check, failed: X, cancelled: Square, interrupted: CircleHelp }
function clock(value: number, date = false) {
  return new Date(value).toLocaleString([], {
    ...(date ? { month: 'short', day: 'numeric' } as const : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
export default function RunTimeline({ runs, now, live, selectedId, inspectorId, onSelect }: {
  runs: RunSummary[]
  now: number
  live: boolean
  selectedId: string | null
  inspectorId: string
  onSelect: (id: string | null) => void
}) {
  const [period, setPeriod] = useState<'all' | 'recent'>('all')
  const [width, setWidth] = useState(600)
  const plotRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const plot = plotRef.current!
    const measure = () => setWidth(Math.max(18, plot.clientWidth))
    const observer = new ResizeObserver(measure)
    observer.observe(plot)
    return () => observer.disconnect()
  }, [])
  const bounds = timelineRange(runs, now)
  const running = runs.filter(run => run.status === 'running').length
  const failed = runs.filter(run => run.status === 'failed' || run.status === 'interrupted').length
  const end = bounds.end
  const span = period === 'recent' ? 30 * 60000 : bounds.end - bounds.start
  const range = { start: period === 'recent' ? end - span : bounds.start - span * 0.025, end: end + span * 0.045, width }
  const visible = runs.filter(run => runEnd(run, now) >= range.start && Date.parse(run.createdAt) <= range.end)
  const lanes = runLanes(visible, now, range)
  const position = (value: number) => (value - range.start) / (range.end - range.start) * width
  const acrossDays = new Date(range.start).toDateString() !== new Date(range.end).toDateString()
  const showNow = running > 0 && now >= range.start && now <= range.end
  const ticks = timelineTicks(range.start, range.end, width).filter(tick => !showNow || Math.abs(position(tick) - position(now)) > 48)
  return (
    <section className={styles.timeline} aria-label="Agent 时间线">
      <header className={styles.timelineHeader}>
        <span className={styles.activitySummary}>
          {running > 0
            ? (
                <span className={styles.liveCount}>
                  <i />
                  {running}
                  {' '}
                  运行中
                </span>
              )
            : <span>已加载运行均已结束</span>}
          {failed > 0
            ? (
                <span className={styles.failedCount}>
                  {failed}
                  {' '}
                  次异常
                </span>
              )
            : null}
        </span>
        <div className={styles.periods} aria-label="时间范围">
          <button type="button" aria-pressed={period === 'recent'} onClick={() => setPeriod('recent')}>近 30 分钟</button>
          <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>已加载</button>
        </div>
      </header>
      <div className={styles.lanes}>
        <div className={styles.ruler}>
          <span>
            AGENTS
            <small>
              /
              {lanes.length}
            </small>
          </span>
          <div className={styles.rulerTicks} ref={plotRef}>
            {ticks.map(tick => <span key={tick} style={{ left: position(tick) }}>{clock(tick, acrossDays)}</span>)}
            {showNow ? <span className={styles.nowLabel} style={{ left: position(now) }}>{live ? '现在' : '最后同步'}</span> : null}
          </div>
        </div>
        {lanes.map((lane) => {
          const active = lane.tracks.flat().some(run => run.status === 'running')
          return (
            <div className={styles.lane} key={lane.id}>
              <div className={styles.laneIdentity} title={`${lane.name} · ${lane.owner}`}>
                <span className={styles.avatar} data-active={active || undefined}>{lane.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.laneName}>
                  <strong>{lane.name}</strong>
                  <small>{lane.owner}</small>
                </span>
                {active ? <i className={styles.agentActive} aria-label="运行中" /> : null}
              </div>
              <div className={styles.laneTracks} style={{ height: Math.max(52, lane.tracks.length * 36 + 16) }}>
                {ticks.map(tick => <i className={styles.gridLine} key={tick} style={{ left: position(tick) }} />)}
                {showNow ? <i className={styles.nowLine} data-live={live || undefined} style={{ left: position(now) }} /> : null}
                {lane.tracks.flatMap((track, trackIndex) => track.map((run) => {
                  const placement = runPlacement(run, now, range)
                  const Icon = statusIcons[run.status]
                  const duration = run.status === 'running' ? Math.max(0, now - Date.parse(run.createdAt)) : run.durationMs
                  const label = `${run.roleName}：${run.taskPreview} · ${RUN_STATUS_LABELS[run.status]} · ${formatDuration(duration)}${run.failedToolCount ? ` · ${run.failedToolCount} 个工具失败` : ''}`
                  return (
                    <button
                      type="button"
                      key={run.id}
                      className={`${styles.runBlock} ${styles[run.status]}`}
                      data-run-id={run.id}
                      data-selected={selectedId === run.id || undefined}
                      data-brief={placement.width < 58 || undefined}
                      data-marker={placement.marker || undefined}
                      style={{ left: placement.left, width: placement.width, top: 12 + trackIndex * 36 }}
                      aria-label={label}
                      aria-expanded={selectedId === run.id}
                      aria-controls={selectedId === run.id ? inspectorId : undefined}
                      title={label}
                      onClick={() => onSelect(selectedId === run.id ? null : run.id)}
                    >
                      <span className={styles.point} />
                      <Icon size={12} />
                      <span className={styles.blockLabel}>{run.taskPreview}</span>
                      {run.failedToolCount > 0 && placement.width >= 100
                        ? (
                            <span className={styles.toolFailure}>
                              !
                              {run.failedToolCount}
                            </span>
                          )
                        : null}
                    </button>
                  )
                }))}
              </div>
            </div>
          )
        })}
        {!lanes.length ? <p className={styles.empty}>此时间窗口内没有已加载的运行。</p> : null}
      </div>
      <footer className={styles.timelineFooter}>
        <span>
          {visible.length}
          {' '}
          /
          {' '}
          {runs.length}
          {' '}
          次已加载运行
        </span>
        <span>
          {clock(period === 'recent' ? range.start : bounds.start, acrossDays)}
          {' '}
          —
          {' '}
          {clock(end, acrossDays)}
        </span>
      </footer>
    </section>
  )
}
