import type { ToolState } from '../../session/types'
import { useState } from 'react'
import styles from './styles.module.css'

interface Props {
  call: { id: string, name: string, arguments?: Record<string, unknown> }
  state?: ToolState
}

export default function ToolCallCard({ call, state }: Props) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const args = call.arguments ?? {}
  const value = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? ''
  const rawSummary = String(value)
  const summary = rawSummary.length > 72 ? `${rawSummary.slice(0, 72)}…` : rawSummary
  const details = state?.result?.details
  const diffText = typeof details?.diff === 'string'
    ? details.diff
    : typeof details?.patch === 'string'
      ? details.patch
      : null
  const seenLines = new Map<string, number>()
  const diff = diffText?.split('\n').map((line) => {
    const occurrence = (seenLines.get(line) ?? 0) + 1
    seenLines.set(line, occurrence)
    return {
      key: `${line}:${occurrence}`,
      line,
      className: line.startsWith('+') && !line.startsWith('+++')
        ? styles.add
        : line.startsWith('-') && !line.startsWith('---')
          ? styles.delete
          : line.startsWith('@@')
            ? styles.hunk
            : '',
    }
  })
  const source = state?.partial ?? state?.result
  const rawOutput = (source?.content ?? []).map(content => content.text ?? '').join('').trimEnd()
  const lines = rawOutput.split('\n')
  const truncated = lines.length > 60 && !expanded
  const output = truncated ? lines.slice(0, 60).join('\n') : rawOutput
  const status = state?.running ? 'running' : state?.isError ? 'error' : state?.result ? 'done' : 'pending'

  function copyOutput() {
    void navigator.clipboard.writeText(rawOutput)
  }

  return (
    <div className={`${styles.tool} ${styles[status]}`}>
      <button className={styles.head} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`}>›</span>
        <span className={styles.name}>{call.name}</span>
        <span className={styles.summary} title={rawSummary}>{summary}</span>
        {status === 'running' ? <span className={styles.signal} title="运行中" /> : null}
        {status === 'error' ? <span className={styles.error}>失败</span> : null}
      </button>

      {open
        ? (
            <div className={styles.body}>
              {diff
                ? (
                    <div className={styles.diff}>
                      {diff.map(item => (
                        <div key={item.key} className={`${styles.diffLine} ${item.className}`}>
                          {item.line}
                        </div>
                      ))}
                    </div>
                  )
                : output
                  ? (
                      <>
                        <pre className={styles.output}>{output}</pre>
                        <div className={styles.actions}>
                          {lines.length > 60
                            ? (
                                <button className={styles.action} onClick={() => setExpanded(value => !value)}>
                                  {expanded ? '收起' : `展开全部（共 ${lines.length} 行）`}
                                </button>
                              )
                            : null}
                          <button className={styles.action} onClick={copyOutput}>复制</button>
                        </div>
                      </>
                    )
                  : <div className={styles.none}>无输出</div>}
            </div>
          )
        : null}
    </div>
  )
}
