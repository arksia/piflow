export interface FilterableItem {
  key: string
  label: unknown
  type?: string
  children?: FilterableItem[]
}

export function filterDropdownItems<T extends FilterableItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q)
    return items as T[]
  const out: T[] = []
  for (const item of items) {
    const self = textOf(item).includes(q)
    const children = item.children ? filterDropdownItems(item.children, q) : undefined
    if (self)
      out.push(item)
    else if (children?.length)
      out.push({ ...item, children })
  }
  return out
}

function textOf(item: FilterableItem) {
  return (typeof item.label === 'string' ? item.label : item.key).toLowerCase()
}
