import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ReviewBundle } from './contract'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { parseReviewRoute, readReviewContext, REVIEW_READ_TOOL, REVIEW_SUBMIT_TOOL, reviewRouteSchema } from './contract'

export default async function reviewExtension(pi: ExtensionAPI) {
  const path = process.env.PIFLOW_REVIEW_BUNDLE
  if (!path)
    throw new Error('Review analysis requires a host-bound fixed bundle.')
  const bundle: ReviewBundle = JSON.parse(await readFile(path, 'utf8'))
  pi.registerTool(defineTool({
    name: REVIEW_READ_TOOL,
    label: 'Read fixed review sources',
    description: 'Read the fixed revision catalog, source diff by file/target id, a document section, or execution evidence. Follow nextCursor until relevant content is read. No live workspace access.',
    parameters: Type.Object({ kind: Type.Union([Type.Literal('catalog'), Type.Literal('source'), Type.Literal('document'), Type.Literal('evidence')]), id: Type.Optional(Type.String({ maxLength: 200 })), cursor: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }),
    async execute(_id, params) { return { content: [{ type: 'text', text: JSON.stringify(readReviewContext(bundle, params)) }], details: {} } },
  }))
  pi.registerTool(defineTool({
    name: REVIEW_SUBMIT_TOOL,
    label: 'Propose feature review route',
    description: 'Submit a complete requirement-driven reading route for the fixed revision. Use only catalog ids. This records an Agent suggestion, never human approval, test success or runtime-observed calls. The host persists and validates separately.',
    parameters: reviewRouteSchema,
    async execute(_id, params) {
      const value = parseReviewRoute(params, bundle.context)
      return { content: [{ type: 'text', text: 'Route structure and references checked locally. Host persistence is pending. Return a short final reply.' }], details: { reviewRoute: value } }
    },
  }))
}
