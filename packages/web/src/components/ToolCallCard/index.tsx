import type { ToolState } from '../../session/state'
import { useState } from 'react'
import { AccChevron } from '../../motion'
import ContentImage from '../ContentImage'
import { reviewOpenByDefault, toolKind, toolPath, toolTarget } from './kind'
import styles from './styles.module.css'

interface Props {
  call: { id: string, name: string, arguments?: Record<string, unknown> }
  state?: ToolState
}

export default function ToolCallCard({ call, state }: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState(false)
  const args = call.arguments ?? {}
  const rawSummary = toolTarget(args)
  const path = toolPath(args)
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
  const rawOutput = (source?.content ?? []).map(content => content.type === 'text' ? content.text : '').join('').trimEnd()
  const images = (source?.content ?? []).filter(content => content.type === 'image')
  const lines = rawOutput.split('\n')
  const truncated = lines.length > 60 && !expanded
  const output = truncated ? lines.slice(0, 60).join('\n') : rawOutput
  const status = state?.running ? 'running' : state?.isError ? 'error' : state?.result ? 'done' : 'pending'
  const expandable = Boolean(diff || rawOutput || images.length)
  const defaultOpen = reviewOpenByDefault(status === 'error' ? 'error' : 'done', Boolean(diff))
  const open = expandable && (userOpen ?? defaultOpen)
  const kind = toolKind(call.name)

  return (
    <article className={`${styles.tool} ${styles[status]} ${expandable ? 't-acc' : ''}`} data-open={expandable ? String(open) : undefined}>
      <div className={styles.headRow}>
        {expandable
          ? (
              <button
                type="button"
                className={`${styles.head} t-acc-head`}
                aria-expanded={open}
                aria-label={`${open ? '收起' : '展开'} ${kind}${rawSummary ? ` ${rawSummary}` : ''}`}
                onClick={() => setUserOpen(!(userOpen ?? defaultOpen))}
              >
                <AccChevron />
                <span className={styles.kind}>{kind}</span>
                {rawSummary ? <span className={styles.summary} title={rawSummary}>{rawSummary}</span> : null}
                {status === 'running' ? <span className={styles.live}>运行中</span> : null}
                {status === 'error' ? <span className={styles.fail}>失败</span> : null}
              </button>
            )
          : (
              <div className={`${styles.head} ${styles.static}`}>
                <span className={styles.kind}>{kind}</span>
                {rawSummary ? <span className={styles.summary} title={rawSummary}>{rawSummary}</span> : null}
                {status === 'running' ? <span className={styles.live}>运行中</span> : null}
                {status === 'error' ? <span className={styles.fail}>失败</span> : null}
              </div>
            )}
        {path
          ? (
              <button type="button" className={styles.action} onClick={() => void navigator.clipboard.writeText(path)}>
                复制路径
              </button>
            )
          : null}
      </div>

      {expandable
        ? (
            <div className="t-acc-panel">
              <div className={`t-acc-panel-inner ${styles.body}`}>
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
                  : null}
                {output
                  ? <pre className={styles.output}>{output}</pre>
                  : !diff && !images.length ? <div className={styles.none}>无输出</div> : null}
                {images.length
                  ? (
                      <div className={styles.images}>
                        {images.map((image, index) => (
                          // Tool result content is immutable; its index is stable.
                          // eslint-disable-next-line react/no-array-index-key
                          <ContentImage key={index} image={image} alt={`工具输出图片 ${index + 1}`} />
                        ))}
                      </div>
                    )
                  : null}
                {rawOutput
                  ? (
                      <div className={styles.actions}>
                        {lines.length > 60
                          ? (
                              <button type="button" className={styles.action} onClick={() => setExpanded(value => !value)}>
                                {expanded ? '收起' : `展开全部（共 ${lines.length} 行）`}
                              </button>
                            )
                          : null}
                        <button type="button" className={styles.action} onClick={() => void navigator.clipboard.writeText(rawOutput)}>
                          复制输出
                        </button>
                      </div>
                    )
                  : null}
              </div>
            </div>
          )
        : null}
    </article>
  )
}
