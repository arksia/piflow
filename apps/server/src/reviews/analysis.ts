import type { ReviewDocument, ReviewFile, ReviewGap, ReviewHunk, ReviewTarget } from '@piflow/protocol'
import type { SourceSnapshot } from './source.ts'
import type { SymbolIndex, SymbolRange } from './symbols.ts'
import { structuredPatch } from 'diff'
import { digest } from './source.ts'
import { changedLines, indexSymbols, symbolStatistics } from './symbols.ts'

export function compareSources(before: SourceSnapshot, after: SourceSnapshot, get: (hash: string) => string) {
  const files: ReviewFile[] = []
  const targets: ReviewTarget[] = []
  const hunks: Record<string, ReviewHunk[]> = Object.create(null)
  const gaps: ReviewGap[] = []
  const omit = new Set([...before.omitted, ...after.omitted].map(x => x.path))
  for (const entry of [...before.omitted, ...after.omitted]) {
    const id = digest(`${entry.path}:${entry.reason}`).slice(0, 24)
    if (!gaps.some(gap => gap.id === id))
      gaps.push({ id, kind: 'source-not-captured', path: entry.path, explanation: entry.reason, source: 'host' })
  }
  const beforeInventory = before.inventory ? new Set(before.inventory) : null
  const afterInventory = after.inventory ? new Set(after.inventory) : null
  function unknownMissing(snapshot: SourceSnapshot, inventory: Set<string> | null, path: string) {
    return !snapshot.files[path] && (inventory ? inventory.has(path) && !snapshot.absent?.includes(path) : !snapshot.complete)
  }
  let diffBudget = 0
  const deadline = performance.now() + 3000
  for (const path of [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()) {
    const oldHash = before.files[path]
    const newHash = after.files[path]
    if (oldHash === newHash || omit.has(path))
      continue
    if (unknownMissing(before, beforeInventory, path) || unknownMissing(after, afterInventory, path)) {
      gaps.push({ id: digest(`missing:${path}`).slice(0, 24), kind: 'comparison-unavailable', path, explanation: '一侧正文未采集，不能据此推断文件新增或删除。', source: 'host' })
      continue
    }
    const oldText = oldHash ? get(oldHash) : ''
    const newText = newHash ? get(newHash) : ''
    const patch = performance.now() < deadline && diffBudget < 8 * 1024 * 1024 ? structuredPatch(path, path, oldText, newText, undefined, undefined, { context: 3, timeout: 100, maxEditLength: 20000 }) : undefined
    if (!patch) {
      gaps.push({ id: digest(path).slice(0, 24), kind: 'diff-budget', path, explanation: 'Diff 超出计算或正文预算。', source: 'host' })
      continue
    }
    diffBudget += oldText.length + newText.length
    const fileId = digest(`${before.id}:${after.id}:${path}`).slice(0, 24)
    const rows: ReviewHunk[] = patch.hunks.map((hunk, i) => ({ id: `${fileId}:${i}`, oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines, lines: hunk.lines }))
    const supported = /\.[cm]?[jt]sx?$/i.test(path)
    let oldSymbols: SymbolRange[] = []
    let newSymbols: SymbolRange[] = []
    let oldIndex: SymbolIndex | undefined
    let newIndex: SymbolIndex | undefined
    if (supported) {
      try {
        oldIndex = indexSymbols(path, oldText, deadline)
        newIndex = indexSymbols(path, newText, deadline)
        oldSymbols = oldIndex.symbols.filter(s => s.kind !== 'test')
        newSymbols = newIndex.symbols.filter(s => s.kind !== 'test')
      }
      catch {
        oldSymbols = []
        newSymbols = []
        oldIndex = undefined
        newIndex = undefined
        gaps.push({ id: `${fileId}:symbols`, kind: 'symbol-budget', path, explanation: '函数解析未完成（语法或预算限制），保留为文件级变更。', source: 'host' })
      }
    }
    const fileTargets: ReviewTarget[] = []
    const pairedTargets = new Map<string, ReviewTarget>()
    for (const side of ['old', 'new'] as const) {
      for (const symbol of side === 'old' ? oldSymbols : newSymbols) {
        const ids = rows.filter(row => changedLines(row, side).some(line => line >= symbol.start && line <= symbol.end)).map(row => row.id)
        if (!ids.length)
          continue
        // A unique same-file name may pair two sides. Ambiguous callbacks stay separate.
        const unique = symbol.stable && oldSymbols.filter(s => s.key === symbol.key).length <= 1 && newSymbols.filter(s => s.key === symbol.key).length <= 1
        const existing = unique ? pairedTargets.get(symbol.key) : undefined
        const target = existing ?? { id: `${fileId}:symbol:${fileTargets.length}`, fileId, name: symbol.name, kind: 'function' as const, hunkIds: [] }
        target.hunkIds = [...new Set([...target.hunkIds, ...ids])]
        if (side === 'old') {
          target.oldStart = symbol.start
          target.oldEnd = symbol.end
        }
        else {
          target.newStart = symbol.start
          target.newEnd = symbol.end
        }
        if (!existing) {
          fileTargets.push(target)
          if (unique)
            pairedTargets.set(symbol.key, target)
        }
      }
    }
    const fileLevel = rows.filter(row => (['old', 'new'] as const).some(side => changedLines(row, side).some(line => !(side === 'old' ? oldSymbols : newSymbols).some(symbol => line >= symbol.start && line <= symbol.end))))
    if (fileLevel.length || !fileTargets.length)
      fileTargets.push({ id: `${fileId}:file`, fileId, name: supported ? '文件级变更' : '文件变更', kind: 'file', hunkIds: (fileLevel.length ? fileLevel : rows).map(row => row.id) })
    if (targets.length + fileTargets.length > 5000) {
      fileTargets.splice(0, fileTargets.length, { id: `${fileId}:file`, fileId, name: '文件变更', kind: 'file', hunkIds: rows.map(row => row.id) })
      oldIndex = undefined
      newIndex = undefined
      gaps.push({ id: `${fileId}:target-budget`, kind: 'target-budget', path, explanation: '函数对象超出总量预算，保留为文件级变更。', source: 'host' })
    }
    targets.push(...fileTargets)
    hunks[fileId] = rows
    files.push({ id: fileId, path, status: !oldHash ? 'added' : !newHash ? 'deleted' : 'modified', beforeDigest: oldHash, afterDigest: newHash, added: rows.reduce((n, h) => n + h.lines.filter(l => l.startsWith('+')).length, 0), removed: rows.reduce((n, h) => n + h.lines.filter(l => l.startsWith('-')).length, 0), hunkIds: rows.map(h => h.id), targetIds: fileTargets.map(t => t.id), languageSupported: supported, statistics: symbolStatistics(path, oldIndex, newIndex, rows, fileTargets) })
  }
  return { files, targets, hunks, gaps }
}
export function sourceDocuments(snapshot: SourceSnapshot, get: (hash: string) => string, onLimit?: () => void) {
  const documents: ReviewDocument[] = []
  const anchors = new Map<string, ReviewDocument>()
  for (const [path, hash] of Object.entries(snapshot.files)) {
    const kind = /^docs\/adr\/.*\.md$/i.test(path) ? 'adr' : /^docs\/design\/.*\.md$/i.test(path) ? 'design' : /^docs\/(?:requirements\/.*|PRD)\.md$/i.test(path) ? 'requirement' : null
    if (!kind)
      continue
    const text = get(hash)
    const lines = text.split('\n')
    let fence: { marker: string, size: number } | null = null
    for (let i = 0; i < lines.length; i++) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]!)?.[1]
      if (marker) {
        if (!fence)
          fence = { marker: marker[0]!, size: marker.length }
        else if (marker[0] === fence.marker && marker.length >= fence.size)
          fence = null
        continue
      }
      if (fence)
        continue
      const heading = /^#{1,6}[^\S\n]+(\S.*)$/.exec(lines[i]!)
      if (!heading)
        continue
      const title = heading[1]!.trim().replace(/#+$/, '').trim()
      const explicit = /\{#([\w-]+)\}$/.exec(title)?.[1] ?? /^(?:REQ|AC|DESIGN)-[\w-]+/.exec(title)?.[0]
      const anchor = explicit ?? title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
      if (documents.length >= 2000) {
        onLimit?.()
        return documents
      }
      documents.push({ id: digest(`${snapshot.id}:${path}:${i}`).slice(0, 24), path, anchor, title: title.replace(/\s*\{#[\w-]+\}$/, ''), kind, digest: hash, startLine: i + 1, stableAnchor: !!explicit })
      const doc = documents.at(-1)!
      const key = JSON.stringify([doc.path, doc.anchor])
      const previous = anchors.get(key)
      if (previous) {
        previous.stableAnchor = false
        doc.stableAnchor = false
      }
      else {
        anchors.set(key, doc)
      }
    }
  }
  return documents
}
export function documentText(doc: ReviewDocument, documents: ReviewDocument[], get: (hash: string) => string) {
  const lines = get(doc.digest).split('\n')
  const next = documents.filter(d => d.path === doc.path && d.startLine > doc.startLine).sort((a, b) => a.startLine - b.startLine)[0]
  return lines.slice(doc.startLine - 1, next ? next.startLine - 1 : undefined).join('\n')
}
