import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { FlowDeliveryStatus, FlowDocument, FlowEdge, FlowNode, FlowTopology, SessionInfoLite, SessionStatusRecord } from '@piflow/protocol'
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
import type { FlowEdgeActivity } from '../../flow/edges'
import type { SessionView } from '../../session/state'
import type { FlowCanvasNode } from '../FlowSessionNode'
import { conductorDraftReady, parseConductorDraft } from '@piflow/protocol'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import { ArrowRight, CircleAlert, ExternalLink, FileText, Link2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { acceptConductor, cancelRun, loadFlow, saveFlow } from '../../flow/api'
import { flowAttentionItems, sessionNeedsInputFor, sessionStatusFor } from '../../flow/attention'
import { changedDeliveryActivities, changedRunActivities, sameDeliveryState, subagentCallEdges } from '../../flow/edges'
import { memberPlacements } from '../../flow/members'
import { routeGraphEdges } from '../../flow/routes'
import { shouldSeedFlow } from '../../flow/seed'
import { shortenPath } from '../../path'
import { createBackgroundSession, createConductorSession, openBackgroundSession, openSession, requestModels, requestProjectTrust, sendPrompt } from '../../session/actions'
import { clearSessionUnread } from '../../session/reducer'
import { useStore } from '../../session/use-store'
import Button from '../Button'
import ChatView from '../ChatView'
import FlowMessageEdge from '../FlowMessageEdge'
import FlowSessionNode from '../FlowSessionNode'
import IconButton from '../IconButton'
import SidebarToggle from '../SidebarToggle'
import styles from './styles.module.css'
import '@xyflow/react/dist/style.css'

const nodeTypes = { session: FlowSessionNode }
const edgeTypes = { message: FlowMessageEdge }

const ROLE_TEMPLATES = [
  { label: '程序员', prompt: '你负责实现代码。先理解需求和现有实现，再完成范围明确的改动，验证行为，并汇报结果、测试与剩余风险。' },
  { label: '产品经理', prompt: '你负责澄清用户目标、边界和验收标准。将需求拆成可执行工作，明确依赖与优先级；有不确定性时先提出关键问题。' },
  { label: '测试', prompt: '你负责验证功能与质量。根据验收标准覆盖关键路径、失败路径和边界条件，提供可复现的问题步骤与验证结论。' },
]

const RUN_STATUS_LABELS = { running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }

const NODE_WIDTH = 172
const NODE_HEIGHT = 128
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
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set())
  const [movedAgents, setMovedAgents] = useState<Set<string>>(() => new Set())
  const [instance, setInstance] = useState<ReactFlowInstance<FlowCanvasNode, Edge> | null>(null)
  const [connectMode, setConnectMode] = useState<ConnectMode | null>(null)
  const [activities, setActivities] = useState<FlowEdgeActivity[]>([])
  const previousMessagesRef = useRef<FlowDocument['messages'] | null>(null)
  const previousRunsRef = useRef<NonNullable<FlowDocument['runs']>>([])
  const messageProjectRef = useRef<string | null>(null)
  const activityTimersRef = useRef(new Map<string, number>())
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
  const openingNodeRef = useRef(new Set<string>())
  const [panelOpen, setPanelOpen] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [draftBrief, setDraftBrief] = useState('')
  const [draftKind, setDraftKind] = useState<'persistent' | 'subagent-role'>('subagent-role')
  const [draftRolePrompt, setDraftRolePrompt] = useState('')
  const [configurationKind, setConfigurationKind] = useState<'persistent' | 'subagent-role'>('persistent')
  const [roleModel, setRoleModel] = useState('')
  const [roleTools, setRoleTools] = useState<string[]>(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
  const [sessionPath, setSessionPath] = useState('')
  const [briefOpen, setBriefOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [rolePrompt, setRolePrompt] = useState('')
  const [orchestrationEnabled, setOrchestrationEnabled] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [runOwnerFilter, setRunOwnerFilter] = useState('')
  const [delegationRole, setDelegationRole] = useState('')
  const [delegationTask, setDelegationTask] = useState('')
  const [delegating, setDelegating] = useState(false)
  const [delegationOpen, setDelegationOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ nodes: string[], edges: string[] }>({ nodes: [], edges: [] })
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pollRef = useRef({ start() {}, stop() {} })
  const ensureNodeSession = useCallback(async (id: string): Promise<string | null> => {
    const current = documentRef.current
    const node = current?.nodes.find(item => item.id === id)
    if (!current || !node || node.kind === 'subagent-role')
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
        setNodes(current => reconcileCanvasNodes(current, resolved.nodes, focusSession))
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
      if (event.key !== 'Escape' || (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')))
        return
      if (connectMode)
        setConnectMode(null)
      else if (selection.nodes.length === 1)
        closeRuntimePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connectMode, selection.nodes])

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
            if (sameDeliveryState(current.messages, loaded.document.messages) && JSON.stringify(current.runs) === JSON.stringify(loaded.document.runs))
              return current
            return { ...current, messages: loaded.document.messages, runs: loaded.document.runs }
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
    if (!document)
      return
    if (messageProjectRef.current !== document.projectPath) {
      messageProjectRef.current = document.projectPath
      previousMessagesRef.current = document.messages
      previousRunsRef.current = document.runs ?? []
      for (const timer of activityTimersRef.current.values())
        window.clearTimeout(timer)
      activityTimersRef.current.clear()
      setActivities([])
      return
    }
    const previous = previousMessagesRef.current
    previousMessagesRef.current = document.messages
    if (!previous)
      return
    const next = [...changedDeliveryActivities(previous, document.messages), ...changedRunActivities(previousRunsRef.current, document.runs ?? [])]
    previousRunsRef.current = document.runs ?? []
    for (const [index, activity] of next.entries()) {
      const key = `${activity.messageId}:${activity.kind}:${Date.now()}:${index}`
      // eslint-disable-next-line react/set-state-in-effect -- this projects a transient event observed from a completed poll.
      setActivities(current => [...current, activity])
      const timer = window.setTimeout(() => {
        setActivities(current => current.filter(item => item !== activity))
        activityTimersRef.current.delete(key)
      }, 1200 + index * 120)
      activityTimersRef.current.set(key, timer)
    }
  }, [document])

  useEffect(() => () => {
    for (const timer of activityTimersRef.current.values())
      window.clearTimeout(timer)
  }, [])

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
          setNodes(current => reconcileCanvasNodes(current, saved.nodes, focusSession))
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
    setNodes(current => applyNodeChanges(changes, current))
  }

  const onNodeClick: NodeMouseHandler<FlowCanvasNode> = (_event, node) => {
    if (!connectMode) {
      setRunOwnerFilter(node.data.kind === 'subagent-role' ? node.data.displayOwnerId ?? '' : '')
      if (node.data.agentId) {
        const id = node.data.agentId
        setNodes(current => current.map(item => ({ ...item, selected: item.id === id })))
        setSelection({ nodes: [id], edges: [] })
      }
      return
    }
    const agentId = node.data.agentId ?? node.id
    if (agentId === connectMode.sourceId)
      return
    connectNodes(connectMode.sourceId, agentId)
  }

  function onPaneClick() {
    setConnectMode(null)
  }

  function closeRuntimePanel() {
    setSelection({ nodes: [], edges: [] })
    setNodes(current => current.map(node => node.selected ? { ...node, selected: false } : node))
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
    const next = { nodes: [...new Set(selectedNodes.map(node => node.data.agentId ?? node.id))], edges: selectedEdges.map(edge => edge.id) }
    setSelection(current => sameSelection(current, next) ? current : next)
    if (next.nodes.length !== 1)
      setBriefOpen(false)
    if (connectMode && !selectedNodes.some(node => node.id === connectMode.sourceId))
      setConnectMode(null)
    const selectedPath = selectedNodes[0]?.data.sessionPath
    if (selectedPath && next.nodes.length === 1)
      clearSessionUnread(selectedPath)
  }, [connectMode])

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
    const node = id ? document?.nodes.find(item => item.id === id) : undefined
    if (!node)
      return
    setBrief(node.brief ?? '')
    setRoleLabel(node.roleLabel ?? '')
    setConfigurationKind(node.kind ?? 'persistent')
    setRoleModel(node.model ?? '')
    setRoleTools(node.tools ?? ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
    setRolePrompt(node.rolePrompt ?? '')
    setOrchestrationEnabled(Boolean(node.orchestrationEnabled))
    setMemberIds((document?.memberships ?? []).filter(item => item.orchestratorId === id).map(item => item.memberId))
    setBriefOpen(true)
    setPanelOpen(false)
  }

  function saveBrief(event: React.FormEvent) {
    event.preventDefault()
    const id = selection.nodes[0]
    if (!document || !id)
      return
    if (configurationKind === 'persistent' && document.memberships?.some(item => item.memberId === id)) {
      setError('该 Agent 仍属于其他编排者，请先移除归属关系，再启用编排能力。')
      return
    }
    if (configurationKind === 'subagent-role' && document.edges.some(edge => edge.source === id || edge.target === id)) {
      setError('请先移除该节点的通信边，再将它改为 Subagent 角色。')
      return
    }
    const existing = document.nodes.find(node => node.id === id)
    if (configurationKind !== (existing?.kind ?? 'persistent') && document.runs?.some(run => run.roleId === id || run.orchestratorId === id)) {
      setError('该节点已有运行记录，请新建另一种执行类型的节点；原运行记录将保留。')
      return
    }
    const now = new Date().toISOString()
    void persist({
      ...document,
      memberships: [
        ...(document.memberships ?? []).filter(item => item.orchestratorId !== id),
        ...(configurationKind === 'persistent' && orchestrationEnabled ? memberIds.map(memberId => ({ orchestratorId: id, memberId })) : []),
      ],
      nodes: document.nodes.map(node => node.id === id ? { ...node, kind: configurationKind, sessionPath: configurationKind === 'subagent-role' ? '' : node.sessionPath, brief: brief.trim(), roleLabel: roleLabel.trim(), rolePrompt: rolePrompt.trim(), model: roleModel.trim(), tools: roleTools, orchestrationEnabled: configurationKind === 'persistent' && orchestrationEnabled, updatedAt: now } : node),
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
      let path = draftKind === 'subagent-role' ? '' : sessionPath
      if (draftKind === 'persistent' && !path) {
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
          kind: draftKind,
          orchestrationEnabled: draftKind === 'persistent',
          rolePrompt: draftRolePrompt.trim(),
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
      setDraftRolePrompt('')
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

  const selectedNodeId = selection.nodes.length === 1 ? selection.nodes[0] : undefined
  const selectedNode = selectedNodeId ? document?.nodes.find(node => node.id === selectedNodeId) : undefined
  const selectedRuns = (document?.runs ?? []).filter(run => selectedNode?.kind === 'subagent-role'
    ? run.roleId === selectedNodeId && (!runOwnerFilter || run.orchestratorId === runOwnerFilter)
    : run.orchestratorId === selectedNodeId).slice().reverse()
  const rolePanelState = selectedRuns.some(run => run.status === 'running') ? 'running' : selectedRuns[0]?.status
  const rolePanelKind = rolePanelState === 'running' ? 'Running' : rolePanelState === 'failed' || rolePanelState === 'interrupted' ? 'Failed' : 'Idle'
  const selectedNodeView = selectedNode ? (viewForSession(store.views, selectedNode.sessionPath) ?? null) : null
  const selectedNeighbors = selectedNodeId
    ? new Set([
        ...(document?.edges.flatMap(edge => edge.source === selectedNodeId ? [edge.target] : edge.target === selectedNodeId ? [edge.source] : []) ?? []),
        ...(document?.memberships?.flatMap(item => item.orchestratorId === selectedNodeId ? [item.memberId] : item.memberId === selectedNodeId ? [item.orchestratorId] : []) ?? []),
        ...(document?.runs?.filter(run => run.status === 'running').flatMap(run => run.orchestratorId === selectedNodeId ? [run.roleId] : run.roleId === selectedNodeId ? [run.orchestratorId] : []) ?? []),
      ])
    : null
  const recentMessages = selectedNodeId
    ? (document?.messages.filter(message => message.source === selectedNodeId || message.target === selectedNodeId).slice(-5).reverse() ?? [])
    : []

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
  const projectedNodes = useMemo(() => {
    const placements = memberPlacements(nodes, document?.memberships ?? [], expandedAgents, movedAgents)
    const primary = new Map(placements.filter(item => !item.reference).map(item => [item.agentId, item]))
    const originals = nodes.map(node => ({ ...node, position: primary.get(node.id)?.position ?? node.position, data: { ...node.data, displayOwnerId: primary.get(node.id)?.ownerId } }))
    const references = placements.filter(item => item.reference).flatMap((item) => {
      const source = nodes.find(node => node.id === item.agentId)
      return source
        ? [{ ...source, id: item.id, position: item.position, selected: source.selected, draggable: false, deletable: false, data: { ...source.data, agentId: item.agentId, displayOwnerId: item.ownerId, referenceLabel: '共享引用' } }]
        : []
    })
    return [...originals, ...references]
  }, [nodes, document?.memberships, expandedAgents, movedAgents])

  useEffect(() => {
    if (!document)
      return
    // eslint-disable-next-line react/set-state-in-effect -- derived user edges and live message activity
    setEdges(toCanvasEdges(document.edges, activities, new Set(selection.edges), reducedMotion || !active, selection.nodes[0], projectedNodes, instance, subagentCallEdges(document.runs ?? [], activities, projectedNodes)))
  }, [document, activities, selection.edges, selection.nodes, reducedMotion, projectedNodes, instance, active])

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
      const path = await ensureNodeSession(nodeId)
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

  function toggleMembers(id: string) {
    setExpandedAgents((current) => {
      const next = new Set(current)
      if (next.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }

  // The store is mutable and keeps a stable identity, so derive status on every notified render.
  const visibleNodes = projectedNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      memberSummary: node.data.orchestrationEnabled
        ? (() => {
            const members = (document?.memberships ?? []).filter(item => item.orchestratorId === node.id)
            const runs = (document?.runs ?? []).filter(run => run.orchestratorId === node.id)
            return { total: members.length, running: runs.filter(run => run.status === 'running').length, failed: runs.filter(run => run.status === 'failed' || run.status === 'interrupted').length }
          })()
        : undefined,
      membersExpanded: expandedAgents.has(node.id),
      onToggleMembers: () => toggleMembers(node.id),
      modelName: node.data.kind === 'subagent-role' ? node.data.roleModel || '继承调用者模型' : viewForSession(store.views, node.data.sessionPath)?.model?.id,
      status: node.data.kind === 'subagent-role' ? roleStatus(document?.runs ?? [], node.data.agentId ?? node.id) : sessionStatusFor(node.data.sessionPath, store.statuses),
      needsInput: sessionNeedsInputFor(node.data.sessionPath, store.statuses),
      unread: store.unreadSessions.has(node.data.sessionPath),
      isCurrent: node.data.sessionPath === activeSessionPath,
      isAnchor: connectMode?.sourceId === node.id,
      isStreaming: Boolean(viewForSession(store.views, node.data.sessionPath)?.isStreaming),
      isDimmed: Boolean(selectedNodeId && (node.data.agentId ?? node.id) !== selectedNodeId && !selectedNeighbors?.has(node.data.agentId ?? node.id) && !(expandedAgents.has(selectedNodeId) && document?.memberships?.some(item => item.orchestratorId === selectedNodeId && item.memberId === (node.data.agentId ?? node.id)))),
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
    <div className={`${styles.workspace} pf-relative pf-flex pf-flex-1 pf-min-h-0 pf-flex-col`}>
      <header className={`${styles.bar} pf-bg-canvas pf-z-4 pf-flex pf-items-center pf-gap-2 pf-px-2`}>
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        <div className={`${styles.heading} pf-flex pf-min-w-0 pf-flex-1 pf-items-center pf-gap-2`}>
          <strong>Flow</strong>
          <span title={projectPath}>{shortenPath(projectPath)}</span>
        </div>
        {saving ? <span className="pf-text-muted pf-text-[0.74rem] pf-whitespace-nowrap"><span className="t-shimmer" data-text="保存中…">保存中…</span></span> : null}
        {(selection.nodes.length > 1 || selection.edges.length) && !connectMode
          ? <button className={`${styles.delete} pf-text-danger`} onClick={deleteSelection}>移出画布</button>
          : null}
        {connectMode
          ? <button className={styles.cancel} onClick={() => setConnectMode(null)}>取消连接</button>
          : null}
        <button className={`${styles.add} pf-font-semibold`} disabled={!document} aria-expanded={panelOpen} onClick={() => setPanelOpen(open => !open)}>添加节点</button>
      </header>

      {attentionItems.length
        ? (
            <div className={`${styles.attention} pf-min-h-[42px] pf-p-[7px_16px] ${attentionItems[0]!.reason === 'needs_input' ? styles.attentionNeedsInput : ''}`} role="status">
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
              <button className={`${styles.attentionAction} pf-inline-flex pf-min-h-[28px] pf-flex-none pf-items-center pf-gap-[5px] pf-p-[3px_7px] pf-rounded-[4px] pf-font-semibold`} type="button" onClick={reviewAttention}>
                查看
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          )
        : null}

      {panelOpen
        ? (
            <form className={`${styles.panel} pf-absolute pf-z-5 pf-right-[16px] pf-overflow-y-auto`} onSubmit={event => void addNode(event)}>
              <label>
                执行类型
                <select value={draftKind} onChange={event => setDraftKind(event.target.value as 'persistent' | 'subagent-role')}>
                  <option value="subagent-role">Subagent 角色（独立任务上下文）</option>
                  <option value="persistent">主 Agent（长期会话）</option>
                </select>
              </label>
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
                角色提示词
                <textarea maxLength={8000} rows={4} value={draftRolePrompt} onChange={event => setDraftRolePrompt(event.target.value)} placeholder="定义职责、工作方式和交付要求" />
              </label>
              {draftKind === 'persistent'
                ? (
                    <label>
                      会话
                      <select value={sessionPath} onChange={event => setSessionPath(event.target.value)}>
                        <option value="">新建干净会话</option>
                        {availableSessions.map(session => <option key={session.path} value={session.path}>{sessionLabel(session)}</option>)}
                      </select>
                    </label>
                  )
                : null}
              <div className={`${styles.panelActions} pf-flex pf-justify-end pf-gap-2`}>
                <Button variant="ghost" size="panel" onClick={() => setPanelOpen(false)}>取消</Button>
                <Button type="submit" variant="accent" size="panel" disabled={saving || !name.trim()}>添加</Button>
              </div>
            </form>
          )
        : null}

      {briefOpen
        ? (
            <form className={`${styles.panel} pf-absolute pf-z-5 pf-right-[16px] pf-overflow-y-auto`} onSubmit={saveBrief} aria-label="Agent 配置">
              <strong>Agent 配置</strong>
              <label>
                执行类型
                <select value={configurationKind} onChange={event => setConfigurationKind(event.target.value as 'persistent' | 'subagent-role')}>
                  <option value="persistent">长期 Agent</option>
                  <option value="subagent-role">Subagent 角色（每次调用独立执行）</option>
                </select>
              </label>
              {configurationKind === 'subagent-role'
                ? (
                    <>
                      <label>
                        模型
                        <input value={roleModel} maxLength={200} onChange={event => setRoleModel(event.target.value)} placeholder="留空继承主 Agent；或 provider/model-id" />
                      </label>
                      <fieldset className="pf-min-w-0 pf-m-[0_0_12px] pf-p-[10px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-text-muted pf-text-[0.75rem]">
                        <legend>角色工具范围</legend>
                        <p>实际执行取角色配置与主 Agent 已启用工具的交集。</p>
                        {['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'].map(tool => (
                          <label className={styles.toggleField} key={tool}>
                            <input type="checkbox" checked={roleTools.includes(tool)} onChange={event => setRoleTools(current => event.target.checked ? [...current, tool] : current.filter(item => item !== tool))} />
                            {tool}
                          </label>
                        ))}
                      </fieldset>
                    </>
                  )
                : null}
              <label>
                从角色模板开始
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const template = ROLE_TEMPLATES.find(item => item.label === event.target.value)
                    if (template) {
                      setRoleLabel(template.label)
                      setRolePrompt(template.prompt)
                    }
                  }}
                >
                  <option value="">自定义（选择模板将替换当前角色提示词）</option>
                  {ROLE_TEMPLATES.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}
                </select>
              </label>
              <label>
                角色名称
                <input autoFocus maxLength={80} value={roleLabel} onChange={event => setRoleLabel(event.target.value)} placeholder="例如：程序员、产品经理、测试" />
              </label>
              <label>
                角色提示词
                <textarea maxLength={8000} rows={5} value={rolePrompt} onChange={event => setRolePrompt(event.target.value)} placeholder="定义职责、工作方式和交付要求；从下次运行开始生效。" />
              </label>
              <label className={styles.toggleField}>
                <input type="checkbox" checked={orchestrationEnabled} disabled={configurationKind === 'subagent-role' || Boolean(document?.memberships?.some(item => item.memberId === selection.nodes[0]))} onChange={event => setOrchestrationEnabled(event.target.checked)} />
                启用编排能力
              </label>
              {document?.memberships?.some(item => item.memberId === selection.nodes[0]) ? <p className="pf-text-muted pf-text-[0.75rem]">启用前请先从所属编排者的成员列表中移除该 Agent。</p> : null}
              {configurationKind === 'persistent' && orchestrationEnabled
                ? (
                    <fieldset className="pf-min-w-0 pf-m-[0_0_12px] pf-p-[10px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-text-muted pf-text-[0.75rem]">
                      <legend>成员（不创建通信连接）</legend>
                      {document?.nodes.filter(node => node.id !== selection.nodes[0] && node.kind === 'subagent-role').map(node => (
                        <label key={node.id} className={styles.toggleField}>
                          <input type="checkbox" checked={memberIds.includes(node.id)} onChange={event => setMemberIds(current => event.target.checked ? [...current, node.id] : current.filter(id => id !== node.id))} />
                          {node.name}
                        </label>
                      ))}
                      {!document?.nodes.some(node => node.id !== selection.nodes[0] && node.kind === 'subagent-role') ? <p>先在画布上添加 Subagent 角色。</p> : null}
                    </fieldset>
                  )
                : null}
              <label>
                Brief
                <textarea maxLength={8000} rows={8} value={brief} onChange={event => setBrief(event.target.value)} placeholder="这个节点固定带上的说明，类似仓库里的 AGENTS.md。可以留空。" />
              </label>
              <div className={`${styles.panelActions} pf-flex pf-justify-end pf-gap-2`}>
                <Button variant="ghost" size="panel" onClick={() => setBriefOpen(false)}>取消</Button>
                <Button type="submit" variant="accent" size="panel" disabled={saving}>保存</Button>
              </div>
            </form>
          )
        : null}

      {error ? <div className={`${styles.error} pf-absolute pf-z-8 pf-right-[16px] pf-bottom-[64px] pf-p-[9px_12px] pf-rounded-[6px] pf-text-danger pf-text-[0.78rem] pf-leading-[1.5]`}>{error}</div> : null}
      <button type="button" className={`${styles.conductorButton} pf-absolute pf-z-5 pf-right-[16px] pf-bottom-[16px] pf-h-[36px] pf-p-[0_14px] pf-border pf-border-solid pf-border-line-strong pf-rounded-[999px] pf-text-ink pf-text-[0.82rem]`} disabled={!document} onClick={() => void showConductor()}>编排</button>
      {conductorOpen
        ? (
            <aside className={`${styles.conductor} pf-right-0 pf-bottom-0 pf-bg-canvas pf-absolute pf-z-7 pf-flex pf-flex-col`} aria-label="编排">
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
                  : <p className={styles.conductorEmpty}>正在打开编排…</p>}
              </div>
            </aside>
          )
        : null}
      <div className="pf-relative pf-flex pf-flex-1 pf-min-h-0 pf-flex-col">
        {!document
          ? <div className="pf-grid pf-flex-1 pf-place-items-center pf-text-muted pf-text-[0.82rem]">正在读取项目 Flow…</div>
          : (
              <ReactFlow<FlowCanvasNode, Edge>
                nodes={visibleNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultViewport={document.viewport}
                minZoom={0.2}
                maxZoom={2}
                zoomOnScroll={false}
                panOnScroll
                fitView={document.nodes.length > 0 && document.viewport.zoom === 1 && document.viewport.x === 0 && document.viewport.y === 0}
                onInit={setInstance}
                onNodesChange={onNodesChange}
                onNodeClick={onNodeClick}
                onNodeDragStart={(_event, node) => {
                  setNodes(current => current.map(item => item.id === node.id ? { ...item, position: node.position } : item))
                  setMovedAgents(current => new Set([...current, node.id]))
                }}
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

        {selectedNode && !connectMode && !briefOpen && !panelOpen
          ? (
              <aside className={`${styles.runtimePanel} pf-top-0 pf-right-0 pf-bottom-0 pf-absolute pf-z-6 pf-flex pf-flex-col`} aria-label={`会话运行面板：${selectedNode.name}`}>
                <header className={`${styles.runtimeHeader} pf-p-[4px_8px_4px_12px] pf-flex pf-items-center pf-gap-2`}>
                  <div className={`${styles.runtimeIdentity} pf-flex pf-min-w-0 pf-flex-1 pf-items-center pf-gap-2`}>
                    <strong title={selectedNode.name}>{selectedNode.name}</strong>
                    <span className={`pf-flex-none pf-text-[0.7rem] ${styles[`runtime${selectedNode.kind === 'subagent-role' ? rolePanelKind : panelStatusKind(selectedNodeView, selectedNode.sessionPath, store.statuses)}`]}`}>
                      {selectedNode.kind === 'subagent-role' ? rolePanelState ? RUN_STATUS_LABELS[rolePanelState] : '尚无运行' : panelStatusLabel(selectedNodeView, selectedNode.sessionPath, store.statuses)}
                    </span>
                  </div>
                  <div className={`${styles.runtimeActions} pf-flex pf-flex-none pf-items-center pf-gap-1`}>
                    <button type="button" disabled={selectedNode.kind === 'subagent-role'} title={selectedNode.kind === 'subagent-role' ? '角色没有唯一长期会话' : '在完整聊天视图中打开'} onClick={() => void focusSession(selectedNode.id)}>
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>打开聊天</span>
                    </button>
                    <IconButton label="关闭运行面板" onClick={closeRuntimePanel}>
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
                  {expandedAgents.has(selectedNode.id)
                    ? (
                        <button type="button" className={`${styles.runtimeTool} pf-inline-flex pf-min-h-[30px] pf-items-center pf-gap-[5px] pf-p-[0_8px] pf-rounded-control pf-text-[0.7rem]`} onClick={() => void instance?.fitView({ nodes: visibleNodes.filter(node => node.id === selectedNode.id || node.data.displayOwnerId === selectedNode.id), padding: 0.5, maxZoom: 1, duration: reducedMotion ? 0 : 180 })}>
                          聚焦成员
                        </button>
                      )
                    : null}
                  <button type="button" className={`${styles.runtimeTool} pf-inline-flex pf-min-h-[30px] pf-items-center pf-gap-[5px] pf-p-[0_8px] pf-rounded-control pf-text-[0.7rem]`} disabled={selectedNode.kind === 'subagent-role'} onClick={startConnect}>
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
                          <select id="delegation-role" required value={delegationRole} onChange={event => setDelegationRole(event.target.value)}>
                            <option value="">选择 Subagent 角色</option>
                            {(document?.nodes ?? []).filter(node => node.kind === 'subagent-role').map(role => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                                {document?.memberships?.some(item => item.orchestratorId === selectedNode.id && item.memberId === role.id) ? ' · 默认成员' : ''}
                              </option>
                            ))}
                          </select>
                          <label htmlFor="delegation-task">任务与验收要求</label>
                          <textarea id="delegation-task" required maxLength={10_000} rows={3} value={delegationTask} onChange={event => setDelegationTask(event.target.value)} placeholder="交给主 Agent 补充上下文并发起委派…" />
                          <button type="submit" disabled={delegating || !delegationRole || !delegationTask.trim()}>{delegating ? '提交中…' : '交给主 Agent 委派'}</button>
                          <small>主 Agent 接收请求、调用角色并整合结果；忙碌时排入后续消息。</small>
                        </form>
                      </details>
                    )
                  : null}
                {selectedRuns.length
                  ? (
                      <section className={`${styles.runList} pf-max-h-[45vh] pf-overflow-y-auto pf-p-[12px]`} aria-label="Subagent 运行记录">
                        <h3>Subagent 运行</h3>
                        {selectedRuns.map(run => (
                          <details key={run.id} className={`${styles.run} pf-p-[8px_0]`}>
                            <summary>
                              {RUN_STATUS_LABELS[run.status]}
                              {' '}
                              ·
                              {' '}
                              {run.configurationSnapshot.roleName}
                              {' '}
                              ·
                              {' '}
                              {document?.nodes.find(node => node.id === run.orchestratorId)?.name ?? run.orchestratorId}
                            </summary>
                            <p>{run.task}</p>
                            <small>
                              {run.id}
                              {' '}
                              ·
                              {' '}
                              {run.configurationSnapshot.model}
                            </small>
                            <pre>{run.output || '等待执行输出…'}</pre>
                            {run.status === 'running' && run.progress ? <p role="status">{run.progress.phase === 'tool' ? `正在执行工具：${run.progress.toolName ?? '工具'}` : run.progress.phase === 'thinking' ? '思考中…' : '正在输出…'}</p> : null}
                            {run.error ? <p role="status">{run.error}</p> : null}
                            {run.status === 'running' ? <button type="button" onClick={() => void cancelRun(document!.projectPath, run.id).catch(reason => setError(String(reason)))}>取消运行</button> : null}
                            <details>
                              <summary>启动配置快照</summary>
                              <pre>{JSON.stringify(run.configurationSnapshot, null, 2)}</pre>
                            </details>
                          </details>
                        ))}
                      </section>
                    )
                  : selectedNode.kind === 'subagent-role' ? <p className="pf-m-auto pf-text-muted pf-text-[0.78rem]">尚无调用记录</p> : null}
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
                      : <p className="pf-m-auto pf-text-muted pf-text-[0.78rem]">正在打开会话运行状态…</p>}
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

function roleStatus(runs: NonNullable<FlowDocument['runs']>, roleId: string): 'running' | 'failed' | 'idle' {
  const relevant = runs.filter(run => run.roleId === roleId)
  if (relevant.some(run => run.status === 'running'))
    return 'running'
  const latest = relevant.at(-1)
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
  edges: FlowEdge[],
  activities: FlowEdgeActivity[],
  selectedEdgeIds: Set<string>,
  reducedMotion: boolean,
  selectedNodeId?: string,
  nodes: FlowCanvasNode[] = [],
  instance: ReactFlowInstance<FlowCanvasNode, Edge> | null = null,
  calls: { id: string, source: string, target: string }[] = [],
): Edge[] {
  const allEdges = [...edges, ...calls]
  const routes = routeGraphEdges(allEdges, nodes.map((node) => {
    const internal = instance?.getInternalNode(node.id)
    const handle = internal?.internals.handleBounds?.source?.[0]
    const position = node.position
    return {
      id: node.id,
      x: position.x + (handle ? handle.x + handle.width / 2 : (node.measured?.width ?? NODE_WIDTH) / 2),
      y: position.y + (handle ? handle.y + handle.height / 2 : (node.measured?.height ?? NODE_HEIGHT) / 2),
      size: 51,
    }
  }))
  return allEdges.map((edge) => {
    const transient = calls.some(call => call.id === edge.id)
    const selected = selectedEdgeIds.has(edge.id)
    const targetId = nodes.find(node => node.id === edge.target)?.data.agentId ?? edge.target
    const adjacent = !selectedNodeId || edge.source === selectedNodeId || targetId === selectedNodeId
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'message',
      selectable: !transient,
      deletable: !transient,
      data: {
        activities: activities.filter(activity => activity.edgeId === edge.id),
        reducedMotion,
        dimmed: !adjacent,
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

function sessionLabel(session: SessionInfoLite) {
  return session.name || session.firstMessage || '空会话'
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
