import type { ReactNode } from 'react'
import { useState } from 'react'
import Glide from '../Glide'
import { visibleTreeRows } from './tree'

interface SidebarTreeProps<T> {
  items: readonly T[]
  collapsed?: ReadonlySet<string>
  onToggle?: (id: string) => void
  getKey: (item: T) => string
  getChildren: (item: T) => readonly T[]
  renderItem: (item: T, state: { depth: number, hasChildren: boolean, collapsed: boolean, toggle: () => void }) => ReactNode
  pin?: string
  maxDepth?: number
}

export default function SidebarTree<T>({ items, collapsed: controlledCollapsed, onToggle, getKey, getChildren, renderItem, pin, maxDepth }: SidebarTreeProps<T>) {
  const [localCollapsed, setLocalCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const collapsed = controlledCollapsed ?? localCollapsed
  const rows = visibleTreeRows(items, collapsed, getKey, getChildren, maxDepth)

  function toggle(id: string) {
    if (!controlledCollapsed) {
      setLocalCollapsed((current) => {
        const next = new Set(current)
        if (next.has(id))
          next.delete(id)
        else
          next.add(id)
        return next
      })
    }
    onToggle?.(id)
  }

  return (
    <div onKeyDown={(event) => {
      if (!(event.target instanceof HTMLButtonElement) || event.target.hasAttribute('aria-haspopup') || event.target.closest('[role="menu"]'))
        return
      const container = event.target.closest<HTMLElement>('[data-tree-node]')
      const index = rows.findIndex(row => row.id === container?.dataset.treeNode)
      const row = rows[index]
      if (!row)
        return
      let target = index
      switch (event.key) {
        case 'ArrowDown':
          target = Math.min(index + 1, rows.length - 1)
          break
        case 'ArrowUp':
          target = Math.max(index - 1, 0)
          break
        case 'Home':
          target = 0
          break
        case 'End':
          target = rows.length - 1
          break
        case 'ArrowRight':
          if (row.hasChildren && row.collapsed)
            toggle(row.id)
          else if (row.hasChildren)
            target = index + 1
          break
        case 'ArrowLeft':
          if (row.hasChildren && !row.collapsed)
            toggle(row.id)
          else if (row.parentId)
            target = rows.findIndex(parent => parent.id === row.parentId)
          break
        default: return
      }
      event.preventDefault()
      if (target !== index)
        event.currentTarget.querySelector<HTMLElement>(`[data-tree-node="${CSS.escape(rows[target]!.id)}"] button:not(:disabled)`)?.focus()
    }}
    >
      <Glide pin={pin} className="[&[data-live]_[data-sidebar-row]]:pf-bg-transparent">
        {rows.map(row => (
          <div key={row.id} data-tree-node={row.id}>
            {renderItem(row.item, { depth: row.depth, hasChildren: row.hasChildren, collapsed: row.collapsed, toggle: () => toggle(row.id) })}
          </div>
        ))}
      </Glide>
    </div>
  )
}
