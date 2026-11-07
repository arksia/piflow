import type {
  RunMessage,
  RunOutputChunk,
  RunSummary,
  RunToolSummary,
} from '@piflow/protocol'

export function mergeRuns(
  current: Record<string, RunSummary>,
  incoming: readonly RunSummary[],
) {
  let next = current
  for (const run of incoming) {
    if ((next[run.id]?.revision ?? -1) >= run.revision)
      continue
    if (next === current)
      next = { ...current }
    next[run.id] = run
  }
  return next
}
export function mergeTools(
  current: Record<string, RunToolSummary>,
  incoming: readonly RunToolSummary[],
) {
  let next = current
  for (const tool of incoming) {
    if ((next[tool.toolCallId]?.updatedRevision ?? -1) >= tool.updatedRevision)
      continue
    if (next === current)
      next = { ...current }
    next[tool.toolCallId] = tool
  }
  return next
}
export function mergeOutput(
  current: RunOutputChunk | null,
  incoming: RunOutputChunk,
): RunOutputChunk {
  if (current && incoming.revision < current.revision)
    return current
  if (incoming.reset || !current)
    return { ...incoming, reset: false }
  if (
    current.version !== incoming.version
    || current.endOffset !== incoming.baseOffset
  ) {
    throw new Error('输出游标已失效，请重新同步')
  }
  let text = current.text + incoming.text
  if (text.length > 160000)
    text = text.slice(-160000)
  if (/[\uDC00-\uDFFF]/.test(text[0] ?? ''))
    text = text.slice(1)
  return {
    ...incoming,
    text,
    baseOffset: incoming.endOffset - text.length,
    truncated:
      incoming.truncated
      || current.truncated
      || text.length < current.text.length + incoming.text.length,
  }
}
export type RunUpdate = Extract<
  RunMessage,
  {
    type: 'run_updated'
  }
>
