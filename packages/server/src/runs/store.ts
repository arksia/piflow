import type {
  RunCommandCounts,
  RunCommandsPage,
  RunDeliveryRecord,
  RunDetail,
  RunOutputChunk,
  RunOutputQuery,
  RunPage,
  RunQuery,
  RunSummary,
  RunToolDetail,
  RunToolsPage,
  RunToolsQuery,
  RunToolSummary,
} from '@piflow/protocol'
import { Buffer } from 'node:buffer'
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PAGE_SIZE = 50
export class RunError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message)
  }
}
export function summarize({
  task: _task,
  configurationSnapshot: _config,
  error: _error,
  recordingError: _recording,
  historyAvailability: _history,
  diagnostics: _diagnostics,
  processExit: _process,
  ...summary
}: RunDetail): RunSummary {
  return summary
}
export function toolSummary({
  inputPreview: _input,
  outputPreview: _output,
  inputTruncated: _it,
  outputTruncated: _ot,
  command,
  deliveryDeclaration: _declaration,
  ...summary
}: RunToolDetail): RunToolSummary {
  return { ...summary, ...(command ? { hasCommandEvidence: true, commandExitCode: command.exitCode } : {}) }
}
function cursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
function decodeCursor(value: string): unknown {
  try {
    if (value.length > 4000)
      throw new Error('oversize cursor')
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  }
  catch {
    throw new RunError('运行记录游标无效')
  }
}
interface OutputWindow {
  text: string
  version: number
  base: number
  end: number
  truncated: boolean
}
export async function openRunStore(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  // SQLite's OS lock is released on crashes; no stale PID files or unsafe PID killing.
  const lease = new DatabaseSync(join(dataDir, 'runs-owner.sqlite'))
  try {
    lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
  }
  catch {
    lease.close()
    throw new Error('运行数据目录正被另一个 piflow 实例使用。')
  }
  const unlock = () => lease.close()
  let db: DatabaseSync
  try {
    db = new DatabaseSync(join(dataDir, 'runs.sqlite'))
    await chmod(join(dataDir, 'runs.sqlite'), 0o600)
  }
  catch (error) {
    await unlock()
    throw error
  }
  try {
    db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
    )
    const schema = Number(
      db.prepare('PRAGMA user_version').get()!.user_version,
    )
    if (schema > 2)
      throw new Error('运行数据库来自更新的 piflow 版本，请升级后重试')
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_path TEXT NOT NULL, created_at TEXT NOT NULL,
        orchestrator_id TEXT NOT NULL, role_id TEXT NOT NULL, status TEXT NOT NULL,
        metadata TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', output_version INTEGER NOT NULL DEFAULT 1,
        output_base INTEGER NOT NULL DEFAULT 0, output_end INTEGER NOT NULL DEFAULT 0,
        output_truncated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS runs_project_created ON runs(project_path, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS runs_active ON runs(project_path, status);
      CREATE TABLE IF NOT EXISTS run_tools (
        run_id TEXT NOT NULL REFERENCES runs(id), tool_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(run_id, tool_id), UNIQUE(run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS run_deliveries (
        run_id TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL
      );
      PRAGMA user_version=2;
      COMMIT;
    `)
  }
  catch (error) {
    db.close()
    await unlock()
    throw error
  }
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  function read(projectPath: string, id: string): RunDetail {
    const row = db
      .prepare('SELECT metadata FROM runs WHERE id=? AND project_path=?')
      .get(id, projectPath)
    if (!row)
      throw new RunError('运行记录不存在', 404)
    return JSON.parse(String(row.metadata)) as RunDetail
  }
  function insert(run: RunDetail, output = '', delivery?: RunDeliveryRecord) {
    function write() {
      db.prepare(
        `INSERT INTO runs(id, project_path, created_at, orchestrator_id, role_id, status, metadata, output, output_end)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(
        run.id,
        run.projectPath,
        run.createdAt,
        run.orchestratorId,
        run.roleId,
        run.status,
        JSON.stringify(run),
        output,
        output.length,
      )
      if (delivery)
        saveDelivery(delivery)
    }
    if (delivery)
      transaction(write)
    else write()
  }
  function toolsAll(id: string, status?: string): RunToolDetail[] {
    return db
      .prepare(
        `SELECT data FROM run_tools WHERE run_id=?${status ? ' AND status=?' : ''} ORDER BY sequence`,
      )
      .all(...(status ? [id, status] : [id]))
      .map(row => JSON.parse(String(row.data)) as RunToolDetail)
  }
  function save(
    run: RunDetail,
    changed: RunToolDetail[] = [],
    output?: OutputWindow,
    delivery?: RunDeliveryRecord,
  ) {
    transaction(() => {
      db.prepare(
        'UPDATE runs SET metadata=?, status=? WHERE id=? AND project_path=?',
      ).run(JSON.stringify(run), run.status, run.id, run.projectPath)
      for (const tool of changed) {
        db.prepare(
          `INSERT INTO run_tools(run_id,tool_id,sequence,status,data) VALUES(?,?,?,?,?)
          ON CONFLICT(run_id,tool_id) DO UPDATE SET status=excluded.status,data=excluded.data`,
        ).run(
          run.id,
          tool.toolCallId,
          tool.sequence,
          tool.status,
          JSON.stringify(tool),
        )
      }
      if (output) {
        db.prepare(
          'UPDATE runs SET output=?,output_version=?,output_base=?,output_end=?,output_truncated=? WHERE id=?',
        ).run(
          output.text,
          output.version,
          output.base,
          output.end,
          Number(output.truncated),
          run.id,
        )
      }
      if (delivery)
        saveDelivery(delivery)
    })
  }
  function saveDelivery(delivery: RunDeliveryRecord) {
    db.prepare('INSERT INTO run_deliveries(run_id,data) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET data=excluded.data')
      .run(delivery.runId, JSON.stringify(delivery))
  }
  function delivery(projectPath: string, runId: string): RunDeliveryRecord | undefined {
    read(projectPath, runId)
    const row = db.prepare('SELECT data FROM run_deliveries WHERE run_id=?').get(runId)
    return row ? JSON.parse(String(row.data)) as RunDeliveryRecord : undefined
  }
  function tool(
    projectPath: string,
    id: string,
    toolId: string,
  ): RunToolDetail {
    read(projectPath, id)
    const row = db
      .prepare('SELECT data FROM run_tools WHERE run_id=? AND tool_id=?')
      .get(id, toolId)
    if (!row)
      throw new RunError('工具步骤不存在', 404)
    return JSON.parse(String(row.data)) as RunToolDetail
  }
  function window(id: string): OutputWindow {
    const row = db
      .prepare(
        'SELECT output,output_version,output_base,output_end,output_truncated FROM runs WHERE id=?',
      )
      .get(id)!
    return {
      text: String(row.output),
      version: Number(row.output_version),
      base: Number(row.output_base),
      end: Number(row.output_end),
      truncated: Boolean(row.output_truncated),
    }
  }
  function list(query: RunQuery): RunPage {
    const { projectPath, orchestratorId, roleId } = query
    const scope = JSON.stringify([
      projectPath,
      orchestratorId ?? '',
      roleId ?? '',
    ])
    const where = ['project_path=?']
    const params: (string | number)[] = [projectPath]
    if (orchestratorId) {
      where.push('orchestrator_id=?')
      params.push(orchestratorId)
    }
    if (roleId) {
      where.push('role_id=?')
      params.push(roleId)
    }
    const active = db
      .prepare(
        `SELECT metadata FROM runs WHERE ${where.join(' AND ')} AND status='running'`,
      )
      .all(...params)
      .map(row => summarize(JSON.parse(String(row.metadata))))
    const latestRoleRuns = db.prepare(`SELECT metadata FROM (
      SELECT metadata, ROW_NUMBER() OVER (PARTITION BY orchestrator_id,role_id ORDER BY created_at DESC,id DESC) AS rank
      FROM runs WHERE ${where.join(' AND ')}
    ) WHERE rank=1`).all(...params).map(row => summarize(JSON.parse(String(row.metadata))))
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor)
      if (
        !Array.isArray(decoded)
        || decoded.length !== 3
        || decoded[0] !== scope
        || typeof decoded[1] !== 'string'
        || typeof decoded[2] !== 'string'
      ) {
        throw new RunError('运行记录游标与筛选不匹配')
      }
      where.push('(created_at < ? OR (created_at = ? AND id < ?))')
      params.push(decoded[1], decoded[1], decoded[2])
    }
    const rows = db
      .prepare(
        `SELECT metadata FROM runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params, PAGE_SIZE + 1)
    const runs = rows
      .slice(0, PAGE_SIZE)
      .map(row => summarize(JSON.parse(String(row.metadata))))
    const last = runs.at(-1)
    return {
      projectPath,
      runs,
      activeRuns: active,
      latestRoleRuns,
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? cursor([scope, last.createdAt, last.id])
          : null,
    }
  }
  function tools(query: RunToolsQuery): RunToolsPage {
    const run = read(query.projectPath, query.runId)
    let after = 0
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor)
      if (
        !Array.isArray(decoded)
        || decoded.length !== 3
        || decoded[0] !== query.projectPath
        || decoded[1] !== query.runId
        || !Number.isSafeInteger(decoded[2])
        || decoded[2] < 0
      ) {
        throw new RunError('工具步骤游标无效')
      }
      after = decoded[2] as number
    }
    const summaries = db
      .prepare(
        `SELECT json_remove(data,'$.inputPreview','$.outputPreview','$.inputTruncated','$.outputTruncated','$.command','$.deliveryDeclaration') AS summary,
        json_extract(data,'$.command') AS command
      FROM run_tools WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?`,
      )
      .all(query.runId, after, PAGE_SIZE + 1)
      .map(row => ({ ...JSON.parse(String(row.summary)), ...(row.command ? { hasCommandEvidence: true, commandExitCode: JSON.parse(String(row.command)).exitCode } : {}) }) as RunToolSummary)
    const page = summaries.slice(0, PAGE_SIZE)
    return {
      tools: page,
      activeTools: toolsAll(query.runId, 'running').map(toolSummary),
      revision: run.revision,
      nextCursor:
        summaries.length > PAGE_SIZE
          ? cursor([query.projectPath, query.runId, page.at(-1)!.sequence])
          : null,
    }
  }
  function commandCounts(runId: string): RunCommandCounts {
    const row = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(json_extract(data,'$.command.exitCode') != 0),0) AS nonzero,
      COALESCE(SUM(json_extract(data,'$.command.exitCode') IS NULL),0) AS unknown
      FROM run_tools WHERE run_id=? AND json_extract(data,'$.toolName')='bash'`).get(runId)!
    return { total: Number(row.total), nonzero: Number(row.nonzero), unknown: Number(row.unknown) }
  }
  function commands(query: RunToolsQuery): RunCommandsPage {
    const run = read(query.projectPath, query.runId)
    let after = 0
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor)
      if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 'commands' || decoded[1] !== query.projectPath || decoded[2] !== query.runId || !Number.isSafeInteger(decoded[3]) || decoded[3] < 0)
        throw new RunError('命令游标无效')
      after = decoded[3] as number
    }
    const rows = db.prepare(`SELECT data FROM run_tools WHERE run_id=? AND sequence>? AND json_extract(data,'$.toolName')='bash' ORDER BY sequence LIMIT ?`)
      .all(query.runId, after, PAGE_SIZE + 1)
    const page = rows.slice(0, PAGE_SIZE).map((row) => {
      const tool = JSON.parse(String(row.data)) as RunToolDetail
      const command = tool.command?.command ?? null
      return { ...toolSummary(tool), commandPreview: command?.slice(0, 160) ?? null, commandTruncated: !!tool.command?.commandTruncated || (command?.length ?? 0) > 160 }
    })
    return { commands: page, counts: commandCounts(query.runId), revision: run.revision, nextCursor: rows.length > PAGE_SIZE ? cursor(['commands', query.projectPath, query.runId, page.at(-1)!.sequence]) : null }
  }
  function output(query: RunOutputQuery): RunOutputChunk {
    const run = read(query.projectPath, query.runId)
    const value = window(query.runId)
    const reset
      = query.version !== value.version
        || query.after === undefined
        || query.after < value.base
        || query.after > value.end
    let index = reset ? 0 : query.after! - value.base
    // A cursor from a previous window may sit inside a UTF-16 surrogate pair.
    if (
      index > 0
      && /[\uDC00-\uDFFF]/.test(value.text[index] ?? '')
      && /[\uD800-\uDBFF]/.test(value.text[index - 1] ?? '')
    ) {
      index--
    }
    return {
      text: value.text.slice(index),
      reset: reset || index !== (query.after ?? value.base) - value.base,
      version: value.version,
      baseOffset: value.base + index,
      endOffset: value.end,
      truncated: value.truncated,
      revision: run.outputRevision,
    }
  }
  async function migrate() {
    let files: string[]
    try {
      files = await readdir(join(dataDir, 'flows'))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return
      throw error
    }
    for (const file of files.filter(name => name.endsWith('.json'))) {
      const path = join(dataDir, 'flows', file)
      const document = JSON.parse(await readFile(path, 'utf8')) as Record<
        string,
        unknown
      >
      if (document.runs === undefined)
        continue
      if (
        !Array.isArray(document.runs)
        || typeof document.projectPath !== 'string'
      ) {
        throw new TypeError(`无法迁移旧运行记录：${file}`)
      }
      transaction(() => {
        for (const value of document.runs as unknown[]) {
          if (!value || typeof value !== 'object')
            throw new Error('旧运行记录格式无效')
          const old = value as Record<string, unknown>
          if (
            typeof old.id !== 'string'
            || typeof old.task !== 'string'
            || typeof old.orchestratorId !== 'string'
            || typeof old.roleId !== 'string'
            || typeof old.parentSessionPath !== 'string'
            || typeof old.parentToolCallId !== 'string'
            || typeof old.createdAt !== 'string'
            || typeof old.output !== 'string'
            || !old.configurationSnapshot
            || typeof old.configurationSnapshot !== 'object'
            || ![
              'running',
              'succeeded',
              'failed',
              'cancelled',
              'interrupted',
            ].includes(String(old.status))
          ) {
            throw new Error('旧运行记录字段无效')
          }
          const exists = db
            .prepare(
              'SELECT project_path,orchestrator_id,role_id FROM runs WHERE id=?',
            )
            .get(old.id)
          if (exists) {
            if (
              exists.project_path !== document.projectPath
              || exists.orchestrator_id !== old.orchestratorId
              || exists.role_id !== old.roleId
            ) {
              throw new Error('旧运行记录身份冲突')
            }
            continue
          }
          const config
            = old.configurationSnapshot as RunDetail['configurationSnapshot']
          const node = Array.isArray(document.nodes)
            ? (
                document.nodes as {
                  id: string
                  name: string
                }[]
              ).find(node => node.id === old.orchestratorId)
            : undefined
          const { output: _output, ...legacy } = old as unknown as RunDetail & {
            output: string
          }
          insert(
            {
              ...legacy,
              projectPath: document.projectPath as string,
              orchestratorName: node?.name ?? old.orchestratorId,
              roleName: config.roleName ?? old.roleId,
              taskPreview: old.task.slice(0, 200),
              lastObservedAt: old.createdAt,
              revision: 1,
              outputRevision: 1,
              toolCount: 0,
              failedToolCount: 0,
              historyAvailability: 'legacy',
              diagnostics:
                old.status === 'interrupted'
                  ? ['旧版本的中断完成时间不可靠。']
                  : [],
              ...(old.status === 'interrupted'
                ? { completedAt: undefined }
                : {}),
            },
            old.output,
          )
        }
      })
      delete document.runs
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        mode: 0o600,
      })
      await rename(temporary, path)
    }
  }
  function recover() {
    transaction(() => {
      for (const row of db
        .prepare('SELECT metadata FROM runs WHERE status=\'running\'')
        .all()) {
        const run = JSON.parse(String(row.metadata)) as RunDetail
        run.status = 'interrupted'
        run.interruptedAt = new Date().toISOString()
        run.completedAt = run.processExit?.closedAt
        run.progress = undefined
        run.revision++
        run.error = run.processExit
          ? '进程已确认关闭，但服务重启中断了交付整理；请检查已保存的执行证据。'
          : '服务重启，执行观察已中断；请检查工作区后再决定是否重新委派。'
        const record = delivery(run.projectPath, run.id)
        if (record) {
          if (record.before.state === 'pending')
            record.before = { state: 'not-captured', reason: '服务重启中断采集。' }
          if (record.after.state === 'pending')
            record.after = { state: 'not-captured', reason: '服务重启中断采集。' }
          record.revision++
          run.deliveryRevision = record.revision
          saveDelivery(record)
        }
        const changed = toolsAll(run.id, 'running').map(tool => ({
          ...tool,
          status: 'interrupted' as const,
          incomplete: true,
          updatedRevision: run.revision,
        }))
        db.prepare('UPDATE runs SET metadata=?,status=? WHERE id=?').run(
          JSON.stringify(run),
          run.status,
          run.id,
        )
        for (const tool of changed) {
          db.prepare(
            'UPDATE run_tools SET data=?,status=? WHERE run_id=? AND tool_id=?',
          ).run(JSON.stringify(tool), tool.status, run.id, tool.toolCallId)
        }
      }
    })
  }
  try {
    await migrate()
    recover()
  }
  catch (error) {
    db.close()
    await unlock()
    throw error
  }
  return {
    read,
    insert,
    save,
    list,
    tools,
    tool,
    toolsAll,
    commands,
    commandCounts,
    delivery,
    window,
    output,
    close: async () => {
      db.close()
      await unlock()
    },
  }
}
