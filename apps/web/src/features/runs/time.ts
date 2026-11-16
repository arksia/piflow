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

export interface TimelineViewport { start: number, end: number, width: number }

export function runPlacement(run: RunSummary, now: number, viewport: TimelineViewport) {
  const scale = viewport.width / (viewport.end - viewport.start)
  const start = Math.max(viewport.start, Date.parse(run.createdAt))
  const end = Math.min(viewport.end, Math.max(start, runEnd(run, now)))
  const actualWidth = Math.max(0, (end - start) * scale)
  const width = Math.min(viewport.width, Math.max(18, actualWidth))
  return {
    left: Math.max(0, Math.min(viewport.width - width, (start - viewport.start) * scale)),
    width,
    marker: actualWidth < 18,
  }
}

export function timelineTicks(start: number, end: number, width: number) {
  const count = Math.max(2, Math.floor(width / 110))
  const target = (end - start) / count
  const steps = [1000, 5000, 10000, 30000, 60000, 300000, 600000, 1800000, 3600000, 10800000, 21600000, 43200000, 86400000]
  const step = steps.find(step => step >= target) ?? Math.ceil(target / 86400000) * 86400000
  const ticks: number[] = []
  for (let tick = Math.ceil(start / step) * step; tick < end; tick += step) {
    if ((tick - start) / (end - start) * width >= 28 && (end - tick) / (end - start) * width >= 28)
      ticks.push(tick)
  }
  return ticks
}

/** Pack hit targets too: temporally disjoint short calls can still collide on screen. */
export function runLanes(runs: RunSummary[], now: number, viewport?: TimelineViewport) {
  const lanes = new Map<string, { id: string, name: string, owner: string, tracks: RunSummary[][] }>()
  for (const run of [...runs].sort((a, b) => -runOrder(a, b))) {
    const id = `${run.orchestratorId}:${run.roleId}`
    let lane = lanes.get(id)
    if (!lane) {
      lane = { id, name: run.roleName, owner: run.orchestratorName, tracks: [] }
      lanes.set(id, lane)
    }
    const start = Date.parse(run.createdAt)
    let track = lane.tracks.find((track) => {
      const previous = track.at(-1)!
      if (!viewport)
        return runEnd(previous, now) <= start
      const before = runPlacement(previous, now, viewport)
      const after = runPlacement(run, now, viewport)
      return before.left + before.width + 4 <= after.left
    })
    if (!track) {
      track = []
      lane.tracks.push(track)
    }
    track.push(run)
  }
  return [...lanes.values()].sort((a, b) => a.id.localeCompare(b.id))
}
