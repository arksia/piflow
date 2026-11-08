import type { ReviewRoute } from '@piflow/protocol'
import type { ReviewBundle } from '../../reviews/contract'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import Fastify from 'fastify'
import { createReviews } from '../../reviews'
import { parseReviewRoute, readReviewContext } from '../../reviews/contract'
import { createReviewGeneration } from '../../reviews/generation'
import { reviewRoutes } from '../../routes/reviews'
import { createSubagentRuns } from '../../runs'

const exec = promisify(execFile)
function route(bundle: ReviewBundle): ReviewRoute {
  return { schemaVersion: 1, revisionToken: bundle.context.revisionToken, summary: '按需求审查', steps: [{ key: 'behavior', title: '确认计算', purpose: '保留零', requirementIds: [], designSectionIds: [], adrIds: [], targets: bundle.context.targets.map(t => ({ targetId: t.id, reason: '计算变更', reviewFocus: '零值' })), evidenceIds: [] }], relations: [], gaps: [] }
}
it('runs fixed read-only analysis, validates references, keeps facts scoped and preserves decisions on route edits', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-route-')))
  const cwd = join(root, 'repo')
  await exec('git', ['init', '-q', cwd])
  await writeFile(join(cwd, 'code.ts'), 'export function calculate() { return 1 }\n')
  await exec('git', ['-C', cwd, 'add', '.'])
  const reviews = await createReviews({ dataDir: join(root, 'data') })
  let bundlePath = ''
  let bundle: ReviewBundle | undefined
  let invalid = false
  const messages: unknown[] = []
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), reviews, publish: m => messages.push(m), execute: async (input, _signal, fact) => {
    if (input.configurationSnapshot.reviewAnalysis) {
      assert.deepEqual(input.configurationSnapshot.tools, [])
      assert.equal(input.configurationSnapshot.delivery, undefined)
      bundlePath = input.configurationSnapshot.reviewAnalysis.bundlePath
      bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as ReviewBundle
      const value = route(bundle)
      if (invalid)
        value.steps[0]!.targets[0]!.targetId = 'invented-id'
      fact({ type: 'tool_start', toolCallId: 'route', toolName: 'submit_review_route', args: {} })
      fact({ type: 'tool_end', toolCallId: 'route', toolName: 'submit_review_route', result: { details: { reviewRoute: value } }, isError: false })
    }
    else {
      await writeFile(join(cwd, 'code.ts'), 'export function calculate() { return 0 }\n')
      fact({ type: 'tool_start', toolCallId: 'check', toolName: 'bash', args: { command: 'false' } })
      fact({ type: 'tool_end', toolCallId: 'check', toolName: 'bash', result: { structuredContent: { exit_code: 1 } }, isError: true })
    }
    fact({ type: 'closed', exitCode: 0 })
    return { output: 'done', closed: true, cancelled: false }
  } })
  const generation = createReviewGeneration(reviews, runs)
  const app = Fastify()
  try {
    await app.register(reviewRoutes, { reviews, generation, runs, isTrusted: () => true })
    const result = await runs.execute({ projectPath: cwd, orchestratorId: 'main', orchestratorName: 'Main', roleId: 'code', roleName: 'Code', parentSessionPath: '/parent', parentToolCallId: 'parent-call', task: '保留零', configurationSnapshot: { roleName: 'Code', cwd, effectivePrompt: '', model: 'a/b', thinkingLevel: 'off', tools: [], memberRoleIds: [], delivery: { kind: 'code', version: 1 } } })
    const id = reviews.forRun(cwd, result.runId).reviewId!
    const initial = reviews.read(cwd, id)
    const rev = initial.revision.id
    generation.start(cwd, id, rev)
    generation.start(cwd, id, rev)
    // close waits for the same managed execution; do not cancel this successful run.
    while (reviews.read(cwd, id).generation.state === 'running') await new Promise(resolve => setTimeout(resolve, 5))
    const detail = reviews.read(cwd, id)
    assert.equal(detail.generation.state, 'succeeded')
    assert.equal(detail.route?.source, 'agent')
    assert.equal(detail.evidence[0]!.exitCode, 1)
    assert.equal(detail.evidence[0]!.sourceVersion, 'unknown')
    await assert.rejects(readFile(bundlePath), /ENOENT/)
    assert.ok(!JSON.stringify(messages).includes('reviewRoute'))
    const target = detail.targets[0]!
    reviews.decide(cwd, id, rev, { targetId: target.id, state: 'seen', note: 'checked' })
    reviews.saveRoute(cwd, id, rev, detail.route!.value, 'user')
    assert.equal(reviews.read(cwd, id).decisions[0]!.state, 'seen')
    assert.throws(() => parseReviewRoute({ ...detail.route!.value, revisionToken: 'stale' }, bundle!.context), /其他修订/)
    assert.throws(() => parseReviewRoute({ ...detail.route!.value, readyToMerge: true }, bundle!.context), /格式/)
    assert.throws(() => parseReviewRoute({ ...detail.route!.value, relations: [{ from: 'behavior', to: 'behavior', kind: 'review-order', explanation: 'cycle' }] }), /成环/)
    assert.throws(() => readReviewContext(bundle!, { kind: 'source', id: '../../etc/passwd' }), /不存在/)
    assert.throws(() => readReviewContext(bundle!, { kind: 'evidence', id: 'missing' }), /不存在/)
    const data = await app.inject({ url: `/api/reviews/${id}?projectPath=${encodeURIComponent(root)}` })
    assert.equal(data.statusCode, 404)
    assert.equal((await app.inject({ method: 'POST', url: `/api/reviews/${id}/decisions`, payload: { projectPath: cwd, revisionId: rev, targetId: 'fake', state: 'seen' } })).statusCode, 400)
    invalid = true
    generation.start(cwd, id, rev)
    while (reviews.read(cwd, id).generation.state === 'running') await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(reviews.read(cwd, id).generation.state, 'failed')
    assert.equal(reviews.read(cwd, id).route?.source, 'user')
  }
  finally {
    await generation.close()
    await app.close()
    await runs.close()
    reviews.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('loads only the two fixed tools, isolates pagination cursors and restricts the process tool profile', async () => {
  const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent')
  const { fileURLToPath } = await import('node:url')
  const { default: process } = await import('node:process')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-review-tools-')))
  const bundle: ReviewBundle = { context: { reviewId: 'review', revisionId: 'rev', revisionToken: 'token', documents: [], files: [], targets: [], evidence: [], gaps: [] }, sources: { file: '中'.repeat(30000) }, documents: {} }
  const bundlePath = join(root, 'context.json')
  await writeFile(bundlePath, JSON.stringify(bundle))
  const old = process.env.PIFLOW_REVIEW_BUNDLE
  process.env.PIFLOW_REVIEW_BUNDLE = bundlePath
  const cliEntry = join(root, 'cli.cjs')
  await writeFile(cliEntry, `require('node:fs').writeFileSync('args.json',JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}]}}))`)
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), cliEntry })
  try {
    const first = readReviewContext(bundle, { kind: 'source', id: 'file' })
    assert.equal(first.text.length, 12000)
    assert.ok(first.nextCursor)
    assert.equal(readReviewContext(bundle, { kind: 'source', id: 'file', cursor: first.nextCursor! }).text.length, 12000)
    assert.throws(() => readReviewContext(bundle, { kind: 'catalog', cursor: first.nextCursor! }), /游标/)
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, 'agent'), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [fileURLToPath(new URL('../../reviews/extension.ts', import.meta.url))] })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const tools = loader.getExtensions().extensions[0]!.tools
    assert.deepEqual([...tools.keys()], ['read_review_context', 'submit_review_route'])
    const result = await tools.get('read_review_context')!.definition.execute('read', { kind: 'catalog' }, undefined, undefined, {} as never)
    assert.match(JSON.stringify(result.content), /revisionToken/)
    await runs.execute({ projectPath: root, orchestratorId: 'main', orchestratorName: 'Main', roleId: 'review-analysis', roleName: 'Review', parentSessionPath: '/p', parentToolCallId: 't', task: 'Analyze', configurationSnapshot: { roleName: 'Review', cwd: root, effectivePrompt: '', model: 'a/b', thinkingLevel: 'off', tools: [], memberRoleIds: [], reviewAnalysis: { reviewId: 'review', revisionId: 'rev', bundlePath } } })
    const args = JSON.parse(await readFile(join(root, 'args.json'), 'utf8')) as string[]
    assert.equal(args[args.indexOf('--tools') + 1], 'read_review_context,submit_review_route')
    assert.ok(args.includes('--no-extensions') && args.includes('--no-mcp') && args.includes('--no-skills'))
    assert.equal(args.includes('--no-tools'), false)
  }
  finally {
    if (old === undefined)
      delete process.env.PIFLOW_REVIEW_BUNDLE
    else process.env.PIFLOW_REVIEW_BUNDLE = old
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
