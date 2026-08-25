import type { SessionInfoLite } from '@piflow/protocol'
import { memo, useMemo, useState } from 'react'
import { newSessionIn, openSession } from '../../session/actions'
import { setSidebarOpen } from '../../session/store'
import { useStore } from '../../session/use-store'
import NewSessionDialog from '../NewSessionDialog'
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

function projectName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, '')
  return trimmed.split('/').pop() || cwd
}

interface SessionListProps {
  onToggleSidebar: () => void
}

function SessionList({ onToggleSidebar }: SessionListProps) {
  const store = useStore()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [creatingCwd, setCreatingCwd] = useState<string | null>(null)
  const byCwd = useMemo(() => {
    const map = new Map<string, SessionInfoLite[]>()
    for (const session of store.sessions) {
      const sessions = map.get(session.cwd) ?? []
      sessions.push(session)
      map.set(session.cwd, sessions)
    }
    return map
  }, [store.sessions])

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

  async function createIn(cwd: string) {
    if (!store.connected || creatingCwd)
      return
    setCreatingCwd(cwd)
    try {
      await newSessionIn(cwd)
      setSidebarOpen(false)
    }
    catch (error) {
      console.error('[piflow]', error)
    }
    finally {
      setCreatingCwd(null)
    }
  }

  const projectCount = byCwd.size

  return (
    <>
      <div className={styles.list}>
        <div className={styles.top}>
          <div>
            <span className={styles.brand}>piflow</span>
            <span className={styles.subtitle}>coding workspace</span>
          </div>
          <div className={styles.topActions}>
            <button className={styles.newSession} title="新会话" aria-label="新会话" disabled={!store.connected} onClick={() => setNewSessionOpen(true)}>+</button>
            <button className={styles.collapse} title="收起会话列表" aria-label="收起会话列表" onClick={onToggleSidebar}>☰</button>
          </div>
        </div>

        {[...byCwd.entries()].map(([cwd, sessions]) => (
          <div key={cwd} className={styles.group}>
            <div className={styles.cwdRow}>
              <div className={styles.projectIdentity}>
                <div className={styles.projectName} title={cwd}>{projectName(cwd)}</div>
                <div className={styles.cwd} title={cwd}>{shorten(cwd)}</div>
              </div>
              <button
                className={styles.projectNew}
                title={`在 ${shorten(cwd)} 中新建会话`}
                aria-label={`在 ${shorten(cwd)} 中新建会话`}
                disabled={!store.connected || creatingCwd !== null}
                onClick={() => void createIn(cwd)}
              >
                {creatingCwd === cwd ? '…' : '+'}
              </button>
            </div>
            {sessions.map(session => (
              <button
                key={session.path}
                className={`${styles.item} ${store.activeKey === session.path ? styles.active : ''}`}
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
        <div className={styles.footer}>
          {projectCount}
          {' 个项目 · '}
          {store.sessions.length}
          {' 个会话'}
        </div>
      </div>
      {newSessionOpen
        ? (
            <NewSessionDialog
              initialPath={store.cwd}
              onClose={() => setNewSessionOpen(false)}
              onCreated={() => {
                setNewSessionOpen(false)
                setSidebarOpen(false)
              }}
            />
          )
        : null}
    </>
  )
}

export default memo(SessionList)
