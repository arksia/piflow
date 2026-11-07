import type { RunSummary } from '@piflow/protocol'

export function formatDuration(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms))
    return '耗时未知'
  if (ms < 1000)
    return `${Math.round(ms)} ms`
  const seconds = Math.floor(ms / 1000)
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} m ${seconds % 60} s`
}
export function runEnd(run: RunSummary, now: number) {
  return run.completedAt
    ? Date.parse(run.completedAt)
    : run.status === 'running'
      ? now
      : Date.parse(run.lastObservedAt)
}
export function runOrder(a: RunSummary, b: RunSummary) {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}
export function timelineRange(runs: RunSummary[], now: number) {
  const starts = runs
    .map(run => Date.parse(run.createdAt))
    .filter(Number.isFinite)
  const ends = runs.map(run => runEnd(run, now)).filter(Number.isFinite)
  const start = starts.length ? Math.min(...starts) : now
  const end = ends.length ? Math.max(start + 1000, ...ends) : start + 1000
  return { start, end }
}

/** Keep each execution distinct; overlapping calls occupy separate tracks. */
export function runLanes(runs: RunSummary[], now: number) {
  const lanes = new Map<string, { id: string, name: string, owner: string, tracks: RunSummary[][] }>()
  for (const run of [...runs].sort((a, b) => -runOrder(a, b))) {
    const id = `${run.orchestratorId}:${run.roleId}`
    let lane = lanes.get(id)
    if (!lane) {
      lane = { id, name: run.roleName, owner: run.orchestratorName, tracks: [] }
      lanes.set(id, lane)
    }
    const start = Date.parse(run.createdAt)
    let track = lane.tracks.find(track => runEnd(track.at(-1)!, now) <= start)
    if (!track) {
      track = []
      lane.tracks.push(track)
    }
    track.push(run)
  }
  return [...lanes.values()]
}
