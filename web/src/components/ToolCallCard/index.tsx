import type { ToolState } from '../../ws'
import { useState } from 'react'
import styles from './styles.module.css'

interface Props {
  call: { id: string, name: string, arguments?: Record<string, unknown> }
  state?: ToolState
}

export default function ToolCallCard({ call, state }: Props) {
  const [open, setOpen] = useState(false)
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
  const output = lines.length > 60 ? `${lines.slice(0, 60).join('\n')}\n… 共 ${lines.length} 行` : rawOutput
  const status = state?.running ? 'running' : state?.isError ? 'error' : state?.result ? 'done' : 'pending'

  return (
    <div className={`${styles.tool} ${styles[status]} recede`}>
      <button className={styles.head} onClick={() => setOpen(value => !value)}>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`}>›</span>
        <span className={styles.name}>{call.name}</span>
        <span className={styles.summary}>{summary}</span>
        {status === 'running' ? <span className={styles.signal} /> : null}
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
                  ? <pre className={styles.output}>{output}</pre>
                  : <div className={styles.none}>无输出</div>}
            </div>
          )
        : null}
    </div>
  )
}
