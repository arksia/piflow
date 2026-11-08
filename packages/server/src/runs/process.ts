import type { RunInput, RunSummary } from '@piflow/protocol'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { CODE_DELIVERY_TOOL } from './delivery'

const MAX_OUTPUT = 160000
export type ProcessFact
  = | {
    type: 'output'
    output: string
    endOffset: number
    progress?: RunSummary['progress']
  }
  | {
    type: 'tool_start'
    toolCallId: string
    toolName: string
    args: unknown
  }
  | {
    type: 'tool_end'
    toolCallId: string
    toolName: string
    result: unknown
    isError: boolean
    durationMs?: number
  }
  | {
    type: 'diagnostic'
    message: string
  }
  | {
    type: 'closed'
    exitCode?: number | null
    signal?: string | null
  }
/** The JSON process Adapter reports facts; the runs Module owns their meaning. */
export async function runSubagentProcess(
  run: RunInput,
  signal: AbortSignal,
  onFact: (fact: ProcessFact) => void,
  options: {
    cliEntry?: string
    agentDir?: string
  } = {},
): Promise<{
  output: string
  error?: string
  cancelled: boolean
  closed: boolean
}> {
  const promptDir = await mkdtemp(join(tmpdir(), 'piflow-subagent-'))
  let output = ''
  let failure: string | undefined
  let stderr = ''
  let closed = false
  let cancelledAtClose = false
  try {
    const promptFile = join(promptDir, 'role.md')
    await writeFile(promptFile, run.configurationSnapshot.effectivePrompt, {
      mode: 0o600,
    })
    const config = run.configurationSnapshot
    const cliEntry
      = options.cliEntry
        ?? join(
          dirname(
            fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')),
          ),
          'bundle/cli.js',
        )
    const args = [
      cliEntry,
      '--mode',
      'json',
      '-p',
      '--no-session',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
      ...(config.delivery ? ['-e', fileURLToPath(new URL('./code-delivery-extension.ts', import.meta.url))] : []),
      '--append-system-prompt',
      promptFile,
      '--model',
      config.model,
      '--thinking',
      config.thinkingLevel,
      ...(config.tools.length || config.delivery
        ? ['--tools', [...new Set([...config.tools, ...(config.delivery ? [CODE_DELIVERY_TOOL] : [])])].join(',')]
        : ['--no-tools']),
      '--',
      `Task: ${run.task}`,
    ]
    if (signal.aborted)
      return { output, cancelled: true, closed }
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: config.cwd,
        detached: process.platform !== 'win32',
        shell: false,
        env: {
          ...process.env,
          ...(options.agentDir
            ? { PI_CODING_AGENT_DIR: options.agentDir }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let buffer = ''
      const decoder = new StringDecoder('utf8')
      let completed = ''
      let completedLength = 0
      let partial = ''
      let partialLength = 0
      let progress: RunSummary['progress']
      let progressTimer: ReturnType<typeof setTimeout> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      let stopping = false
      function kill(signal: NodeJS.Signals) {
        try {
          if (process.platform !== 'win32' && child.pid)
            process.kill(-child.pid, signal)
          else child.kill(signal)
        }
        catch {
          /* process already exited */
        }
      }
      function abort() {
        if (stopping)
          return
        stopping = true
        kill('SIGTERM')
        timeout = setTimeout(kill, 5000, 'SIGKILL')
        timeout.unref()
      }
      function flush() {
        clearTimeout(progressTimer)
        progressTimer = undefined
        output = [completed, partial]
          .filter(Boolean)
          .join('\n\n')
          .slice(-MAX_OUTPUT)
        if (/[\uDC00-\uDFFF]/.test(output[0] ?? ''))
          output = output.slice(1)
        onFact({
          type: 'output',
          output,
          endOffset:
            completedLength
            + partialLength
            + (completedLength && partialLength ? 2 : 0),
          progress,
        })
      }
      function schedule() {
        progressTimer ??= setTimeout(flush, 250)
      }
      function line(text: string) {
        let event: unknown
        try {
          event = JSON.parse(text)
        }
        catch {
          onFact({
            type: 'diagnostic',
            message: '子进程输出了无法解析的 JSON 事件。',
          })
          return
        }
        if (!event || typeof event !== 'object' || !('type' in event))
          return
        if (
          event.type === 'message_update'
          && 'assistantMessageEvent' in event
        ) {
          const update = event.assistantMessageEvent
          if (update && typeof update === 'object' && 'type' in update) {
            if (
              update.type === 'text_delta'
              && 'delta' in update
              && typeof update.delta === 'string'
            ) {
              partialLength += update.delta.length
              partial = (partial + update.delta).slice(-MAX_OUTPUT)
              progress = { phase: 'responding' }
              schedule()
            }
            else if (update.type === 'thinking_delta') {
              progress = { phase: 'thinking' }
              schedule()
            }
          }
          return
        }
        if (
          event.type === 'tool_execution_start'
          || event.type === 'tool_execution_end'
        ) {
          // Flush text first, but never throttle tool lifecycle facts.
          if (progressTimer)
            flush()
          if (
            !('toolCallId' in event)
            || typeof event.toolCallId !== 'string'
            || !event.toolCallId
            || event.toolCallId.length > 1000
            || !('toolName' in event)
            || typeof event.toolName !== 'string'
          ) {
            onFact({
              type: 'diagnostic',
              message: '工具事件缺少有效的调用身份，部分步骤不可用。',
            })
            return
          }
          if (event.type === 'tool_execution_start') {
            onFact({
              type: 'tool_start',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: 'args' in event ? event.args : undefined,
            })
          }
          else if ('isError' in event && typeof event.isError === 'boolean') {
            onFact({
              type: 'tool_end',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: 'result' in event ? event.result : undefined,
              isError: event.isError,
              ...('durationMs' in event
                && typeof event.durationMs === 'number'
                && Number.isFinite(event.durationMs)
                && event.durationMs >= 0
                ? { durationMs: event.durationMs }
                : {}),
            })
          }
          else {
            onFact({
              type: 'diagnostic',
              message: '工具结束事件缺少有效状态。',
            })
          }
          return
        }
        if (event.type !== 'message_end' || !('message' in event))
          return
        const message = event.message
        if (
          !message
          || typeof message !== 'object'
          || !('role' in message)
          || message.role !== 'assistant'
        ) {
          return
        }
        if (
          'stopReason' in message
          && (message.stopReason === 'error' || message.stopReason === 'aborted')
        ) {
          failure
            = 'errorMessage' in message
              && typeof message.errorMessage === 'string'
              ? message.errorMessage
              : String(message.stopReason)
        }
        if ('content' in message && Array.isArray(message.content)) {
          const text = message.content
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
          if (text) {
            completedLength += text.length + (completedLength ? 2 : 0)
            completed = [completed, text]
              .filter(Boolean)
              .join('\n\n')
              .slice(-MAX_OUTPUT)
          }
          partial = ''
          partialLength = 0
          flush()
        }
      }
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += decoder.write(chunk)
        // Bound complete records as well as a trailing partial record.
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n')
          const text = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          if (text.length > 2000000) {
            failure = 'Subagent event exceeded output limit'
            abort()
          }
          else if (text.trim()) {
            line(text)
          }
        }
        if (buffer.length > 2000000) {
          failure = 'Subagent event exceeded output limit'
          buffer = ''
          abort()
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-8000)
      })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted)
        abort()
      child.once('error', (error) => {
        failure = error.message
      })
      child.once('close', (code, exitSignal) => {
        signal.removeEventListener('abort', abort)
        clearTimeout(timeout)
        buffer += decoder.end()
        if (buffer.trim())
          line(buffer)
        if (progressTimer)
          flush()
        closed = true
        cancelledAtClose = signal.aborted
        onFact({ type: 'closed', exitCode: code, signal: exitSignal })
        resolve(code ?? 1)
      })
    })
    if (code !== 0 && !failure)
      failure = stderr || `Subagent exited with code ${code}`
    if (!output && !failure && !signal.aborted)
      failure = 'Subagent returned no assistant output'
    return { output, error: failure, cancelled: cancelledAtClose, closed }
  }
  finally {
    await rm(promptDir, { recursive: true, force: true })
  }
}
