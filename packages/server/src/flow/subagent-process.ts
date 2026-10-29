import type { SubagentRun } from '@piflow/protocol'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

const MAX_OUTPUT = 160_000

/** Run an isolated JSON CLI process without saving a session. */
export async function runSubagentProcess(
  run: SubagentRun,
  signal: AbortSignal,
  onProgress: (output: string, progress?: SubagentRun['progress']) => Promise<void>,
  options: { cliEntry?: string, agentDir?: string } = {},
): Promise<{ output: string, error?: string, cancelled: boolean }> {
  const promptDir = await mkdtemp(join(tmpdir(), 'piflow-subagent-'))
  let output = ''
  let failure: string | undefined
  let stderr = ''
  try {
    const promptFile = join(promptDir, 'role.md')
    await writeFile(promptFile, run.configurationSnapshot.effectivePrompt, { mode: 0o600 })
    const config = run.configurationSnapshot
    const cliEntry = options.cliEntry ?? join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js')
    const args = [cliEntry, '--mode', 'json', '-p', '--no-session', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--append-system-prompt', promptFile, '--model', config.model, '--thinking', config.thinkingLevel, ...(config.tools.length ? ['--tools', config.tools.join(',')] : ['--no-tools']), '--', `Task: ${run.task}`]
    if (signal.aborted)
      return { output, cancelled: true }
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: config.cwd,
        detached: process.platform !== 'win32',
        shell: false,
        env: { ...process.env, ...(options.agentDir ? { PI_CODING_AGENT_DIR: options.agentDir } : {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let buffer = ''
      const decoder = new StringDecoder('utf8')
      let completedOutput = ''
      let partialOutput = ''
      let progress: SubagentRun['progress']
      let progressTimer: ReturnType<typeof setTimeout> | undefined
      let writes = Promise.resolve()
      let timeout: ReturnType<typeof setTimeout> | undefined
      let stopping = false
      function kill(signal: NodeJS.Signals) {
        try {
          if (process.platform !== 'win32' && child.pid)
            process.kill(-child.pid, signal)
          else
            child.kill(signal)
        }
        catch { /* process already exited */ }
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
        if (progressTimer)
          clearTimeout(progressTimer)
        progressTimer = undefined
        output = [completedOutput, partialOutput].filter(Boolean).join('\n\n').slice(-MAX_OUTPUT)
        const snapshot = output
        const state = progress
        writes = writes.then(() => onProgress(snapshot, state))
        void writes.catch(() => abort())
      }
      function schedule() {
        // Bound durable updates to four per second while retaining the latest streamed text.
        progressTimer ??= setTimeout(flush, 250)
      }
      function line(text: string) {
        let event: unknown
        try {
          event = JSON.parse(text)
        }
        catch {
          return
        }
        if (!event || typeof event !== 'object' || !('type' in event))
          return
        if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
          const update = event.assistantMessageEvent
          if (update && typeof update === 'object' && 'type' in update) {
            if (update.type === 'text_delta' && 'delta' in update && typeof update.delta === 'string') {
              partialOutput = (partialOutput + update.delta).slice(-MAX_OUTPUT)
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
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
          progress = event.type === 'tool_execution_start'
            ? { phase: 'tool', toolName: 'toolName' in event && typeof event.toolName === 'string' ? event.toolName : undefined }
            : { phase: 'thinking' }
          schedule()
          return
        }
        if (event.type !== 'message_end' || !('message' in event))
          return
        const message = event.message
        if (!message || typeof message !== 'object' || !('role' in message) || message.role !== 'assistant')
          return
        if ('stopReason' in message && (message.stopReason === 'error' || message.stopReason === 'aborted'))
          failure = 'errorMessage' in message && typeof message.errorMessage === 'string' ? message.errorMessage : String(message.stopReason)
        if ('content' in message && Array.isArray(message.content)) {
          const text = message.content.flatMap((part: unknown) => part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('\n')
          completedOutput = [completedOutput, text].filter(Boolean).join('\n\n').slice(-MAX_OUTPUT)
          partialOutput = ''
          flush()
        }
      }
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += decoder.write(chunk)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const text of lines)
          line(text)
        if (buffer.length > 2_000_000) {
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
      child.once('error', reject)
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort)
        if (timeout)
          clearTimeout(timeout)
        buffer += decoder.end()
        if (buffer.trim())
          line(buffer)
        if (progressTimer)
          flush()
        void writes.then(() => resolve(code ?? 1), reject)
      })
    })
    if (code !== 0 && !failure)
      failure = stderr || `Subagent exited with code ${code}`
    if (!output && !failure && !signal.aborted)
      failure = 'Subagent returned no assistant output'
    return { output, error: failure, cancelled: signal.aborted }
  }
  finally {
    await rm(promptDir, { recursive: true, force: true })
  }
}
