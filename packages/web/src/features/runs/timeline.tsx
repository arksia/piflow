import type { RunSummary } from '@piflow/protocol'
import { RUN_STATUS_LABELS } from '@piflow/protocol'
import { Activity, Check, CircleHelp, GitBranch, OctagonX, Square, X } from 'lucide-react'
import styles from './styles.module.css'
import { formatDuration, runEnd, runLanes, timelineRange } from './time'

const statusIcons = { running: Activity, succeeded: Check, failed: X, cancelled: Square, interrupted: CircleHelp }
function clock(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
export default function RunTimeline({ runs, now, live, selectedId, onSelect }: {
  runs: RunSummary[]
  now: number
  live: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const lanes = runLanes(runs, now)
  const bounds = timelineRange(runs, now)
  const span = bounds.end - bounds.start
  const range = { start: bounds.start - span * 0.035, end: bounds.end + span * 0.065 }
  const length = range.end - range.start
  const position = (value: number) => ((value - range.start) / length) * 100
  const running = runs.filter(run => run.status === 'running').length
  const failed = runs.filter(run => run.status === 'failed' || run.status === 'interrupted').length
  const ticks = Array.from({ length: 5 }, (_, i) => ({ percent: 5 + i * 22.5, time: range.start + length * (5 + i * 22.5) / 100 }))
  const showNow = running > 0 && now >= range.start && now <= range.end
  return (
    <section className={styles.timeline} aria-label="运行时间线">
      <header className={styles.timelineHeader}>
        <GitBranch size={16} />
        <strong>Agent 时间线</strong>
        <span className={styles.summaryCount}>
          {lanes.length}
          {' '}
          个角色
        </span>
        {running
          ? (
              <span className={styles.liveCount}>
                <i />
                {running}
                {' '}
                运行中
              </span>
            )
          : null}
        {failed
          ? (
              <span className={styles.failedCount}>
                <OctagonX size={12} />
                {failed}
                {' '}
                次异常
              </span>
            )
          : null}
        <span className={styles.rangeLabel}>
          已加载范围 ·
          {formatDuration(span)}
        </span>
      </header>
      <div className={styles.lanes}>
        <div className={styles.ruler}>
          <span>
            AGENTS
            <small>
              {' '}
              /
              {runs.length}
              {' '}
              RUNS
            </small>
          </span>
          <div className={styles.rulerTicks}>
            {ticks.map(tick => <span key={tick.percent} style={{ left: `${tick.percent}%` }}>{clock(tick.time)}</span>)}
          </div>
        </div>
        {lanes.map((lane, index) => {
          const active = lane.tracks.flat().filter(run => run.status === 'running').length
          return (
            <div className={styles.lane} key={lane.id}>
              <div className={styles.laneIdentity}>
                <span className={styles.avatar} data-tone={index % 4}>{lane.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.laneName}>
                  <strong title={lane.name}>{lane.name}</strong>
                  <small title={lane.owner}>{lane.owner}</small>
                </span>
                <span className={styles.laneState} data-active={active > 0 || undefined}>{active ? `${active} 执行中` : '空闲'}</span>
              </div>
              <div className={styles.laneTracks} style={{ height: Math.max(64, lane.tracks.length * 44 + 20) }}>
                {ticks.map(tick => <i className={styles.gridLine} key={tick.percent} style={{ left: `${tick.percent}%` }} />)}
                {showNow ? <i className={styles.nowLine} data-live={live || undefined} style={{ left: `${position(now)}%` }} /> : null}
                {lane.tracks.flatMap((track, trackIndex) => track.map((run) => {
                  const width = Math.max(0, position(Math.max(Date.parse(run.createdAt), runEnd(run, now))) - position(Date.parse(run.createdAt)))
                  const Icon = statusIcons[run.status]
                  const duration = run.status === 'running' ? now - Date.parse(run.createdAt) : run.durationMs
                  const label = `${run.roleName}：${run.taskPreview} · ${RUN_STATUS_LABELS[run.status]} · ${formatDuration(duration)}${run.failedToolCount ? ` · ${run.failedToolCount} 个工具失败` : ''}`
                  return (
                    <button
                      type="button"
                      key={run.id}
                      className={`${styles.runBlock} ${styles[run.status]}`}
                      data-selected={selectedId === run.id || undefined}
                      data-brief={width < 4 || undefined}
                      style={{ left: `${position(Date.parse(run.createdAt))}%`, width: `${width}%`, top: 14 + trackIndex * 44 }}
                      aria-label={label}
                      aria-pressed={selectedId === run.id}
                      title={label}
                      onClick={() => onSelect(run.id)}
                    >
                      <Icon size={13} />
                      <span>{run.taskPreview}</span>
                      {run.failedToolCount
                        ? (
                            <span className={styles.toolFailure} title={`${run.failedToolCount} 个工具失败`}>
                              !
                              {run.failedToolCount}
                            </span>
                          )
                        : null}
                      <small>{formatDuration(duration)}</small>
                    </button>
                  )
                }))}
              </div>
            </div>
          )
        })}
      </div>
      <footer className={styles.timelineFooter}>
        <span>
          {clock(bounds.start)}
          {' '}
          —
          {' '}
          {clock(bounds.end)}
        </span>
        <span>
          {showNow
            ? (
                <>
                  <i className={styles.nowDot} />
                  {live ? '实时' : '最后同步'}
                </>
              )
            : '按真实时间比例 · 点击任务查看详情'}
        </span>
      </footer>
    </section>
  )
}
