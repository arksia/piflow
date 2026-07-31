import type { SessionInfoLite } from '../../ws'
import { useStore } from '../../use-store'
import { newSession, openSession, setSidebarOpen } from '../../ws'
import styles from './styles.module.css'

function shorten(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

function relativeTime(timestamp: string) {
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  if (minutes < 1)
    return '刚刚'
  if (minutes < 60)
    return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30)
    return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

function label(session: SessionInfoLite) {
  return session.name || session.firstMessage || '空会话'
}

export default function SessionList() {
  const store = useStore()
  const byCwd = new Map<string, SessionInfoLite[]>()
  for (const session of store.sessions) {
    const sessions = byCwd.get(session.cwd) ?? []
    sessions.push(session)
    byCwd.set(session.cwd, sessions)
  }

  async function pick(session: SessionInfoLite) {
    if (!store.connected)
      return
    try {
      await openSession(session.path)
      setSidebarOpen(false)
    }
    catch (error) {
      console.error('[piflow]', error)
    }
  }

  async function create() {
    if (!store.connected)
      return
    try {
      await newSession()
      setSidebarOpen(false)
    }
    catch (error) {
      console.error('[piflow]', error)
    }
  }

  return (
    <div className={styles.list}>
      <div className={styles.top}>
        <span className={styles.brand}>piflow</span>
        <button className={`${styles.newSession} recede`} title="新会话" disabled={!store.connected} onClick={create}>
          + 新会话
        </button>
      </div>

      {[...byCwd.entries()].map(([cwd, sessions]) => (
        <div key={cwd} className={styles.group}>
          <div className={styles.cwd}>{shorten(cwd)}</div>
          {sessions.map(session => (
            <button
              key={session.path}
              className={`${styles.item} ${store.activeKey === session.path ? styles.active : ''} recede`}
              disabled={!store.connected}
              onClick={() => pick(session)}
            >
              <span className={styles.label}>{label(session)}</span>
              <span className={styles.meta}>
                {relativeTime(session.modified)}
                {' '}
                ·
                {' '}
                {session.messageCount}
                {' '}
                条
              </span>
            </button>
          ))}
        </div>
      ))}

      {!store.connected ? <div className={styles.offline}>连接中…</div> : null}
    </div>
  )
}
