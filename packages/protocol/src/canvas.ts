import type { AgentConfiguration, FlowMembership } from './agents'
import { parseAgentConfiguration, parseFlowMemberships } from './agents'

export const PROJECT_CANVAS_FILE = '.piflow/canvas.json'
export const LEGACY_MODULES_FILE = '.piflow/modules.json'
export const PROJECT_CANVAS_VERSION = 1

const ROOT_KEYS = ['version', 'nodes', 'links', 'memberships']
const NODE_KEYS = ['id', 'name', 'brief', 'position', 'roleLabel', 'rolePrompt', 'orchestrationEnabled']
const LINK_KEYS = ['id', 'source', 'target']

export interface CanvasPosition {
  x: number
  y: number
}

export interface CanvasNode extends AgentConfiguration {
  id: string
  name: string
  brief: string
  position: CanvasPosition
}

export interface CanvasLink {
  id: string
  source: string
  target: string
}

export interface ProjectCanvas {
  memberships?: FlowMembership[]
  version: typeof PROJECT_CANVAS_VERSION
  nodes: CanvasNode[]
  links: CanvasLink[]
}

/** Known fields plus anything this version does not understand. Unknown fields are written back. */
export interface ProjectCanvasDocument {
  canvas: ProjectCanvas
  extras: Record<string, unknown>
  nodeExtras: Record<string, Record<string, unknown>>
  linkExtras: Record<string, Record<string, unknown>>
}

export interface LegacyModules {
  nodes: Array<{ id: string, name: string, brief: string, extras: Record<string, unknown> }>
  links: Array<{ id: string, source: string, target: string, extras: Record<string, unknown> }>
  extras: Record<string, unknown>
}

export class UnsupportedProjectCanvasVersion extends Error {
  readonly version: number

  constructor(version: number) {
    super(`unsupported project canvas version: ${version}`)
    this.name = 'UnsupportedProjectCanvasVersion'
    this.version = version
  }
}

/**
 * Version 1 is additive. A new optional field stays on this version, defaults when
 * missing, and joins the known-key list so it is not treated as an extra.
 * Bump the version only when an older reader would misread the file.
 * A reader that does not recognize `version` throws and must not write the file.
 */
export function parseProjectCanvas(value: unknown): ProjectCanvasDocument {
  if (!isRecord(value))
    throw new Error('invalid project canvas')
  readVersion(value)
  if (!Array.isArray(value.nodes))
    throw new Error('invalid project canvas')
  const linksValue = value.links === undefined ? [] : value.links
  if (!Array.isArray(linksValue))
    throw new Error('invalid project canvas')

  const nodes = value.nodes.map(parseNode)
  if (new Set(nodes.map(item => item.node.id)).size !== nodes.length)
    throw new Error('duplicate canvas node')
  const nodeIds = new Set(nodes.map(item => item.node.id))
  const links = linksValue.map(parseLink)
  if (new Set(links.map(item => item.link.id)).size !== links.length)
    throw new Error('duplicate canvas link')
  if (links.some(item => item.link.source === item.link.target || !nodeIds.has(item.link.source) || !nodeIds.has(item.link.target)))
    throw new Error('invalid canvas link')
  if (new Set(links.map(linkKey)).size !== links.length)
    throw new Error('duplicate canvas link')

  return {
    canvas: { version: PROJECT_CANVAS_VERSION, nodes: nodes.map(node => node.node), links: links.map(link => link.link), ...(value.memberships === undefined ? {} : { memberships: parseFlowMemberships(value.memberships, nodes.map(node => node.node)) }) },
    extras: extrasOf(value, ROOT_KEYS),
    nodeExtras: Object.fromEntries(nodes.map(node => [node.node.id, node.extras])),
    linkExtras: Object.fromEntries(links.map(link => [link.link.id, link.extras])),
  }
}

export function serializeProjectCanvas(document: ProjectCanvasDocument): Record<string, unknown> {
  return {
    version: document.canvas.version,
    ...(document.canvas.memberships === undefined ? {} : { memberships: document.canvas.memberships }),
    nodes: document.canvas.nodes.map(node => ({
      ...node,
      ...(document.nodeExtras[node.id] ?? {}),
    })),
    links: document.canvas.links.map(link => ({
      id: link.id,
      source: link.source,
      target: link.target,
      ...(document.linkExtras[link.id] ?? {}),
    })),
    ...document.extras,
  }
}

/** Read `.piflow/modules.json` so it can be written once as a canvas. Positions are filled by the caller. */
export function parseLegacyModules(value: unknown): LegacyModules {
  if (!isRecord(value))
    throw new Error('invalid project canvas')
  readVersion(value)
  if (!Array.isArray(value.modules))
    throw new Error('invalid project canvas')
  const linksValue = value.links === undefined ? [] : value.links
  if (!Array.isArray(linksValue))
    throw new Error('invalid project canvas')
  const nodes = value.modules.map(parseLegacyNode)
  if (new Set(nodes.map(node => node.id)).size !== nodes.length)
    throw new Error('duplicate canvas node')
  const nodeIds = new Set(nodes.map(node => node.id))
  const links = (linksValue as unknown[]).map(parseLegacyLink)
  if (links.some(link => link.source === link.target || !nodeIds.has(link.source) || !nodeIds.has(link.target)))
    throw new Error('invalid canvas link')
  return { nodes, links, extras: extrasOf(value, ['version', 'modules', 'links']) }
}

function readVersion(value: Record<string, unknown>): void {
  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new Error('invalid project canvas')
  if (version !== PROJECT_CANVAS_VERSION)
    throw new UnsupportedProjectCanvasVersion(version)
}

function parseNode(value: unknown): { node: CanvasNode, extras: Record<string, unknown> } {
  if (!isRecord(value))
    throw new Error('invalid canvas node')
  const id = asId(value.id)
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name || name.length > 80)
    throw new Error('invalid canvas node name')
  const brief = typeof value.brief === 'string' ? value.brief.trim().slice(0, 8000) : ''
  return {
    node: { id, name, brief, position: parsePosition(value.position), ...parseAgentConfiguration(value) },
    extras: extrasOf(value, NODE_KEYS),
  }
}

function parseLegacyNode(value: unknown): { id: string, name: string, brief: string, extras: Record<string, unknown> } {
  if (!isRecord(value))
    throw new Error('invalid canvas node')
  const id = asId(value.id)
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name || name.length > 80)
    throw new Error('invalid canvas node name')
  const brief = typeof value.brief === 'string' ? value.brief.trim().slice(0, 8000) : ''
  return { id, name, brief, extras: extrasOf(value, ['id', 'name', 'brief']) }
}

function parsePosition(value: unknown): CanvasPosition {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y))
    throw new Error('invalid canvas node')
  return { x: value.x, y: value.y }
}

function parseLink(value: unknown): { link: CanvasLink, extras: Record<string, unknown> } {
  if (!isRecord(value))
    throw new Error('invalid canvas link')
  return {
    link: {
      id: asId(value.id),
      source: asId(value.source),
      target: asId(value.target),
    },
    extras: extrasOf(value, LINK_KEYS),
  }
}

function parseLegacyLink(value: unknown): { id: string, source: string, target: string, extras: Record<string, unknown> } {
  if (!isRecord(value))
    throw new Error('invalid canvas link')
  return {
    id: asId(value.id),
    source: asId(value.source),
    target: asId(value.target),
    extras: extrasOf(value, ['id', 'source', 'target']),
  }
}

function linkKey(link: { link: CanvasLink }): string {
  return [link.link.source, link.link.target].sort().join('\0')
}

function extrasOf(value: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!known.includes(key))
      extras[key] = item
  }
  return extras
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || value === '')
    throw new Error('invalid project canvas')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
