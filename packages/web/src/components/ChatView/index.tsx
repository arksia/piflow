import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { UIEvent, WheelEvent } from 'react'
import { PanelLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sessionAttention } from '../../flow/attention'
import { trustProject } from '../../session/actions'
import { readDraft, saveDraftText } from '../../session/persistence'
import { setSidebarOpen } from '../../session/store'
import { useStore } from '../../session/use-store'
import BranchNavigator from '../BranchNavigator'
import IconButton from '../IconButton'
import InputBar from '../InputBar'
import MessageItem from '../MessageItem'
import ViewSwitch from '../ViewSwitch'
import styles from './styles.module.css'

const SCROLL_KEY = 'piflow.scroll'
const PRESETS = ['探索这个代码库', '回顾我的改动', '修一个 bug', '做个功能规划']
const messageIds = new WeakMap<AgentMessage, number>()
let nextMessageId = 1

function readScrollMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SCROLL_KEY) ?? '{}')
  }
  catch {
    return {}
  }
}

interface ChatViewProps {
  onShowFlow: () => void
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
}

export default function ChatView({ onShowFlow, onToggleSidebar, sidebarCollapsed }: ChatViewProps) {
  const store = useStore()
  const view = store.activeKey ? (store.views[store.activeKey] ?? null) : null
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrollMapRef = useRef(readScrollMap())
  const stickToBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const userScrollRef = useRef(false)
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const previousKeyRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [column, setColumn] = useState<HTMLDivElement | null>(null)
  const [composerText, setComposerText] = useState('')
  const [composerFocusVersion, setComposerFocusVersion] = useState(0)
  const [trustError, setTrustError] = useState<string | null>(null)
  const session = store.sessions.find(session => session.path === store.activeKey)
  const title = store.activeKey ? session?.name || session?.firstMessage || '新会话' : ''
  const trust = view?.cwd ? store.projectTrust[view.cwd] : undefined
  const statuses = view?.extensionRequests.filter(request => request.method === 'setStatus' && request.statusText) ?? []
  const widgets = view?.extensionRequests.filter(request => request.method === 'setWidget' && request.widgetLines) ?? []
  const draftKey = store.activeKey ?? `new:${store.cwd}`

  useEffect(() => {
    // Session changes replace the controlled composer with that session's draft.
    // eslint-disable-next-line react/set-state-in-effect
    setComposerText(readDraft(draftKey).text)
  }, [draftKey])

  useEffect(() => {
    function setEditorText(event: Event) {
      const command = (event as CustomEvent<{ session: string, text: string }>).detail
      if (command.session !== store.activeKey)
        return
      setComposerText(command.text)
      setComposerFocusVersion(version => version + 1)
    }
    window.addEventListener('piflow:set-editor-text', setEditorText)
    return () => window.removeEventListener('piflow:set-editor-text', setEditorText)
  }, [store.activeKey])

  function persist(key: string, top: number) {
    scrollMapRef.current[key] = top
    localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollMapRef.current))
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (programmaticScrollRef.current)
      return
    markUserScroll()
    const key = store.activeKey
    if (!key)
      return
    const element = event.currentTarget
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(persist, 200, key, element.scrollTop)
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160
  }

  function markUserScroll() {
    userScrollRef.current = true
    clearTimeout(userScrollTimerRef.current)
    userScrollTimerRef.current = setTimeout(() => {
      userScrollRef.current = false
    }, 200)
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0)
      stickToBottomRef.current = false
    markUserScroll()
  }

  useLayoutEffect(() => {
    const element = scrollerRef.current
    const oldKey = previousKeyRef.current
    if (oldKey && element)
      persist(oldKey, element.scrollTop)
    previousKeyRef.current = store.activeKey
    if (element && store.activeKey) {
      programmaticScrollRef.current = true
      element.scrollTop = scrollMapRef.current[store.activeKey] ?? element.scrollHeight
      stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
  }, [store.activeKey])

  // Anchor scroll to the bottom while streaming, but only when the user is already near the bottom.
  // ResizeObserver batches content changes and requestAnimationFrame throttles the scroll update.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !column)
      return

    function anchor() {
      if (!stickToBottomRef.current || userScrollRef.current)
        return
      programmaticScrollRef.current = true
      scroller!.scrollTop = scroller!.scrollHeight
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }

    const observer = new ResizeObserver(() => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      rafRef.current = requestAnimationFrame(anchor)
    })

    resizeObserverRef.current = observer
    observer.observe(column)

    return () => {
      observer.disconnect()
      resizeObserverRef.current = null
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [column, store.activeKey])

  // Re-anchor to bottom after window resize when the user is already near the bottom.
  useEffect(() => {
    function handleResize() {
      const element = scrollerRef.current
      if (!element)
        return
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 160
      stickToBottomRef.current = nearBottom
      if (!nearBottom)
        return
      programmaticScrollRef.current = true
      element.scrollTop = element.scrollHeight
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    function onResize() {
      clearTimeout(timer)
      timer = setTimeout(handleResize, 100)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [])

  const isEmpty = !view || view.messages.length === 0
  const isLive = store.connected && !!view?.isStreaming
  const attention = store.activeKey ? sessionAttention(store.activeKey, store.statuses) : null
  const status = store.connectionState !== 'connected'
    ? { label: store.connectionState === 'reconnecting' ? '重连中…' : '连接中…', kind: 'connection' }
    : view?.isCompacting
      ? { label: '压缩上下文', kind: 'running' }
      : attention && attention.kind !== 'unread'
        ? attention
        : isLive
          ? { label: '运行中', kind: 'running' }
          : { label: '', kind: '' }

  function applyPreset(preset: string) {
    setComposerText(preset)
    saveDraftText(draftKey, preset)
    setComposerFocusVersion(version => version + 1)
  }

  function trustProjectNow() {
    if (!view?.cwd)
      return
    setTrustError(null)
    void trustProject(view.cwd).catch(error => setTrustError(error instanceof Error && error.message ? error.message : '操作失败，请重试'))
  }

  return (
    <div className={styles.chat}>
      <header className={styles.bar}>
        {sidebarCollapsed
          ? (
              <span className={styles.menu}>
                <IconButton label="展开会话列表" onClick={onToggleSidebar}>
                  <PanelLeft />
                </IconButton>
              </span>
            )
          : null}
        <span className={styles.mobileMenu}>
          <IconButton label="切换会话列表" onClick={() => setSidebarOpen(!store.sidebarOpen)}>
            <PanelLeft />
          </IconButton>
        </span>
        <div className={styles.identity}>
          {title ? <div className={styles.title} title={title}>{title}</div> : null}
        </div>
        <div className={styles.actions}>
          <span className={`${styles.status} ${status.label ? styles.on : ''} ${status.kind === 'failed' ? styles.failed : ''} ${status.kind === 'needs_input' ? styles.wait : ''}`}>{status.label}</span>
          {store.activeKey ? <BranchNavigator path={store.activeKey} /> : null}
          <ViewSwitch active="chat" onChange={view => view === 'flow' && onShowFlow()} />
        </div>
      </header>

      <div ref={scrollerRef} className={`${styles.scroll} ${isEmpty ? styles.centered : ''}`} onScroll={onScroll} onWheel={onWheel}>
        {trust?.requiresTrust && !trust.trusted
          ? (
              <div className={styles.trust}>
                <span>项目资源已停用，确认信任后才会加载扩展与技能。</span>
                <button onClick={trustProjectNow}>信任项目</button>
                {trustError ? <span className={styles.trustError} role="alert">{trustError}</span> : null}
              </div>
            )
          : null}
        {isEmpty
          ? (
              <div className={styles.hero}>
                <h1>今天做点什么？</h1>
                <div className={styles.presets}>
                  {PRESETS.map(preset => (
                    <button key={preset} className={styles.pill} onClick={() => applyPreset(preset)}>{preset}</button>
                  ))}
                </div>
                {!view ? <p className={styles.dim}>也可以从左侧选择一个历史会话继续</p> : null}
              </div>
            )
          : (
              <div ref={setColumn} className={styles.column}>
                {view.messages.map(message => (
                  <MessageItem
                    key={messageKey(message)}
                    message={message}
                    toolResults={view.toolResults}
                  />
                ))}
                {view.live ? <MessageItem message={view.live} toolResults={view.toolResults} live /> : null}
                {isLive && !view.live
                  ? (
                      <div className={styles.pending}>
                        <span className={styles.dot} />
                        正在生成…
                      </div>
                    )
                  : null}
                {store.connected && view.isCompacting ? <div className={styles.note}>正在压缩上下文…</div> : null}
                {view.compactionNotice && (
                  <div className={styles.note}>
                    {compactionNoticeLabel(view.compactionNotice)}
                  </div>
                )}
                {view.stats
                  ? (
                      <div className={styles.stats} title="本 session 累计统计，不含 Provider quota">
                        {formatTokens(view.stats.tokens.total)}
                        {' tokens · $'}
                        {view.stats.cost.toFixed(4)}
                        {' · '}
                        {view.stats.userMessages}
                        {' 用户消息 · '}
                        {view.stats.assistantMessages}
                        {' 回复 · '}
                        {view.stats.toolCalls}
                        {' 工具调用'}
                      </div>
                    )
                  : null}
                {view.error ? <div className={styles.error}>{view.error}</div> : null}
              </div>
            )}
      </div>

      {statuses.length || widgets.length
        ? (
            <div className={styles.extensionState}>
              {statuses.map(status => <span key={status.id}>{status.method === 'setStatus' ? status.statusText : ''}</span>)}
              {widgets.map(widget => (
                <span key={widget.id}>{widget.method === 'setWidget' ? widget.widgetLines?.join('\n') : ''}</span>
              ))}
            </div>
          )
        : null}

      <InputBar
        view={view}
        text={composerText}
        focusVersion={composerFocusVersion}
        onTextChange={setComposerText}
        draftKey={draftKey}
      />
    </div>
  )
}

function messageKey(message: AgentMessage) {
  let id = messageIds.get(message)
  if (!id) {
    id = nextMessageId++
    messageIds.set(message, id)
  }
  return `${message.role}:${message.timestamp ?? 'untimed'}:${id}`
}

function formatTokens(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`
}

function compactionNoticeLabel(notice: NonNullable<import('../../session/state').SessionView['compactionNotice']>) {
  if (notice.status === 'success')
    return `已压缩 ${formatTokens(notice.tokensBefore)} → ${formatTokens(notice.tokensAfter ?? 0)} tokens`
  if (notice.status === 'aborted')
    return '压缩已中止'
  return `压缩失败：${notice.message ?? '未知错误'}`
}
