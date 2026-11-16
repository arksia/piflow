import type { RunSummary } from './runs.ts'

export type EvidenceTarget
  = | { kind: 'run', runId: string, tab?: 'delivery' | 'steps' | 'output' }
    | { kind: 'review', reviewId: string, revisionId: string, targetId?: string, minimumVersion: number }

export interface FlowActivityCounts {
  running: number
  latestFailures: number
  cancelled: number
  pendingReviews: number
  unreadTargets: number
  changesRequested: number
  inProgressReviews: number
  unavailableReviews: number
  uncoveredChanges: number
}
export type FlowActivityKind = 'running' | 'latest-failure' | 'cancelled' | 'pending-review' | 'changes-requested' | 'in-progress-review' | 'unavailable-review' | 'evidence-gap'
export const FLOW_ACTIVITY_KINDS: readonly FlowActivityKind[] = ['running', 'latest-failure', 'cancelled', 'pending-review', 'changes-requested', 'in-progress-review', 'unavailable-review', 'evidence-gap']
export interface FlowActivityItem {
  id: string
  kind: FlowActivityKind
  orchestratorId: string | null
  roleId?: string
  purpose?: RunSummary['purpose']
  title: string
  description: string
  updatedAt: string
  count: number
  target: EvidenceTarget
}
export interface FlowActivityGroup {
  orchestratorId: string | null
  counts: FlowActivityCounts
  roles: { roleId: string, purpose: NonNullable<RunSummary['purpose']>, running: number }[]
}
export interface FlowActivityPage {
  projectPath: string
  observedAt: string
  totals: FlowActivityCounts
  groups: FlowActivityGroup[]
  items: FlowActivityItem[]
  nextCursor: string | null
}
export interface FlowActivityQuery {
  projectPath: string
  /** 'unassigned' selects deliveries without a current source Run. */
  orchestratorId?: string
  kind?: FlowActivityKind
  cursor?: string
}
export const API_FLOW_ACTIVITY_PATH = '/api/flow/activity'
export function buildFlowActivityPath(query: FlowActivityQuery) {
  const params = new URLSearchParams({ projectPath: query.projectPath })
  for (const key of ['orchestratorId', 'kind', 'cursor'] as const) {
    if (query[key] !== undefined)
      params.set(key, query[key])
  }
  return `${API_FLOW_ACTIVITY_PATH}?${params}`
}
