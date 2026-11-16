import type { FlowActivityCounts, FlowActivityGroup, FlowActivityItem, FlowActivityKind, FlowActivityPage, FlowActivityQuery, RunSummary } from '@piflow/protocol'
import type { Reviews } from '../reviews/index.ts'
import type { SubagentRuns } from '../runs/index.ts'
import { Buffer } from 'node:buffer'
import { FLOW_ACTIVITY_KINDS } from '@piflow/protocol'
import { RunError } from '../runs/index.ts'

function empty(): FlowActivityCounts {
  return { running: 0, latestFailures: 0, cancelled: 0, pendingReviews: 0, unreadTargets: 0, changesRequested: 0, inProgressReviews: 0, unavailableReviews: 0, uncoveredChanges: 0 }
}

/** One read-only observation across Runs and Reviews, not a cross-database transaction. */
export async function readFlowActivity(query: FlowActivityQuery, runs: Pick<SubagentRuns, 'activity'>, reviews?: Pick<Reviews, 'attention'>): Promise<FlowActivityPage> {
  if (query.kind && !FLOW_ACTIVITY_KINDS.includes(query.kind))
    throw new RunError('关注分类无效')
  const scope = JSON.stringify([query.projectPath, query.orchestratorId ?? '', query.kind ?? ''])
  let after: [string, string] | undefined
  if (query.cursor) {
    try {
      if (query.cursor.length > 8000)
        throw new Error('oversize')
      const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== scope || typeof value[1] !== 'string' || typeof value[2] !== 'string')
        throw new Error('scope')
      after = [value[1], value[2]]
    }
    catch {
      throw new RunError('关注游标与项目、组或分类不匹配')
    }
  }
  const reviewFacts = reviews?.attention(query.projectPath) ?? []
  const runFacts = await runs.activity(query.projectPath, reviewFacts.flatMap(item => item.sourceRunId ? [item.sourceRunId] : []))
  const sources = new Map(runFacts.sources.map(run => [run.id, run]))
  const groups = new Map<string | null, FlowActivityGroup>()
  const totals = empty()
  const items: FlowActivityItem[] = []
  function group(id: string | null) {
    if (!groups.has(id))
      groups.set(id, { orchestratorId: id, counts: empty(), roles: [] })
    return groups.get(id)!
  }
  function count(id: string | null, key: keyof FlowActivityCounts, amount = 1) {
    totals[key] += amount
    group(id).counts[key] += amount
  }
  function runItem(run: RunSummary, kind: FlowActivityKind, description: string) {
    items.push({ id: `${kind}:${run.id}`, kind, orchestratorId: run.orchestratorId, roleId: run.roleId, purpose: run.purpose ?? 'task', title: run.roleName, description: `${description} · ${run.taskPreview}`, updatedAt: run.createdAt, count: 1, target: { kind: 'run', runId: run.id } })
  }
  for (const run of runFacts.activeRuns) {
    count(run.orchestratorId, 'running')
    const roles = group(run.orchestratorId).roles
    const purpose = run.purpose ?? 'task'
    const role = roles.find(item => item.roleId === run.roleId && item.purpose === purpose)
    if (role)
      role.running++
    else roles.push({ roleId: run.roleId, purpose, running: 1 })
    runItem(run, 'running', run.progress?.phase === 'collecting' ? '整理证据' : purpose === 'review-analysis' ? '审查路线分析中' : '执行中')
  }
  for (const run of runFacts.latestRuns) {
    if (run.status === 'failed' || run.status === 'interrupted') {
      count(run.orchestratorId, 'latestFailures')
      runItem(run, 'latest-failure', run.status === 'failed' ? '最近一次执行失败' : '最近一次执行中断')
    }
    else if (run.status === 'cancelled') {
      count(run.orchestratorId, 'cancelled')
      runItem(run, 'cancelled', '最近一次执行被取消')
    }
  }
  for (const fact of reviewFacts) {
    const source = fact.sourceRunId ? sources.get(fact.sourceRunId) : undefined
    const owner = source?.orchestratorId ?? null
    const missing = Boolean(fact.sourceRunId && !source)
    const running = source?.status === 'running'
    function reviewItem(kind: FlowActivityKind, amount: number, description: string, targetId?: string) {
      items.push({ id: `${kind}:${fact.review.id}`, kind, orchestratorId: owner, roleId: source?.roleId, title: fact.review.title, description, updatedAt: fact.review.updatedAt, count: amount, target: { kind: 'review', reviewId: fact.review.id, revisionId: fact.review.revisionId, minimumVersion: fact.review.version, ...(targetId ? { targetId } : {}) } })
    }
    if (running) {
      count(owner, 'inProgressReviews')
      reviewItem('in-progress-review', 1, '执行尚未结束；可阅读已固定的源码')
    }
    else if (missing) {
      count(owner, 'unavailableReviews')
      reviewItem('unavailable-review', 1, '执行证据不可用；不能判断执行是否结束')
    }
    else if (fact.unread) {
      count(owner, 'pendingReviews')
      count(owner, 'unreadTargets', fact.unread)
      reviewItem('pending-review', fact.unread, `${fact.unread} 个范围内对象尚未查看`, fact.firstUnreadId)
    }
    if (fact.changesRequested) {
      count(owner, 'changesRequested', fact.changesRequested)
      reviewItem('changes-requested', fact.changesRequested, `${fact.changesRequested} 个对象有修改意见；尚未自动投递`, fact.firstRequestedId)
    }
    if (fact.gaps) {
      count(owner, 'uncoveredChanges', fact.gaps)
      reviewItem('evidence-gap', fact.gaps, fact.gapReasons.join('；'))
    }
  }
  const sorted = items.filter(item => (!query.orchestratorId || (query.orchestratorId === 'unassigned' ? item.orchestratorId === null : item.orchestratorId === query.orchestratorId)) && (!query.kind || item.kind === query.kind))
    .sort((a, b) => a.updatedAt === b.updatedAt ? a.id === b.id ? 0 : a.id < b.id ? 1 : -1 : a.updatedAt < b.updatedAt ? 1 : -1)
    .filter(item => !after || item.updatedAt < after[0] || (item.updatedAt === after[0] && item.id < after[1]))
  const page = sorted.slice(0, 20)
  const last = page.at(-1)
  return { projectPath: query.projectPath, observedAt: new Date().toISOString(), totals, groups: [...groups.values()], items: page, nextCursor: sorted.length > page.length && last ? Buffer.from(JSON.stringify([scope, last.updatedAt, last.id])).toString('base64url') : null }
}
