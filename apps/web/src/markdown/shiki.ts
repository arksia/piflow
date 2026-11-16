import type { BundledLanguage, BundledTheme } from 'shiki/bundle/web'
import { bundledLanguages, codeToHtml } from 'shiki/bundle/web'

const shikiTheme: BundledTheme = 'slack-dark'

const snippetCache = new Map<string, Promise<string> | string>()

export function normalizeCodeLanguage(language?: string): BundledLanguage | null {
  if (!language)
    return null

  const normalized = language.trim().toLowerCase()
  if (!normalized)
    return null

  return normalized in bundledLanguages ? normalized as BundledLanguage : null
}

export function getHighlightedCodeSnapshot(code: string, language?: string): string | null {
  const normalizedLanguage = normalizeCodeLanguage(language)
  if (!normalizedLanguage)
    return null

  const cacheKey = createSnippetCacheKey(code, normalizedLanguage)
  const cached = snippetCache.get(cacheKey)
  return typeof cached === 'string' ? cached : null
}

export function highlightCodeBlock(code: string, language?: string): Promise<string | null> {
  const normalizedLanguage = normalizeCodeLanguage(language)
  if (!normalizedLanguage)
    return Promise.resolve(null)

  const cacheKey = createSnippetCacheKey(code, normalizedLanguage)
  const cached = snippetCache.get(cacheKey)
  if (cached)
    return Promise.resolve(cached)

  const task = codeToHtml(code, {
    lang: normalizedLanguage,
    theme: shikiTheme,
  }).then((html) => {
    snippetCache.set(cacheKey, html)
    return html
  })

  snippetCache.set(cacheKey, task)
  return task
}

function createSnippetCacheKey(code: string, language: BundledLanguage): string {
  return `${shikiTheme}\u0000${language}\u0000${code}`
}
