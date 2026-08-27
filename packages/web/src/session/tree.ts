import type { SessionInfoLite } from '@piflow/protocol'

/** Maximum rendered indent levels; deeper descendants align with this depth. */
export const MAX_TREE_INDENT = 3

export interface SessionTreeNode {
  session: SessionInfoLite
  children: SessionTreeNode[]
  /** Actual lineage depth (0 = root), uncapped. */
  depth: number
  /** Latest modified across the whole subtree — drives root ordering. */
  subtreeModified: string
}

/**
 * Builds a forest from a flat session list using parentSession links.
 * Sessions whose parent is missing (deleted or outside the list) become roots.
 */
export function buildSessionForest(sessions: SessionInfoLite[]): SessionTreeNode[] {
  const nodes = new Map<string, SessionTreeNode>()
  for (const session of sessions)
    nodes.set(session.path, { session, children: [], depth: 0, subtreeModified: session.modified })

  const roots: SessionTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.session.parentSession ? nodes.get(node.session.parentSession) : undefined
    if (parent && parent !== node)
      parent.children.push(node)
    else
      roots.push(node)
  }

  function finalize(node: SessionTreeNode, depth: number): string {
    node.depth = depth
    let latest = node.session.modified
    node.children.sort((a, b) => b.session.modified.localeCompare(a.session.modified))
    for (const child of node.children) {
      const childLatest = finalize(child, depth + 1)
      if (childLatest > latest)
        latest = childLatest
    }
    node.subtreeModified = latest
    return latest
  }

  for (const root of roots)
    finalize(root, 0)
  roots.sort((a, b) => b.subtreeModified.localeCompare(a.subtreeModified))
  return roots
}

export interface SessionTreeRow {
  node: SessionTreeNode
  /** Indent level for rendering, capped at MAX_TREE_INDENT. */
  indent: number
  hasChildren: boolean
}

/** Flattens the forest into render rows, skipping children of collapsed nodes. */
export function flattenSessionForest(forest: SessionTreeNode[], collapsed: ReadonlySet<string>): SessionTreeRow[] {
  const rows: SessionTreeRow[] = []
  function walk(node: SessionTreeNode) {
    rows.push({ node, indent: Math.min(node.depth, MAX_TREE_INDENT), hasChildren: node.children.length > 0 })
    if (!collapsed.has(node.session.path)) {
      for (const child of node.children)
        walk(child)
    }
  }
  for (const root of forest)
    walk(root)
  return rows
}

/** Paths of the session's ancestors, nearest first — the chain to expand on activate. */
export function sessionAncestors(sessions: SessionInfoLite[], path: string): string[] {
  const byPath = new Map(sessions.map(session => [session.path, session]))
  const chain: string[] = []
  let current = byPath.get(path)
  while (current?.parentSession && chain.length < sessions.length) {
    const parent = byPath.get(current.parentSession)
    if (!parent)
      break
    chain.push(parent.path)
    current = parent
  }
  return chain
}

/** Human-readable lineage for tooltips: "root label → … → parent label". */
export function sessionLineage(sessions: SessionInfoLite[], path: string): string | null {
  const byPath = new Map(sessions.map(session => [session.path, session]))
  const ancestors = sessionAncestors(sessions, path)
  if (ancestors.length === 0)
    return null
  return ancestors
    .reverse()
    .map(ancestorPath => byPath.get(ancestorPath))
    .filter((session): session is SessionInfoLite => session !== undefined)
    .map(session => session.name || session.firstMessage)
    .join(' → ')
}
