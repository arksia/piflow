import type {
  RunDetail,
  RunMessage,
  RunPage,
  RunSummary,
  RunToolSummary,
} from '@piflow/protocol'
import { buildRunsPath } from '@piflow/protocol'
import { api } from '../../session/api'
import { mergeRuns, mergeTools } from './cache'

export interface RunFilter {
  orchestratorId?: string
  roleId?: string
}
interface RunWindow {
  ids: Set<string>
  cursors: (string | undefined)[]
  nextCursor: string | null
  loading: boolean
  initialized: boolean
  error: string | null
  generation: number
}
interface RunProject {
  projectPath: string
  runs: Record<string, RunSummary>
  tools: Record<string, Record<string, RunToolSummary>>
  errors: Record<string, string>
  windows: Map<string, RunWindow>
}
const projects = new Map<string, RunProject>()
const listeners = new Set<() => void>()
let version = 0
let activityVersion = 0
let connectionVersion = 0
let connected = false
function notify(activity = false) {
  version++
  if (activity)
    activityVersion++
  for (const listener of listeners) listener()
}
export function subscribeRuns(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const getRunsVersion = () => version
export const getActivityVersion = () => activityVersion
export function getRunsConnection() {
  return {
    connected,
    version: connectionVersion,
  }
}
export function runProject(projectPath: string): RunProject {
  let project = projects.get(projectPath)
  if (!project) {
    project = {
      projectPath,
      runs: {},
      tools: {},
      errors: {},
      windows: new Map(),
    }
    projects.set(projectPath, project)
  }
  return project
}
export function runWindow(
  projectPath: string,
  filter: RunFilter = {},
): RunWindow {
  const project = runProject(projectPath)
  const key = JSON.stringify(filter)
  let window = project.windows.get(key)
  if (!window) {
    window = {
      ids: new Set(),
      cursors: [undefined],
      nextCursor: null,
      loading: false,
      initialized: false,
      error: null,
      generation: 0,
    }
    project.windows.set(key, window)
  }
  return window
}
export function receiveRun(message: RunMessage) {
  const project = runProject(message.projectPath)
  if (message.type === 'run_recording_error') {
    project.errors = { ...project.errors, [message.runId]: message.error }
    notify()
    return
  }
  const previous = project.runs[message.run.id]
  project.runs = mergeRuns(project.runs, [message.run])
  if (message.changedTools?.length) {
    project.tools[message.run.id] = mergeTools(
      project.tools[message.run.id] ?? {},
      message.changedTools,
    )
  }
  for (const [key, window] of project.windows) {
    const filter = JSON.parse(key) as RunFilter
    if (
      (!filter.roleId || filter.roleId === message.run.roleId)
      && (!filter.orchestratorId
        || filter.orchestratorId === message.run.orchestratorId)
    ) {
      window.ids.add(message.run.id)
    }
  }
  notify(!previous || previous.status !== message.run.status)
}
export function acceptRunDetail(detail: RunDetail) {
  const project = runProject(detail.projectPath)
  const previous = project.runs[detail.id]
  project.runs = mergeRuns(project.runs, [detail])
  notify(!previous || previous.status !== detail.status)
}
export function acceptTools(
  projectPath: string,
  runId: string,
  tools: RunToolSummary[],
) {
  const project = runProject(projectPath)
  project.tools[runId] = mergeTools(project.tools[runId] ?? {}, tools)
  notify()
}
export async function loadRunWindow(
  projectPath: string,
  filter: RunFilter = {},
  more = false,
) {
  const project = runProject(projectPath)
  const window = runWindow(projectPath, filter)
  if (more && (!window.nextCursor || window.loading))
    return
  const generation = ++window.generation
  const cursors = more ? [window.nextCursor!] : window.cursors
  window.loading = true
  window.error = null
  notify()
  try {
    const pages = await Promise.all(
      cursors.map(cursor =>
        api<RunPage>(
          buildRunsPath(project.projectPath, '', { ...filter, cursor }),
        ),
      ),
    )
    if (generation !== window.generation)
      return
    const canonical = pages[0]!.projectPath
    const observed = projects.get(canonical)
    if (observed && observed !== project) {
      project.runs = mergeRuns(project.runs, Object.values(observed.runs))
      for (const [runId, tools] of Object.entries(observed.tools))
        project.tools[runId] = mergeTools(project.tools[runId] ?? {}, Object.values(tools))
      project.errors = { ...project.errors, ...observed.errors }
      for (const [key, existing] of observed.windows) {
        const target = project.windows.get(key)
        if (target) {
          for (const id of existing.ids) target.ids.add(id)
        }
        else {
          project.windows.set(key, existing)
        }
      }
      for (const [alias, value] of projects) {
        if (value === observed)
          projects.set(alias, project)
      }
    }
    projects.set(canonical, project)
    project.projectPath = canonical
    const incoming = pages.flatMap(page => [
      ...page.runs,
      ...page.activeRuns,
      ...page.latestRoleRuns,
    ])
    project.runs = mergeRuns(project.runs, incoming)
    for (const page of pages) {
      for (const run of [...page.runs, ...page.activeRuns])
        window.ids.add(run.id)
    }
    if (more)
      window.cursors.push(cursors[0])
    window.nextCursor = pages.at(-1)!.nextCursor
    window.initialized = true
  }
  catch (error) {
    if (generation === window.generation)
      window.error = String(error)
  }
  finally {
    if (generation === window.generation) {
      window.loading = false
      notify(true)
    }
  }
}
export function setRunsConnected(value: boolean) {
  connected = value
  connectionVersion++
  notify(true)
  if (!value)
    return
  for (const project of new Set(projects.values())) {
    const previouslyRunning = Object.values(project.runs).filter(
      run => run.status === 'running',
    )
    for (const key of project.windows.keys())
      void loadRunWindow(project.projectPath, JSON.parse(key) as RunFilter)
    // Old running rows can be outside a refreshed page after a long disconnection.
    for (const run of previouslyRunning) {
      void api<RunDetail>(
        buildRunsPath(project.projectPath, `/${encodeURIComponent(run.id)}`),
      )
        .then(acceptRunDetail)
        .catch((error: unknown) => {
          project.errors = {
            ...project.errors,
            [run.id]: `运行状态同步失败：${String(error)}`,
          }
          notify()
        })
    }
  }
}
