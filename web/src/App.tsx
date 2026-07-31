import styles from './App.module.css'
import ChatView from './components/ChatView'
import SessionList from './components/SessionList'
import { useStore } from './use-store'
import { setSidebarOpen } from './ws'

export default function App() {
  const store = useStore()

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${store.sidebarOpen ? styles.open : ''}`}>
        <SessionList />
      </aside>
      {store.sidebarOpen
        ? <div className={styles.scrim} onClick={() => setSidebarOpen(false)} />
        : null}
      <main className={styles.main}>
        <ChatView />
      </main>
    </div>
  )
}
