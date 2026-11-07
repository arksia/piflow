import type {
  RunDetail,
  RunOutputChunk,
  RunSummary,
  RunToolDetail,
  RunToolsPage,
  RunToolSummary,
} from '@piflow/protocol'
import type { RunFilter } from './store'
import {
  API_RUNS_PATH,
  buildRunsPath,
  RUN_STATUS_LABELS,
} from '@piflow/protocol'
import { ArrowUpRight, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '../../components/Dialog'
import { openSession } from '../../session/actions'
import { api, post } from '../../session/api'
import { requestToolFocus } from '../../session/store'
import { mergeOutput } from './cache'
import {
  acceptRunDetail,
  acceptTools,
  getRunsConnection,
  loadRunWindow,
  runProject,
  runWindow,
} from './store'
import styles from './styles.module.css'
import { formatDuration, runOrder } from './time'
import RunTimeline from './timeline'
import { useRunProject } from './use-runs'

function time(value: string | number) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
export default function RunPanel({
  projectPath,
  initialFilter = {},
  onClose,
  onShowChat,
}: {
  projectPath: string
  initialFilter?: RunFilter
  onClose: () => void
  onShowChat: () => void
}) {
  const project = useRunProject(projectPath)
  const [owner, setOwner] = useState(initialFilter.orchestratorId ?? '')
  const [role, setRole] = useState(initialFilter.roleId ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filter: RunFilter = {
    ...(owner ? { orchestratorId: owner } : {}),
    ...(role ? { roleId: role } : {}),
  }
  const window = runWindow(projectPath, filter)
  const connection = getRunsConnection()
  const [now, setNow] = useState(Date.now)
  const frozenNowRef = useRef(now)
  if (connection.connected && window.initialized && !window.loading && !window.error)
    frozenNowRef.current = now
  const rows = [...window.ids]
    .flatMap(id => (project.runs[id] ? [project.runs[id]!] : []))
    .sort(runOrder)
  const active = rows.some(run => run.status === 'running')
  const key = JSON.stringify(filter)
  useEffect(() => {
    void loadRunWindow(projectPath, JSON.parse(key) as RunFilter)
  }, [projectPath, key])
  useEffect(() => {
    if (!active || !connection.connected)
      return
    let timer: ReturnType<typeof setInterval> | undefined
    function sync() {
      clearInterval(timer)
      if (document.visibilityState !== 'hidden')
        timer = setInterval(() => setNow(Date.now()), 1000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [active, connection.connected])
  const selected = selectedId && project.runs[selectedId]
  const owners = new Map(
    Object.values(project.runs).map(run => [
      run.orchestratorId,
      run.orchestratorName,
    ]),
  )
  const roles = new Map(
    Object.values(project.runs).map(run => [run.roleId, run.roleName]),
  )
  return (
    <Dialog
      title="运行记录"
      width={1240}
      maxHeight={820}
      responsive
      onClose={onClose}
      actions={(
        <button
          type="button"
          className={styles.action}
          disabled={window.loading}
          onClick={() => void loadRunWindow(projectPath, filter)}
          aria-label="刷新运行记录"
        >
          <RefreshCw size={15} />
        </button>
      )}
    >
      <div className={styles.filters}>
        <label>
          主 Agent
          <select
            value={owner}
            onChange={(event) => {
              setOwner(event.target.value)
              setSelectedId(null)
            }}
          >
            <option value="">全部</option>
            {[...owners].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          角色
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value)
              setSelectedId(null)
            }}
          >
            <option value="">全部</option>
            {[...roles].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span role="status">
          {!connection.connected
            ? '连接中断 · 状态待同步'
            : window.loading
              ? '正在同步…'
              : window.error
                ? '同步失败 · 记录可能过期'
                : `已加载 ${rows.length} 次运行`}
        </span>
      </div>
      {window.error
        ? (
            <p className={styles.error} role="alert">
              {window.error}
              <button
                type="button"
                onClick={() => void loadRunWindow(projectPath, filter)}
              >
                重试
              </button>
            </p>
          )
        : null}
      <div
        className={`${styles.workspace} ${selected ? styles.hasDetail : ''}`}
      >
        <section className={styles.list} aria-label="运行时间线">
          {rows.length
            ? <RunTimeline runs={rows} now={frozenNowRef.current} live={connection.connected && !window.loading && !window.error} selectedId={selectedId} onSelect={setSelectedId} />
            : <p className={styles.empty}>{window.loading ? '正在加载运行记录…' : '尚无符合条件的运行。主 Agent 委派任务后会在这里留下记录。'}</p>}
          {window.nextCursor
            ? (
                <button
                  className={styles.more}
                  type="button"
                  disabled={window.loading}
                  onClick={() => void loadRunWindow(projectPath, filter, true)}
                >
                  {window.loading ? '加载中…' : '加载更早运行'}
                </button>
              )
            : null}
        </section>
        {selected
          ? (
              <RunInspector
                key={`${projectPath}:${selected.id}`}
                run={selected}
                connectionVersion={connection.version}
                now={frozenNowRef.current}
                onDismiss={() => setSelectedId(null)}
                onParent={async () => {
                  await openSession(selected.parentSessionPath)
                  requestToolFocus(
                    selected.parentSessionPath,
                    selected.parentToolCallId,
                  )
                  onClose()
                  onShowChat()
                }}
              />
            )
          : null}
      </div>
    </Dialog>
  )
}
function RunInspector({
  run,
  connectionVersion,
  onParent,
  onDismiss,
  now,
}: {
  run: RunSummary
  connectionVersion: number
  onParent: () => Promise<void>
  onDismiss: () => void
  now: number
}) {
  const project = runProject(run.projectPath)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [output, setOutput] = useState<RunOutputChunk | null>(null)
  const outputRef = useRef<RunOutputChunk | null>(null)
  const outputRequestRef = useRef({ busy: false, pending: false })
  const [toolId, setToolId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingTools, setLoadingTools] = useState(false)
  const cursorRef = useRef<string | null>(null)
  const cursorsRef = useRef<(string | undefined)[]>([undefined])
  const toolsRequestRef = useRef(0)
  const currentRef = useRef(true)
  const [retry, setRetry] = useState(0)
  const suffix = `/${encodeURIComponent(run.id)}`
  useEffect(() => {
    currentRef.current = true
    const requests = toolsRequestRef
    return () => {
      currentRef.current = false
      requests.current++
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void api<RunDetail>(buildRunsPath(run.projectPath, suffix))
      .then((value) => {
        if (!cancelled) {
          setDetail(value)
          acceptRunDetail(value)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [
    run.projectPath,
    suffix,
    run.status,
    run.toolCount,
    run.failedToolCount,
    connectionVersion,
    retry,
  ])
  const loadTools = useCallback(async (more: boolean) => {
    const request = ++toolsRequestRef.current
    setLoadingTools(true)
    try {
      const queryCursors = more && cursorRef.current ? [cursorRef.current] : cursorsRef.current
      const pages = await Promise.all(
        queryCursors.map(cursor =>
          api<RunToolsPage>(
            buildRunsPath(run.projectPath, `${suffix}/tools`, { cursor }),
          ),
        ),
      )
      if (!currentRef.current || request !== toolsRequestRef.current)
        return
      acceptTools(
        run.projectPath,
        run.id,
        pages.flatMap(page => [...page.tools, ...page.activeTools]),
      )
      if (more)
        cursorsRef.current.push(cursorRef.current!)
      cursorRef.current = pages.at(-1)!.nextCursor
      setCursor(cursorRef.current)
    }
    catch (reason) {
      if (currentRef.current && request === toolsRequestRef.current)
        setError(String(reason))
    }
    finally {
      if (currentRef.current && request === toolsRequestRef.current)
        setLoadingTools(false)
    }
  }, [run.projectPath, run.id, suffix])
  useEffect(() => {
    void loadTools(false)
  }, [loadTools, connectionVersion, retry])
  useEffect(() => {
    const request = outputRequestRef.current
    request.pending = true
    if (request.busy)
      return
    request.busy = true
    async function readOutput() {
      try {
        while (currentRef.current && request.pending) {
          request.pending = false
          const previous = outputRef.current
          const value = await api<RunOutputChunk>(
            buildRunsPath(run.projectPath, `${suffix}/output`, {
              version: previous?.version,
              after: previous?.endOffset,
            }),
          )
          if (!currentRef.current)
            return
          const merged = mergeOutput(outputRef.current, value)
          outputRef.current = merged
          setOutput(merged)
        }
      }
      catch (reason) {
        if (currentRef.current)
          setError(String(reason))
      }
      finally {
        request.busy = false
      }
    }
    void readOutput()
  }, [run.projectPath, suffix, run.outputRevision, connectionVersion, retry])
  const tools = Object.values(project.tools[run.id] ?? {}).sort(
    (a, b) => a.sequence - b.sequence,
  )
  const notice = project.errors[run.id] ?? detail?.recordingError
  async function cancel() {
    setStopping(true)
    setError(null)
    try {
      await post(`${API_RUNS_PATH}${suffix}/cancel`, {
        projectPath: run.projectPath,
      })
    }
    catch (reason) {
      if (currentRef.current) {
        setError(String(reason))
        setStopping(false)
      }
    }
  }
  return (
    <aside className={styles.inspector} aria-label="运行详情">
      <header className={styles.detailHeader}>
        <strong>{run.roleName}</strong>
        <span className={styles[run.status]}>
          {RUN_STATUS_LABELS[run.status]}
        </span>
        <button
          type="button"
          className={styles.action}
          onClick={() =>
            void onParent().catch(reason => setError(String(reason)))}
        >
          <ArrowUpRight size={14} />
          定位父调用
        </button>
        <button type="button" className={styles.action} onClick={onDismiss} aria-label="收起运行详情"><X size={14} /></button>
      </header>
      <p className={styles.task}>{detail?.task ?? run.taskPreview}</p>
      {run.status === 'running' && run.progress ? <p className={styles.muted}>{run.progress.phase === 'tool' ? `正在执行 ${run.progress.toolName ?? '工具'}` : run.progress.phase === 'thinking' ? '正在思考' : '正在生成回复'}</p> : null}
      <p className={styles.muted}>
        {run.id}
        <br />
        {time(run.createdAt)}
        {' '}
        ·
        {formatDuration(run.status === 'running' ? Math.max(0, now - Date.parse(run.createdAt)) : run.durationMs)}
        {run.interruptedAt
          ? ` · ${time(run.interruptedAt)} 发现中断，最后观察于 ${time(run.lastObservedAt)}`
          : ''}
      </p>
      {run.status === 'interrupted'
        ? (
            <p className={styles.warning}>
              执行观察已中断；无法据此确认外部进程或工作区副作用已停止。
            </p>
          )
        : null}
      {run.completedAt
        && Date.parse(run.completedAt) < Date.parse(run.createdAt)
        ? (
            <p className={styles.warning}>
              记录期间墙上时钟发生变化；耗时以单调计时为准。
            </p>
          )
        : null}
      {run.status === 'running'
        ? (
            <button
              type="button"
              className={styles.action}
              disabled={stopping}
              onClick={() => void cancel()}
            >
              {stopping ? '正在请求停止…' : '取消运行'}
            </button>
          )
        : null}
      {notice
        ? (
            <p className={styles.error} role="alert">
              {notice}
            </p>
          )
        : null}
      {detail?.error ? <p className={styles.error}>{detail.error}</p> : null}
      {error
        ? (
            <p className={styles.error} role="alert">
              {error}
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setRetry(value => value + 1)
                }}
              >
                重试读取
              </button>
            </p>
          )
        : null}
      {detail?.diagnostics.map(message => (
        <p key={message} className={styles.warning}>
          {message}
        </p>
      ))}
      <h3>
        工具步骤
        <small>{run.toolCount}</small>
      </h3>
      {detail?.historyAvailability === 'legacy'
        ? (
            <p className={styles.muted}>旧版本未保存工具历史。</p>
          )
        : !tools.length
            ? (
                <p className={styles.muted}>
                  {loadingTools ? '正在加载…' : '尚无工具步骤。'}
                </p>
              )
            : null}
      {tools.map(tool => (
        <ToolStep
          key={tool.toolCallId}
          tool={tool}
          projectPath={run.projectPath}
          runId={run.id}
          open={toolId === tool.toolCallId}
          onToggle={() =>
            setToolId(toolId === tool.toolCallId ? null : tool.toolCallId)}
          connectionVersion={connectionVersion + retry}
          now={now}
        />
      ))}
      {cursor
        ? (
            <button
              className={styles.more}
              type="button"
              disabled={loadingTools}
              onClick={() => void loadTools(true)}
            >
              {loadingTools ? '加载中…' : '加载后续步骤'}
            </button>
          )
        : null}
      <h3>执行输出</h3>
      {output?.truncated
        ? (
            <p className={styles.warning}>输出较长，仅保留最近 160000 字符。</p>
          )
        : null}
      <pre className={styles.output}>{output?.text || '暂无文本输出。'}</pre>
      {detail
        ? (
            <details className={styles.configuration}>
              <summary>启动配置快照</summary>
              <pre>{JSON.stringify(detail.configurationSnapshot, null, 2)}</pre>
            </details>
          )
        : null}
    </aside>
  )
}
function ToolStep({
  tool,
  projectPath,
  runId,
  open,
  onToggle,
  connectionVersion,
  now,
}: {
  tool: RunToolSummary
  projectPath: string
  runId: string
  open: boolean
  onToggle: () => void
  connectionVersion: number
  now: number
}) {
  const [detail, setDetail] = useState<RunToolDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open)
      return
    let cancelled = false
    void api<RunToolDetail>(
      buildRunsPath(
        projectPath,
        `/${encodeURIComponent(runId)}/tools/${encodeURIComponent(tool.toolCallId)}`,
      ),
    )
      .then((value) => {
        if (!cancelled)
          setDetail(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [
    projectPath,
    runId,
    tool.toolCallId,
    tool.updatedRevision,
    open,
    connectionVersion,
    retry,
  ])
  const label
    = tool.status === 'running'
      ? '执行中'
      : tool.status === 'failed'
        ? '失败'
        : tool.status === 'interrupted'
          ? '未确认结束'
          : '完成'
  return (
    <section className={styles.step}>
      <button
        className={styles.stepHead}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {tool.sequence}
          .
          {tool.toolName}
        </span>
        <span className={styles[tool.status]}>{label}</span>
        <small>{formatDuration(tool.status === 'running' && tool.startedAt ? Math.max(0, now - Date.parse(tool.startedAt)) : tool.durationMs)}</small>
      </button>
      {open
        ? (
            <div className={styles.stepBody}>
              {tool.incomplete
                ? (
                    <p className={styles.warning}>
                      步骤记录不完整，缺少开始或结束事实。
                    </p>
                  )
                : null}
              {tool.evidenceIncomplete
                ? (
                    <p className={styles.warning}>部分证据预览不可用。</p>
                  )
                : null}
              {error
                ? (
                    <p className={styles.error}>
                      {error}
                      <button
                        type="button"
                        onClick={() => {
                          setError(null)
                          setRetry(value => value + 1)
                        }}
                      >
                        重试
                      </button>
                    </p>
                  )
                : detail
                  ? (
                      <>
                        <h4>
                          输入
                          {detail.inputTruncated ? ' · 已截断' : ''}
                        </h4>
                        <pre>{detail.inputPreview || '无输入预览'}</pre>
                        <h4>
                          输出
                          {detail.outputTruncated ? ' · 已截断' : ''}
                        </h4>
                        <pre>
                          {detail.outputPreview
                            || (tool.status === 'running' ? '等待结束记录…' : '无文本输出')}
                        </pre>
                      </>
                    )
                  : (
                      <p>正在读取…</p>
                    )}
            </div>
          )
        : null}
    </section>
  )
}
