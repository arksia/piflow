import type { FlowPosition, FlowViewport } from '@piflow/protocol'

const PROJECT_KEY = 'piflow.flow-project'

export interface FlowViewState {
  teamId: string | null
  groups: Record<string, { positions: Record<string, FlowPosition>, viewport?: FlowViewport }>
}

const viewKey = (project: string) => `piflow.flow-view:1:${project}`

export function readFlowView(project: string): FlowViewState {
  try {
    const value = JSON.parse(localStorage.getItem(viewKey(project)) ?? 'null') as FlowViewState | null
    if (value && (value.teamId === null || typeof value.teamId === 'string') && value.groups && typeof value.groups === 'object') {
      const groups: FlowViewState['groups'] = {}
      for (const [id, group] of Object.entries(value.groups)) {
        if (!group || typeof group !== 'object' || !group.positions || typeof group.positions !== 'object')
          continue
        const positions = Object.fromEntries(Object.entries(group.positions).filter(([, p]) => p && Number.isFinite(p.x) && Number.isFinite(p.y)))
        const v = group.viewport
        groups[id] = { positions, ...(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom >= 0.2 && v.zoom <= 2 ? { viewport: v } : {}) }
      }
      return { teamId: value.teamId, groups }
    }
  }
  catch { /* A view preference cannot prevent opening the project. */ }
  return { teamId: null, groups: {} }
}

export function saveFlowView(project: string, view: FlowViewState) {
  try {
    localStorage.setItem(viewKey(project), JSON.stringify(view))
  }
  catch { /* Continue with the in-memory view if storage is unavailable. */ }
}

export function readFlowProject(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ''
  }
  catch {
    return ''
  }
}

export function saveFlowProject(path: string): string {
  if (path)
    localStorage.setItem(PROJECT_KEY, path)
  return path
}
