export interface ConductorDraftModule {
  id: string
  name: string
  brief: string
}

export interface ConductorDraftLink {
  source: string
  target: string
}

export interface ConductorDraft {
  modules: ConductorDraftModule[]
  links: ConductorDraftLink[]
}

const FENCE_SOURCE = '```piflow-modules[^\\n]*\\n([\\s\\S]*?)```'

function fence(): RegExp {
  return new RegExp(FENCE_SOURCE, 'g')
}

export function parseConductorDraft(text: string): ConductorDraft | null {
  const blocks = [...text.matchAll(fence())]
  const json = blocks.at(-1)?.[1]
  if (json === undefined)
    return null
  let value: unknown
  try {
    value = JSON.parse(json)
  }
  catch {
    return null
  }
  if (!isRecord(value) || !Array.isArray(value.modules))
    return null
  const links = value.links === undefined ? [] : value.links
  if (!Array.isArray(links))
    return null
  const modules: ConductorDraftModule[] = []
  for (const item of value.modules) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '')
      return null
    modules.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : '',
      brief: typeof item.brief === 'string' ? item.brief : '',
    })
  }
  const parsedLinks: ConductorDraftLink[] = []
  for (const item of links) {
    if (!isRecord(item) || typeof item.source !== 'string' || typeof item.target !== 'string' || item.source === '' || item.target === '')
      return null
    parsedLinks.push({ source: item.source, target: item.target })
  }
  return { modules, links: parsedLinks }
}

/** Drop closed draft fences. An unclosed fence stays, because it is not a draft yet. */
export function stripConductorFences(text: string): string {
  return text.replace(fence(), '')
}

export function conductorDraftReady(value: unknown): value is ConductorDraft {
  if (!isRecord(value) || !Array.isArray(value.modules) || !Array.isArray(value.links))
    return false
  const modules: ConductorDraftModule[] = []
  for (const item of value.modules) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.brief !== 'string')
      return false
    modules.push({ id: item.id, name: item.name, brief: item.brief })
  }
  const links: ConductorDraftLink[] = []
  for (const item of value.links) {
    if (!isRecord(item) || typeof item.source !== 'string' || typeof item.target !== 'string')
      return false
    links.push({ source: item.source, target: item.target })
  }
  if (modules.length === 0 || new Set(modules.map(module => module.id)).size !== modules.length)
    return false
  const ids = new Set(modules.map(module => module.id))
  for (const module of modules) {
    const name = module.name.trim()
    const brief = module.brief.trim()
    if (!name || name.length > 80 || !brief || brief.length > 8000)
      return false
  }
  return links.every(link => link.source !== link.target && ids.has(link.source) && ids.has(link.target))
}

/**
 * Keep every current module and link. An existing module keeps its name and any
 * brief it already has. A draft fills a brief only when the current one is empty.
 * Modules the draft does not mention stay. New ids are minted for new modules and links.
 */
export function mergeConductorDraft(
  current: { modules: Array<{ id: string, name: string, brief: string }>, links: Array<{ id: string, source: string, target: string }> },
  draft: ConductorDraft,
  newId: () => string,
): { modules: Array<{ id: string, name: string, brief: string }>, links: Array<{ id: string, source: string, target: string }> } | null {
  if (!conductorDraftReady(draft))
    return null
  const currentById = new Map(current.modules.map(module => [module.id, module]))
  const idMap = new Map<string, string>()
  const modules = current.modules.map(module => ({ ...module }))
  for (const item of draft.modules) {
    const existing = currentById.get(item.id)
    if (existing) {
      idMap.set(item.id, existing.id)
      if (!existing.brief.trim()) {
        const target = modules.find(module => module.id === existing.id)
        if (target)
          target.brief = item.brief.trim()
      }
      continue
    }
    const id = newId()
    idMap.set(item.id, id)
    modules.push({ id, name: item.name.trim(), brief: item.brief.trim() })
  }
  const links = current.links.map(link => ({ ...link }))
  const seen = new Set(links.map(linkKey))
  for (const link of draft.links) {
    const source = idMap.get(link.source)
    const target = idMap.get(link.target)
    if (!source || !target || source === target)
      continue
    const key = linkKey({ source, target })
    if (seen.has(key))
      continue
    seen.add(key)
    links.push({ id: newId(), source, target })
  }
  return { modules, links }
}

function linkKey(link: { source: string, target: string }): string {
  return [link.source, link.target].sort().join('\0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
