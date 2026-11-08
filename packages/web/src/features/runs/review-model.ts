import type { ReviewDetail, ReviewHunk, ReviewRouteStep } from '@piflow/protocol'

export const decisionLabels = { 'unread': '待审', 'seen': '已看', 'changes-requested': '需修改', 'skipped': '已略过' }
export function reviewGroups(detail: ReviewDetail, mode: 'files' | 'flow') {
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
  return groups
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
