import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { EvidenceTarget, FlowActivityKind, FlowDeliveryStatus, FlowDocument, FlowEdge, FlowNode, FlowTopology, RunSummary, SessionStatusRecord } from '@piflow/protocol'
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
import type { RunFilter } from '../runs/store'
import type { FlowCanvasNode } from './components/FlowSessionNode'
import type { FlowEdgeActivity } from './edges'
import type { NewNodeDraft, NodeConfigurationDraft } from './node-forms'
import type { FlowRouteNode } from './routes'
import { conductorDraftReady, parseConductorDraft, RUN_STATUS_LABELS } from '@piflow/protocol'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import { ArrowLeft, ArrowRight, ChevronRight, ExternalLink, FileText, Link2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button'
import Dialog from '../../components/Dialog'
import IconButton from '../../components/IconButton'
import NewSessionDialog from '../../components/NewSessionDialog'
import { configuredModel, providerBrand } from '../../components/ProviderLogo/brand'
import Select from '../../components/Select'
import SidebarToggle from '../../components/SidebarToggle'
import Textarea from '../../components/Textarea'
import { openBackgroundSession, openSession, requestModels, requestProjectTrust, sendFlowConductorPrompt, sendFlowNodePrompt, sendPrompt } from '../../session/actions'
import { sessionNeedsInputFor, sessionStatusFor } from '../../session/attention'
import { clearSessionUnread } from '../../session/reducer'
import { useStore } from '../../session/use-store'
import ChatView from '../chat'
import RunPanel from '../runs'
import { getRunsConnection, runProject, runWindow, subscribeRunEvents } from '../runs/store'
import { runOrder } from '../runs/time'
import { useRunProject } from '../runs/use-runs'
import { acceptConductor, loadFlow, saveFlow } from './api'
import { flowAttentionItems } from './attention'
import FlowAgentForm from './components/FlowAgentForm'
import FlowAttention from './components/FlowAttention'
import FlowCanvasTools from './components/FlowCanvasTools'
import FlowMessageEdge from './components/FlowMessageEdge'
import FlowNodeForm from './components/FlowNodeForm'
import FlowNodeSummary from './components/FlowNodeSummary'
import FlowSessionNode from './components/FlowSessionNode'
import { aggregateActivities, changedDeliveryActivities, changedRunActivities, sameDeliveryState, subagentCallEdges } from './edges'
import FlowReview from './evidence'
import { NODE_HEIGHT, NODE_WIDTH, nodeGeometry } from './geometry'
import { arrangeNodes, layoutFingerprint } from './layout'
import { projectMembers } from './members'
import { addDraftNode, configureNode } from './node-forms'
import { routeGraphEdges } from './routes'
import styles from './styles.module.css'
import { useFlowActivity } from './use-activity'
import { focusViewport, revealViewport } from './viewport'
import { readFlowView, saveFlowView } from './workspace'
import '@xyflow/react/dist/style.css'

const nodeTypes = { session: FlowSessionNode }
const edgeTypes = { message: FlowMessageEdge }

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
  projectPath: string
  onProjectChange: (path: string) => void
  focusRequest: { id: string, request: number } | null
  onSelectedNodeChange: (id: string | null) => void
  active?: boolean
  onShowChat: () => void
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
}

interface ConnectMode {
  sourceId: string
}

export default function FlowView({ projectPath, onProjectChange, focusRequest, onSelectedNodeChange, active = true, onShowChat, onToggleSidebar, sidebarCollapsed }: FlowViewProps) {
  const store = useStore()
  const runState = useRunProject(projectPath, true)
  const runs = useMemo(() => Object.values(runState.runs).sort(runOrder), [runState.runs])
  const [runPanel, setRunPanel] = useState<(RunFilter & { initialRunId?: string, target?: EvidenceTarget }) | null>(null)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [document, setDocument] = useState<FlowDocument | null>(null)
  const documentRef = useRef<FlowDocument | null>(null)
  const [nodes, setNodes] = useState<FlowCanvasNode[]>([])
  const [measurements, setMeasurements] = useState<Record<string, { width: number, height: number }>>({})
  const [edges, setEdges] = useState<Edge[]>([])
  const [viewState, setViewState] = useState(() => readFlowView(projectPath))
  const [roleChooserId, setRoleChooserId] = useState<string | null>(null)
  const viewStateRef = useRef(viewState)
  viewStateRef.current = viewState
  const team = document?.nodes.find(node => node.id === viewState.teamId && node.kind !== 'subagent-role' && node.orchestrationEnabled)
  const teamId = team?.id ?? null
  const [activityKind, setActivityKind] = useState<FlowActivityKind>()
  const attention = useFlowActivity(document?.projectPath ?? projectPath, teamId ?? undefined, activityKind, active && Boolean(document))
  const activityCounts = teamId && attention.page ? attention.page.groups.find(group => group.orchestratorId === teamId)?.counts ?? { running: 0, latestFailures: 0, cancelled: 0, pendingReviews: 0, unreadTargets: 0, changesRequested: 0, inProgressReviews: 0, unavailableReviews: 0, uncoveredChanges: 0 } : attention.page?.totals
  const overviewViewportRef = useRef<Viewport | null>(null)
  const pendingRoleRef = useRef<string | null>(null)
  const [instance, setInstance] = useState<ReactFlowInstance<FlowCanvasNode, Edge> | null>(null)
  const [minimap, setMinimap] = useState(() => {
    try {
      return localStorage.getItem('piflow.flow-minimap') === 'true'
    }
    catch { return false }
  })
  const [layoutUndo, setLayoutUndo] = useState<{ fingerprint: string, positions: Map<string, { x: number, y: number }> } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const focusTargetRef = useRef<string[]>([])
  const focusPendingRef = useRef(false)
  const [summaryDisplayId, setSummaryDisplayId] = useState<string | null>(null)
  function openEvidence(target: EvidenceTarget) {
    setRunPanel({ target })
    setSummaryDisplayId(null)
  }
  const [detailOpen, setDetailOpen] = useState(false)
  const [hoveredDisplayId, setHoveredDisplayId] = useState<string | null>(null)
  const activeDisplayRef = useRef<string | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const [connectMode, setConnectMode] = useState<ConnectMode | null>(null)
  const [activities, setActivities] = useState<FlowEdgeActivity[]>([])
  const previousMessagesRef = useRef<FlowDocument['messages'] | null>(null)
  const saveRevRef = useRef(0)
  const pendingSaveRef = useRef<FlowDocument | null>(null)
  const graphChangedRef = useRef(false)
  const commitGraphRef = useRef(false)
  const saveRunningRef = useRef(false)
  const acceptingRef = useRef(false)
  const seenConductorRef = useRef(0)
  const openingRef = useRef(new Set<string>())
  const persistRef = useRef<(next: FlowDocument, commitGraph?: boolean) => Promise<boolean>>(async () => false)
  const [conductorOpen, setConductorOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [configurationId, setConfigurationId] = useState<string | null>(null)
  const [runOwnerFilter, setRunOwnerFilter] = useState('')
  const [delegationRole, setDelegationRole] = useState('')
  const [delegationTask, setDelegationTask] = useState('')
  const [delegating, setDelegating] = useState(false)
  const [delegationOpen, setDelegationOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ nodes: string[], edges: string[] }>({ nodes: [], edges: [] })
  const focusedRequestRef = useRef(0)
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pollRef = useRef({ start() {}, stop() {} })
  const focusSession = useCallback(async (id: string) => {
    if (openingRef.current.has(id))
      return
    openingRef.current.add(id)
    setError(null)
    try {
      const path = documentRef.current?.nodes.find(node => node.id === id)?.sessionPath || null
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
  }, [onShowChat])

  if (store.conductorNonce !== seenConductorRef.current) {
    seenConductorRef.current = store.conductorNonce
    if (store.conductorNonce > 0) {
      setConductorOpen(true)
      setDetailOpen(false)
      setSummaryDisplayId(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    const rev = saveRevRef.current
    void loadFlow(projectPath)
      .then(async (loaded) => {
        if (cancelled || rev !== saveRevRef.current)
          return
        const resolved = loaded.document
        if (cancelled || rev !== saveRevRef.current)
          return
        setDocument(resolved)
        setNodes(current => reconcileCanvasNodes(current, resolved.nodes, focusSession))
      })
      .catch((reason: unknown) => !cancelled && setError(String(reason)))
    return () => {
      cancelled = true
    }
  }, [focusSession, projectPath])

  useEffect(() => {
    if (document && viewState.teamId && !team) {
      const next = { ...viewState, teamId: null }
      // eslint-disable-next-line react/set-state-in-effect -- a removed group invalidates the local view.
      setViewState(next)
      saveFlowView(projectPath, next)
      // eslint-disable-next-line react/set-state-in-effect -- close the removed group inspector.
      setSummaryDisplayId(null)
      // eslint-disable-next-line react/set-state-in-effect -- close the removed group inspector.
      setDetailOpen(false)
    }
  }, [document, team, viewState, projectPath])

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

  const pushActivities = useCallback((incoming: FlowEdgeActivity[]) => {
    if (incoming.length)
      setActivities(current => aggregateActivities(current, incoming, Date.now()))
  }, [])
  const activeRef = useRef(active)
  activeRef.current = active

  // Poll for new inter-node messages while the canvas is visible.
  // Only the message list is inspected; topology is never overwritten from poll.
  useEffect(() => {
    if (!projectPath)
      return
    let cancelled = false
    let intervalId: number | null = null
    let epoch = 0
    let baseline = true

    function tick() {
      const currentEpoch = epoch
      void loadFlow(projectPath)
        .then((loaded) => {
          if (cancelled || currentEpoch !== epoch)
            return
          const messages = loaded.document.messages
          if (!baseline && previousMessagesRef.current)
            pushActivities(changedDeliveryActivities(previousMessagesRef.current, messages))
          baseline = false
          previousMessagesRef.current = messages
          setDocument((current) => {
            if (!current || current.projectPath !== loaded.document.projectPath)
              return current
            if (sameDeliveryState(current.messages, loaded.document.messages))
              return current
            return { ...current, messages: loaded.document.messages }
          })
        })
        .catch(() => {
          baseline = true
          // Polling failures are not surfaced; the next tick will retry.
        })
    }

    function start() {
      if (intervalId !== null || !activeRef.current || window.document.visibilityState === 'hidden')
        return
      baseline = true
      epoch++
      tick()
      intervalId = window.setInterval(tick, 3000)
    }

    function stop() {
      epoch++
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
  }, [projectPath, pushActivities])

  useEffect(() => {
    if (active) {
      pollRef.current.stop()
      pollRef.current.start()
    }
    else {
      pollRef.current.stop()
    }
  }, [active, attention.connectionVersion])

  useEffect(() => subscribeRunEvents((message, previous) => {
    const window = runWindow(projectPath)
    if (message.type !== 'run_updated' || message.projectPath !== runProject(projectPath).projectPath
      || !activeRef.current || window.loading || !window.initialized || !getRunsConnection().connected
      || globalThis.document.visibilityState === 'hidden') {
      return
    }
    pushActivities(changedRunActivities(previous ? [previous] : [], [message.run]))
  }), [projectPath, pushActivities])

  useEffect(() => {
    if (!activities.length)
      return
    const timer = window.setInterval(() => setActivities(current => aggregateActivities(current, [], Date.now())), 200)
    return () => window.clearInterval(timer)
  }, [activities.length])

  useEffect(() => {
    function clear() {
      setActivities([])
    }
    const frame = requestAnimationFrame(clear)
    function visibility() {
      if (globalThis.document.visibilityState === 'hidden')
        clear()
    }
    globalThis.document.addEventListener('visibilitychange', visibility)
    return () => {
      cancelAnimationFrame(frame)
      globalThis.document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, attention.connectionVersion])

  const focusCanvas = useCallback((ids: string[], minZoom = 0.85, maxZoom = 1.1) => {
    focusTargetRef.current = ids
    focusPendingRef.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const targets = instance?.getNodes().filter(node => ids.includes(node.id)) ?? []
      if (focusTargetRef.current !== ids)
        return
      if (!canvas || !instance || !targets.length || !canvas.clientWidth || !canvas.clientHeight) {
        focusPendingRef.current = false
        return
      }
      const bounds = instance.getNodesBounds(targets)
      void instance.setViewport(focusViewport(bounds, canvas.getBoundingClientRect(), minZoom, maxZoom), { duration: reducedMotion ? 0 : 180 }).finally(() => {
        if (focusTargetRef.current === ids)
          focusPendingRef.current = false
      })
    }))
  }, [instance, reducedMotion])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !instance)
      return
    const observer = new ResizeObserver(() => {
      if (focusPendingRef.current || !canvas.clientWidth || !canvas.clientHeight)
        return
      const targets = instance.getNodes().filter(node => focusTargetRef.current.includes(node.id))
      if (targets.length) {
        const next = revealViewport(instance.getNodesBounds(targets), canvas.getBoundingClientRect(), instance.getViewport())
        void instance.setViewport(next)
      }
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [instance])

  const navigateTeam = useCallback((id: string | null) => {
    const current = { ...viewStateRef.current, groups: { ...viewStateRef.current.groups } }
    if (instance) {
      if (teamId) {
        current.groups[teamId] = { positions: Object.fromEntries(instance.getNodes().map(node => [node.id, node.position])), viewport: instance.getViewport() }
      }
      else {
        overviewViewportRef.current = instance.getViewport()
      }
    }
    const next = { ...current, teamId: id }
    if (id && !next.groups[id])
      next.groups[id] = { positions: Object.fromEntries(projectMembers(nodes, documentRef.current?.memberships ?? [], id).nodes.map(node => [node.id, node.position])) }
    setViewState(next)
    saveFlowView(projectPath, next)
    setInstance(null)
    setConnectMode(null)
    setSummaryDisplayId(null)
    setDetailOpen(false)
    setConductorOpen(false)
    setHoveredDisplayId(null)
    setLayoutUndo(null)
    focusTargetRef.current = []
    setSelection({ nodes: id ? [id] : teamId ? [teamId] : [], edges: [] })
    setNodes(current => current.map(node => ({ ...node, selected: node.id === (id ?? teamId) })))
    activeDisplayRef.current = id ?? teamId
    if (!id)
      requestAnimationFrame(() => requestAnimationFrame(restoreNodeFocus))
  }, [instance, teamId, projectPath, nodes])

  const displayRuns = useMemo(() => runs.filter(run => run.status === 'running' || activities.some(item => item.messageId === run.id) || (run.orchestratorId === teamId && selection.nodes.some(id => id === run.roleId || id === `analysis:${JSON.stringify([teamId, run.roleId])}`))), [runs, activities, teamId, selection.nodes])
  const projection = useMemo(() => projectMembers(nodes, document?.memberships ?? [], teamId, teamId ? viewState.groups[teamId]?.positions : undefined, displayRuns), [nodes, document?.memberships, teamId, viewState.groups, displayRuns])
  const projectedNodes = useMemo(() => projection.nodes.map(node => ({ ...node, measured: measurements[node.id] ?? node.measured })), [projection, measurements])
  const authoredEdges = useMemo(() => {
    const ids = new Set(projection.nodes.map(node => node.id))
    return teamId ? projection.edges : (document?.edges ?? []).filter(edge => ids.has(edge.source) && ids.has(edge.target))
  }, [projection, teamId, document?.edges])

  useEffect(() => {
    const focusId = focusRequest?.id
    if (!focusId || !instance || focusRequest?.request === focusedRequestRef.current)
      return
    const frame = requestAnimationFrame(() => {
      const node = nodes.find(item => item.id === focusId)
      if (!node)
        return
      if (node.data.kind === 'subagent-role' && !projectedNodes.some(item => item.id === node.id)) {
        const owners = (document?.memberships ?? []).filter(item => item.memberId === node.id)
        if (owners.length === 1) {
          navigateTeam(owners[0]!.orchestratorId)
          return
        }
        focusedRequestRef.current = focusRequest!.request
        if (owners.length)
          setRoleChooserId(node.id)
        else
          setConfigurationId(node.id)
        return
      }
      if (node.data.kind !== 'subagent-role' && teamId && node.id !== teamId) {
        navigateTeam(null)
        return
      }
      focusedRequestRef.current = focusRequest!.request

      setNodes(current => current.map(item => ({ ...item, selected: item.id === node.id })))

      setSelection({ nodes: [node.id], edges: [] })

      setDetailOpen(true)

      setSummaryDisplayId(null)

      setConductorOpen(false)

      setRunOwnerFilter(node.data.kind === 'subagent-role' ? teamId ?? '' : '')
      activeDisplayRef.current = node.id
      focusCanvas([node.id])
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, instance, nodes, focusCanvas, projectedNodes, document?.memberships, teamId, navigateTeam])

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
      setNodes(current => reconcileCanvasNodes(current, next.nodes, focusSession))
    if (saveRunningRef.current)
      return false
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
          if (replaceNodes)
            graphChangedRef.current = true
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
          setNodes(current => reconcileCanvasNodes(current, saved.nodes, focusSession))
      }
    }
    catch (reason) {
      setError(`保存失败，当前画布尚未保存：${String(reason)}`)
      return false
    }
    finally {
      saveRunningRef.current = false
      setSaving(false)
      if (pendingSaveRef.current && !acceptingRef.current)
        void persist(pendingSaveRef.current)
    }
    return true
  }
  persistRef.current = persist

  function connectNodes(sourceId: string, targetId: string) {
    if (document?.nodes.some(node => node.kind === 'subagent-role' && (node.id === sourceId || node.id === targetId))) {
      setError('通信边只能连接长期 Agent；角色通过 subagent 调用')
      return
    }
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
    const sizes = changes.flatMap(change => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : [])
    if (sizes.length)
      setMeasurements(current => sizes.every(([id, size]) => current[id]?.width === size.width && current[id]?.height === size.height) ? current : { ...current, ...Object.fromEntries(sizes) })
    if (teamId) {
      const positions = changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position] as const] : [])
      if (positions.length)
        setViewState(current => ({ ...current, groups: { ...current.groups, [teamId]: { ...current.groups[teamId], positions: { ...current.groups[teamId]?.positions, ...Object.fromEntries(positions) } } } }))
    }
    setNodes(current => applyNodeChanges(teamId ? changes.filter(change => change.type !== 'position') : changes, current))
  }

  function inspectNode(node: FlowCanvasNode) {
    const id = node.id
    activeDisplayRef.current = node.id
    focusTargetRef.current = [id]
    setDetailOpen(false)
    setConductorOpen(false)
    setRunOwnerFilter(node.data.kind === 'subagent-role' ? teamId ?? '' : '')
    setNodes(current => current.map(item => ({ ...item, selected: item.id === id })))
    setSelection({ nodes: [id], edges: [] })
    setSummaryDisplayId(current => current === node.id ? null : node.id)
  }

  function activateNode(node: FlowCanvasNode, additive = false) {
    const id = node.id
    if (connectMode) {
      connectNodes(connectMode.sourceId, id)
      return
    }
    if (additive) {
      setSummaryDisplayId(null)
      setDetailOpen(false)
      setNodes(current => current.map(item => item.id === id ? { ...item, selected: !item.selected } : item))
      return
    }
    if (!teamId && node.data.orchestrationEnabled)
      navigateTeam(id)
    else
      inspectNode(node)
  }

  const onNodeClick: NodeMouseHandler<FlowCanvasNode> = (event, node) => {
    if (connectMode) {
      activateNode(node)
    }
    else if (event.metaKey || event.ctrlKey) {
      setSummaryDisplayId(null)
      setDetailOpen(false)
    }
    else if (!event.shiftKey) {
      activateNode(node)
    }
  }

  function restoreNodeFocus() {
    const id = activeDisplayRef.current
    requestAnimationFrame(() => {
      const button = [...(canvasRef.current?.querySelectorAll<HTMLElement>('[data-flow-node]') ?? [])].find(item => item.dataset.flowNode === id)
      const fallback = canvasRef.current?.closest('[data-flow-workspace]')?.querySelector<HTMLElement>('[data-flow-heading]')
      ;(button ?? fallback)?.focus({ preventScroll: true })
    })
  }

  function closeEvidence() {
    setRunPanel(null)
    restoreNodeFocus()
  }

  function closeSummary() {
    setSummaryDisplayId(null)
    restoreNodeFocus()
  }

  function openRuntimePanel() {
    setSummaryDisplayId(null)
    setDetailOpen(true)
    setConductorOpen(false)
    focusCanvas([activeDisplayRef.current ?? selection.nodes[0]!])
  }

  function onPaneClick() {
    setConnectMode(null)
    setSummaryDisplayId(null)
  }

  function closeRuntimePanel() {
    focusTargetRef.current = []
    focusPendingRef.current = false
    setDetailOpen(false)
    setSummaryDisplayId(null)
    restoreNodeFocus()
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, node: FlowCanvasNode, draggedNodes: FlowCanvasNode[]) {
    const current = documentRef.current
    if (!current)
      return
    if (teamId) {
      const next = { ...viewStateRef.current, groups: { ...viewStateRef.current.groups, [teamId]: { ...viewStateRef.current.groups[teamId], positions: Object.fromEntries((instance?.getNodes() ?? [node]).map(item => [item.id, item.position])) } } }
      setViewState(next)
      saveFlowView(projectPath, next)
      return
    }
    const now = new Date().toISOString()
    const positions = new Map((draggedNodes.length ? draggedNodes : [node]).map(item => [item.id, item.position]))
    void persist({
      ...current,
      nodes: current.nodes.map(item => positions.has(item.id) ? { ...item, position: positions.get(item.id)!, updatedAt: now } : item),
    }, true)
  }

  const onNodesDelete: OnNodesDelete<FlowCanvasNode> = (deleted) => {
    if (!document || teamId)
      return
    const ids = new Set(deleted.map(node => node.id))
    void persist({
      ...document,
      nodes: document.nodes.filter(node => !ids.has(node.id)),
      memberships: (document.memberships ?? []).filter(item => !ids.has(item.orchestratorId) && !ids.has(item.memberId)),
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
    const next = { nodes: [...new Set(selectedNodes.map(node => node.id))], edges: selectedEdges.map(edge => edge.id) }
    setSelection(current => sameSelection(current, next) ? current : next)
    onSelectedNodeChange(next.nodes.length === 1 ? next.nodes[0]! : null)
    if (next.nodes.length !== 1)
      setConfigurationId(null)
    if (connectMode && !selectedNodes.some(node => node.id === connectMode.sourceId))
      setConnectMode(null)
    const selectedPath = selectedNodes[0]?.data.sessionPath
    if (selectedPath && next.nodes.length === 1)
      clearSessionUnread(selectedPath)
  }, [connectMode, onSelectedNodeChange])

  function onMoveEnd(_event: MouseEvent | TouchEvent | null, viewport: Viewport) {
    if (teamId) {
      setViewState((current) => {
        const next = { ...current, groups: { ...current.groups, [teamId]: { positions: Object.fromEntries(projectedNodes.map(node => [node.id, node.position])), viewport } } }
        saveFlowView(projectPath, next)
        return next
      })
      return
    }
    overviewViewportRef.current = viewport
    const current = documentRef.current
    if (acceptingRef.current || !current || sameViewport(current.viewport, viewport))
      return
    void persist({ ...current, viewport })
  }

  async function showConductor() {
    setConductorOpen(true)
    setSummaryDisplayId(null)
    setDetailOpen(false)
    const path = documentRef.current?.conductorPath
    if (!path)
      return
    try {
      await openBackgroundSession(path)
      await Promise.all([requestModels(path), requestProjectTrust(projectPath)])
    }
    catch (reason) {
      setError(String(reason))
    }
  }

  async function sendFirstNodeMessage(nodeId: string, text: string) {
    const state = await sendFlowNodePrompt(projectPath, nodeId, text)
    if (!state.sessionFile)
      throw new Error('Flow 节点会话尚未绑定')
    const current = documentRef.current
    if (!current)
      return
    const next = { ...current, nodes: current.nodes.map(node => node.id === nodeId ? { ...node, sessionPath: state.sessionFile! } : node) }
    documentRef.current = next
    setDocument(next)
    setNodes(nodes => reconcileCanvasNodes(nodes, next.nodes, focusSession))
  }

  async function sendFirstConductorMessage(text: string) {
    const state = await sendFlowConductorPrompt(projectPath, text)
    if (!state.sessionFile)
      throw new Error('Flow Conductor 会话尚未绑定')
    const current = documentRef.current
    if (!current)
      return
    const next = { ...current, conductorPath: state.sessionFile }
    documentRef.current = next
    setDocument(next)
    await requestModels(state.key)
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
      setNodes(current => reconcileCanvasNodes(current, saved.nodes, focusSession))
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
    if (!id || !documentRef.current?.nodes.some(node => node.id === id))
      return
    setConfigurationId(id)
    setPanelOpen(false)
  }

  function editableDocument() {
    const current = documentRef.current
    if (!current || current.projectPath !== projectPath)
      throw new Error('项目已切换，请重新打开表单')
    if (saveRunningRef.current || acceptingRef.current)
      throw new Error('画布正在保存，请稍后重试')
    return current
  }

  async function saveConfiguration(id: string, draft: NodeConfigurationDraft) {
    const next = configureNode(editableDocument(), id, draft)
    if (!await persist(next, true))
      throw new Error('保存失败，请重试；草稿已保留。')
  }

  async function addNode(draft: NewNodeDraft) {
    const latest = editableDocument()
    const center = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 120, y: 120 }
    const point = findFreeNodePosition(latest.nodes, center)
    if (!await persist(addDraftNode(latest, { ...draft, sessionPath: '' }, '', point), true))
      throw new Error('保存失败，请重试；草稿已保留。')
  }

  async function arrangeLayout() {
    const current = editableDocument()
    if (teamId) {
      const positions = arrangeNodes(projectedNodes, projection.edges)
      const next = { ...viewState, groups: { ...viewState.groups, [teamId]: { positions: Object.fromEntries(positions) } } }
      setViewState(next)
      saveFlowView(projectPath, next)
      focusCanvas(projectedNodes.map(node => node.id), 0.2, 1)
      return
    }
    const positions = arrangeNodes(current.nodes.filter(node => node.kind !== 'subagent-role').map(node => ({ ...node, measured: nodes.find(item => item.id === node.id)?.measured })), [
      ...current.edges,

    ])
    const next = { ...current, nodes: current.nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node) }
    setLayoutUndo({ fingerprint: layoutFingerprint(next), positions: new Map(current.nodes.map(node => [node.id, { ...node.position }])) })
    if (await persist(next, true))
      focusCanvas(next.nodes.filter(node => node.kind !== 'subagent-role').map(node => node.id), 0.2, 1)
  }

  async function undoLayout() {
    const current = editableDocument()
    if (!layoutUndo || layoutUndo.fingerprint !== layoutFingerprint(current))
      return
    const next = { ...current, nodes: current.nodes.map(node => ({ ...node, position: layoutUndo.positions.get(node.id) ?? node.position })) }
    if (await persist(next, true)) {
      setLayoutUndo(null)
      focusCanvas(next.nodes.filter(node => node.kind !== 'subagent-role').map(node => node.id), 0.2, 1)
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
      memberships: (document.memberships ?? []).filter(item => !nodeIds.has(item.orchestratorId) && !nodeIds.has(item.memberId)),
      edges: document.edges.filter(edge => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
    }, true)
    setSelection({ nodes: [], edges: [] })
  }

  const startConnect = useCallback(() => {
    if (documentRef.current?.nodes.find(node => node.id === selection.nodes[0])?.kind === 'subagent-role')
      return
    if (selection.nodes.length === 1)
      setConnectMode({ sourceId: selection.nodes[0]! })
  }, [selection])

  const configurationNode = document?.nodes.find(node => node.id === configurationId)
  const selectedNodeId = selection.nodes.length === 1 ? selection.nodes[0] : undefined
  const selectedNode = selectedNodeId ? document?.nodes.find(node => node.id === selectedNodeId) : undefined
  const selectedData = projectedNodes.find(node => node.id === selectedNodeId)?.data
  const selectedRuns = runs.filter(run => selectedData?.kind === 'subagent-role'
    ? run.roleId === (selectedData.agentId ?? selectedNodeId) && (run.purpose ?? 'task') === (selectedData.runPurpose ?? 'task') && (!runOwnerFilter || run.orchestratorId === runOwnerFilter)
    : run.orchestratorId === selectedNodeId)
  const rolePanelState = selectedRuns.some(run => run.status === 'running') ? 'running' : selectedRuns[0]?.status
  const rolePanelKind = rolePanelState === 'running' ? 'Running' : rolePanelState === 'failed' || rolePanelState === 'interrupted' ? 'Failed' : 'Idle'
  useLayoutEffect(() => {
    if (detailOpen)
      detailRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [detailOpen, selectedNodeId])
  const selectedNodeView = selectedNode ? (viewForSession(store.views, selectedNode.sessionPath) ?? null) : null
  const neighborhoodId = projectedNodes.find(node => node.id === hoveredDisplayId)?.data.agentId
    ?? (hoveredDisplayId && projectedNodes.some(node => node.id === hoveredDisplayId) ? hoveredDisplayId : selectedNodeId)
  const selectedNeighbors = neighborhoodId
    ? new Set([
        ...(document?.edges.flatMap(edge => edge.source === neighborhoodId ? [edge.target] : edge.target === neighborhoodId ? [edge.source] : []) ?? []),
        ...(document?.memberships?.flatMap(item => item.orchestratorId === neighborhoodId ? [item.memberId] : item.memberId === neighborhoodId ? [item.orchestratorId] : []) ?? []),
        ...runs.filter(run => run.status === 'running').flatMap(run => run.orchestratorId === neighborhoodId ? [run.roleId] : run.roleId === neighborhoodId ? [run.orchestratorId] : []),
      ])
    : null
  const recentMessages = selectedNodeId
    ? (document?.messages.filter(message => message.source === selectedNodeId || message.target === selectedNodeId).slice(-5).reverse() ?? [])
    : []

  // Lightweight inspection uses existing facts only. Load the composer on explicit detail access.
  useEffect(() => {
    if (!selectedNodeId || !detailOpen || conductorOpen)
      return
    const id = selectedNodeId
    let cancelled = false
    async function run() {
      try {
        const path = documentRef.current?.nodes.find(node => node.id === id)?.sessionPath || null
        if (!path || cancelled)
          return
        const opened = await openBackgroundSession(path)
        if (!cancelled)
          await requestModels(opened.key)
      }
      catch (reason) {
        if (!cancelled)
          setError(String(reason))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedNodeId, detailOpen, conductorOpen])

  const conductorPath = document?.conductorPath
  const conductorView = viewForSession(store.views, conductorPath)
  const conductorStreaming = Boolean(conductorView?.isStreaming || (conductorPath && store.statuses[conductorPath]?.status === 'running'))
  const draftMessage = latestDraftMessage(conductorView)
  const conductorReady = conductorDraftReady(parseConductorDraft(draftMessage ? messageText(draftMessage) : '')) && !conductorStreaming
  const callEdges = useMemo(() => subagentCallEdges(runs, activities, projectedNodes), [runs, activities, projectedNodes])
  const routeInput = JSON.stringify({
    edges: [...authoredEdges, ...callEdges.filter(edge => !authoredEdges.some(authored => authored.id === edge.id))].map(({ id, source, target }) => ({ id, source, target })),
    nodes: projectedNodes.map((node) => {
      const { id, x, y, size } = nodeGeometry(node)
      return { id, x, y, size }
    }),
  })
  const graphRoutes = useMemo(() => {
    const input = JSON.parse(routeInput) as { edges: Array<{ id: string, source: string, target: string }>, nodes: FlowRouteNode[] }
    return routeGraphEdges(input.edges, input.nodes)
  }, [routeInput])

  useEffect(() => {
    if (!document)
      return
    // eslint-disable-next-line react/set-state-in-effect -- derived user edges and live message activity
    setEdges(toCanvasEdges(authoredEdges, activities, new Set(selection.edges), reducedMotion || !active, neighborhoodId, projectedNodes, callEdges.filter(edge => !authoredEdges.some(authored => authored.id === edge.id)), graphRoutes, Boolean(teamId)))
  }, [document, activities, selection.edges, neighborhoodId, reducedMotion, projectedNodes, active, callEdges, graphRoutes, teamId, authoredEdges])

  async function delegateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedNode?.orchestrationEnabled || !delegationTask.trim() || !delegationRole || delegating)
      return
    const nodeId = selectedNode.id
    const role = document?.nodes.find(node => node.id === delegationRole && node.kind === 'subagent-role')
    if (!role)
      return
    setDelegating(true)
    setError(null)
    try {
      const path = documentRef.current?.nodes.find(node => node.id === nodeId)?.sessionPath || null
      if (!path)
        throw new Error('主 Agent 会话尚未就绪')
      const opened = await openBackgroundSession(path)
      await sendPrompt(`请调用 subagent 工具，将下面的任务委派给角色 ${JSON.stringify({ id: role.id, name: role.name })}。请提供必要上下文，收到结果后检查并汇总，继续完成任务。\n\n${delegationTask.trim()}`, undefined, 'followUp', opened.key)
      setDelegationTask('')
      setDelegationOpen(false)
    }
    catch (reason) {
      setError(String(reason))
    }
    finally {
      setDelegating(false)
    }
  }

  // The store is mutable and keeps a stable identity, so derive status on every notified render.
  const visibleNodes = projectedNodes.map((node) => {
    const model = node.data.kind === 'subagent-role'
      ? configuredModel(node.data.roleModel, store.models)
      : viewForSession(store.views, node.data.sessionPath)?.model ?? configuredModel(node.data.roleModel, store.models)
    const owned = runs.filter(run => run.orchestratorId === (node.data.displayOwnerId ?? node.id) && (node.data.kind !== 'subagent-role' || (run.roleId === (node.data.agentId ?? node.id) && (run.purpose ?? 'task') === (node.data.runPurpose ?? 'task'))))
    const activeRuns = owned.filter(run => run.status === 'running')
    return ({
      ...node,
      selected: selection.nodes.includes(node.id),
      data: {
        ...node.data,
        memberSummary: node.data.orchestrationEnabled
          ? (() => {
              const members = (document?.memberships ?? []).filter(item => item.orchestratorId === node.id)
              const ownedRuns = runs.filter(run => run.orchestratorId === node.id)
              const counts = attention.page?.groups.find(group => group.orchestratorId === node.id)?.counts
              return { total: members.length, running: counts?.running ?? ownedRuns.filter(run => run.status === 'running').length, failed: counts?.latestFailures ?? members.filter(item => roleStatus(ownedRuns, item.memberId) === 'failed').length }
            })()
          : undefined,
        onEnterTeam: node.data.orchestrationEnabled && !teamId ? () => navigateTeam(node.id) : undefined,
        onInspect: () => inspectNode(node),
        runCount: activeRuns.length,
        runPhase: activeRuns.some(run => run.progress?.phase === 'collecting') ? '整理证据' : activeRuns[0]?.progress?.phase === 'tool' ? '执行工具' : activeRuns[0]?.progress?.phase === 'responding' ? '响应' : '思考',
        modelName: model?.id ?? (!node.data.evidenceOnly && node.data.kind === 'subagent-role' ? node.data.roleModel || '继承调用者模型' : undefined),
        provider: model?.provider,
        brand: providerBrand(model?.provider),
        status: node.data.kind === 'subagent-role' ? roleStatus(owned, node.data.agentId ?? node.id) : sessionStatusFor(node.data.sessionPath, store.statuses),
        needsInput: sessionNeedsInputFor(node.data.sessionPath, store.statuses),
        unread: store.unreadSessions.has(node.data.sessionPath),
        isAnchor: connectMode?.sourceId === node.id,
        isStreaming: Boolean(viewForSession(store.views, node.data.sessionPath)?.isStreaming),
        summaryOpen: summaryDisplayId === node.id,
        onActivate: (_id: string, additive?: boolean) => activateNode(node, additive),
        onHover: setHoveredDisplayId,
        isDimmed: Boolean(neighborhoodId && (node.data.agentId ?? node.id) !== neighborhoodId && !selectedNeighbors?.has(node.data.agentId ?? node.id)),
      },
    })
  })
  const attentionItems = flowAttentionItems(document?.nodes ?? [], store.statuses)

  function reviewAttention(id: string) {
    const target = nodes.find(node => node.id === id)
    if (!target)
      return
    if (teamId && id !== teamId)
      navigateTeam(null)
    setNodes(current => current.map(node => ({ ...node, selected: node.id === target.id })))
    setSelection({ nodes: [target.id], edges: [] })
    activeDisplayRef.current = target.id
    setSummaryDisplayId(null)
    setDetailOpen(true)
    setConductorOpen(false)
    if (instance)
      focusCanvas([target.id])
  }

  const summaryNode = visibleNodes.find(node => node.id === summaryDisplayId && node.id === selectedNodeId)
  const summaryRuns = summaryNode?.data.kind === 'subagent-role'
    ? selectedRuns
    : runs.filter(run => run.orchestratorId === selectedNodeId)
  const summaryActivity = summaryRuns[0]?.taskPreview ?? recentMessages[0]?.preview
  const sourceNode = connectMode ? document?.nodes.find(node => node.id === connectMode.sourceId) : undefined

  return (
    <div
      data-flow-workspace=""
      className={`${styles.workspace} pf-relative pf-flex pf-flex-1 pf-min-h-0 pf-flex-col`}
      onKeyDown={(event) => {
        if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [aria-modal="true"]')))
          return
        if (event.key === 'Escape') {
          if (connectMode)
            setConnectMode(null)
          else if (conductorOpen)
            setConductorOpen(false)
          else if (detailOpen)
            closeRuntimePanel()
          else if (summaryDisplayId)
            closeSummary()
          else if (teamId)
            navigateTeam(null)
          else
            return
          event.stopPropagation()
        }
      }}
    >
      <header className={`${styles.bar} pf-bg-canvas pf-z-4 pf-flex pf-items-center pf-gap-2 pf-px-2`}>
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        <div data-flow-heading="" tabIndex={-1} className={`${styles.heading} pf-flex pf-min-w-0 pf-flex-1 pf-items-center pf-gap-2`}>
          {teamId
            ? (
                <button type="button" className={styles.breadcrumb} aria-label="返回 Flow 总览" onClick={() => navigateTeam(null)}>
                  <ArrowLeft size={14} />
                  Flow
                </button>
              )
            : <strong>Flow</strong>}
          {team
            ? (
                <>
                  <ChevronRight size={13} aria-hidden="true" />
                  <strong title={team.name}>{team.name}</strong>
                </>
              )
            : null}
          <button type="button" title={projectPath} onClick={() => setProjectPickerOpen(true)}>{projectPath.split('/').filter(Boolean).at(-1) || '选择工程'}</button>
        </div>
        {saving ? <span className="pf-text-muted pf-text-[0.74rem] pf-whitespace-nowrap"><span className="t-shimmer" data-text="保存中…">保存中…</span></span> : null}
        {(selection.nodes.length > 1 || selection.edges.length) && !connectMode
          ? <button className={`${styles.delete} pf-text-danger`} onClick={deleteSelection}>移出画布</button>
          : null}
        {connectMode
          ? <button className={styles.cancel} onClick={() => setConnectMode(null)}>取消连接</button>
          : null}
        <button type="button" className={styles.cancel} onClick={() => setRunPanel({})}>运行记录</button>
        <button
          className={`${styles.add} pf-font-semibold`}
          disabled={!document}
          aria-expanded={panelOpen}
          onClick={() => {
            setConfigurationId(null)
            setPanelOpen(open => !open)
          }}
        >
          添加节点
        </button>
      </header>

      {runPanel?.target?.kind === 'review' ? <FlowReview key={JSON.stringify(runPanel.target)} projectPath={document?.projectPath ?? projectPath} target={runPanel.target} onClose={closeEvidence} onShowChat={onShowChat} onEvidence={openEvidence} /> : runPanel ? <RunPanel key={projectPath + JSON.stringify(runPanel)} projectPath={projectPath} initialFilter={runPanel} initialRunId={runPanel.target?.kind === 'run' ? runPanel.target.runId : runPanel.initialRunId} initialTab={runPanel.target?.kind === 'run' ? runPanel.target.tab : undefined} onClose={closeEvidence} onShowChat={onShowChat} /> : null}
      {roleChooserId
        ? (
            <Dialog title="选择角色所在的协作组" onClose={() => setRoleChooserId(null)}>
              <div className={styles.groupChoices}>
                {document?.memberships?.filter(item => item.memberId === roleChooserId).map(item => (
                  <button
                    type="button"
                    key={item.orchestratorId}
                    onClick={() => {
                      pendingRoleRef.current = roleChooserId
                      setRoleChooserId(null)
                      navigateTeam(item.orchestratorId)
                    }}
                  >
                    {document.nodes.find(node => node.id === item.orchestratorId)?.name ?? '已移除的编排者'}
                    <ArrowRight size={14} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setConfigurationId(roleChooserId)
                    setRoleChooserId(null)
                  }}
                >
                  编辑角色配置
                </button>
              </div>
            </Dialog>
          )
        : null}
      {projectPickerOpen ? <NewSessionDialog initialPath={projectPath} onSelect={onProjectChange} onCreated={() => setProjectPickerOpen(false)} onClose={() => setProjectPickerOpen(false)} /> : null}
      <FlowAttention owners={Object.fromEntries((document?.nodes ?? []).map(node => [node.id, node.name]))} page={attention.page} counts={activityCounts} sessions={teamId ? attentionItems.filter(item => item.nodeId === teamId) : attentionItems} loading={attention.loading} stale={attention.stale} error={attention.error} kind={activityKind} onKind={setActivityKind} onMore={() => void attention.more()} onRefresh={() => void attention.refresh()} onEvidence={openEvidence} onSession={reviewAttention} />
      {panelOpen
        ? (
            <FlowNodeForm key={projectPath} busy={saving} onCreate={addNode} onClose={() => setPanelOpen(false)} />
          )
        : null}

      {configurationNode && document
        ? (
            <FlowAgentForm key={configurationNode.id} document={document} node={configurationNode} busy={saving} onSave={draft => saveConfiguration(configurationNode.id, draft)} onClose={() => setConfigurationId(null)} />
          )
        : null}

      {error ? <div className={`${styles.error} pf-absolute pf-z-8 pf-right-[16px] pf-bottom-[64px] pf-p-[9px_12px] pf-rounded-[6px] pf-text-danger pf-text-[0.78rem] pf-leading-[1.5]`}>{error}</div> : null}
      <button type="button" className={`${styles.conductorButton} pf-absolute pf-z-5 pf-right-[16px] pf-bottom-[16px] pf-h-[36px] pf-p-[0_14px] pf-border pf-border-solid pf-border-line-strong pf-rounded-[999px] pf-text-ink pf-text-[0.82rem]`} disabled={!document} onClick={() => void showConductor()}>编排</button>
      <div className={styles.canvasLayout}>
        <div ref={canvasRef} className={styles.canvas}>
          {!document
            ? <div className="pf-grid pf-flex-1 pf-place-items-center pf-text-muted pf-text-[0.82rem]">正在读取项目 Flow…</div>
            : (
                <ReactFlow<FlowCanvasNode, Edge>
                  key={teamId ?? 'overview'}
                  nodes={visibleNodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  defaultViewport={teamId ? viewState.groups[teamId]?.viewport : overviewViewportRef.current ?? document.viewport}
                  fitView={Boolean(teamId && !viewState.groups[teamId]?.viewport)}
                  fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1.1 }}
                  minZoom={0.2}
                  maxZoom={2}
                  zoomOnScroll={false}
                  panOnScroll
                  onInit={(current) => {
                    setInstance(current)
                    const roleId = pendingRoleRef.current
                    if (roleId) {
                      pendingRoleRef.current = null
                      activeDisplayRef.current = roleId
                      focusTargetRef.current = [roleId]
                      setSelection({ nodes: [roleId], edges: [] })
                      setNodes(nodes => nodes.map(node => ({ ...node, selected: node.id === roleId })))
                      setRunOwnerFilter(teamId ?? '')
                      setSummaryDisplayId(roleId)
                    }
                    restoreNodeFocus()
                  }}
                  onNodesChange={onNodesChange}
                  selectNodesOnDrag={false}
                  multiSelectionKeyCode={['Meta', 'Control']}
                  onNodeClick={onNodeClick}
                  onNodeDragStart={(_event, node, draggedNodes) => {
                    setSummaryDisplayId(null)
                    setLayoutUndo(null)
                    if (teamId) {
                      setViewState(current => ({ ...current, groups: { ...current.groups, [teamId]: { ...current.groups[teamId], positions: Object.fromEntries(projectedNodes.map(item => [item.id, item.position])) } } }))
                    }
                    else {
                      const positions = new Map((draggedNodes.length ? draggedNodes : [node]).map(item => [item.id, item.position]))
                      setNodes(current => current.map(item => positions.has(item.id) ? { ...item, position: positions.get(item.id)! } : item))
                    }
                  }}
                  onNodeDragStop={onNodeDragStop}
                  onNodeDoubleClick={(_event, node) => {
                    if (!node.data.orchestrationEnabled)
                      void node.data.onOpen()
                  }}
                  onPaneClick={onPaneClick}
                  onNodesDelete={onNodesDelete}
                  onEdgesChange={onEdgesChange}
                  onEdgesDelete={onEdgesDelete}
                  onMoveEnd={onMoveEnd}
                  onSelectionChange={onSelectionChange}
                  deleteKeyCode={teamId ? null : ['Backspace', 'Delete']}
                  colorMode="dark"
                >
                  <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--flow-grid)" />
                  <FlowCanvasTools
                    canLocate={selection.nodes.length === 1}
                    canArrange={!saving && Boolean(document.nodes.length)}
                    canUndo={!teamId && !saving && Boolean(layoutUndo && layoutUndo.fingerprint === layoutFingerprint(document))}
                    minimap={minimap}
                    onZoomOut={() => void instance?.zoomOut()}
                    onZoomIn={() => void instance?.zoomIn()}
                    onOverview={() => {
                      focusTargetRef.current = []
                      focusPendingRef.current = false
                      void instance?.fitView({ padding: 0.12, duration: reducedMotion ? 0 : 180 })
                    }}
                    onLocate={() => focusCanvas(selection.nodes)}
                    onArrange={() => void arrangeLayout().catch(reason => setError(String(reason)))}
                    onUndo={() => void undoLayout().catch(reason => setError(String(reason)))}
                    onMinimap={() => {
                      setMinimap(value => !value)
                      try {
                        localStorage.setItem('piflow.flow-minimap', String(!minimap))
                      }
                      catch { /* Device preference is optional. */ }
                    }}
                  />
                  {summaryNode && !connectMode && !configurationNode && !panelOpen && !detailOpen && !conductorOpen
                    ? <FlowNodeSummary key={summaryNode.id} node={summaryNode} ownerName={document.nodes.find(node => node.id === summaryNode.data.displayOwnerId)?.name} activity={summaryActivity} onClose={closeSummary} evidence={attention.page?.items.filter(item => item.orchestratorId === (summaryNode.data.displayOwnerId ?? summaryNode.id) && (summaryNode.data.kind !== 'subagent-role' || item.roleId === (summaryNode.data.agentId ?? summaryNode.id)) && item.target.kind === 'review').slice(0, 3)} onEvidence={openEvidence} runs={summaryRuns.slice(0, 4)} onRun={id => openEvidence({ kind: 'run', runId: id })} onDetails={summaryNode.data.evidenceOnly ? undefined : openRuntimePanel} onRuns={() => setRunPanel(summaryNode.data.kind === 'subagent-role' ? { roleId: summaryNode.data.agentId ?? selectedNodeId, ...(runOwnerFilter ? { orchestratorId: runOwnerFilter } : {}) } : { orchestratorId: selectedNodeId })} />
                    : null}
                  {team && projection.nodes.length === 1
                    ? (
                        <div className={styles.emptyTeam}>
                          <span>还没有默认成员</span>
                          <button type="button" onClick={() => setConfigurationId(team.id)}>配置成员</button>
                        </div>
                      )
                    : null}
                  {minimap ? <MiniMap pannable zoomable nodeColor="var(--c-faint)" maskColor="rgb(0 0 0 / 72%)" /> : null}
                </ReactFlow>
              )}

        </div>
        {conductorOpen
          ? (
              <aside className={`${styles.conductor} pf-bg-canvas pf-z-7 pf-flex pf-flex-col`} aria-label="编排">
                <header className={`${styles.conductorBar} pf-p-[10px_12px] pf-flex pf-items-center pf-justify-between pf-gap-2`}>
                  <strong>编排</strong>
                  <button type="button" onClick={() => setConductorOpen(false)}>关闭</button>
                </header>
                <div className={`${styles.conductorChat} pf-min-h-0 pf-overflow-hidden`}>
                  {conductorView
                    ? (
                        <ChatView
                          sessionKey={conductorView.key}
                          messageExtra={message => draftCard(message, draftMessage, conductorReady, saving, () => void acceptDraft())}
                        />
                      )
                    : <FlowFirstPrompt busy={saving} onSend={sendFirstConductorMessage} />}
                </div>
              </aside>
            )
          : null}
        {detailOpen && !conductorOpen && selectedNode && !connectMode && !configurationNode && !panelOpen
          ? (
              <aside
                ref={detailRef}
                onKeyDown={(event) => {
                  if (event.key === 'Delete' || event.key === 'Backspace')
                    event.stopPropagation()
                }}
                className={`${styles.runtimePanel} pf-z-6 pf-flex pf-flex-col`}
                aria-label={`会话运行面板：${selectedNode.name}`}
              >
                <header className={`${styles.runtimeHeader} pf-p-[4px_8px_4px_12px] pf-flex pf-items-center pf-gap-2`}>
                  <div className={`${styles.runtimeIdentity} pf-flex pf-min-w-0 pf-flex-1 pf-items-center pf-gap-2`}>
                    <strong title={selectedNode.name}>{selectedNode.name}</strong>
                    <span className={`pf-flex-none pf-text-[0.7rem] ${styles[`runtime${selectedNode.kind === 'subagent-role' ? rolePanelKind : panelStatusKind(selectedNodeView, selectedNode.sessionPath, store.statuses)}`]}`}>
                      {selectedNode.kind === 'subagent-role' ? rolePanelState ? RUN_STATUS_LABELS[rolePanelState] : '尚无运行' : panelStatusLabel(selectedNodeView, selectedNode.sessionPath, store.statuses)}
                    </span>
                  </div>
                  <div className={`${styles.runtimeActions} pf-flex pf-flex-none pf-items-center pf-gap-1`}>
                    <button type="button" disabled={selectedNode.kind === 'subagent-role' || !selectedNode.sessionPath} title={selectedNode.kind === 'subagent-role' ? '角色没有唯一长期会话' : !selectedNode.sessionPath ? '发送第一条消息后可打开' : '在完整聊天视图中打开'} onClick={() => void focusSession(selectedNode.id)}>
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>打开聊天</span>
                    </button>
                    <IconButton label="返回画布（关闭运行面板）" onClick={closeRuntimePanel}>
                      <X />
                    </IconButton>
                  </div>
                </header>
                <div className={`${styles.runtimeSummary} pf-flex-none pf-p-[9px_12px]`}>
                  <p>{[selectedNode.orchestrationEnabled ? '编排者' : '', selectedNode.roleLabel].filter(Boolean).join(' · ') || '自定义 Agent'}</p>
                  <p>{selectedNode.goal || '尚未设置目标'}</p>
                  {selectedNode.brief?.trim() ? <p className={styles.runtimeBrief}>{selectedNode.brief.trim()}</p> : null}
                </div>
                <div className={`${styles.runtimeToolbar} pf-p-[5px_8px] pf-flex pf-flex-none pf-items-center pf-gap-1`} role="toolbar" aria-label="节点操作">
                  {selectedNode.orchestrationEnabled && !teamId ? <button type="button" className={styles.runtimeTool} onClick={() => navigateTeam(selectedNode.id)}>进入协作组</button> : null}
                  <button type="button" className={`${styles.runtimeTool} pf-inline-flex pf-min-h-[30px] pf-items-center pf-gap-[5px] pf-p-[0_8px] pf-rounded-control pf-text-[0.7rem]`} disabled={selectedNode.kind === 'subagent-role' || Boolean(teamId)} onClick={startConnect}>
                    <Link2 size={14} aria-hidden="true" />
                    连接
                  </button>
                  <button type="button" className={`${styles.runtimeTool} pf-inline-flex pf-min-h-[30px] pf-items-center pf-gap-[5px] pf-p-[0_8px] pf-rounded-control pf-text-[0.7rem]`} onClick={openBrief}>
                    <FileText size={14} aria-hidden="true" />
                    Agent 配置
                  </button>
                  <button type="button" className={`${styles.runtimeTool} pf-inline-flex pf-min-h-[30px] pf-items-center pf-gap-[5px] pf-p-[0_8px] pf-rounded-control pf-text-[0.7rem] ${styles.runtimeDelete} pf-ml-auto`} onClick={deleteSelection}>
                    <Trash2 size={14} aria-hidden="true" />
                    移出画布
                  </button>
                </div>
                {selectedNode.kind === 'subagent-role'
                  ? (
                      <label className={`${styles.runFilter} pf-flex pf-items-center pf-gap-[8px] pf-text-[0.75rem]`}>
                        调用者
                        <select aria-label="调用者" value={runOwnerFilter} onChange={event => setRunOwnerFilter(event.target.value)}>
                          <option value="">全部主 Agent</option>
                          {(document?.nodes ?? []).filter(node => node.orchestrationEnabled && node.kind !== 'subagent-role').map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
                        </select>
                      </label>
                    )
                  : null}
                {selectedNode.orchestrationEnabled && selectedNode.kind !== 'subagent-role'
                  ? (
                      <details className={`${styles.delegationEntry} pf-text-[0.75rem]`} open={delegationOpen} onToggle={event => setDelegationOpen(event.currentTarget.open)}>
                        <summary>委派任务</summary>
                        <form className={`${styles.delegation} pf-grid pf-gap-[8px]`} onSubmit={delegateTask}>
                          <label htmlFor="delegation-role">委派给角色</label>
                          <Select appearance="surface" id="delegation-role" required value={delegationRole} onChange={event => setDelegationRole(event.target.value)}>
                            <option value="">选择 Subagent 角色</option>
                            {(document?.nodes ?? []).filter(node => node.kind === 'subagent-role').map(role => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                                {document?.memberships?.some(item => item.orchestratorId === selectedNode.id && item.memberId === role.id) ? ' · 默认成员' : ''}
                              </option>
                            ))}
                          </Select>
                          <label htmlFor="delegation-task">任务与验收要求</label>
                          <Textarea appearance="surface" id="delegation-task" required maxLength={10_000} rows={3} value={delegationTask} onChange={event => setDelegationTask(event.target.value)} placeholder="交给主 Agent 补充上下文并发起委派…" />
                          <button type="submit" disabled={delegating || !delegationRole || !delegationTask.trim()}>{delegating ? '提交中…' : '交给主 Agent 委派'}</button>
                          <small>主 Agent 接收请求、调用角色并整合结果；忙碌时排入后续消息。</small>
                        </form>
                      </details>
                    )
                  : null}
                <button type="button" className={styles.runtimeTool} onClick={() => setRunPanel(selectedNode.kind === 'subagent-role' ? { roleId: selectedNode.id, ...(runOwnerFilter ? { orchestratorId: runOwnerFilter } : {}) } : { orchestratorId: selectedNode.id })}>查看运行记录</button>
                {recentMessages.length
                  ? (
                      <section className={`${styles.deliveryList} pf-overflow-y-auto pf-p-[8px_12px] pf-flex-none`} aria-label="最近的跨会话消息">
                        <h3>最近消息</h3>
                        {recentMessages.map(message => (
                          <article key={message.id} className={`${styles.delivery} pf-p-[6px_0]`}>
                            <span className={`pf-text-[0.65rem] ${styles[`delivery${message.status}`]}`}>{deliveryStatusLabel(message.status)}</span>
                            <p>{message.preview || message.body}</p>
                            {message.reply ? <p className={styles.deliveryReply}>{message.reply}</p> : null}
                          </article>
                        ))}
                      </section>
                    )
                  : null}
                <div className={`${styles.runtimeChat} pf-flex pf-min-h-0 pf-flex-1`}>
                  {selectedNode.kind === 'subagent-role'
                    ? <p className="pf-m-auto pf-text-muted pf-text-[0.78rem]">角色不绑定长期会话。主 Agent 通过 subagent 工具调用它，每次运行使用独立上下文。</p>
                    : selectedNodeView
                      ? <ChatView sessionKey={selectedNodeView.key} />
                      : selectedNode.sessionPath
                        ? <p className="pf-m-auto pf-text-muted pf-text-[0.78rem]">正在打开会话运行状态…</p>
                        : <FlowFirstPrompt key={selectedNode.id} busy={saving} onSend={text => sendFirstNodeMessage(selectedNode.id, text)} />}
                </div>
              </aside>
            )
          : null}

        {connectMode && sourceNode
          ? (
              <div className={[
                `${styles.mode} pf-absolute pf-z-5 pf-bottom-[16px] pf-left-[50%] pf-p-[8px_14px] pf-rounded-[6px] pf-bg-surface`,
                'pf-border pf-border-solid pf-border-signal pf-text-ink pf-text-[0.78rem] pf-leading-[1.5]',
                'pf-pointer-events-none',
              ].join(' ')}
              >
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

function FlowFirstPrompt({ busy, onSend }: { busy: boolean, onSend: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!text.trim() || busy || sending)
      return
    setSending(true)
    setError(null)
    try {
      await onSend(text.trim())
      setText('')
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    finally {
      setSending(false)
    }
  }
  return (
    <form className="pf-flex pf-flex-1 pf-flex-col pf-justify-end pf-gap-2 pf-p-3" onSubmit={submit}>
      <Textarea rows={3} maxLength={10000} value={text} onChange={event => setText(event.target.value)} placeholder="发送第一条消息以开始这个节点…" aria-label="Flow 节点的第一条消息" />
      {error ? <p className="pf-m-0 pf-text-danger pf-text-[0.75rem]" role="alert">{error}</p> : null}
      <div className="pf-flex pf-justify-end">
        <Button type="submit" variant="accent" size="panel" disabled={!text.trim() || busy || sending}>{sending ? '发送中…' : '发送'}</Button>
      </div>
    </form>
  )
}

function roleStatus(runs: RunSummary[], roleId: string): 'running' | 'failed' | 'idle' {
  const relevant = runs.filter(run => run.roleId === roleId)
  if (relevant.some(run => run.status === 'running'))
    return 'running'
  const latest = relevant.slice().sort(runOrder)[0]
  return latest?.status === 'failed' || latest?.status === 'interrupted' ? 'failed' : 'idle'
}

function reconcileCanvasNodes(previous: FlowCanvasNode[], next: FlowNode[], onOpen: (id: string) => void): FlowCanvasNode[] {
  const byId = new Map(previous.map(node => [node.id, node]))
  return next.map(node => ({ ...byId.get(node.id), ...toCanvasNode(node, () => onOpen(node.id)), selected: byId.get(node.id)?.selected ?? false }))
}

function toCanvasNode(node: FlowNode, onOpen: () => void): FlowCanvasNode {
  return {
    id: node.id,
    type: 'session',
    position: node.position,
    data: { sessionPath: node.sessionPath, name: node.name, goal: node.goal, brief: node.brief, kind: node.kind, roleModel: node.model, orchestrationEnabled: node.orchestrationEnabled, status: 'idle', needsInput: false, onOpen },
  }
}

function toCanvasEdges(
  edges: Array<Pick<FlowEdge, 'id' | 'source' | 'target'>>,
  activities: FlowEdgeActivity[],
  selectedEdgeIds: Set<string>,
  reducedMotion: boolean,
  selectedNodeId?: string,
  nodes: FlowCanvasNode[] = [],
  calls: { id: string, source: string, target: string }[] = [],
  routes: Map<string, import('./routes').FlowRoutePoint[]> = new Map(),
  membership = false,
): Edge[] {
  const allEdges = [...edges, ...calls]
  return allEdges.map((edge) => {
    const transient = calls.some(call => call.id === edge.id)
    const selected = selectedEdgeIds.has(edge.id)
    const targetId = nodes.find(node => node.id === edge.target)?.data.agentId ?? edge.target
    const sourceId = nodes.find(node => node.id === edge.source)?.data.agentId ?? edge.source
    const adjacent = !selectedNodeId || sourceId === selectedNodeId || targetId === selectedNodeId
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'message',
      selectable: !transient && !membership,
      deletable: !transient && !membership,
      data: {
        activities: activities.filter(activity => activity.edgeId === edge.id),
        reducedMotion,
        dimmed: !adjacent,
        highlighted: Boolean(selectedNodeId && adjacent),
        route: routes.get(edge.id),
        transient,
      },
      selected,
    }
  })
}

function topologyOf(document: FlowDocument): FlowTopology {
  return { nodes: document.nodes, edges: document.edges, memberships: document.memberships, viewport: document.viewport }
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

function panelStatusKind(view: SessionView | null, sessionPath: string, statuses: Record<string, SessionStatusRecord>) {
  if (sessionNeedsInputFor(sessionPath, statuses))
    return 'NeedsInput'
  const status = sessionStatusFor(sessionPath, statuses)
  if (status === 'failed')
    return 'Failed'
  if (view?.isStreaming || status === 'running')
    return 'Running'
  return 'Idle'
}

function panelStatusLabel(view: SessionView | null, sessionPath: string, statuses: Record<string, SessionStatusRecord>) {
  const kind = panelStatusKind(view, sessionPath, statuses)
  if (kind === 'NeedsInput')
    return '待回答'
  if (kind === 'Failed')
    return '失败'
  if (kind === 'Running')
    return '运行中'
  return '空闲'
}

function deliveryStatusLabel(status: FlowDeliveryStatus) {
  return ({ queued: '排队中', delivered: '已送达', replied: '已回复', failed: '失败' } satisfies Record<FlowDeliveryStatus, string>)[status]
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
    <div className={`${styles.conductorDraft} pf-border pf-border-solid pf-border-line pf-rounded-[8px]`}>
      <div className="pf-p-[12px_12px_0]">
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
      <div className={`${styles.panelActions} pf-flex pf-justify-end pf-gap-2`}>
        <Button variant="accent" size="panel" disabled={!ready || saving} onClick={onAccept}>接受</Button>
      </div>
    </div>
  )
}

function draftName(draft: { modules: Array<{ id: string, name: string }> }, id: string): string {
  return draft.modules.find(module => module.id === id)?.name.trim() || id
}
