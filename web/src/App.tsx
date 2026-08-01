import { useEffect } from 'react'
import styles from './App.module.css'
import { setSidebarOpen } from './client'
import ChatView from './components/ChatView'
import SessionList from './components/SessionList'
import { useStore } from './use-store'

export default function App() {
  const store = useStore()

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
        <ChatView />
      </main>
    </div>
  )
}
