import type { ComposerCommandHit } from '@piflow/protocol'

export interface AtToken {
  kind: 'at'
  query: string
  start: number
  end: number
  quoted: boolean
}

export interface SlashToken {
  kind: 'slash'
  query: string
  start: number
  end: number
}

export type ComposerToken = AtToken | SlashToken

export function composerToken(text: string, cursor: number): ComposerToken | null {
  const at = Math.max(0, Math.min(cursor, text.length))
  if (text.startsWith('/') && at >= 1) {
    const whitespace = text.search(/\s/)
    if (whitespace === -1)
      return { kind: 'slash', query: text.slice(1, at), start: 0, end: text.length }
    if (at < whitespace)
      return { kind: 'slash', query: text.slice(1, at), start: 0, end: whitespace }
  }
  const quoted = quotedAt(text, at)
  if (quoted)
    return quoted
  let start = at
  while (start > 0 && !/\s/.test(text[start - 1]!))
    start -= 1
  if (!text.startsWith('@', start) || !tokenBoundary(text, start))
    return null
  let end = start
  while (end < text.length && !/\s/.test(text[end]!))
    end += 1
  return { kind: 'at', query: text.slice(start + 1, at), start, end, quoted: false }
}

export function applyAt(text: string, token: AtToken, path: string): { text: string, cursor: number } {
  const directory = path.endsWith('/')
  const quote = token.quoted || /[\s"]/.test(path)
  const body = quote ? `@"${path}"` : `@${path}`
  const insert = directory ? body : `${body} `
  const cursor = token.start + insert.length - (directory && quote ? 1 : 0)
  return { text: text.slice(0, token.start) + insert + text.slice(token.end), cursor }
}

export function applyCommand(text: string, name: string): { text: string, cursor: number } {
  const nameEnd = text.search(/\s/)
  const end = nameEnd === -1 ? text.length : nameEnd
  const insert = `/${name} `
  return { text: insert + text.slice(end), cursor: insert.length }
}

export function filterCommands(commands: readonly ComposerCommandHit[], query: string): ComposerCommandHit[] {
  const q = query.toLowerCase()
  if (!q)
    return [...commands]
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command.name, q) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.command)
}

function quotedAt(text: string, cursor: number): AtToken | null {
  const before = text.slice(0, cursor)
  let quoteStart = -1
  let open = false
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== '"')
      continue
    open = !open
    if (open)
      quoteStart = i
  }
  if (!open || quoteStart < 1 || before[quoteStart - 1] !== '@' || !tokenBoundary(text, quoteStart - 1))
    return null
  const close = text.indexOf('"', quoteStart + 1)
  const end = close === -1 ? text.length : close + 1
  return {
    kind: 'at',
    query: text.slice(quoteStart + 1, cursor),
    start: quoteStart - 1,
    end,
    quoted: true,
  }
}

function tokenBoundary(text: string, index: number) {
  return index === 0 || /\s/.test(text[index - 1] ?? '')
}

function scoreCommand(name: string, query: string) {
  const bare = (name.startsWith('skill:') ? name.slice('skill:'.length) : name).toLowerCase()
  const full = name.toLowerCase()
  if (bare.startsWith(query) || full.startsWith(query))
    return 3
  if (bare.includes(query) || full.includes(query))
    return 2
  if (subsequence(bare, query) || subsequence(full, query))
    return 1
  return 0
}

function subsequence(name: string, query: string) {
  let index = 0
  for (const char of name) {
    if (char === query[index])
      index += 1
    if (index === query.length)
      return true
  }
  return false
}
