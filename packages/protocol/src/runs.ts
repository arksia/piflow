export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface RunConfiguration {
  roleName: string
  effectivePrompt: string
  model: string
  thinkingLevel: string
  tools: string[]
  cwd: string
  memberRoleIds: string[]
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
  progress?: { phase: 'thinking' | 'responding' | 'tool', toolName?: string }
  toolCount: number
  failedToolCount: number
  revision: number
  outputRevision: number
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
