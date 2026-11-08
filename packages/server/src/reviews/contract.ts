import type { ReviewAnalysisContext, ReviewContextRequest, ReviewRoute } from '@piflow/protocol'
import { Buffer } from 'node:buffer'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { ReviewError } from './source'

export const REVIEW_SUBMIT_TOOL = 'submit_review_route'
export const REVIEW_READ_TOOL = 'read_review_context'
const text = (maxLength = 1000) => Type.String({ minLength: 1, maxLength })
const ids = () => Type.Array(text(200), { maxItems: 100 })
export const reviewRouteSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  revisionToken: text(200),
  summary: text(2000),
  steps: Type.Array(Type.Object({ key: text(100), title: text(200), purpose: text(), requirementIds: ids(), designSectionIds: ids(), adrIds: ids(), targets: Type.Array(Type.Object({ targetId: text(200), reason: text(), reviewFocus: text() }, { additionalProperties: false }), { maxItems: 100 }), evidenceIds: ids() }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
  relations: Type.Array(Type.Object({ from: Type.String({ minLength: 1, maxLength: 100, description: 'Source review step key from steps[].key, never a document or target ID.' }), to: Type.String({ minLength: 1, maxLength: 100, description: 'Destination review step key from steps[].key.' }), kind: Type.Enum(['review-order', 'http', 'event', 'data-dependency'], { type: 'string', description: 'Exactly review-order, http, event or data-dependency. Relationships connect review steps only; do not use implements/verifies or document-to-code edges.' }), explanation: text() }, { additionalProperties: false }), { maxItems: 200 }),
  gaps: Type.Array(Type.Object({ kind: text(100), referenceIds: ids(), explanation: text() }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false })
export function parseReviewRoute(input: unknown, context?: ReviewAnalysisContext): ReviewRoute {
  if (!Value.Check(reviewRouteSchema, input) || Buffer.byteLength(JSON.stringify(input)) > 128 * 1024)
    throw new ReviewError('路线格式无效或超过 128 KiB。')
  const value = structuredClone(input) as ReviewRoute
  const steps = new Set(value.steps.map(step => step.key))
  if (steps.size !== value.steps.length)
    throw new ReviewError('路线步骤 key 重复。')
  for (const edge of value.relations) {
    if (!steps.has(edge.from) || !steps.has(edge.to))
      throw new ReviewError('路线关系引用了不存在的步骤。')
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  function visit(key: string) {
    if (visiting.has(key))
      throw new ReviewError('阅读顺序不能成环。')
    if (done.has(key))
      return
    visiting.add(key)
    for (const edge of value.relations.filter(e => e.from === key && e.kind === 'review-order')) visit(edge.to)
    visiting.delete(key)
    done.add(key)
  }
  for (const step of value.steps) visit(step.key)
  if (!context)
    return value
  if (value.revisionToken !== context.revisionToken)
    throw new ReviewError('路线来自其他修订。', 409)
  const kinds = (kind: string) => new Set(context.documents.filter(d => d.kind === kind).map(d => d.id))
  const valid = { requirement: kinds('requirement'), design: kinds('design'), adr: kinds('adr'), target: new Set(context.targets.map(t => t.id)), evidence: new Set(context.evidence.map(e => e.id)) }
  function check(ids: string[], set: Set<string>) {
    for (const id of ids) {
      if (!set.has(id))
        throw new ReviewError(`引用 ${id} 不属于当前修订或类型不匹配。`)
    }
  }
  for (const step of value.steps) {
    check(step.requirementIds, valid.requirement)
    check(step.designSectionIds, valid.design)
    check(step.adrIds, valid.adr)
    check(step.targets.map(t => t.targetId), valid.target)
    check(step.evidenceIds, valid.evidence)
  }
  const all = new Set([...Object.values(valid).flatMap(set => [...set]), ...context.gaps.map(g => g.id)])
  for (const gap of value.gaps) check(gap.referenceIds, all)
  return value
}
export interface ReviewBundle {
  context: ReviewAnalysisContext
  sources: Record<string, string>
  documents: Record<string, string>
}
export function readReviewContext(bundle: ReviewBundle, request: ReviewContextRequest) {
  if (!['catalog', 'source', 'document', 'evidence'].includes(request.kind))
    throw new ReviewError('读取类型无效。')
  const scope = [bundle.context.revisionToken, request.kind, request.id ?? '']
  let offset = 0
  if (request.cursor) {
    try {
      if (request.cursor.length > 2000)
        throw new Error('cursor too long')
      const decoded = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(decoded) || JSON.stringify(decoded.slice(0, 3)) !== JSON.stringify(scope) || !Number.isSafeInteger(decoded[3]) || decoded[3] < 0)
        throw new Error('cursor scope')
      offset = decoded[3]
    }
    catch { throw new ReviewError('分页游标不属于当前对象和修订。') }
  }
  let body: string
  if (request.kind === 'catalog') {
    body = JSON.stringify({ ...bundle.context, contract: { readKinds: ['catalog', 'source', 'document', 'evidence'], documents: 'Use kind=document for requirements, designs and ADRs; id=document.id.', relations: 'Optional step-to-step relationships only. from/to are steps[].key. kind exactly review-order|http|event|data-dependency. Put document and target associations inside each step, never in relations.' } })
  }
  else if (request.kind === 'source') {
    const fileId = bundle.context.targets.find(t => t.id === request.id)?.fileId ?? request.id ?? ''
    if (!Object.hasOwn(bundle.sources, fileId))
      throw new ReviewError('源码对象未采集或不存在。', 404)
    body = bundle.sources[fileId]!
  }
  else if (request.kind === 'document') {
    if (!request.id || !Object.hasOwn(bundle.documents, request.id))
      throw new ReviewError('文档未采集或不存在。', 404)
    body = bundle.documents[request.id]!
  }
  else {
    if (request.id && !bundle.context.evidence.some(e => e.id === request.id))
      throw new ReviewError('执行证据不存在。', 404)
    body = JSON.stringify(request.id ? bundle.context.evidence.filter(e => e.id === request.id) : bundle.context.evidence)
  }
  if (offset > body.length)
    throw new ReviewError('分页位置无效。')
  let end = Math.min(offset + 12000, body.length)
  if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1] ?? ''))
    end--
  return { revisionId: bundle.context.revisionId, revisionToken: bundle.context.revisionToken, text: body.slice(offset, end), totalCharacters: body.length, nextCursor: end < body.length ? Buffer.from(JSON.stringify([...scope, end])).toString('base64url') : null }
}
