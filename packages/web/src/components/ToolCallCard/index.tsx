import type { ToolState } from '../../session/state'
import { FilePen, FileText, Folder, Pencil, Search, Terminal, Wrench } from 'lucide-react'
import { useState } from 'react'
import { AccChevron } from '../../motion'
import ContentImage from '../ContentImage'
import { reviewOpenByDefault, toolKind, toolPath, toolTarget } from './kind'
import styles from './styles.module.css'

interface Props {
  call: { id: string, name: string, arguments?: Record<string, unknown> }
  state?: ToolState
  /** Row inside a run group. Diff stays one click away; failures still open. */
  plain?: boolean
}

export default function ToolCallCard({ call, state, plain = false }: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState(false)
  const args = call.arguments ?? argumentsOf(state?.args)
  const rawSummary = toolTarget(args)
  const path = toolPath(args)
  const details = argumentsOf(state?.result?.details)
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
  const defaultOpen = reviewOpenByDefault(status === 'error' ? 'error' : 'done', !plain && Boolean(diff))
  const open = expandable && (userOpen ?? defaultOpen)
  const kind = toolKind(call.name)
  const took = state?.durationMs != null ? formatDuration(state.durationMs) : null
  const nested = state?.children ?? []

  return (
    <article className={`${styles.tool} ${styles[status]} ${plain ? styles.plain : ''} ${expandable ? 't-acc t-acc-fold' : ''}`} data-open={expandable ? String(open) : undefined}>
      <div className={`${styles.headRow} pf-flex pf-items-center pf-gap-2`}>
        {expandable
          ? (
              <button
                type="button"
                className={`${styles.head} pf-flex pf-items-center pf-gap-2 pf-flex-1 pf-min-w-0 pf-text-left pf-rounded-control t-acc-head t-tool`}
                aria-expanded={open}
                aria-label={`${open ? '收起' : '展开'} ${kind}${rawSummary ? ` ${rawSummary}` : ''}`}
                onClick={() => setUserOpen(!(userOpen ?? defaultOpen))}
              >
                <ToolMark name={call.name} open={open} />
                <span className="pf-shrink-0 pf-text-mid">{kind}</span>
                {rawSummary ? <span className="pf-min-w-0 pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-font-mono" title={rawSummary}>{rawSummary}</span> : null}
                {took ? <span className="pf-shrink-0 pf-text-faint pf-[font-variant-numeric:tabular-nums]">{took}</span> : null}
                {status === 'running' ? <span className="pf-shrink-0 pf-ml-auto">运行中</span> : null}
                {status === 'error' ? <span className="pf-shrink-0 pf-ml-auto pf-text-danger">失败</span> : null}
              </button>
            )
          : (
              <div className={`${styles.head} pf-flex pf-items-center pf-gap-2 pf-flex-1 pf-min-w-0 pf-text-left pf-rounded-control ${styles.static}`}>
                <ToolMark name={call.name} open={null} />
                <span className="pf-shrink-0 pf-text-mid">{kind}</span>
                {rawSummary ? <span className="pf-min-w-0 pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-font-mono" title={rawSummary}>{rawSummary}</span> : null}
                {took ? <span className="pf-shrink-0 pf-text-faint pf-[font-variant-numeric:tabular-nums]">{took}</span> : null}
                {status === 'running' ? <span className="pf-shrink-0 pf-ml-auto">运行中</span> : null}
                {status === 'error' ? <span className="pf-shrink-0 pf-ml-auto pf-text-danger">失败</span> : null}
              </div>
            )}
        {path
          ? (
              <button type="button" className={`${styles.action} pf-shrink-0 pf-p-[0_4px] pf-rounded-control`} onClick={() => void navigator.clipboard.writeText(path)}>
                复制路径
              </button>
            )
          : null}
      </div>

      {nested.length
        ? (
            <div className={`${styles.nested} pf-grid pf-gap-[2px]`}>
              {nested.map(child => (
                <ToolCallCard
                  key={child.id}
                  plain
                  call={{ id: child.id, name: child.name ?? 'tool', arguments: argumentsOf(child.args) }}
                  state={child}
                />
              ))}
            </div>
          )
        : null}

      {expandable
        ? (
            <div className="t-acc-panel">
              <div className={`t-acc-panel-inner ${styles.body} pf-grid pf-gap-2 pf-text-[13px]`}>
                {diff
                  ? (
                      <div className={`${styles.diff} pf-max-h-[280px] pf-overflow-auto pf-p-[8px_0] pf-rounded-control pf-font-mono`}>
                        {diff.map(item => (
                          <div key={item.key} className={`${styles.diffLine} pf-p-[0_14px] pf-whitespace-pre-wrap pf-break-words ${item.className}`}>
                            {item.line}
                          </div>
                        ))}
                      </div>
                    )
                  : null}
                {output
                  ? <pre className={`${styles.output} pf-m-0 pf-max-h-[280px] pf-overflow-auto pf-p-[10px_14px] pf-rounded-control pf-text-body pf-font-mono pf-whitespace-pre-wrap pf-break-words`}>{output}</pre>
                  : !diff && !images.length ? <div className="pf-text-faint">无输出</div> : null}
                {images.length
                  ? (
                      <div className="pf-grid pf-gap-2">
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
                      <div className="pf-flex pf-gap-3">
                        {lines.length > 60
                          ? (
                              <button type="button" className={`${styles.action} pf-shrink-0 pf-p-[0_4px] pf-rounded-control`} onClick={() => setExpanded(value => !value)}>
                                {expanded ? '收起' : `展开全部（共 ${lines.length} 行）`}
                              </button>
                            )
                          : null}
                        <button type="button" className={`${styles.action} pf-shrink-0 pf-p-[0_4px] pf-rounded-control`} onClick={() => void navigator.clipboard.writeText(rawOutput)}>
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

function ToolMark({ name, open }: { name: string, open: boolean | null }) {
  const glyph = <ToolGlyph name={name} />
  if (open === null)
    return <span className={`${styles.slot} pf-w-[13px] pf-h-[13px] pf-text-faint`}>{glyph}</span>
  return (
    <span className={`t-icon-swap ${styles.slot} pf-w-[13px] pf-h-[13px] pf-text-faint`} data-state={open ? 'b' : 'a'}>
      <span className="t-icon" data-icon="a">{glyph}</span>
      <span className="t-icon" data-icon="b"><AccChevron /></span>
    </span>
  )
}

const TOOL_ICONS: Record<string, typeof FileText> = {
  read: FileText,
  write: FilePen,
  edit: Pencil,
  bash: Terminal,
  ls: Folder,
  grep: Search,
  find: Search,
  glob: Search,
}

function ToolGlyph({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name] ?? Wrench
  return <Icon size={13} aria-hidden="true" />
}

function argumentsOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function formatDuration(ms: number) {
  if (ms < 1000)
    return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60)
    return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
