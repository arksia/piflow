import type { FlowDocument, FlowNode, SessionInfoLite } from '@piflow/protocol'
import type { SessionTreeNode } from '../../session/tree'
import { Bot, Folder, GitFork, MessageSquarePlus, PanelLeftClose, Plus, Search, Settings, Workflow, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { loadFlow } from '../../features/flow/api'
import { usePresence } from '../../motion'
import { shortenPath } from '../../path'
import { openBackgroundSession, openSession, renameSession, selectProjectForNewChat } from '../../session/actions'
import { sessionAttention, sessionRailStatus } from '../../session/attention'
import { readCollapsedProjects, readCollapsedSessions, saveCollapsedProjects, saveCollapsedSessions } from '../../session/persistence'

import { requestConductorPanel, setSidebarOpen } from '../../session/store'
import { buildSessionForest, filterSessions, sessionAncestors, sessionLineage } from '../../session/tree'
import { useStore } from '../../session/use-store'
import ExtensionManagerDialog from '../ExtensionManagerDialog'
import IconButton from '../IconButton'
import LatticeLoader from '../LatticeLoader'
import NewSessionDialog from '../NewSessionDialog'
import ProviderDialog from '../ProviderDialog'
import SessionItemMenu from '../SessionItemMenu'
import SettingsDialog from '../SettingsDialog'
import SidebarTree from '../SidebarTree'
import { SidebarTreeGroup, SidebarTreeRow, SidebarTreeToggle } from '../SidebarTree/parts'
import ViewSwitch from '../ViewSwitch'
import styles from './styles.module.css'

const FLOW_STATUS_CLASSES = {
  idle: 'pf-text-faint',
  role: 'pf-text-muted',
  running: 'pf-text-signal',
  needsInput: 'pf-text-warning',
  failed: 'pf-text-danger',
}

interface FlowSidebarItem {
  id: string
  kind: 'persistent' | 'subagent-role'
  node?: FlowNode
  children: FlowSidebarItem[]
}

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

function flowNodeStatus(kind: 'persistent' | 'subagent-role', sessionPath: string, store: ReturnType<typeof useStore>): { label: string, state: keyof typeof FLOW_STATUS_CLASSES } {
  if (kind === 'subagent-role')
    return { label: '角色', state: 'role' }
  if (!sessionPath)
    return { label: '未开始', state: 'idle' }
  const status = store.statuses[sessionPath]
  if (status?.needsInputAt)
    return { label: '待回答', state: 'needsInput' }
  if (status?.status === 'running')
    return { label: '运行中', state: 'running' }
  if (status?.status === 'failed')
    return { label: '失败', state: 'failed' }
  return { label: '空闲', state: 'idle' }
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
  flowProject: string
  selectedFlowNodeId: string | null
  onFlowProjectChange: (path: string) => void
  onSelectFlowNode: (id: string) => void
}

function SessionList({ theme, view, onShowChat, onShowFlow, onToggleTheme, onToggleSidebar, flowProject, selectedFlowNodeId, onFlowProjectChange, onSelectFlowNode }: SessionListProps) {
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

  const forestByCwd = useMemo(() => {
    const map = new Map<string, SessionTreeNode[]>()
    for (const [cwd, sessions] of byCwd)
      map.set(cwd, buildSessionForest(sessions))
    return map
  }, [byCwd])

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
      if (session.conductor) {
        await openBackgroundSession(session.path)
        requestConductorPanel()
        onShowFlow()
        setSidebarOpen(false)
        return
      }
      await openSession(session.path)
      onShowChat()
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
      <div className={`${styles.list} pf-flex pf-w-full pf-h-full pf-min-h-0 pf-box-border pf-flex-col pf-text-ui`}>
        <div className={`${styles.top} pf-flex pf-items-center pf-justify-between pf-shrink-0 pf-gap-2 pf-mb-[4px]`}>
          <div className={`${styles.brand} pf-flex pf-items-center pf-gap-[8px] pf-text-[14px] pf-font-semibold`}>
            <Workflow size={18} aria-hidden="true" />
            <span>piflow</span>
          </div>
          <IconButton
            tip
            label="收起会话列表"
            onClick={() => {
              if (window.matchMedia('(width <= 768px)').matches)
                setSidebarOpen(false)
              else
                onToggleSidebar()
            }}
          >
            <PanelLeftClose />
          </IconButton>
        </div>
        <ViewSwitch active={view} onChange={next => next === 'flow' ? onShowFlow() : onShowChat()} />
        {actionError ? <div className="pf-m-[10px_6px_0] pf-p-[7px_8px] pf-border pf-border-solid pf-border-danger pf-rounded-[4px] pf-text-danger pf-text-[0.76rem]" role="alert">{actionError}</div> : null}
        {view === 'chat'
          ? (
              <>
                <button
                  type="button"
                  className={`${styles.newSession} pf-flex pf-items-center pf-h-[32px] pf-mt-[8px] pf-rounded-[8px] pf-text-[length:var(--text-ui)] pf-font-medium pf-text-left`}
                  disabled={!store.connected}
                  onClick={() => setNewSessionOpen(true)}
                >
                  <span className={`${styles.slot} pf-grid pf-flex-none pf-place-items-center`}><MessageSquarePlus size={16} aria-hidden="true" /></span>
                  新建会话
                </button>
                <div className="pf-relative pf-h-[36px] pf-mt-[6px]">
                  <div
                    className={[
                      `${styles.workspaceLabel} pf-flex pf-items-center pf-h-[32px] pf-text-faint pf-text-[length:var(--text-small)]`,
                      `pf-font-medium ${searchOpen ? `${styles.workspaceLabelHidden} pf-pointer-events-none` : ''}`,
                    ].join(' ')}
                    aria-hidden={searchOpen}
                  >
                    项目与会话
                  </div>
                  <button
                    type="button"
                    className={[
                      `${styles.searchToggle} pf-grid pf-place-items-center pf-cursor-pointer pf-absolute pf-top-0 pf-right-0`,
                      'pf-w-[32px] pf-h-[32px] pf-rounded-[8px]',
                      searchOpen ? `${styles.searchToggleHidden} pf-pointer-events-none` : '',
                    ].join(' ')}
                    ref={searchToggleRef}
                    aria-label="搜索会话"
                    aria-expanded={searchOpen}
                    aria-hidden={searchOpen}
                    tabIndex={searchOpen ? -1 : 0}
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search size={15} />
                  </button>
                  <div className={`${styles.searchField} pf-absolute pf-top-0 pf-right-0 pf-flex pf-h-[32px] pf-items-center pf-overflow-hidden ${searchOpen ? styles.searchFieldOpen : ''}`} aria-hidden={!searchOpen}>
                    <span className={`${styles.slot} pf-grid pf-flex-none pf-place-items-center`}><Search size={16} aria-hidden="true" /></span>
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
                    <button type="button" className={`${styles.searchClose} pf-grid pf-place-items-center pf-cursor-pointer pf-w-[32px] pf-h-[32px] pf-flex-none pf-rounded-[8px]`} aria-label="关闭搜索" tabIndex={searchOpen ? 0 : -1} onClick={closeSearch}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className="pf-flex-1 pf-min-h-0 pf-overflow-auto" aria-label="项目与会话">
                  {[...byCwd.entries()].map(([cwd]) => {
                    const shown = !collapsedProjects.has(cwd) || Boolean(query.trim())
                    return (
                      <SidebarTreeGroup
                        key={cwd}
                        label={projectName(cwd)}
                        title={shortenPath(cwd)}
                        open={shown}
                        onToggle={() => {
                          if (!query.trim())
                            toggleProject(cwd)
                        }}
                        actions={(
                          <IconButton
                            className="pf-mr-[2px]"
                            size="compact"
                            label={`在 ${projectName(cwd)} 中新建会话`}
                            disabled={!store.connected}
                            onClick={() => {
                              selectProjectForNewChat(cwd)
                              onShowChat()
                              setSidebarOpen(false)
                            }}
                          >
                            <Plus />
                          </IconButton>
                        )}
                      >
                        <SidebarTree
                          items={forestByCwd.get(cwd) ?? []}
                          collapsed={collapsed}
                          onToggle={toggleCollapsed}
                          getKey={node => node.session.path}
                          getChildren={node => node.children}
                          pin={store.activeKey ?? undefined}
                          maxDepth={3}
                          renderItem={(node, tree) => {
                            const session = node.session
                            return (
                              <SessionRow
                                session={session}
                                active={store.activeKey === session.path}
                                streaming={store.statuses[session.path]?.status === 'running'}
                                attention={sessionAttention(session.path, store.statuses, store.unreadSessions)}
                                rail={sessionRailStatus(session.path, store.statuses, store.unreadSessions, store.seenFailures)}
                                connected={store.connected}
                                opening={openingPath === session.path}
                                editing={editingPath === session.path}
                                indent={tree.depth}
                                hasChildren={tree.hasChildren}
                                isCollapsed={tree.collapsed}
                                lineage={sessionLineage(store.sessions, session.path)}
                                onPick={() => void pick(session)}
                                onRenameStart={() => setEditingPath(session.path)}
                                onRenameEnd={() => setEditingPath(null)}
                                onToggle={tree.toggle}
                              />
                            )
                          }}
                        />
                      </SidebarTreeGroup>
                    )
                  })}

                  {store.connected && store.sessions.length === 0
                    ? (
                        <div className="pf-p-[18px_8px] pf-text-faint pf-text-center pf-text-[length:var(--text-small)]">
                          还没有会话
                          <br />
                          新建会话，选择项目开始工作。
                        </div>
                      )
                    : null}

                  {query.trim() && filteredSessions.length === 0 ? <div className="pf-p-[18px_8px] pf-text-faint pf-text-center pf-text-[length:var(--text-small)]">没有匹配的会话</div> : null}

                  {!store.connected ? <div className="pf-mt-[16px] pf-p-[8px] pf-text-faint pf-text-[0.8rem]"><span className="t-shimmer" data-text={store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}>{store.connectionState === 'reconnecting' ? '重连中…' : '连接中…'}</span></div> : null}
                </div>
              </>
            )
          : <FlowSidebar projectPath={flowProject || store.cwd} selectedNodeId={selectedFlowNodeId} onProjectChange={onFlowProjectChange} onSelectNode={onSelectFlowNode} />}
        <div className={`${styles.footer} pf-flex pf-shrink-0 pf-items-center pf-min-h-[52px] pf-gap-[8px] pf-mt-auto`}>
          <button type="button" className={`${styles.settings} pf-flex pf-items-center pf-gap-[8px] pf-min-h-[32px] pf-p-[0_6px] pf-rounded-control pf-text-[12px]`} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} aria-hidden="true" />
            设置
          </button>
          <span className={`${styles.connection} pf-flex pf-items-center pf-gap-[6px] pf-ml-auto pf-text-muted pf-text-caption pf-whitespace-nowrap`} data-connected={store.connected} role="status">{store.connected ? '本地已连接' : store.connectionState === 'reconnecting' ? '重新连接中' : '连接中'}</span>
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

function FlowSidebar({ projectPath, selectedNodeId, onProjectChange, onSelectNode }: { projectPath: string, selectedNodeId: string | null, onProjectChange: (path: string) => void, onSelectNode: (id: string) => void }) {
  const store = useStore()
  const [document, setDocument] = useState<FlowDocument | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const treeItems: FlowSidebarItem[] = (['persistent', 'subagent-role'] as const).map(kind => ({
    id: `group:${kind}`,
    kind,
    children: document?.nodes.filter(node => (node.kind === 'subagent-role' ? 'subagent-role' : 'persistent') === kind).map(node => ({ id: node.id, kind, node, children: [] })) ?? [],
  })).filter(item => item.children.length > 0)
  useEffect(() => {
    let cancelled = false
    if (!projectPath) {
      // eslint-disable-next-line react/set-state-in-effect -- clear the previous project's node list immediately.
      setDocument(null)
      return
    }
    const refresh = () => {
      void loadFlow(projectPath).then((result) => {
        if (!cancelled)
          setDocument(result.document)
      }).catch(() => {
        if (!cancelled)
          setDocument(null)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [projectPath])
  return (
    <>
      <div className="pf-flex pf-min-h-0 pf-flex-1 pf-flex-col pf-overflow-hidden">
        <div className="pf-flex pf-min-h-[52px] pf-flex-none pf-items-center pf-gap-2 pf-border-b pf-border-solid pf-border-line pf-p-[6px_4px_6px_6px]">
          <div className="pf-flex pf-min-w-0 pf-flex-1 pf-flex-col pf-gap-[1px]">
            <span className="pf-text-[0.68rem] pf-leading-[1.25] pf-text-faint">工程</span>
            <strong className="pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-text-[0.86rem] pf-font-medium pf-leading-[1.35] pf-text-ink" title={projectPath}>{projectPath ? projectName(projectPath) : '未选择'}</strong>
          </div>
          <IconButton label="选择 Flow 工程" disabled={!store.connected} onClick={() => setPickerOpen(true)}><Folder /></IconButton>
        </div>
        <div className="pf-flex pf-h-[36px] pf-flex-none pf-items-center pf-justify-between pf-px-[10px] pf-text-[length:var(--text-small)] pf-font-medium pf-text-faint">
          <span>Flow 节点</span>
          {document ? <span className="pf-font-mono pf-tabular-nums pf-text-caption">{document.nodes.length}</span> : null}
        </div>
        <nav className="pf-min-h-0 pf-flex-1 pf-overflow-auto" aria-label="Flow 节点">
          {treeItems.map(group => (
            <FlowNodeGroup key={group.id} group={group} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
          ))}
          {document && document.nodes.length === 0 ? <p className="pf-m-0 pf-p-[18px_8px] pf-text-center pf-text-small pf-text-faint">这个工程还没有 Flow 节点</p> : null}
          {!document && projectPath ? <p className="pf-m-0 pf-p-[18px_8px] pf-text-center pf-text-small pf-text-faint">正在读取 Flow…</p> : null}
          {!projectPath ? <button type="button" className="pf-mt-2 pf-w-full pf-rounded-[5px] pf-border-0 pf-bg-transparent pf-p-2 pf-text-left pf-text-[0.78rem] pf-text-muted hover:pf-bg-press hover:pf-text-ink" onClick={() => setPickerOpen(true)}>选择一个工程以打开 Flow</button> : null}
        </nav>
      </div>
      {pickerOpen ? <NewSessionDialog initialPath={projectPath || store.cwd} onSelect={onProjectChange} onCreated={() => setPickerOpen(false)} onClose={() => setPickerOpen(false)} /> : null}
    </>
  )
}

function FlowNodeGroup({ group, selectedNodeId, onSelectNode }: { group: FlowSidebarItem, selectedNodeId: string | null, onSelectNode: (id: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(true)
  const heading = group.kind === 'persistent' ? '主 Agent' : 'Subagent 角色'
  return (
    <SidebarTreeGroup label={heading} open={open} onToggle={() => setOpen(value => !value)} metadata={<span className="pf-pr-[8px] pf-text-caption pf-text-faint">{group.children.length}</span>}>
      <SidebarTree
        items={group.children}
        getKey={item => item.id}
        getChildren={item => item.children}
        pin={selectedNodeId ?? undefined}
        renderItem={(item, tree) => {
          const node = item.node!
          const status = flowNodeStatus(item.kind, node.sessionPath, store)
          const Icon = item.kind === 'persistent' ? Bot : GitFork
          return <SidebarTreeRow id={node.id} label={node.name} indent={tree.depth + 1} active={selectedNodeId === node.id} rail={<Icon size={15} aria-hidden="true" />} trailing={<span className={`pf-whitespace-nowrap pf-text-caption ${FLOW_STATUS_CLASSES[status.state]}`}>{status.label}</span>} title={`${node.name} · ${status.label}`} ariaLabel={`${node.name}，${status.label}，定位到画布并打开节点面板`} onSelect={() => onSelectNode(node.id)} />
        }}
      />
    </SidebarTreeGroup>
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
    <>
      {presence.mounted && shownRef.current
        ? <LatticeLoader status={shownRef.current} phase={presence.className} />
        : hasChildren
          ? <SidebarTreeToggle label={sessionLabel} open={!collapsed} onToggle={onToggle} />
          : null}
    </>
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
    <SidebarTreeRow
      id={session.path}
      label={label(session)}
      active={active}
      indent={indent}
      title={title}
      disabled={!connected || opening}
      onSelect={onPick}
      rail={<SessionRail status={rail} hasChildren={hasChildren} collapsed={isCollapsed} sessionLabel={label(session)} onToggle={onToggle} />}
      trailing={
        connected
          ? (
              <span className={`t-icon-swap ${styles.swap} pf-col-start-2 pf-row-start-1`} data-state="a">
                <span className="t-icon pf-inline-flex pf-items-center pf-justify-center pf-w-[32px] pf-h-[32px]" data-icon="a"><span className="pf-text-faint pf-text-caption pf-[font-variant-numeric:tabular-nums] pf-whitespace-nowrap">{opening ? '…' : age}</span></span>
                <span className="t-icon" data-icon="b"><SessionItemMenu session={session} label={label(session)} streaming={streaming} onRename={onRenameStart} /></span>
              </span>
            )
          : <span className="pf-inline-flex pf-items-center pf-justify-center pf-w-[32px] pf-h-[32px]"><span className="pf-text-faint pf-text-caption pf-[font-variant-numeric:tabular-nums] pf-whitespace-nowrap">{opening ? '…' : age}</span></span>
      }
    />
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
    <SidebarTreeRow label={label(session)} indent={indent}>
      <div className="pf-col-span-full pf-p-[4px_8px]">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void commit()
          }}
        >
          <input
            ref={inputRef}
            className={`${styles.renameInput} pf-block pf-box-border pf-w-full pf-p-[5px_7px] pf-bg-bg pf-text-[0.85rem]`}
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
          {error ? <span className="pf-block pf-p-[4px_2px_0] pf-text-danger pf-text-[0.7rem]">{error}</span> : null}
        </form>
      </div>
    </SidebarTreeRow>
  )
}

export default memo(SessionList)
