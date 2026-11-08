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
import { createFlowStore } from '../../flow/store'
import { createSubagentTools } from '../../flow/subagents'
import { createReviews } from '../../reviews'
import { parseReviewRoute, readReviewContext } from '../../reviews/contract'
import { createReviewGeneration } from '../../reviews/generation'
import { exportReviewIntent, importReviewIntent } from '../../reviews/intent'
import { reviewRoutes } from '../../routes/reviews'
import { createSubagentRuns } from '../../runs'

const exec = promisify(execFile)
async function waitForGeneration(reviews: Awaited<ReturnType<typeof createReviews>>, project: string, id: string) {
  const deadline = Date.now() + 5000
  while (reviews.read(project, id).generation.state === 'running') {
    if (Date.now() > deadline)
      throw new Error('analysis test timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
function route(bundle: ReviewBundle): ReviewRoute {
  return { schemaVersion: 1, revisionToken: bundle.context.revisionToken, summary: '按需求审查', steps: [{ key: 'behavior', title: '确认计算', purpose: '保留零', requirementIds: [], designSectionIds: [], adrIds: [], targets: bundle.context.targets.map(t => ({ targetId: t.id, reason: '计算变更', reviewFocus: '零值' })), evidenceIds: bundle.context.evidence.map(e => e.id) }], relations: [], gaps: [] }
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
  let providerFailure = false
  let waitForCancel = false
  let analysisStarted = () => {}
  const messages: unknown[] = []
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), reviews, publish: m => messages.push(m), execute: async (input, signal, fact) => {
    if (input.configurationSnapshot.reviewAnalysis) {
      if (providerFailure)
        throw new Error('Provider unavailable')
      if (waitForCancel) {
        analysisStarted()
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        fact({ type: 'closed', exitCode: null })
        return { output: '', closed: true, cancelled: true }
      }
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
    const flow = createFlowStore(join(root, 'data'))
    const now = new Date().toISOString()
    await flow.replaceTopology(cwd, { nodes: [{ id: 'main', name: 'Main', kind: 'persistent', sessionPath: '/parent', orchestrationEnabled: true, brief: '', goal: '', createdAt: now, updatedAt: now, position: { x: 0, y: 0 } }], edges: [], memberships: [], viewport: { x: 0, y: 0, zoom: 1 } }, { commitGraph: true })
    let trusted = false
    let enabled = true
    const tools = createSubagentTools({ flow, runs, reviews, reviewGeneration: generation, isTrusted: () => trusted, source: () => ({ cwd, sessionPath: enabled ? '/parent' : '/not-main', model: 'a/b', thinkingLevel: 'off', tools: [] }) })
    const reviewTool = tools.find(t => t.name === 'review_delivery')!
    const toolContext = {} as Parameters<typeof reviewTool.execute>[4]
    await assert.rejects(reviewTool.execute('read', { reviewId: id, action: 'read' }, undefined, undefined, toolContext), /Trust this project/)
    trusted = true
    const read = await reviewTool.execute('read', { reviewId: id, action: 'read' }, undefined, undefined, toolContext)
    assert.match(JSON.stringify(read.content), /reviewId/)
    assert.equal(reviews.read(cwd, id).generation.state, 'idle')
    enabled = false
    await assert.rejects(reviewTool.execute('generate', { reviewId: id, action: 'generate' }, undefined, undefined, toolContext), /Only a main Agent/)
    enabled = true
    await reviewTool.execute('generate', { reviewId: id, action: 'generate' }, undefined, undefined, toolContext)
    generation.start(cwd, id, rev)
    generation.start(cwd, id, rev)
    // close waits for the same managed execution; do not cancel this successful run.
    await waitForGeneration(reviews, cwd, id)
    const detail = reviews.read(cwd, id)
    assert.equal(detail.generation.state, 'succeeded')
    assert.equal(detail.route?.source, 'agent')
    assert.equal(detail.evidence[0]!.exitCode, 1)
    assert.equal(detail.evidence[0]!.sourceVersion, 'unknown')
    const evidenceId = detail.route!.value.steps[0]!.evidenceIds[0]!
    reviews.setEvidence(cwd, id, rev, [])
    assert.ok(reviews.read(cwd, id).evidence.some(e => e.id === evidenceId))
    await assert.rejects(readFile(bundlePath), /ENOENT/)
    assert.ok(!JSON.stringify(messages).includes('reviewRoute'))
    const target = detail.targets[0]!
    reviews.decide(cwd, id, rev, { targetId: target.id, state: 'seen', note: 'checked' })
    const portable = exportReviewIntent(detail.route!.value, bundle!.context)
    assert.ok(!JSON.stringify(portable).includes('revisionToken'))
    const rebound = importReviewIntent(portable, { ...bundle!.context, revisionToken: 'new-token' })
    assert.equal(rebound.revisionToken, 'new-token')
    assert.equal(rebound.steps[0]!.targets[0]!.targetId, target.id)
    const missing = importReviewIntent(portable, { ...bundle!.context, targets: [] })
    assert.equal(missing.steps[0]!.targets.length, 0)
    assert.ok(missing.gaps.some(g => g.kind === 'intent-unresolved'))
    assert.throws(() => importReviewIntent({ ...portable, decisions: [{ state: 'seen' }] }, bundle!.context), /格式/)
    reviews.exclude(cwd, id, rev, target.hunkIds, 'Independent change')
    assert.ok(reviews.read(cwd, id).exclusions?.length)
    assert.equal(reviews.read(cwd, id).decisions[0]!.state, 'seen')
    assert.throws(() => reviews.exclude(cwd, id, rev, ['fake-hunk'], 'reason'), /无效/)
    reviews.exclude(cwd, id, rev, target.hunkIds, null)
    assert.equal(reviews.read(cwd, id).exclusions?.length, 0)

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
    await waitForGeneration(reviews, cwd, id)
    assert.equal(reviews.read(cwd, id).generation.state, 'failed')
    assert.equal(reviews.read(cwd, id).route?.source, 'user')
    invalid = false
    providerFailure = true
    generation.start(cwd, id, rev)
    await waitForGeneration(reviews, cwd, id)
    assert.equal(reviews.read(cwd, id).generation.state, 'failed')
    assert.match(reviews.read(cwd, id).generation.error!, /Provider unavailable/)
    assert.equal(reviews.read(cwd, id).route?.source, 'user')
    providerFailure = false
    waitForCancel = true
    const started = new Promise<void>((resolve) => {
      analysisStarted = resolve
    })
    generation.start(cwd, id, rev)
    await started
    generation.cancel(cwd, id, rev)
    await waitForGeneration(reviews, cwd, id)
    assert.equal(reviews.read(cwd, id).generation.state, 'cancelled')
    assert.equal(reviews.read(cwd, id).route?.source, 'user')
    assert.equal(reviews.read(cwd, id).decisions[0]!.state, 'seen')
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

it('keeps Code execution and its recorded result available when review storage fails', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-review-failure-')))
  const reviews = await createReviews({ dataDir: join(root, 'data') })
  const unavailable = new Proxy(reviews, {
    get(target, key) {
      if (key === 'captureBefore' || key === 'captureAfter' || key === 'forRun') {
        return () => {
          throw new Error('Review storage unavailable')
        }
      }
      return Reflect.get(target, key)
    },
  })
  let executed = false
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), reviews: unavailable, execute: async (_input, _signal, fact) => {
    executed = true
    fact({ type: 'closed', exitCode: 0 })
    return { output: 'Code result retained', closed: true, cancelled: false }
  } })
  try {
    const result = await runs.execute({ projectPath: root, orchestratorId: 'main', orchestratorName: 'Main', roleId: 'code', roleName: 'Code', parentSessionPath: '/p', parentToolCallId: 't', task: 'Code', configurationSnapshot: { roleName: 'Code', cwd: root, effectivePrompt: '', model: 'a/b', thinkingLevel: 'off', tools: [], memberRoleIds: [], delivery: { kind: 'code', version: 1 } } })
    assert.equal(executed, true)
    assert.equal(result.status, 'succeeded')
    assert.equal(result.output, 'Code result retained')
    assert.equal(result.recordingError, undefined)
    assert.equal(result.review, undefined)
    assert.equal((await runs.read(root, result.runId)).status, 'succeeded')
  }
  finally {
    await runs.close()
    reviews.close()
    await rm(root, { recursive: true, force: true })
  }
})
