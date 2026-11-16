import type { SessionStatus, SessionStatusRecord } from '@piflow/protocol'

export function sessionStatusFor(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
): SessionStatus {
  return statuses[sessionPath]?.status ?? 'idle'
}

export function sessionNeedsInputFor(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
): boolean {
  return Boolean(statuses[sessionPath]?.needsInputAt)
}

export type SessionAttentionKind = 'needs_input' | 'failed' | 'running' | 'unread'

export function sessionAttention(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
  unread?: ReadonlySet<string>,
): { kind: SessionAttentionKind, label: string } | null {
  const status = statuses[sessionPath]
  if (status?.needsInputAt)
    return { kind: 'needs_input', label: '待回答' }
  if (status?.status === 'failed')
    return { kind: 'failed', label: '失败' }
  if (status?.status === 'running')
    return { kind: 'running', label: '运行中' }
  if (unread?.has(sessionPath))
    return { kind: 'unread', label: '已完成' }
  return null
}

export function sessionRailStatus(
  sessionPath: string,
  statuses: Record<string, SessionStatusRecord>,
  unread?: ReadonlySet<string>,
  seenFailures?: Readonly<Record<string, string>>,
): 'working' | 'done' | 'error' | 'needs_input' | null {
  const attention = sessionAttention(sessionPath, statuses, unread)
  if (attention?.kind === 'needs_input')
    return 'needs_input'
  if (attention?.kind === 'failed')
    return seenFailures?.[sessionPath] === statuses[sessionPath]?.updatedAt ? null : 'error'
  if (attention?.kind === 'running')
    return 'working'
  if (attention?.kind === 'unread')
    return 'done'
  return null
}
