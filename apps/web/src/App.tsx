import { lazy, Suspense, useEffect, useState } from 'react'
import styles from './App.module.css'
import ChatView from './components/ChatView'
import SessionList from './components/SessionList'
import { setSidebarOpen } from './session/store'
import { useStore } from './session/use-store'

const FlowView = lazy(() => import('./components/FlowView'))

export default function App() {
  const store = useStore()
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'flow'>('chat')

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
      <aside className={`${styles.sidebar} ${store.sidebarOpen ? styles.open : ''}`}>
        <SessionList />
      </aside>
      {store.sidebarOpen
        ? <button type="button" className={styles.scrim} aria-label="关闭会话列表" onClick={() => setSidebarOpen(false)} />
        : null}
      <main className={styles.main}>
        {workspaceView === 'chat'
          ? <ChatView onShowFlow={() => setWorkspaceView('flow')} />
          : (
              <Suspense fallback={<div className={styles.loading}>正在加载 Flow…</div>}>
                <FlowView onShowChat={() => setWorkspaceView('chat')} />
              </Suspense>
            )}
      </main>
    </div>
  )
}
