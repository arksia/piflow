import type {
  RunDeliveryDetail,
  RunDeliveryRecord,
  RunDetail,
  RunInput,
  RunMessage,
  RunOutputQuery,
  RunProcessExit,
  RunQuery,
  RunResult,
  RunToolDetail,
  RunToolsQuery,
} from '@piflow/protocol'
import type { ProcessFact } from './process'
import { Buffer } from 'node:buffer'
import { realpath } from 'node:fs/promises'
import { CODE_DELIVERY_TOOL, deliveryDetail, deliverySummary, parseCodeDelivery } from './delivery'
import { runSubagentProcess } from './process'
import { openRunStore, RunError, summarize, toolSummary } from './store'

export { RunError } from './store'
export type SubagentRuns = Awaited<ReturnType<typeof createSubagentRuns>>
function preview(value: unknown, tail = false) {
  try {
    let text: string
    if (
      value
      && typeof value === 'object'
      && 'content' in value
      && Array.isArray(value.content)
    ) {
      text = value.content
        .flatMap((part: unknown) =>
          part
          && typeof part === 'object'
          && 'type' in part
          && part.type === 'text'
          && 'text' in part
          && typeof part.text === 'string'
            ? [part.text]
            : [],
        )
        .join('\n')
    }
    else {
      text
        = typeof value === 'string'
          ? value
          : (JSON.stringify(value, null, 2) ?? '')
    }
    const bytes = Buffer.from(text)
    const truncated = bytes.length > 8192
    // Decode only complete UTF-8 code points at the retained edge.
    let start = tail && truncated ? bytes.length - 8192 : 0
    let end = tail ? bytes.length : Math.min(bytes.length, 8192)
    while (start < bytes.length && (bytes[start]! & 0xC0) === 0x80) start++
    while (end < bytes.length && (bytes[end]! & 0xC0) === 0x80) end--
    return {
      text: bytes.subarray(start, end).toString('utf8'),
      truncated,
      incomplete: false,
    }
  }
  catch {
    return { text: '预览不可用', truncated: false, incomplete: true }
  }
}
export async function createSubagentRuns(options: {
  dataDir: string
  publish?: (message: RunMessage) => void
  agentDir?: string
  cliEntry?: string
  execute?: typeof runSubagentProcess
}) {
  const store = await openRunStore(options.dataDir)
  const active = new Map<
    string,
    {
      projectPath: string
      controller: AbortController
      done: Promise<RunResult>
      closed: boolean
    }
  >()
  const recordingErrors = new Map<string, string>()
  let closing = false
  let closePromise: Promise<void> | undefined
  function publish(message: RunMessage) {
    try {
      options.publish?.(message)
    }
    catch (error) {
      console.error('[piflow] run notification failed', error)
    }
  }
  async function normalize(projectPath: string) {
    if (
      typeof projectPath !== 'string'
      || !projectPath
      || projectPath.length > 4000
    ) {
      throw new RunError('projectPath 无效')
    }
    try {
      return await realpath(projectPath)
    }
    catch {
      throw new RunError('项目路径不存在', 404)
    }
  }
  function id(value: string) {
    if (typeof value !== 'string' || !value || value.length > 1000)
      throw new RunError('运行或工具身份无效')
    return value
  }
  function readDelivery(run: RunDetail): RunDeliveryDetail {
    const record = store.delivery(run.projectPath, run.id)
    const counts = store.commandCounts(run.id)
    if (!record)
      return { availability: run.deliveryKind ? 'not-captured' : 'not-requested', runId: run.id, projectPath: run.projectPath, revision: run.deliveryRevision ?? 0, commands: counts, checkReferences: [] }
    return deliveryDetail(record, counts, (toolId) => {
      try {
        return store.tool(run.projectPath, run.id, toolId)
      }
      catch (error) {
        if (error instanceof RunError && error.statusCode === 404)
          return undefined
        throw error
      }
    })
  }
  async function execute(
    input: RunInput,
    signal?: AbortSignal,
    onOutput?: (output: string) => void,
    context?: { agentDir: string },
  ): Promise<RunResult> {
    const projectPath = await normalize(input.projectPath)
    if (closing)
      throw new RunError('运行管理正在关闭', 503)
    if (
      !input.task.trim()
      || input.task.length > 12000
      || !input.configurationSnapshot.model
    ) {
      throw new RunError('任务或模型配置无效')
    }
    const snapshot: RunInput = structuredClone({
      projectPath,
      orchestratorId: input.orchestratorId,
      orchestratorName: input.orchestratorName,
      roleId: input.roleId,
      roleName: input.roleName,
      parentSessionPath: input.parentSessionPath,
      parentToolCallId: input.parentToolCallId,
      task: input.task,
      configurationSnapshot: input.configurationSnapshot,
    })
    let run: RunDetail = {
      ...snapshot,
      id: crypto.randomUUID(),
      taskPreview: input.task.slice(0, 200),
      status: 'running',
      createdAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      revision: 1,
      outputRevision: 0,
      toolCount: 0,
      failedToolCount: 0,
      historyAvailability: 'recorded',
      diagnostics: [],
      ...(snapshot.configurationSnapshot.delivery ? { deliveryKind: 'code', deliveryRevision: 1 } : {}),
    }
    let delivery: RunDeliveryRecord | undefined = run.deliveryKind
      ? {
          runId: run.id,
          projectPath,
          revision: 1,
          before: { state: 'not-captured' },
          after: { state: 'not-captured' },
          concurrentRunIds: [],
        }
      : undefined
    store.insert(run, '', delivery)
    const controller = new AbortController()
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    const runningTools = new Map<string, RunToolDetail>()
    let recordingError: string | undefined
    let currentOutput = store.window(run.id)
    const began = performance.now()
    let processExit: RunProcessExit | undefined
    let closedDuration: number | undefined
    function recordFailure(error: unknown) {
      recordingError ??= error instanceof Error ? error.message : String(error)
      recordingErrors.set(run.id, recordingError)
      controller.abort()
      publish({
        type: 'run_recording_error',
        projectPath,
        runId: run.id,
        error: `运行记录保存失败：${recordingError}`,
      })
    }
    function fact(event: ProcessFact) {
      if (event.type === 'closed') {
        const entry = active.get(run.id)
        if (entry)
          entry.closed = true
        processExit = { closedAt: new Date().toISOString(), exitCode: event.exitCode ?? null, signal: event.signal ?? null }
        closedDuration = Math.max(0, performance.now() - began)
        return
      }
      if (recordingError)
        return
      const next = structuredClone(run)
      next.revision++
      next.lastObservedAt = new Date().toISOString()
      const changed: RunToolDetail[] = []
      let changedDelivery: RunDeliveryRecord | undefined
      let output: typeof currentOutput | undefined
      try {
        if (event.type === 'output') {
          let text = event.output.slice(-160000)
          if (text.length && text.charCodeAt(0) >= 0xDC00 && text.charCodeAt(0) <= 0xDFFF)
            text = text.slice(1)
          next.progress = runningTools.size
            ? {
                phase: 'tool',
                toolName: runningTools.values().next().value?.toolName,
              }
            : event.progress
          if (
            text !== currentOutput.text
            || event.endOffset !== currentOutput.end
          ) {
            const base = Math.max(0, event.endOffset - text.length)
            const overlap = currentOutput.end - base
            const append
              = base >= currentOutput.base
                && overlap >= 0
                && event.endOffset >= currentOutput.end
                && text.slice(0, overlap)
                === currentOutput.text.slice(base - currentOutput.base)
            output = {
              text,
              base,
              end: event.endOffset,
              version: currentOutput.version + Number(!append),
              truncated: base > 0,
            }
            next.outputRevision++
          }
        }
        else if (event.type === 'diagnostic') {
          if (
            next.diagnostics.includes(event.message)
            || next.diagnostics.length >= 10
          ) {
            return
          }
          next.diagnostics.push(event.message)
        }
        else {
          let previous: RunToolDetail | undefined
          try {
            previous = store.tool(projectPath, run.id, event.toolCallId)
          }
          catch (error) {
            if (!(error instanceof RunError) || error.statusCode !== 404)
              throw error
          }
          if (
            previous
            && (previous.toolName !== event.toolName || event.type === 'tool_start' || previous.status !== 'running')
          ) {
            const contradiction
              = previous.toolName !== event.toolName
                || (event.type === 'tool_end'
                  && (previous.status === 'failed') !== event.isError)
            if (contradiction && next.diagnostics.length < 10) {
              next.diagnostics.push(
                '收到矛盾的重复工具事件，已保留首次确认的状态。',
              )
            }
            else {
              return
            }
          }
          else {
            const tool: RunToolDetail = previous
              ? { ...previous }
              : {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  sequence: next.toolCount + 1,
                  updatedRevision: next.revision,
                  status: 'running',
                  incomplete: false,
                  evidenceIncomplete: false,
                  inputPreview: '',
                  outputPreview: '',
                  inputTruncated: false,
                  outputTruncated: false,
                }
            if (!previous)
              next.toolCount++
            tool.updatedRevision = next.revision
            if (event.type === 'tool_start') {
              const input = preview(event.args)
              tool.startedAt = next.lastObservedAt
              tool.inputPreview = input.text
              tool.inputTruncated = input.truncated
              tool.evidenceIncomplete = input.incomplete
              if (tool.toolName === 'bash') {
                const command = event.args && typeof event.args === 'object' && 'command' in event.args && typeof event.args.command === 'string' ? preview(event.args.command) : null
                tool.command = { command: command?.text ?? null, commandTruncated: command?.truncated ?? false, exitCode: null, exitCodeSource: 'unavailable' }
              }
            }
            else {
              const result = preview(event.result, event.isError)
              tool.endedAt = next.lastObservedAt
              tool.status = event.isError ? 'failed' : 'succeeded'
              tool.durationMs = event.durationMs
              tool.outputPreview = result.text
              tool.outputTruncated = result.truncated
              tool.evidenceIncomplete ||= result.incomplete
              tool.incomplete = !tool.startedAt
              if (tool.toolName === 'bash') {
                const structured = event.result && typeof event.result === 'object' && 'structuredContent' in event.result ? event.result.structuredContent : null
                const code = structured && typeof structured === 'object' && 'exit_code' in structured && typeof structured.exit_code === 'number' && Number.isSafeInteger(structured.exit_code) ? structured.exit_code : null
                tool.command = { command: tool.command?.command ?? null, commandTruncated: tool.command?.commandTruncated ?? false, exitCode: code, exitCodeSource: code === null ? 'unavailable' : 'pi-structured-result' }
                if (code !== null && (code !== 0) !== event.isError && next.diagnostics.length < 10)
                  next.diagnostics.push('命令退出码与工具状态不一致，已分别保留原始事实。')
              }
              if (event.isError)
                next.failedToolCount++
            }
            if (delivery && (tool.toolName === 'bash' || (tool.toolName === CODE_DELIVERY_TOOL && event.type === 'tool_end') || (delivery.declaration && !delivery.declaration.subsequentToolActivity && tool.toolName !== CODE_DELIVERY_TOOL))) {
              changedDelivery = structuredClone(delivery)
              changedDelivery.revision++
              next.deliveryRevision = changedDelivery.revision
              if (tool.toolName === CODE_DELIVERY_TOOL && event.type === 'tool_end') {
                if (!event.isError) {
                  try {
                    const result = event.result
                    const details = result && typeof result === 'object' && 'details' in result ? result.details : null
                    const value = parseCodeDelivery(details && typeof details === 'object' && 'codeDelivery' in details ? details.codeDelivery : undefined)
                    tool.deliveryDeclaration = value
                    changedDelivery.declaration = { value, toolCallId: tool.toolCallId, submittedAt: next.lastObservedAt, sequence: tool.sequence, subsequentToolActivity: false }
                    changedDelivery.lastDeclarationError = undefined
                  }
                  catch (error) {
                    changedDelivery.lastDeclarationError = error instanceof Error ? error.message : String(error)
                    tool.evidenceIncomplete = true
                  }
                }
                else {
                  changedDelivery.lastDeclarationError = '交付声明工具未成功提交；保留此前有效声明。'
                }
              }
              else if (changedDelivery.declaration) {
                changedDelivery.declaration.subsequentToolActivity = true
              }
            }
            changed.push(tool)
          }
          const pending = new Map(runningTools)
          for (const tool of changed) {
            if (tool.status === 'running')
              pending.set(tool.toolCallId, tool)
            else pending.delete(tool.toolCallId)
          }
          next.progress = pending.size
            ? {
                phase: 'tool',
                toolName: pending.values().next().value?.toolName,
              }
            : undefined
        }
        store.save(next, changed, output, changedDelivery)
        run = next
        if (changedDelivery)
          delivery = changedDelivery
        if (output)
          currentOutput = output
        for (const tool of changed) {
          if (tool.status === 'running')
            runningTools.set(tool.toolCallId, tool)
          else runningTools.delete(tool.toolCallId)
        }
        publish({
          type: 'run_updated',
          projectPath,
          run: summarize(run),
          ...(changed.length ? { changedTools: changed.map(toolSummary) } : {}),
        })
        if (event.type === 'output') {
          try {
            onOutput?.(event.output)
          }
          catch (error) {
            console.error('[piflow] parent tool update failed', error)
          }
        }
      }
      catch (error) {
        recordFailure(error)
      }
    }
    async function perform(): Promise<RunResult> {
      let status: RunResult['status'] = 'failed'
      let error: string | undefined
      let output = ''
      let closed = false
      try {
        const outcome = await (options.execute ?? runSubagentProcess)(
          snapshot,
          combined,
          fact,
          { ...options, ...context },
        )
        output = outcome.output
        error = outcome.error
        closed = outcome.closed
        status
          = recordingError || closing
            ? 'interrupted'
            : outcome.cancelled
              ? 'cancelled'
              : error
                ? 'failed'
                : 'succeeded'
      }
      catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
        status
          = closing || recordingError
            ? 'interrupted'
            : combined.aborted
              ? 'cancelled'
              : 'failed'
      }
      const next: RunDetail = {
        ...run,
        status,
        progress: undefined,
        error,
        revision: run.revision + 1,
        durationMs: closedDuration ?? Math.max(0, performance.now() - began),
        ...(closed ? { completedAt: processExit?.closedAt ?? new Date().toISOString() } : {}),
        ...(processExit ? { processExit } : {}),
        ...(status === 'interrupted'
          ? { interruptedAt: new Date().toISOString() }
          : {}),
        ...(recordingError ? { recordingError } : {}),
      }
      const unfinished = [...runningTools.values()].map(tool => ({
        ...tool,
        status: 'interrupted' as const,
        incomplete: true,
        updatedRevision: next.revision,
      }))
      try {
        store.save(next, unfinished)
        publish({
          type: 'run_updated',
          projectPath,
          run: summarize(next),
          changedTools: unfinished.map(toolSummary),
        })
      }
      catch (failure) {
        recordFailure(failure)
      }
      let resultDelivery: RunResult['delivery']
      if (delivery) {
        try {
          resultDelivery = deliverySummary(readDelivery(next))
        }
        catch (failure) { recordFailure(failure) }
      }
      return {
        runId: run.id,
        status,
        output,
        error,
        ...(resultDelivery ? { delivery: resultDelivery } : {}),
        ...(recordingError ? { recordingError } : {}),
      }
    }
    // Publish only after registering cancellation, including for immediate listeners.
    const done = Promise.resolve().then(perform)
    active.set(run.id, { projectPath, controller, done, closed: false })
    publish({ type: 'run_updated', projectPath, run: summarize(run) })
    try {
      return await done
    }
    finally {
      active.delete(run.id)
    }
  }
  return {
    execute,
    async cancel(projectPath: string, runId: string) {
      const project = await normalize(projectPath)
      store.read(project, id(runId))
      const entry = active.get(runId)
      if (!entry || entry.closed || entry.projectPath !== project)
        throw new RunError('运行已结束或不再由当前进程管理', 409)
      entry.controller.abort()
    },
    async list(query: RunQuery) {
      return store.list({
        ...query,
        projectPath: await normalize(query.projectPath),
      })
    },
    async read(projectPath: string, runId: string) {
      const run = store.read(await normalize(projectPath), id(runId))
      return {
        ...run,
        ...(recordingErrors.has(runId)
          ? { recordingError: recordingErrors.get(runId) }
          : {}),
      }
    },
    async tools(query: RunToolsQuery) {
      return store.tools({
        ...query,
        runId: id(query.runId),
        projectPath: await normalize(query.projectPath),
      })
    },
    async commands(query: RunToolsQuery) {
      return store.commands({ ...query, runId: id(query.runId), projectPath: await normalize(query.projectPath) })
    },
    async delivery(projectPath: string, runId: string) {
      return readDelivery(store.read(await normalize(projectPath), id(runId)))
    },
    async tool(projectPath: string, runId: string, toolCallId: string) {
      return store.tool(
        await normalize(projectPath),
        id(runId),
        id(toolCallId),
      )
    },
    async output(query: RunOutputQuery) {
      for (const value of [query.after, query.version]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
          throw new RunError('输出游标无效')
      }
      return store.output({
        ...query,
        runId: id(query.runId),
        projectPath: await normalize(query.projectPath),
      })
    },
    close() {
      closePromise ??= (async () => {
        closing = true
        for (const entry of active.values()) entry.controller.abort()
        await Promise.allSettled(
          [...active.values()].map(entry => entry.done),
        )
        await store.close()
      })()
      return closePromise
    },
  }
}
