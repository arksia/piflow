export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface RunConfiguration {
  roleName: string
  effectivePrompt: string
  model: string
  thinkingLevel: string
  tools: string[]
  cwd: string
  memberRoleIds: string[]
  delivery?: { kind: 'code', version: 1 }
  reviewId?: string
  reviewAnalysis?: { reviewId: string, revisionId: string, bundlePath: string }
}
export interface RunInput {
  projectPath: string
  orchestratorId: string
  orchestratorName: string
  roleId: string
  roleName: string
  parentSessionPath: string
  parentToolCallId: string
  task: string
  configurationSnapshot: RunConfiguration
}
export interface RunSummary {
  id: string
  projectPath: string
  orchestratorId: string
  orchestratorName: string
  roleId: string
  roleName: string
  parentSessionPath: string
  parentToolCallId: string
  taskPreview: string
  status: RunStatus
  createdAt: string
  lastObservedAt: string
  completedAt?: string
  interruptedAt?: string
  durationMs?: number
  progress?: { phase: 'thinking' | 'responding' | 'tool' | 'collecting', toolName?: string }
  toolCount: number
  failedToolCount: number
  revision: number
  outputRevision: number
  deliveryKind?: 'code'
  deliveryRevision?: number
}
export interface RunDetail extends RunSummary {
  task: string
  configurationSnapshot: RunConfiguration
  error?: string
  recordingError?: string
  historyAvailability: 'recorded' | 'legacy'
  diagnostics: string[]
  processExit?: RunProcessExit
}
export interface RunProcessExit {
  closedAt: string
  exitCode: number | null
  signal: string | null
}
export interface RunCommandEvidence {
  command: string | null
  commandTruncated: boolean
  exitCode: number | null
  exitCodeSource: 'pi-structured-result' | 'unavailable'
}
export interface RunToolSummary {
  toolCallId: string
  sequence: number
  updatedRevision: number
  toolName: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  incomplete: boolean
  evidenceIncomplete: boolean
  hasCommandEvidence?: boolean
  commandExitCode?: number | null
}
export interface RunToolDetail extends RunToolSummary {
  inputPreview: string
  outputPreview: string
  inputTruncated: boolean
  outputTruncated: boolean
  command?: RunCommandEvidence
  deliveryDeclaration?: CodeDeliveryDeclaration
  reviewRoute?: import('./reviews').ReviewRoute
}
export interface RunCommandSummary extends RunToolSummary {
  commandPreview: string | null
  commandTruncated: boolean
}
export interface RunCommandCounts {
  total: number
  nonzero: number
  unknown: number
}
export interface RunCommandsPage {
  commands: RunCommandSummary[]
  counts: RunCommandCounts
  nextCursor: string | null
  revision: number
}
export interface RunQuery {
  projectPath: string
  orchestratorId?: string
  roleId?: string
  cursor?: string
}
export interface RunPage {
  projectPath: string
  runs: RunSummary[]
  activeRuns: RunSummary[]
  latestRoleRuns: RunSummary[]
  nextCursor: string | null
}
export interface RunToolsQuery {
  projectPath: string
  runId: string
  cursor?: string
}
export interface RunToolsPage {
  tools: RunToolSummary[]
  activeTools: RunToolSummary[]
  nextCursor: string | null
  revision: number
}
export interface RunOutputQuery {
  projectPath: string
  runId: string
  version?: number
  after?: number
}
export interface RunOutputChunk {
  text: string
  reset: boolean
  version: number
  baseOffset: number
  endOffset: number
  truncated: boolean
  revision: number
}
export interface RunResult {
  runId: string
  status: Exclude<RunStatus, 'running'>
  output: string
  error?: string
  recordingError?: string
  delivery?: RunDeliverySummary
}
export type RunMessage = {
  type: 'run_updated'
  projectPath: string
  run: RunSummary
  changedTools?: RunToolSummary[]
} | {
  type: 'run_recording_error'
  projectPath: string
  runId: string
  error: string
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
}
export const API_RUNS_PATH = '/api/runs'
export function buildRunsPath(projectPath: string, suffix = '', query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ projectPath })
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined)
      params.set(key, String(value))
  }
  return `${API_RUNS_PATH}${suffix}?${params}`
}

export interface CodeDeliveryDeclaration {
  outcome: 'completed' | 'partial' | 'blocked'
  summary: string
  changes: string[]
  artifacts: { path: string, description: string }[]
  checks: { name: string, claimedStatus: 'passed' | 'failed' | 'not-run' | 'unknown', toolCallIds: string[], note: string }[]
  unresolved: string[]
}
export type GitWorkspaceSnapshot = {
  state: 'pending' | 'unavailable' | 'not-captured'
  reason?: string
} | {
  state: 'recorded'
  startedAt: string
  capturedAt: string
  root: string
  head: string | null
  branch: string | null
  files: { path: string, originalPath?: string, index: string, worktree: string }[]
  filesTruncated: boolean
  stagedStat: string
  unstagedStat: string
  stagedStatTruncated: boolean
  unstagedStatTruncated: boolean
}
export interface RunDeliveryRecord {
  runId: string
  projectPath: string
  revision: number
  declaration?: {
    value: CodeDeliveryDeclaration
    toolCallId: string
    submittedAt: string
    sequence: number
    subsequentToolActivity: boolean
  }
  lastDeclarationError?: string
  before: GitWorkspaceSnapshot
  after: GitWorkspaceSnapshot
  concurrentRunIds: string[]
  concurrentRunIdsTruncated?: boolean
}
export interface RunCheckReference {
  toolCallId: string
  linked: boolean
  exitCode: number | null
  status?: RunToolSummary['status']
}
export interface RunDeliveryDetail {
  availability: 'recorded' | 'not-requested' | 'not-captured'
  runId: string
  projectPath: string
  revision: number
  record?: RunDeliveryRecord
  commands: RunCommandCounts
  checkReferences: RunCheckReference[]
  processExit?: RunProcessExit
}
export interface RunDeliverySummary {
  declaration: 'submitted' | 'missing'
  outcome?: CodeDeliveryDeclaration['outcome']
  summary?: string
  commands: RunCommandCounts
  unresolved: string[]
  unresolvedCount: number
  unresolvedTruncated: boolean
  before: GitWorkspaceSnapshot['state']
  after: GitWorkspaceSnapshot['state']
  warnings: string[]
}
