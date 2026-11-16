export function visibleTreeRows<T>(items: readonly T[], collapsed: ReadonlySet<string>, getKey: (item: T) => string, getChildren: (item: T) => readonly T[], maxDepth = Number.POSITIVE_INFINITY) {
  const rows: { item: T, id: string, parentId?: string, depth: number, hasChildren: boolean, collapsed: boolean }[] = []
  function visit(nodes: readonly T[], depth: number, parentId?: string) {
    for (const item of nodes) {
      const id = getKey(item)
      const children = getChildren(item)
      rows.push({ item, id, parentId, depth: Math.min(depth, maxDepth), hasChildren: children.length > 0, collapsed: collapsed.has(id) })
      if (!collapsed.has(id))
        visit(children, depth + 1, id)
    }
  }
  visit(items, 0)
  return rows
}
