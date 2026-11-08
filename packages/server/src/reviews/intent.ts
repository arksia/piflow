import type { ReviewAnalysisContext, ReviewRoute } from '@piflow/protocol'
import { Buffer } from 'node:buffer'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { parseReviewRoute, reviewRouteSchema } from './contract'
import { ReviewError } from './source'

const selector = Type.Object({ path: Type.String({ minLength: 1, maxLength: 4000 }), name: Type.String({ minLength: 1, maxLength: 1000 }), kind: Type.String({ minLength: 1, maxLength: 30 }) }, { additionalProperties: false })
const selectors = Type.Array(selector, { maxItems: 300 })
const intentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  summary: reviewRouteSchema.properties.summary,
  steps: Type.Array(Type.Object({ key: Type.String({ minLength: 1, maxLength: 100 }), title: Type.String({ minLength: 1, maxLength: 200 }), purpose: Type.String({ minLength: 1, maxLength: 1000 }), documents: selectors, targets: Type.Array(Type.Object({ ...selector.properties, reason: Type.String({ minLength: 1, maxLength: 1000 }), reviewFocus: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }), { maxItems: 100 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
  relations: reviewRouteSchema.properties.relations,
}, { additionalProperties: false })
/** Portable intent contains selectors, never machine ids, source bodies or human decisions. */
export function exportReviewIntent(route: ReviewRoute, context: ReviewAnalysisContext) {
  const intent = {
    schemaVersion: 1,
    summary: route.summary,
    steps: route.steps.map(step => ({
      key: step.key,
      title: step.title,
      purpose: step.purpose,
      documents: [...new Set([...step.requirementIds, ...step.designSectionIds, ...step.adrIds])].map((id) => {
        const doc = context.documents.find(d => d.id === id)!
        return { path: doc.path, name: doc.anchor, kind: doc.kind }
      }),
      targets: step.targets.map((link) => {
        const target = context.targets.find(t => t.id === link.targetId)!
        return { path: context.files.find(f => f.id === target.fileId)!.path, name: target.name, kind: target.kind, reason: link.reason, reviewFocus: link.reviewFocus }
      }),
    })),
    relations: route.relations,
  }
  if (!Value.Check(intentSchema, intent) || Buffer.byteLength(JSON.stringify(intent)) > 128 * 1024)
    throw new ReviewError('路线意图超过可携带的格式或 128 KiB 预算；请减少步骤或关联后重试。')
  return intent
}
export function importReviewIntent(input: unknown, context: ReviewAnalysisContext): ReviewRoute {
  if (!Value.Check(intentSchema, input) || Buffer.byteLength(JSON.stringify(input)) > 128 * 1024)
    throw new ReviewError('路线意图格式无效或超过 128 KiB。')
  const intent = input as ReturnType<typeof exportReviewIntent>
  const route: ReviewRoute = { schemaVersion: 1, revisionToken: context.revisionToken, summary: intent.summary, steps: [], relations: intent.relations, gaps: [] }
  function missing(path: string, name: string) {
    if (route.gaps.length < 99)
      route.gaps.push({ kind: 'intent-unresolved', referenceIds: [], explanation: `无法唯一定位 ${path.slice(0, 400)} / ${name.slice(0, 400)}，请重新关联。` })
  }
  for (const step of intent.steps) {
    const next: ReviewRoute['steps'][number] = { key: step.key, title: step.title, purpose: step.purpose, requirementIds: [], designSectionIds: [], adrIds: [], targets: [], evidenceIds: [] }
    for (const ref of step.documents) {
      const matches = context.documents.filter(d => d.path === ref.path && d.anchor === ref.name && d.kind === ref.kind)
      if (matches.length !== 1) {
        missing(ref.path, ref.name)
        continue
      }
      const doc = matches[0]!
      next[doc.kind === 'requirement' ? 'requirementIds' : doc.kind === 'design' ? 'designSectionIds' : 'adrIds'].push(doc.id)
    }
    for (const ref of step.targets) {
      const matches = context.targets.filter(t => t.name === ref.name && t.kind === ref.kind && context.files.find(f => f.id === t.fileId)?.path === ref.path)
      if (matches.length !== 1) {
        missing(ref.path, ref.name)
        continue
      }
      next.targets.push({ targetId: matches[0]!.id, reason: ref.reason, reviewFocus: ref.reviewFocus })
    }
    route.steps.push(next)
  }
  route.gaps.push({ kind: 'intent-evidence', referenceIds: [], explanation: '导入只恢复阅读路线意图；执行证据与人工审查状态属于本机修订，未从文件继承。' })
  return parseReviewRoute(route, context)
}
