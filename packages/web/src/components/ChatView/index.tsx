import type { ChatMessage } from '@piflow/protocol'
import type { CSSProperties, UIEvent, WheelEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { setSidebarOpen } from '../../session/store'
import { useStore } from '../../session/use-store'
import InputBar from '../InputBar'
import MessageItem from '../MessageItem'
import ViewSwitch from '../ViewSwitch'
import styles from './styles.module.css'

const SCROLL_KEY = 'piflow.scroll'
const PRESETS = ['探索这个代码库', '回顾我的改动', '修一个 bug', '做个功能规划']
const WIDTHS = [860, 1180, 1440] as const
const messageIds = new WeakMap<ChatMessage, number>()
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
}

export default function ChatView({ onShowFlow, onToggleSidebar }: ChatViewProps) {
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
  const [widthIndex, setWidthIndex] = useState(() => Math.min(Number(localStorage.getItem('piflow.chatWidth') ?? 1), 2))
  const session = store.sessions.find(session => session.path === store.activeKey)
  const title = store.activeKey ? session?.name || session?.firstMessage || '新会话' : ''

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
  const chatStyle = { '--chat-w': `${WIDTHS[widthIndex] ?? WIDTHS[1]}px` } as CSSProperties
  const isLive = store.connected && !!view?.isStreaming
  const statusLabel = !store.connected
    ? '连接中…'
    : view?.isCompacting
      ? '压缩上下文'
      : isLive
        ? '生成中'
        : ''

  function applyPreset(preset: string) {
    setComposerText(preset)
    setComposerFocusVersion(version => version + 1)
  }

  function cycleWidth() {
    setWidthIndex((current) => {
      const next = (current + 1) % WIDTHS.length
      localStorage.setItem('piflow.chatWidth', String(next))
      return next
    })
  }

  return (
    <div className={styles.chat} style={chatStyle}>
      <header className={styles.bar}>
        <button className={styles.menu} title="会话列表" aria-label="会话列表" onClick={onToggleSidebar}>☰</button>
        <button className={styles.mobileMenu} title="会话列表" aria-label="切换会话列表" onClick={() => setSidebarOpen(!store.sidebarOpen)}>☰</button>
        <div className={styles.identity}>
          {title ? <div className={styles.title} title={title}>{title}</div> : null}
        </div>
        <div className={styles.actions}>
          <span className={`${styles.status} ${statusLabel ? styles.on : ''}`}>{statusLabel}</span>
          <ViewSwitch active="chat" onChange={view => view === 'flow' && onShowFlow()} />
          <button className={styles.width} title="切换聊天宽度" aria-label="切换聊天宽度" onClick={cycleWidth}>⇔</button>
        </div>
      </header>

      <div ref={scrollerRef} className={`${styles.scroll} ${isEmpty ? styles.centered : ''}`} onScroll={onScroll} onWheel={onWheel}>
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
                {view.error ? <div className={styles.error}>{view.error}</div> : null}
              </div>
            )}
      </div>

      <InputBar
        view={view}
        text={composerText}
        focusVersion={composerFocusVersion}
        onTextChange={setComposerText}
      />
    </div>
  )
}

function messageKey(message: ChatMessage) {
  let id = messageIds.get(message)
  if (!id) {
    id = nextMessageId++
    messageIds.set(message, id)
  }
  return `${message.role}:${message.timestamp ?? 'untimed'}:${id}`
}
