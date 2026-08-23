import type { FlowDocument, FlowEdge, FlowMessageRecord, FlowNode, FlowTopology, SessionInfoLite } from '@piflow/protocol'
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
import type { FlowCanvasNode } from '../FlowSessionNode'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadFlow, saveFlow } from '../../flow/api'
import { createBackgroundSession, openSession } from '../../session/actions'
import { useStore } from '../../session/use-store'
import FlowSessionNode from '../FlowSessionNode'
import ViewSwitch from '../ViewSwitch'
import styles from './styles.module.css'
import '@xyflow/react/dist/style.css'

const nodeTypes = { session: FlowSessionNode }

interface FlowViewProps {
  onShowChat: () => void
  onToggleSidebar: () => void
}

interface ConnectMode {
  sourceId: string
}

export default function FlowView({ onShowChat, onToggleSidebar }: FlowViewProps) {
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
  const [activeEdges, setActiveEdges] = useState(() => new Map<string, { source: string, target: string }>())
  const activeTimersRef = useRef(new Map<string, number>())
  const seenMessageIdsRef = useRef(new Set<string>())
  const [panelOpen, setPanelOpen] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [sessionPath, setSessionPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ nodes: string[], edges: string[] }>({ nodes: [], edges: [] })
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const focusSession = useCallback(async (path: string) => {
    try {
      await openSession(path)
      onShowChat()
    }
    catch (reason) {
      setError(String(reason))
    }
  }, [onShowChat])

  useEffect(() => {
    let cancelled = false
    void loadFlow(projectPath)
      .then(async (loaded) => {
        if (cancelled)
          return
        let resolved = loaded
        if (!loaded.nodes.length && seedSessionPath && seedSessionCwd === loaded.projectPath) {
          const now = new Date().toISOString()
          resolved = await saveFlow(loaded.projectPath, {
            ...topologyOf(loaded),
            nodes: [{
              id: crypto.randomUUID(),
              sessionPath: seedSessionPath,
              name: seedSessionName,
              goal: seedSessionGoal,
              position: { x: 80, y: 80 },
              createdAt: now,
              updatedAt: now,
            }],
          })
        }
        if (cancelled)
          return
        setDocument(resolved)
        setNodes(resolved.nodes.map(node => toCanvasNode(node, () => void focusSession(node.sessionPath))))
        if (instance)
          void instance.setViewport(resolved.viewport)
      })
      .catch((reason: unknown) => !cancelled && setError(String(reason)))
    return () => {
      cancelled = true
    }
  }, [focusSession, instance, projectPath, seedSessionCwd, seedSessionGoal, seedSessionName, seedSessionPath])

  // Press Escape to cancel peer-connect mode.
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

  // Keep a mutable reference to the latest document and mark the initial messages
  // as seen so the message-activity animation does not replay history on load.
  useEffect(() => {
    documentRef.current = document
    if (document && seenMessageIdsRef.current.size === 0)
      seenMessageIdsRef.current = new Set(document.messages.map(m => m.id))
  }, [document])

  // Poll for new inter-node messages while the canvas is visible.
  // Only the message list is inspected; topology is never overwritten from poll.
  useEffect(() => {
    if (!projectPath)
      return
    let cancelled = false
    let intervalId: number | null = null
    const timers = activeTimersRef.current

    function processIncoming(messages: FlowMessageRecord[]) {
      const currentDocument = documentRef.current
      if (!currentDocument)
        return
      const newMessages = messages.filter(message => !seenMessageIdsRef.current.has(message.id))
      if (newMessages.length === 0)
        return
      for (const message of newMessages) {
        seenMessageIdsRef.current.add(message.id)
        const edge = currentDocument.edges.find(e => e.id === message.edgeId)
        if (!edge)
          continue
        const previousTimer = activeTimersRef.current.get(message.edgeId)
        if (previousTimer)
          window.clearTimeout(previousTimer)
        const timer = window.setTimeout(() => {
          setActiveEdges((current) => {
            const next = new Map(current)
            next.delete(message.edgeId)
            return next
          })
          activeTimersRef.current.delete(message.edgeId)
        }, 3000)
        activeTimersRef.current.set(message.edgeId, timer)
        setActiveEdges((current) => {
          const next = new Map(current)
          next.set(message.edgeId, { source: message.source, target: message.target })
          return next
        })
      }
    }

    function tick() {
      void loadFlow(projectPath)
        .then((loaded) => {
          if (cancelled)
            return
          processIncoming(loaded.messages)
        })
        .catch(() => {
          // Polling failures are not surfaced; the next tick will retry.
        })
    }

    function start() {
      if (intervalId !== null || window.document.visibilityState === 'hidden')
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
      if (window.document.visibilityState === 'hidden')
        stop()
      else
        start()
    }

    start()
    window.document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      cancelled = true
      stop()
      window.document.removeEventListener('visibilitychange', handleVisibility)
      for (const timer of timers.values())
        window.clearTimeout(timer)
      timers.clear()
      seenMessageIdsRef.current.clear()
      setActiveEdges(new Map())
    }
  }, [projectPath])

  // Re-render edges when topology, active message events, selection, or motion preference change.
  useEffect(() => {
    if (!document)
      return
    // Edges are derived from document topology, active messages, selection, and motion preference.
    // eslint-disable-next-line react/set-state-in-effect
    setEdges(toCanvasEdges(document.edges, activeEdges, new Set(selection.edges), reducedMotion))
  }, [document, activeEdges, selection.edges, reducedMotion])

  async function persist(next: FlowDocument) {
    setDocument(next)
    setNodes(next.nodes.map(node => toCanvasNode(node, () => void focusSession(node.sessionPath))))
    setSaving(true)
    setError(null)
    try {
      const saved = await saveFlow(next.projectPath, topologyOf(next))
      setDocument(saved)
      setNodes(saved.nodes.map(node => toCanvasNode(node, () => void focusSession(node.sessionPath))))
    }
    catch (reason) {
      setError(String(reason))
    }
    finally {
      setSaving(false)
    }
  }

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
    void persist({ ...document, edges: [...document.edges, edge] })
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
    if (!document)
      return
    const now = new Date().toISOString()
    void persist({
      ...document,
      nodes: document.nodes.map(item => item.id === node.id ? { ...item, position: node.position, updatedAt: now } : item),
    })
  }

  const onNodesDelete: OnNodesDelete<FlowCanvasNode> = (deleted) => {
    if (!document)
      return
    const ids = new Set(deleted.map(node => node.id))
    void persist({
      ...document,
      nodes: document.nodes.filter(node => !ids.has(node.id)),
      edges: document.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
    })
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
    void persist({ ...document, edges: document.edges.filter(edge => !ids.has(edge.id)) })
  }

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: FlowCanvasNode[], edges: Edge[] }) => {
    const next = { nodes: selectedNodes.map(node => node.id), edges: selectedEdges.map(edge => edge.id) }
    setSelection(current => sameSelection(current, next) ? current : next)
    if (connectMode && !selectedNodes.some(node => node.id === connectMode.sourceId))
      setConnectMode(null)
  }, [connectMode])

  function onMoveEnd(_event: MouseEvent | TouchEvent | null, viewport: Viewport) {
    if (!document || sameViewport(document.viewport, viewport))
      return
    void persist({ ...document, viewport })
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
      const point = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 120, y: 120 }
      const now = new Date().toISOString()
      const next: FlowDocument = {
        ...document,
        nodes: [...document.nodes, {
          id: crypto.randomUUID(),
          sessionPath: path,
          name: name.trim(),
          goal: goal.trim(),
          position: point,
          createdAt: now,
          updatedAt: now,
        }],
      }
      await persist(next)
      setName('')
      setGoal('')
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
    })
    setSelection({ nodes: [], edges: [] })
  }

  const startConnect = useCallback(() => {
    if (selection.nodes.length === 1)
      setConnectMode({ sourceId: selection.nodes[0]! })
  }, [selection])

  const availableSessions = store.sessions.filter(session => session.cwd === document?.projectPath && !document.nodes.some(node => node.sessionPath === session.path))
  const visibleNodes = useMemo(() => nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      status: statusFor(node.data.sessionPath, store),
      isAnchor: connectMode?.sourceId === node.id,
    },
  })), [nodes, connectMode, store])

  const sourceNode = connectMode ? document?.nodes.find(node => node.id === connectMode.sourceId) : undefined

  return (
    <div className={styles.workspace}>
      <header className={styles.bar}>
        <button className={styles.menu} title="会话列表" aria-label="会话列表" onClick={onToggleSidebar}>☰</button>
        <div className={styles.heading}>
          <strong>Flow</strong>
          <span title={projectPath}>{shorten(projectPath)}</span>
        </div>
        {saving ? <span className={styles.saving}>保存中…</span> : null}
        {selection.nodes.length || selection.edges.length ? <button className={styles.delete} onClick={deleteSelection}>移出画布</button> : null}
        {selection.nodes.length === 1 && !connectMode
          ? <button className={styles.connect} onClick={startConnect}>连接</button>
          : null}
        {connectMode
          ? <button className={styles.cancel} onClick={() => setConnectMode(null)}>取消连接</button>
          : null}
        <button className={styles.add} disabled={!document} onClick={() => setPanelOpen(open => !open)}>+ 节点</button>
        <ViewSwitch active="flow" onChange={view => view === 'chat' && onShowChat()} />
      </header>

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

      {error ? <div className={styles.error}>{error}</div> : null}
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
  )
}

function toCanvasNode(node: FlowNode, onOpen: () => void): FlowCanvasNode {
  return {
    id: node.id,
    type: 'session',
    position: node.position,
    data: { sessionPath: node.sessionPath, name: node.name, goal: node.goal, status: 'idle', onOpen },
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
        type: 'smoothstep',
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
      type: 'smoothstep',
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

function statusFor(sessionPath: string, store: ReturnType<typeof useStore>): 'idle' | 'running' | 'failed' {
  return store.statuses[sessionPath]?.status ?? 'idle'
}

function sessionLabel(session: SessionInfoLite) {
  return session.name || session.firstMessage || '空会话'
}

function shorten(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}
