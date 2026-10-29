import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import styles from './App.module.css'
import ChatView from './components/ChatView'
import ExtensionDialog from './components/ExtensionDialog'
import SessionList from './components/SessionList'
import WorkspaceSidebar from './components/WorkspaceSidebar'
import { setSidebarOpen, setWorkspaceView as setStoreWorkspaceView } from './session/store'
import { useStore } from './session/use-store'

const FlowView = lazy(() => import('./components/FlowView'))
type Theme = 'dark' | 'light'

export default function App() {
  const store = useStore()
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'flow'>(
    () => localStorage.getItem('piflow.workspaceView') === 'flow' ? 'flow' : 'chat',
  )
  const [flowReady, setFlowReady] = useState(() => localStorage.getItem('piflow.workspaceView') === 'flow')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('piflow.sidebarCollapsed') === 'true')
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [narrow, setNarrow] = useState(() => window.matchMedia('(width <= 768px)').matches)
  // ponytail: Flow's chrome is display:none on this breakpoint, so show chat without clearing the saved view
  const view = narrow ? 'chat' : workspaceView

  useEffect(() => {
    setStoreWorkspaceView(view)
  }, [view])

  useEffect(() => {
    const media = window.matchMedia('(width <= 768px)')
    const onChange = () => setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleWorkspaceSidebar = useCallback(() => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    localStorage.setItem('piflow.sidebarCollapsed', String(next))
    requestAnimationFrame(() => {
      const label = next ? '展开会话列表' : '收起会话列表'
      const buttons = document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)
      Array.from(buttons).find(button => button.getClientRects().length && !button.closest('[inert]'))?.focus({ preventScroll: true })
    })
  }, [sidebarCollapsed])

  const onShowFlow = useCallback(() => {
    setFlowReady(true)
    setWorkspaceView('flow')
    localStorage.setItem('piflow.workspaceView', 'flow')
  }, [])
  const onShowChat = useCallback(() => {
    setWorkspaceView('chat')
    localStorage.setItem('piflow.workspaceView', 'chat')
  }, [])
  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      localStorage.setItem('piflow.theme', next)
      return next
    })
  }, [])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <div className={styles.shell} data-sidebar-collapsed={sidebarCollapsed || undefined}>
      <a className={styles.skipLink} href="#workspace-content">跳到工作区</a>
      <WorkspaceSidebar collapsed={sidebarCollapsed} open={store.sidebarOpen} narrow={narrow} onClose={closeSidebar}>
        <SessionList
          theme={theme}
          view={view}
          onShowChat={onShowChat}
          onShowFlow={onShowFlow}
          onToggleTheme={toggleTheme}
          onToggleSidebar={toggleWorkspaceSidebar}
        />
      </WorkspaceSidebar>
      <main id="workspace-content" className={styles.main} tabIndex={-1} inert={narrow && store.sidebarOpen}>
        <div className={`${styles.pane} ${view !== 'chat' ? styles.paneHidden : ''}`}>
          <ChatView onToggleSidebar={toggleWorkspaceSidebar} sidebarCollapsed={sidebarCollapsed} />
        </div>
        {flowReady
          ? (
              <div className={`${styles.pane} ${view !== 'flow' ? styles.paneHidden : ''}`}>
                <Suspense fallback={<div className={styles.loading}>正在加载 Flow…</div>}>
                  <FlowView
                    active={view === 'flow'}
                    onShowChat={onShowChat}
                    onToggleSidebar={toggleWorkspaceSidebar}
                    sidebarCollapsed={sidebarCollapsed}
                  />
                </Suspense>
              </div>
            )
          : null}
      </main>
      <ExtensionDialog />
    </div>
  )
}
