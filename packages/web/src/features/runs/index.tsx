import type {
  RunDetail,
  RunSummary,
  RunToolsPage,
} from '@piflow/protocol'
import type { RunFilter } from './store'
import {
  API_RUNS_PATH,
  buildRunsPath,
  RUN_STATUS_LABELS,
} from '@piflow/protocol'
import { ArrowUpRight, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Dialog from '../../components/Dialog'
import { openSession } from '../../session/actions'
import { api, post } from '../../session/api'
import { requestToolFocus } from '../../session/store'
import RunDeliveryView from './delivery'
import RunOutput from './output'
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
import ToolStep from './tool-step'
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
  const inspectorId = useId()
  const filterRef = useRef<HTMLDetailsElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
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
  function selectRun(id: string | null) {
    if (!id && selectedId) {
      const trigger = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-run-id]') ?? [])]
        .find(button => button.dataset.runId === selectedId)
      trigger?.focus({ preventScroll: true })
    }
    setSelectedId(id)
  }
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
  useEffect(() => {
    function dismissFilter(event: PointerEvent) {
      const details = filterRef.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target))
        details.open = false
    }
    document.addEventListener('pointerdown', dismissFilter)
    return () => document.removeEventListener('pointerdown', dismissFilter)
  }, [])
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
      compact
      onClose={onClose}
      actions={(
        <>
          <details
            className={styles.filterMenu}
            ref={filterRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filterRef.current?.open) {
                event.preventDefault()
                event.stopPropagation()
                filterRef.current.open = false
                filterRef.current.querySelector('summary')?.focus()
              }
            }}
          >
            <summary aria-label="筛选运行记录" title="筛选运行记录" data-active={!!(owner || role) || undefined}><SlidersHorizontal size={15} /></summary>
            <div className={styles.filterPopover}>
              <strong>筛选运行</strong>
              <label>
                主 Agent
                <select
                  value={owner}
                  onChange={(event) => {
                    setOwner(event.target.value)
                    setSelectedId(null)
                  }}
                >
                  <option value="">全部主 Agent</option>
                  {[...owners].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
                  <option value="">全部角色</option>
                  {[...roles].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  setOwner('')
                  setRole('')
                  setSelectedId(null)
                }}
              >
                清除筛选
              </button>
            </div>
          </details>
          <button
            type="button"
            className={styles.iconAction}
            disabled={window.loading}
            onClick={() => void loadRunWindow(projectPath, filter)}
            aria-label="刷新运行记录"
          >
            <RefreshCw size={15} />
          </button>
        </>
      )}
    >
      <div
        className={styles.panel}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && selectedId) {
            event.preventDefault()
            event.stopPropagation()
            selectRun(null)
          }
        }}
      >
        {owner || role
          ? (
              <div className={styles.scope} aria-label="当前筛选">
                {owner
                  ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOwner('')
                          setSelectedId(null)
                        }}
                      >
                        {owners.get(owner) ?? '所选主 Agent'}
                        <X size={12} />
                        <span className={styles.srOnly}>清除主 Agent 筛选</span>
                      </button>
                    )
                  : null}
                {role
                  ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRole('')
                          setSelectedId(null)
                        }}
                      >
                        {roles.get(role) ?? '所选角色'}
                        <X size={12} />
                        <span className={styles.srOnly}>清除角色筛选</span>
                      </button>
                    )
                  : null}
              </div>
            )
          : null}
        {!connection.connected || window.loading || window.error
          ? (
              <p className={styles.connection} role="status">{!connection.connected ? '连接中断 · 显示最后同步的记录' : window.loading ? '正在同步运行记录…' : '同步失败 · 记录可能过期'}</p>
            )
          : null}
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
              ? <RunTimeline runs={rows} now={frozenNowRef.current} live={connection.connected && !window.loading && !window.error} selectedId={selectedId} inspectorId={inspectorId} onSelect={selectRun} />
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
                  id={inspectorId}
                  run={selected}
                  connectionVersion={connection.version}
                  now={frozenNowRef.current}
                  onDismiss={() => selectRun(null)}
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
      </div>
    </Dialog>
  )
}
function RunInspector({
  id,
  run,
  connectionVersion,
  onParent,
  onDismiss,
  now,
}: {
  id: string
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
  const [tab, setTab] = useState<'delivery' | 'steps' | 'output'>(() => run.deliveryKind === 'code' ? 'delivery' : 'steps')
  const tabs = run.deliveryKind === 'code' ? ['delivery', 'steps', 'output'] as const : ['steps', 'output'] as const
  const [toolId, setToolId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingTools, setLoadingTools] = useState(false)
  const cursorRef = useRef<string | null>(null)
  const cursorsRef = useRef<(string | undefined)[]>([undefined])
  const toolsRequestRef = useRef({ generation: 0 })
  const currentRef = useRef(true)
  const [retry, setRetry] = useState(0)
  const suffix = `/${encodeURIComponent(run.id)}`
  useEffect(() => {
    currentRef.current = true
    const requests = toolsRequestRef.current
    return () => {
      currentRef.current = false
      requests.generation++
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void api<RunDetail>(buildRunsPath(run.projectPath, suffix))
      .then((value) => {
        if (!cancelled) {
          setDetail(current => current && current.revision > value.revision ? current : value)
          setError(null)
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
    run.completedAt,
    connectionVersion,
    retry,
  ])
  const loadTools = useCallback(async (more: boolean) => {
    const request = ++toolsRequestRef.current.generation
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
      if (!currentRef.current || request !== toolsRequestRef.current.generation)
        return
      setError(null)
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
      if (currentRef.current && request === toolsRequestRef.current.generation)
        setError(String(reason))
    }
    finally {
      if (currentRef.current && request === toolsRequestRef.current.generation)
        setLoadingTools(false)
    }
  }, [run.projectPath, run.id, suffix])
  useEffect(() => {
    if (tab !== 'steps')
      return
    const request = toolsRequestRef.current
    void loadTools(false)
    return () => {
      request.generation++
    }
  }, [tab, loadTools, connectionVersion, retry])
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
    <aside id={id} className={styles.inspector} aria-label="运行详情">
      <header className={styles.detailHeader}>
        <strong>{run.roleName}</strong>
        <span className={styles[run.status]}>
          {run.progress?.phase === 'collecting' ? '整理交付证据' : RUN_STATUS_LABELS[run.status]}
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
      {run.status === 'running' && run.progress ? <p className={styles.muted}>{run.progress.phase === 'tool' ? `正在执行 ${run.progress.toolName ?? '工具'}` : run.progress.phase === 'thinking' ? '正在思考' : run.progress.phase === 'collecting' ? '进程已结束，正在整理交付证据' : '正在生成回复'}</p> : null}
      <p className={styles.muted}>
        {run.id}
        <br />
        {time(run.createdAt)}
        {' '}
        ·
        {formatDuration(run.status === 'running' && !run.completedAt ? Math.max(0, now - Date.parse(run.createdAt)) : run.durationMs)}
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
      {run.status === 'running' && !run.completedAt
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
      <div className={styles.detailTabs} role="tablist" aria-label="运行详情视图">
        {tabs.map((view, index) => (
          <button
            type="button"
            role="tab"
            key={view}
            id={`${id}-tab-${view}`}
            aria-selected={tab === view}
            aria-controls={`${id}-view-${view}`}
            tabIndex={tab === view ? 0 : -1}
            onClick={() => setTab(view)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
              if (next !== null) {
                event.preventDefault()
                setTab(tabs[next]!)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
              }
            }}
          >
            {{ delivery: '交付', steps: '步骤', output: '输出' }[view]}
          </button>
        ))}
      </div>
      {run.deliveryKind === 'code'
        ? <section id={`${id}-view-delivery`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tab-delivery`} hidden={tab !== 'delivery'}>{tab === 'delivery' ? <RunDeliveryView key={run.id} run={run} connectionVersion={connectionVersion} now={now} /> : null}</section>
        : null}
      <section id={`${id}-view-steps`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tab-steps`} hidden={tab !== 'steps'}>
        {tab === 'steps'
          ? (
              <>
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
              </>
            )
          : null}
      </section>
      <section id={`${id}-view-output`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tab-output`} hidden={tab !== 'output'}>
        {tab === 'output' ? <RunOutput run={run} connectionVersion={connectionVersion + retry} /> : null}
      </section>
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
