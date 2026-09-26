import type { SessionInfoLite } from '@piflow/protocol'
import type { SessionTreeRow } from '../../session/tree'
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageSquarePlus, PanelLeftClose, Plus, Search, Settings } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { sessionAttention } from '../../flow/attention'
import { newSessionIn, openSession, renameSession } from '../../session/actions'
import { readCollapsedSessions, saveCollapsedSessions } from '../../session/persistence'
import { setSidebarOpen } from '../../session/store'
import { buildSessionForest, filterSessions, flattenSessionForest, sessionAncestors, sessionLineage } from '../../session/tree'
import { useStore } from '../../session/use-store'
import ExtensionManagerDialog from '../ExtensionManagerDialog'
import IconButton from '../IconButton'
import NewSessionDialog from '../NewSessionDialog'
import ProviderDialog from '../ProviderDialog'
import SessionItemMenu from '../SessionItemMenu'
import SettingsDialog from '../SettingsDialog'
import styles from './styles.module.css'

function sessionAge(timestamp: string) {
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  if (minutes < 1)
    return '刚刚'
  if (minutes < 60)
    return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30)
    return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12)
    return `${months}mo`
  return `${Math.floor(months / 12)}y`
}

function label(session: SessionInfoLite) {
  return session.name || session.firstMessage || '空会话'
}

function attentionClass(kind: string) {
  if (kind === 'needs_input')
    return styles.needsInput
  if (kind === 'failed')
    return styles.failed
  if (kind === 'running')
    return styles.running
  return styles.unread
}

function projectName(cwd: string) {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || cwd
}

interface SessionListProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onToggleSidebar: () => void
}

function SessionList({ theme, onToggleTheme, onToggleSidebar }: SessionListProps) {
  const store = useStore()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [creatingCwd, setCreatingCwd] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedSessions())
  const filteredSessions = useMemo(() => filterSessions(store.sessions, query), [store.sessions, query])
  const byCwd = useMemo(() => {
    const map = new Map<string, SessionInfoLite[]>()
    for (const session of filteredSessions) {
      const sessions = map.get(session.cwd) ?? []
      sessions.push(session)
      map.set(session.cwd, sessions)
    }
    return map
  }, [filteredSessions])

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
    if (!store.connected || openingPath)
      return
    setOpeningPath(session.path)
    setActionError(null)
    try {
      await openSession(session.path)
      setSidebarOpen(false)
    }
    catch (error) {
      setActionError(error instanceof Error ? error.message : '无法打开会话')
    }
    finally {
      setOpeningPath(null)
    }
  }

  async function createIn(cwd: string) {
    if (!store.connected || creatingCwd || openingPath)
      return
    setCreatingCwd(cwd)
    setActionError(null)
    try {
      await newSessionIn(cwd)
      setSidebarOpen(false)
    }
    catch (error) {
      setActionError(error instanceof Error ? error.message : '无法创建会话')
    }
    finally {
      setCreatingCwd(null)
    }
  }

  return (
    <>
      <div className={styles.list}>
        <div className={styles.top}>
          <div>
            <span className={styles.brand}>piflow</span>
            <span className={styles.subtitle}>coding workspace</span>
          </div>
          <IconButton tip label="收起会话列表" onClick={onToggleSidebar}>
            <PanelLeftClose />
          </IconButton>
        </div>
        {actionError ? <div className={styles.actionError} role="alert">{actionError}</div> : null}
        <div className={styles.searchRow}>
          <label className={styles.search}>
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
            />
          </label>
          <IconButton tip variant="outline" label="新会话" disabled={!store.connected} onClick={() => setNewSessionOpen(true)}>
            <MessageSquarePlus />
          </IconButton>
        </div>

        <div className={styles.sessions}>
          {[...byCwd.entries()].map(([cwd]) => {
            const open = store.sessions.some(session => session.path === store.activeKey && session.cwd === cwd)
            return (
              <div key={cwd} className={styles.group}>
                <div className={styles.cwdRow}>
                  <span className={`t-icon-swap ${styles.folder}`} data-state={open ? 'b' : 'a'} aria-hidden="true">
                    <span className="t-icon" data-icon="a"><Folder size={14} /></span>
                    <span className="t-icon" data-icon="b"><FolderOpen size={14} /></span>
                  </span>
                  <div className={styles.projectName} title={cwd}>
                    <span className={styles.projectLabel}>{projectName(cwd)}</span>
                  </div>
                  <IconButton
                    size="compact"
                    label={`在 ${projectName(cwd)} 中新建会话`}
                    disabled={!store.connected || creatingCwd !== null}
                    onClick={() => void createIn(cwd)}
                  >
                    {creatingCwd === cwd ? <span className={styles.busy}>…</span> : <Plus />}
                  </IconButton>
                </div>
                {(rowsByCwd.get(cwd) ?? []).map(({ node, indent, hasChildren }) => {
                  const session = node.session
                  return (
                    <SessionRow
                      key={session.path}
                      session={session}
                      active={store.activeKey === session.path}
                      streaming={store.statuses[session.path]?.status === 'running'}
                      attention={sessionAttention(session.path, store.statuses, store.unreadSessions)}
                      connected={store.connected}
                      opening={openingPath === session.path}
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
            )
          })}

          {query.trim() && filteredSessions.length === 0 ? <div className={styles.empty}>没有匹配的会话</div> : null}

          {!store.connected ? <div className={styles.offline}><span className="t-shimmer" data-text={store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}>{store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}</span></div> : null}
        </div>
        <div className={styles.footer}>
          <IconButton tip size="compact" label="设置" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </IconButton>
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
      {settingsOpen
        ? (
            <SettingsDialog
              theme={theme}
              connected={store.connected}
              onToggleTheme={onToggleTheme}
              onOpenProviders={() => {
                setSettingsOpen(false)
                setProvidersOpen(true)
              }}
              onOpenExtensions={() => {
                setSettingsOpen(false)
                setExtensionsOpen(true)
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )
        : null}
      {extensionsOpen ? <ExtensionManagerDialog onClose={() => setExtensionsOpen(false)} /> : null}
      {providersOpen ? <ProviderDialog onClose={() => setProvidersOpen(false)} /> : null}
    </>
  )
}

interface SessionRowProps {
  session: SessionInfoLite
  active: boolean
  streaming: boolean
  attention: { kind: string, label: string } | null
  connected: boolean
  opening: boolean
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

function SessionRow({ session, active, streaming, attention, connected, opening, editing, indent, hasChildren, isCollapsed, lineage, onPick, onRenameStart, onRenameEnd, onToggle }: SessionRowProps) {
  if (editing)
    return <RenameRow session={session} indent={indent} onDone={onRenameEnd} />
  const age = sessionAge(session.modified)
  const title = [
    label(session),
    lineage ? `fork 自：${lineage}` : '',
    `${age} · ${session.messageCount} 条`,
    attention?.label ?? '',
  ].filter(Boolean).join('\n')
  return (
    <div className={styles.sessionRow} style={indent ? { paddingLeft: indent * 12 + 2 } : undefined}>
      <span className={styles.rail}>
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
          : null}
      </span>
      <div className={`${styles.item} ${active ? styles.active : ''}`} title={title}>
        <button className={styles.itemMain} disabled={!connected || opening} onClick={onPick}>
          <span className={styles.label}>{label(session)}</span>
          <span className={styles.trailing}>
            {attention ? <span className={`${styles.dot} ${attentionClass(attention.kind)}`} /> : null}
            <span className={styles.age}>{opening ? '…' : age}</span>
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
    <div className={styles.sessionRow} style={indent ? { paddingLeft: indent * 12 + 2 } : undefined}>
      <span className={styles.rail} />
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
    </div>
  )
}

export default memo(SessionList)
