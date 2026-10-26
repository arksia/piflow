import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { FlowDocument, FlowEdge, FlowNode, FlowTopology, SessionInfoLite } from '@piflow/protocol'
import type {
  Edge,
  EdgeChange,
  NodeChange,
  NodeMouseHandler,
  OnEdgesDelete,
  OnNodesDelete,
  ReactFlowInstance,
  Viewport,
} from '@xyflow/react'
import type { SessionView } from '../../session/state'
import type { FlowCanvasNode } from '../FlowSessionNode'
import { conductorDraftReady, parseConductorDraft } from '@piflow/protocol'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import { ArrowRight, CircleAlert, PanelLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { acceptConductor, loadFlow, saveFlow } from '../../flow/api'
import { flowAttentionItems, sessionNeedsInputFor, sessionStatusFor } from '../../flow/attention'
import { activeDeliveryEdges, sameDeliveryState } from '../../flow/edges'
import { shouldSeedFlow } from '../../flow/seed'
import { shortenPath } from '../../path'
import { createBackgroundSession, createConductorSession, openBackgroundSession, openSession, requestModels, requestProjectTrust } from '../../session/actions'
import { readDraft } from '../../session/persistence'
import { clearSessionUnread } from '../../session/reducer'
import { useStore } from '../../session/use-store'
import ChatView from '../ChatView'
import FlowSessionNode from '../FlowSessionNode'
import IconButton from '../IconButton'
import InputBar from '../InputBar'
import styles from './styles.module.css'
import '@xyflow/react/dist/style.css'

const nodeTypes = { session: FlowSessionNode }

const NODE_WIDTH = 288
const NODE_HEIGHT = 156
const NODE_MARGIN = 32

function rectsOverlap(a: { x: number, y: number, w: number, h: number }, b: { x: number, y: number, w: number, h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function findFreeNodePosition(existing: FlowNode[], center: { x: number, y: number }) {
  const bounds = existing.map(node => ({ x: node.position.x, y: node.position.y, w: NODE_WIDTH + NODE_MARGIN, h: NODE_HEIGHT + NODE_MARGIN }))
  for (let step = 0; step < 40; step++) {
    const candidate = { x: center.x + step * 48, y: center.y + step * 32 }
    const rect = { x: candidate.x, y: candidate.y, w: NODE_WIDTH + NODE_MARGIN, h: NODE_HEIGHT + NODE_MARGIN }
    if (!bounds.some(other => rectsOverlap(rect, other)))
      return candidate
  }
  return center
}

interface FlowViewProps {
  active?: boolean
  onShowChat: () => void
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
}

interface ConnectMode {
  sourceId: string
}

export default function FlowView({ active = true, onShowChat, onToggleSidebar, sidebarCollapsed }: FlowViewProps) {
  const store = useStore()
  const activeView = store.activeKey ? store.views[store.activeKey] : undefined
  const activeSessionPath = activeView?.sessionFile ?? store.activeKey
  const activeSession = store.sessions.find(session => session.path === activeSessionPath)
  const projectPath = activeSession?.cwd ?? store.cwd
  const seedSessionPath = activeSession?.path ?? ''
  const seedSessionName = activeSession ? sessionLabel(activeSession) : ''
  const seedSessionGoal = activeSession?.firstMessage ?? ''
  const seedSessionCwd = activeSession?.cwd ?? ''
  const [document, setDocument] = useState<FlowDocument | null>(null)
  const documentRef = useRef<FlowDocument | null>(null)
  const [nodes, setNodes] = useState<FlowCanvasNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [instance, setInstance] = useState<ReactFlowInstance<FlowCanvasNode, Edge> | null>(null)
  const [connectMode, setConnectMode] = useState<ConnectMode | null>(null)
  const activeEdges = useMemo(() => activeDeliveryEdges(document?.messages ?? []), [document])
  const saveRevRef = useRef(0)
  const pendingSaveRef = useRef<FlowDocument | null>(null)
  const graphChangedRef = useRef(false)
  const commitGraphRef = useRef(false)
  const saveRunningRef = useRef(false)
  const acceptingRef = useRef(false)
  const seenConductorRef = useRef(0)
  const openingRef = useRef(new Set<string>())
  const persistRef = useRef<(next: FlowDocument, commitGraph?: boolean) => Promise<void>>(async () => {})
  const [conductorOpen, setConductorOpen] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [composerFocusVersion, setComposerFocusVersion] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const openingNodeRef = useRef(new Set<string>())
  const [panelOpen, setPanelOpen] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [draftBrief, setDraftBrief] = useState('')
  const [sessionPath, setSessionPath] = useState('')
  const [briefOpen, setBriefOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ nodes: string[], edges: string[] }>({ nodes: [], edges: [] })
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pollRef = useRef({ start() {}, stop() {} })
  const ensureNodeSession = useCallback(async (id: string): Promise<string | null> => {
    const current = documentRef.current
    const node = current?.nodes.find(item => item.id === id)
    if (!current || !node)
      return null
    let path = node.sessionPath
    if (!path) {
      const state = await createBackgroundSession(current.projectPath)
      if (!state.sessionFile)
        throw new Error('新会话尚未生成可持久化路径')
      path = state.sessionFile
      const latest = documentRef.current ?? current
      await persistRef.current({
        ...latest,
        nodes: latest.nodes.map(item => item.id === id ? { ...item, sessionPath: path, updatedAt: new Date().toISOString() } : item),
      })
    }
    return path
  }, [])
  const focusSession = useCallback(async (id: string) => {
    if (openingRef.current.has(id))
      return
    openingRef.current.add(id)
    setError(null)
    try {
      const path = await ensureNodeSession(id)
      if (!path)
        return
      await openSession(path)
      onShowChat()
    }
    catch (reason) {
      setError(String(reason))
    }
    finally {
      openingRef.current.delete(id)
    }
  }, [ensureNodeSession, onShowChat])

  if (store.conductorNonce !== seenConductorRef.current) {
    seenConductorRef.current = store.conductorNonce
    if (store.conductorNonce > 0)
      setConductorOpen(true)
  }

  useEffect(() => {
    let cancelled = false
    const rev = saveRevRef.current
    void loadFlow(projectPath)
      .then(async (loaded) => {
        if (cancelled || rev !== saveRevRef.current)
          return
        let resolved = loaded.document
        if (shouldSeedFlow({
          stored: loaded.stored,
          nodeCount: resolved.nodes.length,
          seedPath: seedSessionPath,
          seedCwd: seedSessionCwd,
          projectPath: resolved.projectPath,
        })) {
          const now = new Date().toISOString()
          resolved = await saveFlow(resolved.projectPath, {
            ...topologyOf(resolved),
            nodes: [{
              id: crypto.randomUUID(),
              sessionPath: seedSessionPath,
              name: seedSessionName,
              goal: seedSessionGoal,
              brief: '',
              position: { x: 80, y: 80 },
              createdAt: now,
              updatedAt: now,
            }],
          })
        }
        if (cancelled || rev !== saveRevRef.current)
          return
        setDocument(resolved)
        setNodes(resolved.nodes.map(node => toCanvasNode(node, () => void focusSession(node.id))))
        setViewport(resolved.viewport)
        if (instance)
          void instance.setViewport(resolved.viewport)
      })
      .catch((reason: unknown) => !cancelled && setError(String(reason)))
    return () => {
      cancelled = true
    }
  }, [focusSession, instance, projectPath, seedSessionCwd, seedSessionGoal, seedSessionName, seedSessionPath])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        setConnectMode(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Honor prefers-reduced-motion for animated message arrows.
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    function onChange() {
      setReducedMotion(media.matches)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Keep a mutable reference to the latest document.
  useEffect(() => {
    documentRef.current = document
  }, [document])

  const activeRef = useRef(active)
  activeRef.current = active

  // Poll for new inter-node messages while the canvas is visible.
  // Only the message list is inspected; topology is never overwritten from poll.
  useEffect(() => {
    if (!projectPath)
      return
    let cancelled = false
    let intervalId: number | null = null

    function tick() {
      void loadFlow(projectPath)
        .then((loaded) => {
          if (cancelled)
            return
          setDocument((current) => {
            if (!current || current.projectPath !== loaded.document.projectPath)
              return current
            if (sameDeliveryState(current.messages, loaded.document.messages))
              return current
            return { ...current, messages: loaded.document.messages }
          })
        })
        .catch(() => {
          // Polling failures are not surfaced; the next tick will retry.
        })
    }

    function start() {
      if (intervalId !== null || !activeRef.current || window.document.visibilityState === 'hidden')
        return
      tick()
      intervalId = window.setInterval(tick, 3000)
    }

    function stop() {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    function handleVisibility() {
      if (!activeRef.current || window.document.visibilityState === 'hidden')
        stop()
      else
        start()
    }

    pollRef.current = { start, stop }
    start()
    window.document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      cancelled = true
      stop()
      window.document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [projectPath])

  useEffect(() => {
    if (active)
      pollRef.current.start()
    else
      pollRef.current.stop()
  }, [active])

  useEffect(() => {
    if (!active || !instance)
      return
    const target = nodes.find(node => node.data.sessionPath === activeSessionPath)
    if (target)
      void instance.fitView({ nodes: [target], padding: 0.55, maxZoom: 1.1, duration: reducedMotion ? 0 : 180 })
    else if (document)
      void instance.setViewport(document.viewport)
    // ponytail: refit when the canvas first has nodes; later topology edits stay put
    // eslint-disable-next-line react/exhaustive-deps -- reading the latest session here would refit on every edit
  }, [active, instance, nodes.length])

  // Re-render edges when topology, active message events, selection, or motion preference change.
  useEffect(() => {
    if (!document)
      return
    // Edges are derived from document topology, active messages, selection, and motion preference.
    // eslint-disable-next-line react/set-state-in-effect
    setEdges(toCanvasEdges(document.edges, activeEdges, new Set(selection.edges), reducedMotion))
  }, [document, activeEdges, selection.edges, reducedMotion])

  async function persist(next: FlowDocument, commitGraph = false) {
    const previous = documentRef.current
    // Replacing nodes drops measured size, and React Flow hides a node until it is measured again.
    // A viewport save must not touch the node list, or the cards vanish when the pan ends.
    const graphChanged = !previous || previous.nodes !== next.nodes || previous.edges !== next.edges
    if (graphChanged)
      graphChangedRef.current = true
    if (commitGraph)
      commitGraphRef.current = true
    documentRef.current = next
    saveRevRef.current += 1
    pendingSaveRef.current = next
    setDocument(next)
    if (graphChanged)
      setNodes(next.nodes.map(node => toCanvasNode(node, () => void focusSession(node.id))))
    if (saveRunningRef.current)
      return
    saveRunningRef.current = true
    setSaving(true)
    setError(null)
    try {
      while (pendingSaveRef.current) {
        const snapshot = pendingSaveRef.current
        const rev = saveRevRef.current
        const replaceNodes = graphChangedRef.current
        const commit = commitGraphRef.current
        graphChangedRef.current = false
        commitGraphRef.current = false
        pendingSaveRef.current = null
        let saved: FlowDocument
        try {
          saved = await saveFlow(snapshot.projectPath, topologyOf(snapshot), commit)
        }
        catch (error) {
          if (commit)
            commitGraphRef.current = true
          throw error
        }
        if (rev !== saveRevRef.current) {
          if (commit)
            commitGraphRef.current = true
          continue
        }
        documentRef.current = saved
        setDocument(saved)
        if (replaceNodes)
          setNodes(saved.nodes.map(node => toCanvasNode(node, () => void focusSession(node.id))))
      }
    }
    catch (reason) {
      setError(String(reason))
    }
    finally {
      saveRunningRef.current = false
      setSaving(false)
      if (pendingSaveRef.current && !acceptingRef.current)
        void persist(pendingSaveRef.current)
    }
  }
  persistRef.current = persist

  function connectNodes(sourceId: string, targetId: string) {
    if (!document || sourceId === targetId)
      return
    const exists = document.edges.some(edge =>
      (edge.source === sourceId && edge.target === targetId)
      || (edge.source === targetId && edge.target === sourceId),
    )
    if (exists) {
      setError('这两个会话已经建立关系')
      setConnectMode(null)
      return
    }
    const edge: FlowEdge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      createdAt: new Date().toISOString(),
    }
    void persist({ ...document, edges: [...document.edges, edge] }, true)
    setConnectMode(null)
  }

  function onNodesChange(changes: NodeChange<FlowCanvasNode>[]) {
    setNodes(current => applyNodeChanges(changes, current))
  }

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    if (!connectMode)
      return
    if (node.id === connectMode.sourceId)
      return
    connectNodes(connectMode.sourceId, node.id)
  }

  function onPaneClick() {
    setConnectMode(null)
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, node: FlowCanvasNode) {
    const current = documentRef.current
    if (!current)
      return
    const now = new Date().toISOString()
    void persist({
      ...current,
      nodes: current.nodes.map(item => item.id === node.id ? { ...item, position: node.position, updatedAt: now } : item),
    }, true)
  }

  const onNodesDelete: OnNodesDelete<FlowCanvasNode> = (deleted) => {
    if (!document)
      return
    const ids = new Set(deleted.map(node => node.id))
    void persist({
      ...document,
      nodes: document.nodes.filter(node => !ids.has(node.id)),
      edges: document.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
    }, true)
    if (connectMode && ids.has(connectMode.sourceId))
      setConnectMode(null)
  }

  function onEdgesChange(changes: EdgeChange<Edge>[]) {
    setEdges(current => applyEdgeChanges(changes, current))
  }

  const onEdgesDelete: OnEdgesDelete<Edge> = (deleted) => {
    if (!document)
      return
    const ids = new Set(deleted.map(edge => edge.id))
    void persist({ ...document, edges: document.edges.filter(edge => !ids.has(edge.id)) }, true)
  }

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: FlowCanvasNode[], edges: Edge[] }) => {
    const next = { nodes: selectedNodes.map(node => node.id), edges: selectedEdges.map(edge => edge.id) }
    setSelection(current => sameSelection(current, next) ? current : next)
    if (next.nodes.length !== 1)
      setBriefOpen(false)
    if (connectMode && !selectedNodes.some(node => node.id === connectMode.sourceId))
      setConnectMode(null)
    const selectedPath = selectedNodes[0]?.data.sessionPath
    if (selectedPath && next.nodes.length === 1)
      clearSessionUnread(selectedPath)
    const nextSelectedId = next.nodes.length === 1 ? next.nodes[0] : undefined
    setComposerText(nextSelectedId ? readDraft(`flow-node:${nextSelectedId}`).text : '')
    if (nextSelectedId)
      setComposerFocusVersion(v => v + 1)
  }, [connectMode])

  function onMove(_event: MouseEvent | TouchEvent | null, viewport: Viewport) {
    setViewport(viewport)
  }

  function onMoveEnd(_event: MouseEvent | TouchEvent | null, viewport: Viewport) {
    const current = documentRef.current
    if (acceptingRef.current || !current || sameViewport(current.viewport, viewport))
      return
    void persist({ ...current, viewport })
  }

  async function showConductor() {
    setConductorOpen(true)
    const path = documentRef.current?.conductorPath
    try {
      if (path) {
        await openBackgroundSession(path)
        await Promise.all([requestModels(path), requestProjectTrust(projectPath)])
        return
      }
      const state = await createConductorSession(projectPath)
      const file = state.sessionFile
      if (!file)
        throw new Error('编排会话没有保存下来')
      const current = documentRef.current
      if (!current)
        return
      const next = { ...current, conductorPath: file }
      documentRef.current = next
      setDocument(next)
      await Promise.all([requestModels(file), requestProjectTrust(projectPath)])
    }
    catch (reason) {
      setError(String(reason))
    }
  }

  async function acceptDraft() {
    const path = documentRef.current?.conductorPath
    const streaming = Boolean(path && (store.views[path]?.isStreaming || store.statuses[path]?.status === 'running'))
    const message = latestDraftMessage(viewForSession(store.views, path))
    const draft = message ? parseConductorDraft(messageText(message)) : null
    if (!draft || !conductorDraftReady(draft) || streaming)
      return
    acceptingRef.current = true
    saveRevRef.current += 1
    pendingSaveRef.current = null
    graphChangedRef.current = false
    commitGraphRef.current = false
    setSaving(true)
    setError(null)
    try {
      const saved = await acceptConductor(projectPath, draft)
      documentRef.current = saved
      setDocument(saved)
      setNodes(saved.nodes.map(node => toCanvasNode(node, () => void focusSession(node.id))))
    }
    catch (reason) {
      setError(String(reason))
    }
    finally {
      acceptingRef.current = false
      setSaving(false)
    }
  }

  function openBrief() {
    const id = selection.nodes[0]
    const node = id ? document?.nodes.find(item => item.id === id) : undefined
    if (!node)
      return
    setBrief(node.brief ?? '')
    setBriefOpen(true)
    setPanelOpen(false)
  }

  function saveBrief(event: React.FormEvent) {
    event.preventDefault()
    const id = selection.nodes[0]
    if (!document || !id)
      return
    const now = new Date().toISOString()
    void persist({
      ...document,
      nodes: document.nodes.map(node => node.id === id ? { ...node, brief: brief.trim(), updatedAt: now } : node),
    }, true)
    setBriefOpen(false)
  }

  async function addNode(event: React.FormEvent) {
    event.preventDefault()
    if (!document || !name.trim())
      return
    setSaving(true)
    setError(null)
    try {
      let path = sessionPath
      if (!path) {
        const state = await createBackgroundSession(document.projectPath)
        if (!state.sessionFile)
          throw new Error('新会话尚未生成可持久化路径')
        path = state.sessionFile
      }
      const center = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 120, y: 120 }
      const point = findFreeNodePosition(document.nodes, center)
      const now = new Date().toISOString()
      const next: FlowDocument = {
        ...document,
        nodes: [...document.nodes, {
          id: crypto.randomUUID(),
          sessionPath: path,
          name: name.trim(),
          goal: goal.trim(),
          brief: draftBrief.trim(),
          position: point,
          createdAt: now,
          updatedAt: now,
        }],
      }
      await persist(next, true)
      setName('')
      setGoal('')
      setDraftBrief('')
      setSessionPath('')
      setPanelOpen(false)
    }
    catch (reason) {
      setError(String(reason))
      setSaving(false)
    }
  }

  function deleteSelection() {
    if (!document)
      return
    const nodeIds = new Set(selection.nodes)
    const edgeIds = new Set(selection.edges)
    void persist({
      ...document,
      nodes: document.nodes.filter(node => !nodeIds.has(node.id)),
      edges: document.edges.filter(edge => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
    }, true)
    setSelection({ nodes: [], edges: [] })
  }

  const startConnect = useCallback(() => {
    if (selection.nodes.length === 1)
      setConnectMode({ sourceId: selection.nodes[0]! })
  }, [selection])

  const selectedNodeId = selection.nodes.length === 1 ? selection.nodes[0] : undefined
  const selectedNode = selectedNodeId ? document?.nodes.find(node => node.id === selectedNodeId) : undefined
  const selectedCanvasNode = selectedNodeId ? nodes.find(node => node.id === selectedNodeId) : undefined
  const selectedNodeView = selectedNode ? (viewForSession(store.views, selectedNode.sessionPath) ?? null) : null

  // Open the node's binding session in the background as soon as it is selected
  // so the composer has a live view (queue, model, abort, steer behavior).
  useEffect(() => {
    if (!selectedNodeId)
      return
    if (openingNodeRef.current.has(selectedNodeId))
      return
    const id = selectedNodeId
    let cancelled = false
    async function run() {
      openingNodeRef.current.add(id)
      try {
        const path = await ensureNodeSession(id)
        if (!path || cancelled)
          return
        const opened = await openBackgroundSession(path)
        await requestModels(opened.key)
      }
      catch (reason) {
        if (!cancelled)
          setError(String(reason))
      }
      finally {
        openingNodeRef.current.delete(id)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedNodeId, ensureNodeSession])

  const conductorPath = document?.conductorPath
  const conductorView = viewForSession(store.views, conductorPath)
  const conductorStreaming = Boolean(conductorView?.isStreaming || (conductorPath && store.statuses[conductorPath]?.status === 'running'))
  const draftMessage = latestDraftMessage(conductorView)
  const conductorReady = conductorDraftReady(parseConductorDraft(draftMessage ? messageText(draftMessage) : '')) && !conductorStreaming
  const availableSessions = store.sessions.filter(session => session.cwd === document?.projectPath && session.path !== conductorPath && !session.conductor && !document.nodes.some(node => node.sessionPath === session.path))
  // The store is mutable and keeps a stable identity, so derive status on every notified render.
  const visibleNodes = nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      status: sessionStatusFor(node.data.sessionPath, store.statuses),
      needsInput: sessionNeedsInputFor(node.data.sessionPath, store.statuses),
      unread: store.unreadSessions.has(node.data.sessionPath),
      isCurrent: node.data.sessionPath === activeSessionPath,
      isAnchor: connectMode?.sourceId === node.id,
    },
  }))
  const attentionItems = flowAttentionItems(document?.nodes ?? [], store.statuses)

  function reviewAttention() {
    const item = attentionItems[0]
    const target = item ? visibleNodes.find(node => node.id === item.nodeId) : undefined
    if (!target)
      return
    setNodes(current => current.map(node => ({ ...node, selected: node.id === target.id })))
    setSelection({ nodes: [target.id], edges: [] })
    if (instance)
      void instance.fitView({ nodes: [target], padding: 0.7, maxZoom: 1, duration: reducedMotion ? 0 : 180 })
  }

  const sourceNode = connectMode ? document?.nodes.find(node => node.id === connectMode.sourceId) : undefined

  return (
    <div className={styles.workspace}>
      <header className={styles.bar}>
        {sidebarCollapsed
          ? (
              <IconButton label="展开会话列表" onClick={onToggleSidebar}>
                <PanelLeft />
              </IconButton>
            )
          : null}
        <div className={styles.heading}>
          <strong>Flow</strong>
          <span title={projectPath}>{shortenPath(projectPath)}</span>
        </div>
        {saving ? <span className={styles.saving}><span className="t-shimmer" data-text="保存中…">保存中…</span></span> : null}
        {(selection.nodes.length > 1 || selection.edges.length) && !connectMode
          ? <button className={styles.delete} onClick={deleteSelection}>移出画布</button>
          : null}
        {connectMode
          ? <button className={styles.cancel} onClick={() => setConnectMode(null)}>取消连接</button>
          : null}
        <button className={styles.add} disabled={!document} aria-expanded={panelOpen} onClick={() => setPanelOpen(open => !open)}>添加节点</button>
      </header>

      {attentionItems.length
        ? (
            <div className={`${styles.attention} ${attentionItems[0]!.reason === 'needs_input' ? styles.attentionNeedsInput : ''}`} role="status">
              <CircleAlert size={15} aria-hidden="true" />
              <span>
                <strong>
                  {attentionItems.length}
                  {' '}
                  个会话需要处理
                </strong>
                <span>
                  {attentionItems[0]!.reason === 'needs_input' ? '待回答' : '失败'}
                  {' · '}
                  {attentionItems[0]!.name}
                </span>
              </span>
              <button className={styles.attentionAction} type="button" onClick={reviewAttention}>
                查看
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          )
        : null}

      {panelOpen
        ? (
            <form className={styles.panel} onSubmit={event => void addNode(event)}>
              <label>
                名称
                <input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="认证模块" autoFocus />
              </label>
              <label>
                当前目标
                <textarea maxLength={500} rows={3} value={goal} onChange={event => setGoal(event.target.value)} placeholder="可选" />
              </label>
              <label>
                Brief
                <textarea maxLength={8000} rows={5} value={draftBrief} onChange={event => setDraftBrief(event.target.value)} placeholder="这个节点固定带上的说明，类似仓库里的 AGENTS.md。可以留空。" />
              </label>
              <label>
                会话
                <select value={sessionPath} onChange={event => setSessionPath(event.target.value)}>
                  <option value="">新建干净会话</option>
                  {availableSessions.map(session => <option key={session.path} value={session.path}>{sessionLabel(session)}</option>)}
                </select>
              </label>
              <div className={styles.panelActions}>
                <button type="button" onClick={() => setPanelOpen(false)}>取消</button>
                <button type="submit" className={styles.confirm} disabled={saving || !name.trim()}>添加</button>
              </div>
            </form>
          )
        : null}

      {briefOpen
        ? (
            <form className={styles.panel} onSubmit={saveBrief}>
              <label>
                Brief
                <textarea maxLength={8000} rows={8} value={brief} onChange={event => setBrief(event.target.value)} placeholder="这个节点固定带上的说明，类似仓库里的 AGENTS.md。可以留空。" autoFocus />
              </label>
              <div className={styles.panelActions}>
                <button type="button" onClick={() => setBriefOpen(false)}>取消</button>
                <button type="submit" className={styles.confirm} disabled={saving}>保存</button>
              </div>
            </form>
          )
        : null}

      {error ? <div className={styles.error}>{error}</div> : null}
      <button type="button" className={styles.conductorButton} disabled={!document} onClick={() => void showConductor()}>编排</button>
      {conductorOpen
        ? (
            <aside className={styles.conductor} aria-label="编排">
              <header className={styles.conductorBar}>
                <strong>编排</strong>
                <button type="button" onClick={() => setConductorOpen(false)}>关闭</button>
              </header>
              <div className={styles.conductorChat}>
                {conductorView
                  ? (
                      <ChatView
                        sessionKey={conductorView.key}
                        messageExtra={message => draftCard(message, draftMessage, conductorReady, saving, () => void acceptDraft())}
                      />
                    )
                  : <p className={styles.conductorEmpty}>正在打开编排…</p>}
              </div>
            </aside>
          )
        : null}
      <div className={styles.canvas}>
        {!document
          ? <div className={styles.loading}>正在读取项目 Flow…</div>
          : (
              <ReactFlow<FlowCanvasNode, Edge>
                nodes={visibleNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                defaultViewport={document.viewport}
                minZoom={0.2}
                maxZoom={2}
                zoomOnScroll={false}
                panOnScroll
                fitView={document.nodes.length > 0 && document.viewport.zoom === 1 && document.viewport.x === 0 && document.viewport.y === 0}
                onInit={setInstance}
                onNodesChange={onNodesChange}
                onNodeClick={onNodeClick}
                onNodeDragStop={onNodeDragStop}
                onNodeDoubleClick={(_event, node) => void node.data.onOpen()}
                onPaneClick={onPaneClick}
                onNodesDelete={onNodesDelete}
                onEdgesChange={onEdgesChange}
                onEdgesDelete={onEdgesDelete}
                onMove={onMove}
                onMoveEnd={onMoveEnd}
                onSelectionChange={onSelectionChange}
                deleteKeyCode={['Backspace', 'Delete']}
                colorMode="dark"
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#292929" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable nodeColor="var(--c-faint)" maskColor="rgb(0 0 0 / 72%)" />
              </ReactFlow>
            )}

        {selectedCanvasNode && !connectMode
          ? (
              <NodeToolbar
                node={selectedCanvasNode}
                viewport={viewport}
                onConnect={startConnect}
                onBrief={openBrief}
                onRemove={() => deleteSelection()}
              />
            )
          : null}

        {selectedCanvasNode && !connectMode
          ? (
              <NodeComposer
                node={selectedCanvasNode}
                viewport={viewport}
                view={selectedNodeView}
                text={composerText}
                focusVersion={composerFocusVersion}
                onTextChange={setComposerText}
              />
            )
          : null}

        {connectMode && sourceNode
          ? (
              <div className={styles.mode}>
                已选择“
                {sourceNode.name}
                ”，点击另一个会话建立关系，或按 Esc / 取消连接退出。
              </div>
            )
          : null}
      </div>
    </div>
  )
}

function NodeComposer({ node, viewport, view, text, focusVersion, onTextChange }: {
  node: FlowCanvasNode
  viewport: Viewport
  view: SessionView | null
  text: string
  focusVersion: number
  onTextChange: (text: string) => void
}) {
  const nodeWidth = node.measured?.width ?? NODE_WIDTH
  const nodeHeight = node.measured?.height ?? NODE_HEIGHT
  const composerWidth = 420
  const screenX = node.position.x * viewport.zoom + viewport.x
  const screenY = node.position.y * viewport.zoom + viewport.y
  const left = screenX + (nodeWidth * viewport.zoom) / 2 - composerWidth / 2
  const top = screenY + nodeHeight * viewport.zoom + 28
  return (
    <div
      className={styles.nodeComposer}
      style={{ left, top, width: composerWidth }}
      data-composer=""
    >
      {view
        ? (
            <InputBar
              view={view}
              text={text}
              focusVersion={focusVersion}
              onTextChange={onTextChange}
              draftKey={`flow-node:${node.id}`}
              hideMeta
              floating
            />
          )
        : <div className={styles.nodeComposerLoading}>正在打开节点会话…</div>}
    </div>
  )
}

function NodeToolbar({ node, viewport, onConnect, onBrief, onRemove }: {
  node: FlowCanvasNode
  viewport: Viewport
  onConnect: () => void
  onBrief: () => void
  onRemove: () => void
}) {
  const nodeWidth = node.measured?.width ?? NODE_WIDTH
  const screenX = node.position.x * viewport.zoom + viewport.x
  const screenY = node.position.y * viewport.zoom + viewport.y
  const left = screenX + (nodeWidth * viewport.zoom) / 2
  const top = screenY - 12
  return (
    <div
      className={styles.nodeToolbar}
      style={{ left, top }}
      role="toolbar"
      aria-label="节点操作"
    >
      <button type="button" className={styles.connect} onClick={onConnect}>连接</button>
      <button type="button" className={styles.connect} onClick={onBrief}>Brief</button>
      <button type="button" className={styles.delete} onClick={onRemove}>移出画布</button>
    </div>
  )
}

function toCanvasNode(node: FlowNode, onOpen: () => void): FlowCanvasNode {
  return {
    id: node.id,
    type: 'session',
    position: node.position,
    data: { sessionPath: node.sessionPath, name: node.name, goal: node.goal, brief: node.brief, status: 'idle', needsInput: false, onOpen },
  }
}

function toCanvasEdges(
  edges: FlowEdge[],
  activeEdges: Map<string, { source: string, target: string }>,
  selectedEdgeIds: Set<string>,
  reducedMotion: boolean,
): Edge[] {
  return edges.map((edge) => {
    const active = activeEdges.get(edge.id)
    const selected = selectedEdgeIds.has(edge.id)
    if (active) {
      return {
        id: edge.id,
        source: active.source,
        target: active.target,
        type: 'default',
        pathOptions: { curvature: 0.5 },
        animated: !reducedMotion,
        selected,
        markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: 'var(--c-signal)' },
        style: { stroke: 'var(--c-signal)', strokeWidth: 2 },
      }
    }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'default',
      pathOptions: { curvature: 0.5 },
      animated: false,
      selected,
      style: { stroke: 'var(--c-muted)', strokeWidth: 1.5 },
    }
  })
}

function topologyOf(document: FlowDocument): FlowTopology {
  return { nodes: document.nodes, edges: document.edges, viewport: document.viewport }
}

function sameViewport(a: Viewport, b: Viewport) {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom
}

function sameSelection(a: { nodes: string[], edges: string[] }, b: { nodes: string[], edges: string[] }) {
  return a.nodes.length === b.nodes.length
    && a.edges.length === b.edges.length
    && a.nodes.every((id, index) => id === b.nodes[index])
    && a.edges.every((id, index) => id === b.edges[index])
}

function sessionLabel(session: SessionInfoLite) {
  return session.name || session.firstMessage || '空会话'
}

function viewForSession(views: Record<string, SessionView>, path: string | undefined) {
  if (!path)
    return undefined
  return views[path] ?? Object.values(views).find(view => view.sessionFile === path)
}

function messageText(message: AgentMessage): string {
  if (message.role === 'user') {
    const content = message.content
    return typeof content === 'string' ? content : content.map(block => block.type === 'text' ? block.text : '').join('\n')
  }
  if (message.role === 'assistant')
    return message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
  return ''
}

function latestDraftMessage(view: { messages: AgentMessage[], live: AgentMessage | null } | undefined) {
  if (!view)
    return undefined
  const shown = view.live ? [...view.messages, view.live] : view.messages
  for (let index = shown.length - 1; index >= 0; index--) {
    const message = shown[index]
    if (message && parseConductorDraft(messageText(message)))
      return message
  }
  return undefined
}

function draftCard(message: AgentMessage, draftMessage: AgentMessage | undefined, ready: boolean, saving: boolean, onAccept: () => void) {
  if (message !== draftMessage)
    return null
  const draft = parseConductorDraft(messageText(message))
  if (!draft)
    return null
  return (
    <div className={styles.conductorDraft}>
      <div className={styles.conductorDraftBody}>
        {draft.modules.map(module => (
          <article key={module.id}>
            <h3>{module.name.trim() || '未命名'}</h3>
            <p>{module.brief.trim() || '还没有说明'}</p>
          </article>
        ))}
        {draft.links.length
          ? (
              <ul>
                {draft.links.map(link => (
                  <li key={`${link.source}-${link.target}`}>
                    {draftName(draft, link.source)}
                    {' → '}
                    {draftName(draft, link.target)}
                  </li>
                ))}
              </ul>
            )
          : <p className={styles.conductorEmpty}>没有连线</p>}
      </div>
      <div className={styles.panelActions}>
        <button type="button" className={styles.confirm} disabled={!ready || saving} onClick={onAccept}>接受</button>
      </div>
    </div>
  )
}

function draftName(draft: { modules: Array<{ id: string, name: string }> }, id: string): string {
  return draft.modules.find(module => module.id === id)?.name.trim() || id
}
