import type { CodeDeliveryDeclaration, RunDeliveryDetail, RunDeliveryRecord, RunDeliverySummary, RunToolDetail } from '@piflow/protocol'
import { Buffer } from 'node:buffer'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const CODE_DELIVERY_TOOL = 'submit_code_delivery'
const text = () => Type.String({ maxLength: 1000 })
const list = <T extends ReturnType<typeof text>>(item: T) => Type.Array(item, { maxItems: 20 })
export const codeDeliverySchema = Type.Object({
  outcome: Type.Union([Type.Literal('completed'), Type.Literal('partial'), Type.Literal('blocked')]),
  summary: Type.String({ minLength: 1, maxLength: 2000 }),
  changes: list(text()),
  artifacts: Type.Array(Type.Object({ path: text(), description: text() }, { additionalProperties: false }), { maxItems: 20 }),
  checks: Type.Array(Type.Object({
    name: text(),
    claimedStatus: Type.Union(['passed', 'failed', 'not-run', 'unknown'].map(value => Type.Literal(value))),
    toolCallIds: list(text()),
    note: text(),
  }, { additionalProperties: false }), { maxItems: 20 }),
  unresolved: list(text()),
}, { additionalProperties: false })
export function parseCodeDelivery(value: unknown): CodeDeliveryDeclaration {
  if (!Value.Check(codeDeliverySchema, value) || Buffer.byteLength(JSON.stringify(value)) > 32768)
    throw new Error('交付声明格式无效或超过 32 KiB；请按工具 schema 缩短后重新提交。')
  return structuredClone(value) as CodeDeliveryDeclaration
}
export function deliveryDetail(record: RunDeliveryRecord, commands: RunDeliveryDetail['commands'], tool: (id: string) => RunToolDetail | undefined): RunDeliveryDetail {
  const ids = [...new Set(record.declaration?.value.checks.flatMap(check => check.toolCallIds) ?? [])]
  return {
    availability: 'recorded',
    runId: record.runId,
    projectPath: record.projectPath,
    revision: record.revision,
    record,
    commands,
    checkReferences: ids.map((toolCallId) => {
      const entry = tool(toolCallId)
      const linked = entry?.toolName === 'bash'
      return { toolCallId, linked, exitCode: linked ? entry.command?.exitCode ?? null : null, ...(linked ? { status: entry.status } : {}) }
    }),
  }
}
export function deliverySummary(detail: RunDeliveryDetail): RunDeliverySummary {
  const report = detail.record?.declaration
  const unresolved = report?.value.unresolved ?? []
  return {
    declaration: report ? 'submitted' : 'missing',
    ...(report ? { outcome: report.value.outcome, summary: report.value.summary } : {}),
    commands: detail.commands,
    unresolved: unresolved.slice(0, 5).map(text => text.slice(0, 300)),
    unresolvedCount: unresolved.length,
    unresolvedTruncated: unresolved.length > 5 || unresolved.some(text => text.length > 300),
    before: detail.record?.before.state ?? 'not-captured',
    after: detail.record?.after.state ?? 'not-captured',
    warnings: [
      ...(!report ? ['未提交结构化交付声明。'] : []),
      ...(report?.subsequentToolActivity ? ['声明提交后仍有工具活动。'] : []),
      ...(detail.commands.nonzero ? ['存在非零退出的命令，请结合重试记录判断。'] : []),
      ...(detail.commands.unknown ? ['部分命令没有可用退出码。'] : []),
      ...(detail.checkReferences.some(reference => !reference.linked) ? ['部分检查引用未关联到本次运行的 bash 证据。'] : []),
      ...(detail.record?.lastDeclarationError ? [detail.record.lastDeclarationError] : []),
    ],
  }
}
export const CODE_DELIVERY_PROMPT = [
  '# Code delivery evidence',
  'This run requests a code delivery. Before your final reply, use submit_code_delivery to declare your outcome, changes, artifacts, checks and unresolved issues. Submit again if you continue using tools after submission.',
  'Only report what you know. Checks can reference your bash tool call ids; never invent ids. Use an empty list if you cannot identify one. A declaration is your claim, not proof: the host separately records actual bash exits and shared-workspace Git snapshots.',
  'A shell exit code of zero does not prove all tests passed. Keep skipped checks and remaining issues explicit. Artifact paths are declarations, not published or verified files. Return a concise final answer as usual.',
].join('\n\n')
