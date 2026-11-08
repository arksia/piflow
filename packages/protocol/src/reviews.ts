/** Fixed source comparisons and human review. Run execution evidence stays in Runs. */
export interface ReviewDocument {
  id: string
  path: string
  anchor: string
  title: string
  kind: 'requirement' | 'design' | 'adr'
  stableAnchor: boolean
  digest: string
  startLine: number
}
export interface ReviewHunk {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}
export interface ReviewTarget {
  id: string
  fileId: string
  name: string
  kind: 'function' | 'file'
  oldStart?: number
  oldEnd?: number
  newStart?: number
  newEnd?: number
  hunkIds: string[]
}
export type ReviewChangeKind = 'added' | 'modified' | 'deleted' | 'unmatched'
export type ReviewFileCategory = 'implementation' | 'test' | 'other'
export interface ReviewSymbolChange {
  name: string
  kind: 'function' | 'method' | 'callback' | 'test'
  change: ReviewChangeKind
  hunkIds: string[]
  targetIds: string[]
}
export interface ReviewFileStatistics {
  addedHunkIds: string[]
  removedHunkIds: string[]
  functionState: 'complete' | 'unavailable' | 'not-applicable'
  testState: 'complete' | 'partial' | 'unavailable' | 'not-applicable'
  changes: ReviewSymbolChange[]
  notes: string[]
}
/** Classification is a path convention, not proof that a file contains tests. */
export function reviewFileCategory(path: string): ReviewFileCategory {
  if (/(?:^|\/)(?:__tests__|tests?|__mocks__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_(?:test|spec)\.(?:py|go|rb)$|(?:Test|Tests)\.(?:java|cs)$/i.test(path))
    return 'test'
  return /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|html?|py|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|cs|rb|php|sh|sql)$/i.test(path) ? 'implementation' : 'other'
}
export interface ReviewFile {
  id: string
  path: string
  status: 'added' | 'deleted' | 'modified'
  beforeDigest?: string
  afterDigest?: string
  added: number
  removed: number
  hunkIds: string[]
  targetIds: string[]
  languageSupported: boolean
  /** Absent on historical revisions. Never derive exact counts from review targets. */
  statistics?: ReviewFileStatistics
}
export interface ReviewGap {
  id: string
  kind: string
  path?: string
  explanation: string
  source: 'host' | 'agent'
}
export interface ReviewRouteStep {
  key: string
  title: string
  purpose: string
  requirementIds: string[]
  designSectionIds: string[]
  adrIds: string[]
  targets: { targetId: string, reason: string, reviewFocus: string }[]
  evidenceIds: string[]
}
export interface ReviewRoute {
  schemaVersion: 1
  revisionToken: string
  summary: string
  steps: ReviewRouteStep[]
  relations: { from: string, to: string, kind: 'review-order' | 'http' | 'event' | 'data-dependency', explanation: string }[]
  gaps: { kind: string, referenceIds: string[], explanation: string }[]
}
export interface ReviewDecision {
  targetId: string
  state: 'unread' | 'seen' | 'changes-requested' | 'skipped'
  note: string
  updatedAt: string
}
export interface ReviewEvidence {
  id: string
  runId: string
  toolCallId: string
  name: string
  exitCode: number | null
  sourceVersion: 'unknown'
}
export interface ReviewSummary {
  id: string
  projectPath: string
  title: string
  revisionId: string
  version: number
  runIds: string[]
  createdAt: string
  updatedAt: string
}
export interface ReviewRevisionSummary {
  id: string
  createdAt: string
  sourceRunId?: string
  fileCount: number
  comparison?: { base: ReviewSourceVersion, target: ReviewSourceVersion }
}
export interface ReviewSourceVersion {
  kind: 'commit' | 'workspace'
  head: string | null
  capturedAt: string
}
export interface ReviewDetail {
  review: ReviewSummary
  revision: ReviewRevisionSummary
  revisions: ReviewRevisionSummary[]
  files: ReviewFile[]
  targets: ReviewTarget[]
  documents: ReviewDocument[]
  evidence: ReviewEvidence[]
  gaps: ReviewGap[]
  route: { version: number, source: 'agent' | 'user', value: ReviewRoute } | null
  decisions: ReviewDecision[]
  exclusions?: { hunkId: string, reason: string }[]
  unassignedHunkIds: string[]
  generation: { state: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted', runId?: string, error?: string }
}
export interface ReviewFileDetail {
  reviewId: string
  revisionId: string
  file: ReviewFile
  hunks: ReviewHunk[]
  before: string | null
  after: string | null
}
export interface ReviewDocumentDetail {
  revisionId: string
  document: ReviewDocument
  text: string
}
export interface ReviewContextRequest {
  kind: 'catalog' | 'source' | 'document' | 'evidence'
  id?: string
  cursor?: string
}
export interface ReviewAnalysisContext {
  reviewId: string
  revisionId: string
  revisionToken: string
  documents: ReviewDocument[]
  files: ReviewFile[]
  targets: ReviewTarget[]
  evidence: ReviewEvidence[]
  gaps: ReviewGap[]
}
export interface ReviewMessage { type: 'review_updated', projectPath: string, reviewId: string, revisionId: string, version: number }
export const API_REVIEWS_PATH = '/api/reviews'
export function buildReviewsPath(projectPath: string, suffix = '', query: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ projectPath })
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined)
      params.set(key, value)
  }
  return `${API_REVIEWS_PATH}${suffix}?${params}`
}
