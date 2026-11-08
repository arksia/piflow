import type { ReviewDecision, ReviewDetail, ReviewEvidence, ReviewFileDetail, ReviewMessage, ReviewRevisionSummary, ReviewRoute, ReviewSummary } from '@piflow/protocol'
import type { SourceSnapshot } from './source'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { compareSources, documentText, sourceDocuments } from './analysis'
import { parseReviewRoute } from './contract'
import { captureSource, ReviewError } from './source'

export { ReviewError } from './source'
export type Reviews = Awaited<ReturnType<typeof createReviews>>
interface RevisionRecord {
  id: string
  reviewId: string
  createdAt: string
  sourceRunId?: string
  beforeId: string
  afterId: string
  revisionToken: string
  files: ReviewDetail['files']
  targets: ReviewDetail['targets']
  documents: ReviewDetail['documents']
  evidence: ReviewEvidence[]
  gaps: ReviewDetail['gaps']
  hunks: Record<string, ReviewFileDetail['hunks']>
  generation: ReviewDetail['generation']
}
export async function createReviews(options: {
  dataDir: string
  publish?: (message: ReviewMessage) => void
}) {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(options.dataDir, 'reviews.sqlite'))
  await chmod(join(options.dataDir, 'reviews.sqlite'), 0o600)
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) > 1) {
    db.close()
    throw new Error('审查数据库来自更新版本。')
  }
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS contents (hash TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, project TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_sources (run_id TEXT PRIMARY KEY, project TEXT NOT NULL, before_id TEXT, after_id TEXT, review_id TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS routes (revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, version INTEGER NOT NULL, source TEXT NOT NULL, run_id TEXT, tool_id TEXT, data TEXT NOT NULL, PRIMARY KEY(revision_id, version), UNIQUE(run_id, tool_id));
    CREATE TABLE IF NOT EXISTS decisions (revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, target_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(revision_id, target_id));
    PRAGMA user_version=1;`)
  const getContent = (hash: string) => {
    const row = db.prepare('SELECT text FROM contents WHERE hash=?').get(hash)
    if (!row)
      throw new ReviewError('固定源码正文不可用', 410)
    return row.text as string
  }
  const putContent = (hash: string, text: string) => {
    db.prepare('INSERT OR IGNORE INTO contents VALUES (?,?)').run(hash, text)
  }
  function transaction<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      db.exec('COMMIT')
      return result
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  function review(projectPath: string, id: string): ReviewSummary {
    const row = db.prepare('SELECT data FROM reviews WHERE id=? AND project=?').get(id, projectPath)
    if (!row)
      throw new ReviewError('交付审查不存在', 404)
    return JSON.parse(row.data as string)
  }
  function revision(projectPath: string, reviewId: string, revisionId?: string): RevisionRecord {
    const entry = review(projectPath, reviewId)
    const row = db.prepare('SELECT data FROM revisions WHERE id=? AND review_id=?').get(revisionId ?? entry.revisionId, reviewId)
    if (!row)
      throw new ReviewError('审查修订不存在', 404)
    return JSON.parse(row.data as string)
  }
  function snapshot(projectPath: string, id: string): SourceSnapshot {
    const row = db.prepare('SELECT data FROM snapshots WHERE project=? AND id=?').get(projectPath, id)
    if (!row)
      throw new ReviewError('源码快照不可用', 410)
    return JSON.parse(row.data as string)
  }
  async function capture(projectPath: string, cwd: string, signal?: AbortSignal, commit?: string) {
    const value = await captureSource(cwd, putContent, signal, commit)
    db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run(value.id, projectPath, JSON.stringify(value))
    return value
  }
  function publish(entry: ReviewSummary, revisionId = entry.revisionId) {
    try {
      options.publish?.({ type: 'review_updated', projectPath: entry.projectPath, reviewId: entry.id, revisionId, version: entry.version })
    }
    catch (error) {
      console.error('[piflow] review notification failed', error)
    }
  }
  function bump(projectPath: string, reviewId: string) {
    const value = review(projectPath, reviewId)
    value.version++
    value.updatedAt = new Date().toISOString()
    db.prepare('UPDATE reviews SET data=? WHERE id=?').run(JSON.stringify(value), reviewId)
    return value
  }
  function makeRevision(projectPath: string, title: string, before: SourceSnapshot, after: SourceSnapshot, sourceRunId?: string, reviewId?: string) {
    const entry: ReviewSummary = reviewId ? review(projectPath, reviewId) : { id: crypto.randomUUID(), projectPath, title: title.slice(0, 200), revisionId: '', version: 0, runIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const comparison = compareSources(before, after, getContent)
    const documents = sourceDocuments(after, getContent)
    for (const kind of ['requirement', 'design'] as const) {
      if (!documents.some(doc => doc.kind === kind))
        comparison.gaps.push({ id: `missing-${kind}`, kind: 'document-missing', explanation: kind === 'requirement' ? '本修订没有采集到需求文档。' : '本修订没有采集到技术方案。', source: 'host' })
    }
    const value: RevisionRecord = { id: crypto.randomUUID(), reviewId: entry.id, createdAt: new Date().toISOString(), sourceRunId, beforeId: before.id, afterId: after.id, revisionToken: crypto.randomUUID(), ...comparison, documents, evidence: [], generation: { state: 'idle' } }
    entry.revisionId = value.id
    entry.version++
    entry.updatedAt = value.createdAt
    if (sourceRunId && !entry.runIds.includes(sourceRunId))
      entry.runIds.push(sourceRunId)
    transaction(() => {
      db.prepare('INSERT INTO reviews VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(entry.id, projectPath, JSON.stringify(entry))
      db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(value.id, entry.id, JSON.stringify(value))
      if (sourceRunId)
        db.prepare('UPDATE run_sources SET after_id=?, review_id=?, reason=NULL WHERE run_id=? AND project=?').run(after.id, entry.id, sourceRunId, projectPath)
    })
    publish(entry)
    return read(projectPath, entry.id)
  }
  function summary(value: RevisionRecord): ReviewRevisionSummary {
    return { id: value.id, createdAt: value.createdAt, sourceRunId: value.sourceRunId, fileCount: value.files.length }
  }
  function read(projectPath: string, reviewId: string, revisionId?: string): ReviewDetail {
    const entry = review(projectPath, reviewId)
    const value = revision(projectPath, reviewId, revisionId)
    const row = db.prepare('SELECT version, source, data FROM routes WHERE revision_id=? ORDER BY version DESC LIMIT 1').get(value.id)
    const route = row ? { version: Number(row.version), source: row.source as 'agent' | 'user', value: JSON.parse(row.data as string) as ReviewRoute } : null
    const linked = new Set(route?.value.steps.flatMap(step => step.targets.map(link => link.targetId)) ?? [])
    const assigned = new Set(value.files.flatMap(file => file.hunkIds).filter(id => value.targets.filter(t => t.hunkIds.includes(id)).every(t => linked.has(t.id))))
    return { review: entry, revision: summary(value), revisions: db.prepare('SELECT data FROM revisions WHERE review_id=? ORDER BY rowid DESC').all(entry.id).map(row => summary(JSON.parse(row.data as string))), files: value.files, targets: value.targets, documents: value.documents, evidence: value.evidence, gaps: value.gaps, route, decisions: db.prepare('SELECT data FROM decisions WHERE revision_id=?').all(value.id).map(row => JSON.parse(row.data as string)), unassignedHunkIds: value.files.flatMap(file => file.hunkIds).filter(id => !assigned.has(id)), generation: value.generation }
  }
  // A process restart cannot prove an unfinished model analysis completed.
  for (const row of db.prepare('SELECT id,data FROM revisions').all()) {
    const value: RevisionRecord = JSON.parse(row.data as string)
    if (value.generation.state === 'running') {
      value.generation = { ...value.generation, state: 'interrupted', error: '服务重启，路线生成已中断。' }
      db.prepare('UPDATE revisions SET data=? WHERE id=?').run(JSON.stringify(value), value.id)
    }
  }
  return {
    read,
    async captureBefore(runId: string, projectPath: string, cwd: string, signal?: AbortSignal, reviewId?: string) {
      if (reviewId)
        review(projectPath, reviewId)
      db.prepare('INSERT INTO run_sources(run_id,project,review_id,reason) VALUES (?,?,?,?)').run(runId, projectPath, reviewId ?? null, '源码采集中；尚无固定交付修订。')
      try {
        const value = await capture(projectPath, cwd, signal)
        db.prepare('UPDATE run_sources SET before_id=? WHERE run_id=?').run(value.id, runId)
      }
      catch (error) {
        db.prepare('UPDATE run_sources SET reason=? WHERE run_id=?').run(`运行前源码未采集：${error instanceof Error ? error.message.slice(0, 300) : '未知错误'}`, runId)
      }
    },
    async captureAfter(runId: string, projectPath: string, cwd: string, title: string, closed: boolean, signal?: AbortSignal) {
      const row = db.prepare('SELECT before_id,review_id FROM run_sources WHERE run_id=? AND project=?').get(runId, projectPath)
      if (!row?.before_id || !closed) {
        db.prepare('UPDATE run_sources SET reason=? WHERE run_id=? AND project=?').run('未可靠观察到进程关闭或缺少起点源码，未生成比较。', runId, projectPath)
        return
      }
      try {
        const after = await capture(projectPath, cwd, signal)
        let before = snapshot(projectPath, row.before_id as string)
        if (row.review_id) {
          const original = db.prepare('SELECT data FROM revisions WHERE review_id=? ORDER BY rowid LIMIT 1').get(row.review_id as string)
          if (original)
            before = snapshot(projectPath, (JSON.parse(original.data as string) as RevisionRecord).beforeId)
        }
        makeRevision(projectPath, title, before, after, runId, row.review_id as string | undefined)
      }
      catch (error) {
        db.prepare('UPDATE run_sources SET reason=? WHERE run_id=? AND project=?').run(`交付源码比较不可用：${error instanceof Error ? error.message.slice(0, 300) : '未知错误'}`, runId, projectPath)
      }
    },
    forRun(projectPath: string, runId: string) {
      const row = db.prepare('SELECT review_id,reason FROM run_sources WHERE run_id=? AND project=?').get(runId, projectPath)
      return { reviewId: row?.review_id as string | null ?? null, reason: row?.reason as string | null ?? '此历史运行未采集源码，不能还原函数 diff。' }
    },
    async createComparison(projectPath: string, base: string, target: string, title: string) {
      const before = await capture(projectPath, projectPath, undefined, base)
      const after = await capture(projectPath, projectPath, undefined, target)
      return makeRevision(projectPath, title, before, after)
    },
    file(projectPath: string, reviewId: string, revisionId: string, fileId: string): ReviewFileDetail {
      const value = revision(projectPath, reviewId, revisionId)
      const file = value.files.find(file => file.id === fileId)
      if (!file)
        throw new ReviewError('变更对象不存在', 404)
      return { reviewId, revisionId, file, hunks: value.hunks[fileId] ?? [], before: file.beforeDigest ? getContent(file.beforeDigest) : null, after: file.afterDigest ? getContent(file.afterDigest) : null }
    },
    document(projectPath: string, reviewId: string, revisionId: string, documentId: string) {
      const value = revision(projectPath, reviewId, revisionId)
      const document = value.documents.find(doc => doc.id === documentId)
      if (!document)
        throw new ReviewError('文档引用不存在', 404)
      return { revisionId, document, text: documentText(document, value.documents, getContent) }
    },
    decide(projectPath: string, reviewId: string, revisionId: string, decision: Omit<ReviewDecision, 'updatedAt'>) {
      const value = revision(projectPath, reviewId, revisionId)
      if (!decision || !value.targets.some(target => target.id === decision.targetId) || !['unread', 'seen', 'changes-requested', 'skipped'].includes(decision.state) || typeof decision.note !== 'string' || decision.note.length > 8000)
        throw new ReviewError('审查对象或意见无效')
      const next: ReviewDecision = { ...decision, updatedAt: new Date().toISOString() }
      const entry = transaction(() => {
        db.prepare('INSERT INTO decisions VALUES (?,?,?) ON CONFLICT(revision_id,target_id) DO UPDATE SET data=excluded.data').run(revisionId, decision.targetId, JSON.stringify(next))
        return bump(projectPath, reviewId)
      })
      publish(entry, revisionId)
      return next
    },
    setEvidence(projectPath: string, reviewId: string, revisionId: string, evidence: ReviewEvidence[]) {
      const value = revision(projectPath, reviewId, revisionId)
      value.evidence = evidence
      db.prepare('UPDATE revisions SET data=? WHERE id=?').run(JSON.stringify(value), value.id)
    },
    context(projectPath: string, reviewId: string, revisionId: string) {
      const value = revision(projectPath, reviewId, revisionId)
      return { reviewId, revisionId, revisionToken: value.revisionToken, files: value.files, targets: value.targets, documents: value.documents, evidence: value.evidence, gaps: value.gaps }
    },
    setGeneration(projectPath: string, reviewId: string, revisionId: string, generation: ReviewDetail['generation']) {
      const value = revision(projectPath, reviewId, revisionId)
      value.generation = generation
      const entry = transaction(() => {
        db.prepare('UPDATE revisions SET data=? WHERE id=?').run(JSON.stringify(value), value.id)
        return bump(projectPath, reviewId)
      })
      publish(entry, revisionId)
    },
    saveRoute(projectPath: string, reviewId: string, revisionId: string, route: ReviewRoute, source: 'agent' | 'user', runId?: string, toolId?: string) {
      const value = revision(projectPath, reviewId, revisionId)
      route = parseReviewRoute(route, { reviewId, revisionId, revisionToken: value.revisionToken, files: value.files, targets: value.targets, documents: value.documents, evidence: value.evidence, gaps: value.gaps })
      if (route.revisionToken !== value.revisionToken)
        throw new ReviewError('路线来自其他修订', 409)
      const existing = runId && toolId ? db.prepare('SELECT version FROM routes WHERE run_id=? AND tool_id=?').get(runId, toolId) : undefined
      if (existing)
        return Number(existing.version)
      const version = Number(db.prepare('SELECT MAX(version) AS version FROM routes WHERE revision_id=?').get(revisionId)!.version ?? 0) + 1
      const entry = transaction(() => {
        db.prepare('INSERT INTO routes VALUES (?,?,?,?,?,?)').run(revisionId, version, source, runId ?? null, toolId ?? null, JSON.stringify(route))
        return bump(projectPath, reviewId)
      })
      publish(entry, revisionId)
      return version
    },
    draft(projectPath: string, reviewId: string, revisionId: string) {
      const value = read(projectPath, reviewId, revisionId)
      return [`请根据以下审查意见返工：${value.review.title}`, `功能审查 ID：${reviewId}；基于修订 ${revisionId}。后续 Code 委派沿用此 reviewId。`, ...value.decisions.filter(d => d.state === 'changes-requested').map((d) => {
        const target = value.targets.find(t => t.id === d.targetId)!
        return `- ${value.files.find(f => f.id === target.fileId)!.path} / ${target.name}：${d.note || '已标记需要修改，请复核。'}`
      }), '请保留无关改动，执行相关检查，提交新的代码交付声明。'].join('\n')
    },
    remove(projectPath: string, reviewId: string) {
      review(projectPath, reviewId)
      transaction(() => {
        db.prepare('DELETE FROM reviews WHERE id=? AND project=?').run(reviewId, projectPath)
        db.prepare('DELETE FROM run_sources WHERE review_id=? AND project=?').run(reviewId, projectPath)
        const retained = new Set<string>()
        for (const row of db.prepare('SELECT data FROM revisions').all()) {
          const r = JSON.parse(row.data as string) as RevisionRecord
          retained.add(r.beforeId)
          retained.add(r.afterId)
        }
        for (const row of db.prepare('SELECT before_id,after_id FROM run_sources').all()) {
          if (row.before_id)
            retained.add(row.before_id as string)
          if (row.after_id)
            retained.add(row.after_id as string)
        }
        const hashes = new Set<string>()
        for (const row of db.prepare('SELECT id,data FROM snapshots').all()) {
          if (!retained.has(row.id as string)) {
            db.prepare('DELETE FROM snapshots WHERE id=?').run(row.id as string)
          }
          else {
            for (const hash of Object.values((JSON.parse(row.data as string) as SourceSnapshot).files))
              hashes.add(hash)
          }
        }
        for (const row of db.prepare('SELECT hash FROM contents').all()) {
          if (!hashes.has(row.hash as string))
            db.prepare('DELETE FROM contents WHERE hash=?').run(row.hash as string)
        }
      })
    },
    close() {
      db.close()
    },
  }
}
