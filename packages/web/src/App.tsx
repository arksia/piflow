import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import styles from './App.module.css'
import ChatView from './components/ChatView'
import ExtensionDialog from './components/ExtensionDialog'
import SessionList from './components/SessionList'
import { setSidebarOpen } from './session/store'
import { useStore } from './session/use-store'

const FlowView = lazy(() => import('./components/FlowView'))
const SIDEBAR_WIDTH_KEY = 'piflow.sidebarWidth'
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 420

function readSidebarWidth() {
  const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(value) ? Math.min(Math.max(value, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH) : 264
}

export default function App() {
  const store = useStore()
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'flow'>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('piflow.sidebarCollapsed') === 'true')
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const [isResizing, setIsResizing] = useState(false)

  const toggleWorkspaceSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      localStorage.setItem('piflow.sidebarCollapsed', String(next))
      return next
    })
  }, [])

  const onShowFlow = useCallback(() => setWorkspaceView('flow'), [])
  const onShowChat = useCallback(() => setWorkspaceView('chat'), [])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed || event.button !== 0)
      return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = sidebarWidth
    setIsResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    function resize(moveEvent: PointerEvent) {
      const nextWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
      sidebarWidthRef.current = nextWidth
      sidebarRef.current?.style.setProperty('--sidebar-width', `${nextWidth}px`)
    }

    function stop() {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      setSidebarWidth(sidebarWidthRef.current)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current))
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  useEffect(() => {
    if (!store.sidebarOpen)
      return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape')
        setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [store.sidebarOpen])

  return (
    <div className={styles.shell}>
      <aside
        ref={sidebarRef}
        className={`${styles.sidebar} ${store.sidebarOpen ? styles.open : ''} ${sidebarCollapsed ? styles.collapsed : ''} ${isResizing ? styles.resizing : ''}`}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <SessionList onToggleSidebar={toggleWorkspaceSidebar} />
      </aside>
      <div
        className={`${styles.resizer} ${sidebarCollapsed ? styles.resizerHidden : ''}`}
        role="separator"
        aria-label="调整会话列表宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        onPointerDown={startResize}
      />
      {store.sidebarOpen
        ? <button type="button" className={styles.scrim} aria-label="关闭会话列表" onClick={() => setSidebarOpen(false)} />
        : null}
      <main className={styles.main}>
        {workspaceView === 'chat'
          ? <ChatView onShowFlow={onShowFlow} onToggleSidebar={toggleWorkspaceSidebar} />
          : (
              <Suspense fallback={<div className={styles.loading}>正在加载 Flow…</div>}>
                <FlowView onShowChat={onShowChat} onToggleSidebar={toggleWorkspaceSidebar} />
              </Suspense>
            )}
      </main>
      <ExtensionDialog />
    </div>
  )
}
