import type { RunToolDetail, RunToolSummary } from '@piflow/protocol'
import { buildRunsPath } from '@piflow/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../session/api'
import styles from './styles.module.css'
import { formatDuration } from './time'

export default function ToolStep({
  tool,
  projectPath,
  runId,
  open,
  onToggle,
  connectionVersion,
  now,
  commandLabel,
}: {
  tool: RunToolSummary
  projectPath: string
  runId: string
  open: boolean
  onToggle: () => void
  connectionVersion: number
  now: number
  commandLabel?: string
}) {
  const [detail, setDetail] = useState<RunToolDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open)
      return
    let cancelled = false
    void api<RunToolDetail>(
      buildRunsPath(
        projectPath,
        `/${encodeURIComponent(runId)}/tools/${encodeURIComponent(tool.toolCallId)}`,
      ),
    )
      .then((value) => {
        if (!cancelled) {
          setDetail(current => current && current.updatedRevision > value.updatedRevision ? current : value)
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [
    projectPath,
    runId,
    tool.toolCallId,
    tool.updatedRevision,
    open,
    connectionVersion,
    retry,
  ])
  const label
    = tool.status === 'running'
      ? '执行中'
      : tool.status === 'failed'
        ? '失败'
        : tool.status === 'interrupted'
          ? '未确认结束'
          : '完成'
  const statusClass = tool.toolName === 'bash' && tool.status !== 'running'
    ? tool.commandExitCode == null ? styles.muted : tool.commandExitCode !== 0 ? styles.failed : styles.succeeded
    : styles[tool.status]
  return (
    <section className={styles.step}>
      <button
        className={styles.stepHead}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.stepLabel} title={commandLabel}>
          {tool.sequence}
          .
          {commandLabel ?? tool.toolName}
        </span>
        <span className={`${styles.stepStatus} ${statusClass}`}>{tool.toolName === 'bash' && tool.status !== 'running' ? tool.commandExitCode == null ? '退出码未知' : `退出 ${tool.commandExitCode}` : label}</span>
        <small>{formatDuration(tool.status === 'running' && tool.startedAt ? Math.max(0, now - Date.parse(tool.startedAt)) : tool.durationMs)}</small>
      </button>
      {open
        ? (
            <div className={styles.stepBody}>
              {tool.incomplete
                ? (
                    <p className={styles.warning}>
                      步骤记录不完整，缺少开始或结束事实。
                    </p>
                  )
                : null}
              {tool.evidenceIncomplete
                ? (
                    <p className={styles.warning}>部分证据预览不可用。</p>
                  )
                : null}
              {error
                ? (
                    <p className={styles.error}>
                      {error}
                      <button
                        type="button"
                        onClick={() => {
                          setError(null)
                          setRetry(value => value + 1)
                        }}
                      >
                        重试
                      </button>
                    </p>
                  )
                : detail && detail.updatedRevision >= tool.updatedRevision
                  ? (
                      <>
                        {tool.toolName === 'bash'
                          ? (
                              <p className={styles.muted}>
                                工具状态：
                                {label}
                                {' '}
                                ·
                                {detail.command?.exitCodeSource === 'pi-structured-result' ? `原生退出码 ${detail.command.exitCode}` : '未记录到原生退出码'}
                              </p>
                            )
                          : null}
                        {detail.command
                          ? (
                              <>
                                <h4>
                                  实际命令
                                  {detail.command.commandTruncated ? ' · 已截断' : ''}
                                </h4>
                                <pre>{detail.command.command ?? '缺少命令开始记录'}</pre>
                              </>
                            )
                          : null}
                        <h4>
                          输入
                          {detail.inputTruncated ? ' · 已截断' : ''}
                        </h4>
                        <pre>{detail.inputPreview || '无输入预览'}</pre>
                        <h4>
                          输出
                          {detail.outputTruncated ? ' · 已截断' : ''}
                        </h4>
                        <pre>
                          {detail.outputPreview
                            || (tool.status === 'running' ? '等待结束记录…' : '无文本输出')}
                        </pre>
                      </>
                    )
                  : (
                      <p>正在读取…</p>
                    )}
            </div>
          )
        : null}
    </section>
  )
}
