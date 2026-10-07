import type { SessionInfoLite } from '@piflow/protocol'
import type { SessionTreeRow } from '../../session/tree'
import { ChevronDown, ChevronRight, Folder, MessageSquarePlus, PanelLeftClose, Search, Settings, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { sessionAttention, sessionRailStatus } from '../../flow/attention'
import { AccChevron, usePresence } from '../../motion'
import { shortenPath } from '../../path'
import { openSession, renameSession } from '../../session/actions'
import { readCollapsedProjects, readCollapsedSessions, saveCollapsedProjects, saveCollapsedSessions } from '../../session/persistence'
import { setSidebarOpen } from '../../session/store'
import { buildSessionForest, filterSessions, flattenSessionForest, sessionAncestors, sessionLineage } from '../../session/tree'
import { useStore } from '../../session/use-store'
import ExtensionManagerDialog from '../ExtensionManagerDialog'
import Glide from '../Glide'
import IconButton from '../IconButton'
import LatticeLoader from '../LatticeLoader'
import NewSessionDialog from '../NewSessionDialog'
import ProviderDialog from '../ProviderDialog'
import SessionItemMenu from '../SessionItemMenu'
import SettingsDialog from '../SettingsDialog'
import ViewSwitch from '../ViewSwitch'
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

function projectName(cwd: string) {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || cwd
}

function togglePersisted(
  id: string,
  save: (next: ReadonlySet<string>) => void,
  set: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
) {
  set((current) => {
    const next = new Set(current)
    if (next.has(id))
      next.delete(id)
    else
      next.add(id)
    save(next)
    return next
  })
}

interface SessionListProps {
  theme: 'dark' | 'light'
  view: 'chat' | 'flow'
  onShowChat: () => void
  onShowFlow: () => void
  onToggleTheme: () => void
  onToggleSidebar: () => void
}

function SessionList({ theme, view, onShowChat, onShowFlow, onToggleTheme, onToggleSidebar }: SessionListProps) {
  const store = useStore()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const searchWasOpenRef = useRef(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedSessions())
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => readCollapsedProjects())
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
  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus()
      searchWasOpenRef.current = true
      return
    }
    if (!searchWasOpenRef.current)
      return
    searchWasOpenRef.current = false
    searchToggleRef.current?.focus()
  }, [searchOpen])

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
    const cwd = sessions.find(session => session.path === activeKey)?.cwd
    if (cwd && collapsedProjects.has(cwd)) {
      const next = new Set(collapsedProjects)
      next.delete(cwd)
      saveCollapsedProjects(next)
      setCollapsedProjects(next)
    }
  }

  function toggleCollapsed(path: string) {
    togglePersisted(path, saveCollapsedSessions, setCollapsed)
  }

  function toggleProject(cwd: string) {
    togglePersisted(cwd, saveCollapsedProjects, setCollapsedProjects)
  }

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
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

  return (
    <>
      <div className={styles.list}>
        <div className={styles.top}>
          <ViewSwitch active={view} onChange={next => next === 'flow' ? onShowFlow() : onShowChat()} />
          <IconButton tip label="收起会话列表" onClick={onToggleSidebar}>
            <PanelLeftClose />
          </IconButton>
        </div>
        {actionError ? <div className={styles.actionError} role="alert">{actionError}</div> : null}
        {view === 'chat'
          ? (
              <>
                <button type="button" className={styles.newSession} disabled={!store.connected} onClick={() => setNewSessionOpen(true)}>
                  <span className={styles.slot}><MessageSquarePlus size={16} aria-hidden="true" /></span>
                  新建会话
                </button>
                <div className={styles.workspaceRow}>
                  <div className={`${styles.workspaceLabel} ${searchOpen ? styles.workspaceLabelHidden : ''}`} aria-hidden={searchOpen}>
                    Workspaces
                  </div>
                  <button
                    type="button"
                    className={`${styles.searchToggle} ${searchOpen ? styles.searchToggleHidden : ''}`}
                    ref={searchToggleRef}
                    aria-label="搜索会话"
                    aria-expanded={searchOpen}
                    aria-hidden={searchOpen}
                    tabIndex={searchOpen ? -1 : 0}
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search size={15} />
                  </button>
                  <div className={`${styles.searchField} ${searchOpen ? styles.searchFieldOpen : ''}`} aria-hidden={!searchOpen}>
                    <span className={styles.slot}><Search size={16} aria-hidden="true" /></span>
                    <input
                      ref={searchRef}
                      value={query}
                      tabIndex={searchOpen ? 0 : -1}
                      onChange={event => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape')
                          closeSearch()
                      }}
                      placeholder="搜索会话"
                      aria-label="搜索会话"
                    />
                    <button type="button" className={styles.searchClose} aria-label="关闭搜索" tabIndex={searchOpen ? 0 : -1} onClick={closeSearch}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className={styles.sessions}>
                  {[...byCwd.entries()].map(([cwd]) => {
                    const shown = !collapsedProjects.has(cwd) || Boolean(query.trim())
                    return (
                      <div key={cwd} className={`${styles.group} t-acc t-acc-fold`} data-open={String(shown)}>
                        <button
                          type="button"
                          className={`${styles.cwdRow} t-folder`}
                          aria-expanded={shown}
                          aria-label={`${shown ? '收起' : '展开'} ${projectName(cwd)}`}
                          onClick={() => {
                            if (!query.trim())
                              toggleProject(cwd)
                          }}
                        >
                          <span className={`t-icon-swap ${styles.folder}`} data-state={shown ? 'b' : 'a'}>
                            <span className="t-icon" data-icon="a"><Folder size={16} /></span>
                            <span className="t-icon" data-icon="b"><AccChevron /></span>
                          </span>
                          <div className={styles.projectName} title={shortenPath(cwd)}>
                            <span className={styles.projectLabel}>{projectName(cwd)}</span>
                          </div>
                        </button>
                        <div className="t-acc-panel" inert={!shown} aria-hidden={!shown}>
                          <div className="t-acc-panel-inner">
                            <Glide className={styles.rows} pin={store.activeKey ?? undefined}>
                              {(rowsByCwd.get(cwd) ?? []).map(({ node, indent, hasChildren }) => {
                                const session = node.session
                                return (
                                  <SessionRow
                                    key={session.path}
                                    session={session}
                                    active={store.activeKey === session.path}
                                    streaming={store.statuses[session.path]?.status === 'running'}
                                    attention={sessionAttention(session.path, store.statuses, store.unreadSessions)}
                                    rail={sessionRailStatus(session.path, store.statuses, store.unreadSessions, store.seenFailures)}
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
                            </Glide>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {query.trim() && filteredSessions.length === 0 ? <div className={styles.empty}>没有匹配的会话</div> : null}

                  {!store.connected ? <div className={styles.offline}><span className="t-shimmer" data-text={store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}>{store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}</span></div> : null}
                </div>
              </>
            )
          : null}
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
  rail: 'working' | 'done' | 'error' | 'needs_input' | null
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

function SessionRail({ status, hasChildren, collapsed, sessionLabel, onToggle }: {
  status: 'working' | 'done' | 'error' | 'needs_input' | null
  hasChildren: boolean
  collapsed: boolean
  sessionLabel: string
  onToggle: () => void
}) {
  const presence = usePresence(status !== null, '--lattice-fade', 200)
  const shownRef = useRef(status)
  if (status)
    shownRef.current = status
  return (
    <span className={styles.rail}>
      {presence.mounted && shownRef.current
        ? <LatticeLoader status={shownRef.current} phase={presence.className} />
        : hasChildren
          ? (
              <button
                className={styles.chevron}
                title={collapsed ? '展开子会话' : '折叠子会话'}
                aria-label={collapsed ? `展开子会话：${sessionLabel}` : `折叠子会话：${sessionLabel}`}
                aria-expanded={!collapsed}
                onClick={onToggle}
              >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            )
          : null}
    </span>
  )
}

function SessionRow({ session, active, streaming, attention, rail, connected, opening, editing, indent, hasChildren, isCollapsed, lineage, onPick, onRenameStart, onRenameEnd, onToggle }: SessionRowProps) {
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
    <div
      className={styles.sessionRow}
      data-glide={session.path}
      aria-current={active ? 'page' : undefined}
      style={indent ? { paddingLeft: `calc(var(--row-pad) + ${indent * 12}px)` } : undefined}
    >
      <SessionRail
        status={rail}
        hasChildren={hasChildren}
        collapsed={isCollapsed}
        sessionLabel={label(session)}
        onToggle={onToggle}
      />
      <div className={`${styles.item} ${active ? styles.active : ''} t-session`} title={title}>
        <button className={styles.itemMain} disabled={!connected || opening} onClick={onPick}>
          <span className={styles.label}>{label(session)}</span>
        </button>
        {connected
          ? (
              <span className={`t-icon-swap ${styles.swap}`} data-state="a">
                <span className={`t-icon ${styles.ageSlot}`} data-icon="a">
                  <span className={styles.age}>{opening ? '…' : age}</span>
                </span>
                <span className="t-icon" data-icon="b">
                  <SessionItemMenu
                    session={session}
                    label={label(session)}
                    streaming={streaming}
                    onRename={onRenameStart}
                  />
                </span>
              </span>
            )
          : (
              <span className={styles.ageSlot}>
                <span className={styles.age}>{opening ? '…' : age}</span>
              </span>
            )}
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
    <div className={styles.sessionRow} style={indent ? { paddingLeft: `calc(var(--row-pad) + ${indent * 12}px)` } : undefined}>
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
