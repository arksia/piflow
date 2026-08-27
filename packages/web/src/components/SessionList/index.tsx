import type { SessionInfoLite } from '@piflow/protocol'
import type { SessionTreeRow } from '../../session/tree'
import { ChevronDown, ChevronRight, MessageSquarePlus, PanelLeftClose, Plus, Settings } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { newSessionIn, openSession, renameSession } from '../../session/actions'
import { readCollapsedSessions, saveCollapsedSessions } from '../../session/persistence'
import { setSidebarOpen } from '../../session/store'
import { buildSessionForest, flattenSessionForest, sessionAncestors, sessionLineage } from '../../session/tree'
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedSessions())
  const byCwd = useMemo(() => {
    const map = new Map<string, SessionInfoLite[]>()
    for (const session of store.sessions) {
      const sessions = map.get(session.cwd) ?? []
      sessions.push(session)
      map.set(session.cwd, sessions)
    }
    return map
  }, [store.sessions])

  const rowsByCwd = useMemo(() => {
    const map = new Map<string, SessionTreeRow[]>()
    for (const [cwd, sessions] of byCwd)
      map.set(cwd, flattenSessionForest(buildSessionForest(sessions), collapsed))
    return map
  }, [byCwd, collapsed])

  // Expand the ancestor chain once when a session becomes active (covers fork-then-open).
  // Adjusted during render (not in an effect) and keyed per activeKey, so later
  // sessions broadcasts don't undo manual collapses.
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  const activeKey = store.activeKey
  const sessions = store.sessions
  if (activeKey && sessions.length > 0 && expandedFor !== activeKey) {
    setExpandedFor(activeKey)
    const ancestors = sessionAncestors(sessions, activeKey).filter(path => collapsed.has(path))
    if (ancestors.length > 0) {
      const next = new Set(collapsed)
      for (const path of ancestors)
        next.delete(path)
      saveCollapsedSessions(next)
      setCollapsed(next)
    }
  }

  function toggleCollapsed(path: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path))
        next.delete(path)
      else
        next.add(path)
      saveCollapsedSessions(next)
      return next
    })
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

        {[...byCwd.entries()].map(([cwd]) => (
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
            {(rowsByCwd.get(cwd) ?? []).map(({ node, indent, hasChildren }) => {
              const session = node.session
              return (
                <SessionRow
                  key={session.path}
                  session={session}
                  active={store.activeKey === session.path}
                  streaming={store.statuses[session.path]?.status === 'running'}
                  connected={store.connected}
                  editing={editingPath === session.path}
                  indent={indent}
                  hasChildren={hasChildren}
                  isCollapsed={collapsed.has(session.path)}
                  lineage={sessionLineage(store.sessions, session.path)}
                  onPick={() => void pick(session)}
                  onRenameStart={() => setEditingPath(session.path)}
                  onRenameEnd={() => setEditingPath(null)}
                  onToggle={() => toggleCollapsed(session.path)}
                />
              )
            })}
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
  indent: number
  hasChildren: boolean
  isCollapsed: boolean
  lineage: string | null
  onPick: () => void
  onRenameStart: () => void
  onRenameEnd: () => void
  onToggle: () => void
}

function SessionRow({ session, active, streaming, connected, editing, indent, hasChildren, isCollapsed, lineage, onPick, onRenameStart, onRenameEnd, onToggle }: SessionRowProps) {
  if (editing)
    return <RenameRow session={session} indent={indent} onDone={onRenameEnd} />
  const title = lineage ? `${label(session)}\nfork 自：${lineage}` : label(session)
  return (
    <div className={`${styles.item} ${active ? styles.active : ''}`} title={title}>
      <div className={styles.rowBody} style={{ paddingLeft: indent * 14 }}>
        {hasChildren
          ? (
              <button
                className={styles.chevron}
                title={isCollapsed ? '展开子会话' : '折叠子会话'}
                aria-label={isCollapsed ? `展开子会话：${label(session)}` : `折叠子会话：${label(session)}`}
                aria-expanded={!isCollapsed}
                onClick={onToggle}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            )
          : <span className={styles.chevronPlaceholder} />}
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
      </div>
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

function RenameRow({ session, indent, onDone }: { session: SessionInfoLite, indent: number, onDone: () => void }) {
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
    <div className={`${styles.item} ${styles.editing}`} style={{ paddingLeft: indent * 14 + 22 }}>
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
