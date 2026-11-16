import type { ReviewChangeKind, ReviewDetail, ReviewFileCategory, ReviewHunk, ReviewRouteStep } from '@piflow/protocol'
import { reviewFileCategory } from '@piflow/protocol'

export const decisionLabels = { 'unread': '待审', 'seen': '已看', 'changes-requested': '需修改', 'skipped': '已略过' }
export function reviewGroups(detail: ReviewDetail, mode: 'files' | 'flow', filter?: ReviewStatisticsFilter) {
  const assigned = new Set(detail.route?.value.steps.flatMap(step => step.targets.map(t => t.targetId)) ?? [])
  const groups: { key: string, title: string, targetIds: string[], step?: ReviewRouteStep }[] = mode === 'flow' && detail.route
    ? detail.route.value.steps.map(step => ({ key: step.key, title: step.title, targetIds: [...new Set(step.targets.map(t => t.targetId))], step }))
    : detail.files.map(file => ({ key: file.id, title: file.path, targetIds: file.targetIds }))
  if (mode === 'flow' && detail.route) {
    const excluded = new Set(detail.exclusions?.map(e => e.hunkId) ?? [])
    const unassigned = detail.targets.filter(t => !assigned.has(t.id) && !t.hunkIds.every(id => excluded.has(id))).map(t => t.id)
    const excludedTargets = detail.targets.filter(t => t.hunkIds.every(id => excluded.has(id))).map(t => t.id)
    if (excludedTargets.length)
      groups.push({ key: 'excluded', title: '已排除 · 仍可查看', targetIds: excludedTargets })
    if (unassigned.length)
      groups.push({ key: 'unassigned', title: '未归类变更', targetIds: unassigned })
  }
  if (!filter)
    return groups
  const visible = new Set([...statisticsMatches(detail, filter).values()].flatMap(m => m.targetIds))
  return groups.map(g => ({ ...g, targetIds: g.targetIds.filter(id => visible.has(id)) })).filter(g => g.targetIds.length)
}
export function diffRows(hunks: ReviewHunk[]) {
  return hunks.flatMap((hunk) => {
    let old = hunk.oldStart
    let next = hunk.newStart
    return [
      { key: hunk.id, old: null, next: null, text: `@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, kind: 'hunk' },
      ...hunk.lines.map((line, index) => {
        const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : line[0] === '\\' ? 'marker' : 'context'
        const row = { key: `${hunk.id}:${index}`, old: kind === 'add' || kind === 'marker' ? null : old, next: kind === 'remove' || kind === 'marker' ? null : next, text: line, kind }
        if (kind === 'context' || kind === 'remove')
          old++
        if (kind === 'context' || kind === 'add')
          next++
        return row
      }),
    ]
  })
}

export interface ReviewStatisticsFilter {
  category: ReviewFileCategory
  metric: 'files' | 'added-lines' | 'removed-lines' | 'functions' | 'tests' | 'callbacks'
  change?: ReviewChangeKind
}
export const categoryLabels = { implementation: '实现代码', test: '测试代码', other: '其他文件' }
export const changeLabels = { added: '新增', modified: '修改', deleted: '删除', unmatched: '未配对' }
export function statisticsLabel(filter: ReviewStatisticsFilter) {
  const metric = { 'files': '文件', 'added-lines': '新增行', 'removed-lines': '删除行', 'functions': '函数/方法', 'tests': '用例声明', 'callbacks': '回调' }[filter.metric]
  return `${categoryLabels[filter.category]} · ${filter.change ? `${changeLabels[filter.change]} ` : ''}${metric}`
}
export function reviewStatistics(detail: ReviewDetail) {
  return (['implementation', 'test', 'other'] as const).map((category) => {
    const files = detail.files.filter(f => reviewFileCategory(f.path) === category)
    const changes = files.flatMap(f => f.statistics?.changes ?? [])
    return {
      category,
      fileCount: files.length,
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
      functions: changes.filter(c => c.kind === 'function' || c.kind === 'method'),
      tests: changes.filter(c => c.kind === 'test'),
      callbacks: changes.filter(c => c.kind === 'callback'),
      functionFiles: files.filter(f => f.statistics?.functionState === 'complete').length,
      testFiles: files.filter(f => f.statistics?.testState === 'complete' || f.statistics?.testState === 'partial').length,
      incompleteFunctions: files.some(f => !f.statistics || f.statistics.functionState === 'unavailable') || changes.some(c => (c.kind === 'function' || c.kind === 'method') && c.change === 'unmatched'),
      incompleteTests: files.some(f => !f.statistics || f.statistics.testState === 'unavailable' || f.statistics.testState === 'partial') || changes.some(c => c.kind === 'test' && c.change === 'unmatched'),
      notes: [...new Set(files.flatMap(f => f.statistics?.notes ?? ['历史修订未采集符号统计。']))],
    }
  }).filter(row => row.fileCount)
}
/** Counts stay revision-wide; filtering never changes decisions, routes or scope exclusions. */
export function statisticsMatches(detail: ReviewDetail, filter: ReviewStatisticsFilter) {
  const matches = new Map<string, { targetIds: string[], hunkIds: string[] }>()
  for (const file of detail.files) {
    if (reviewFileCategory(file.path) !== filter.category)
      continue
    let hunkIds = file.hunkIds
    let targetIds = file.targetIds
    if (filter.metric === 'added-lines' || filter.metric === 'removed-lines') {
      if (!(filter.metric === 'added-lines' ? file.added : file.removed))
        continue
      hunkIds = (filter.metric === 'added-lines' ? file.statistics?.addedHunkIds : file.statistics?.removedHunkIds) ?? file.hunkIds
      targetIds = targetIds.filter(id => detail.targets.some(t => t.id === id && t.hunkIds.some(h => hunkIds.includes(h))))
    }
    else if (filter.metric !== 'files') {
      const changes = file.statistics?.changes.filter(c => (filter.metric === 'functions' ? c.kind === 'function' || c.kind === 'method' : filter.metric === 'tests' ? c.kind === 'test' : c.kind === 'callback') && (!filter.change || c.change === filter.change)) ?? []
      hunkIds = [...new Set(changes.flatMap(c => c.hunkIds))]
      targetIds = [...new Set(changes.flatMap(c => c.targetIds))]
    }
    if (hunkIds.length)
      matches.set(file.id, { targetIds, hunkIds })
  }
  return matches
}
