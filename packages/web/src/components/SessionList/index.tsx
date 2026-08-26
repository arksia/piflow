import type { SessionInfoLite } from '@piflow/protocol'
import { MessageSquarePlus, PanelLeftClose, Plus, Settings } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { newSessionIn, openSession, renameSession } from '../../session/actions'
import { setSidebarOpen } from '../../session/store'
import { useStore } from '../../session/use-store'
import ExtensionManagerDialog from '../ExtensionManagerDialog'
import NewSessionDialog from '../NewSessionDialog'
import SessionItemMenu from '../SessionItemMenu'
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
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [creatingCwd, setCreatingCwd] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
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
            <button className={styles.newSession} title="新会话" aria-label="新会话" disabled={!store.connected} onClick={() => setNewSessionOpen(true)}><MessageSquarePlus size={15} /></button>
            <button className={styles.collapse} title="收起会话列表" aria-label="收起会话列表" onClick={onToggleSidebar}><PanelLeftClose size={15} /></button>
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
                {creatingCwd === cwd ? '…' : <Plus size={13} />}
              </button>
            </div>
            {sessions.map(session => (
              <SessionRow
                key={session.path}
                session={session}
                active={store.activeKey === session.path}
                streaming={store.statuses[session.path]?.status === 'running'}
                connected={store.connected}
                editing={editingPath === session.path}
                onPick={() => void pick(session)}
                onRenameStart={() => setEditingPath(session.path)}
                onRenameEnd={() => setEditingPath(null)}
              />
            ))}
          </div>
        ))}

        {!store.connected ? <div className={styles.offline}>连接中…</div> : null}
        <div className={styles.footer}>
          <span>
            {projectCount}
            {' 个项目 · '}
            {store.sessions.length}
            {' 个会话'}
          </span>
          <button className={styles.settings} title="扩展管理" aria-label="扩展管理" disabled={!store.connected} onClick={() => setExtensionsOpen(true)}><Settings size={14} /></button>
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
      {extensionsOpen ? <ExtensionManagerDialog onClose={() => setExtensionsOpen(false)} /> : null}
    </>
  )
}

interface SessionRowProps {
  session: SessionInfoLite
  active: boolean
  streaming: boolean
  connected: boolean
  editing: boolean
  onPick: () => void
  onRenameStart: () => void
  onRenameEnd: () => void
}

function SessionRow({ session, active, streaming, connected, editing, onPick, onRenameStart, onRenameEnd }: SessionRowProps) {
  if (editing)
    return <RenameRow session={session} onDone={onRenameEnd} />
  return (
    <div className={`${styles.item} ${active ? styles.active : ''}`}>
      <button className={styles.itemMain} disabled={!connected} onClick={onPick}>
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
      {connected
        ? (
            <SessionItemMenu
              className={styles.menu}
              session={session}
              label={label(session)}
              streaming={streaming}
              onRename={onRenameStart}
            />
          )
        : null}
    </div>
  )
}

function RenameRow({ session, onDone }: { session: SessionInfoLite, onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  async function commit() {
    if (busy)
      return
    const value = inputRef.current?.value.trim() ?? ''
    if (value === (session.name ?? '')) {
      onDone()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameSession(session.path, value)
      onDone()
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '重命名失败')
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className={`${styles.item} ${styles.editing}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void commit()
        }}
      >
        <input
          ref={inputRef}
          className={styles.renameInput}
          defaultValue={session.name ?? ''}
          placeholder={session.firstMessage || '空会话'}
          aria-label="会话名称"
          aria-invalid={error !== null}
          autoFocus
          onFocus={event => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelledRef.current = true
              event.currentTarget.blur()
            }
          }}
          onBlur={() => cancelledRef.current ? onDone() : void commit()}
        />
        {error ? <span className={styles.renameError}>{error}</span> : null}
      </form>
    </div>
  )
}

export default memo(SessionList)
