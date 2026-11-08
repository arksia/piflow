import type { ReviewDocument, ReviewFile, ReviewGap, ReviewHunk, ReviewTarget } from '@piflow/protocol'
import type { SourceSnapshot } from './source'
import { structuredPatch } from 'diff'
import ts from 'typescript'
import { digest } from './source'

interface SymbolRange {
  name: string
  start: number
  end: number
}
function symbols(path: string, text: string): SymbolRange[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: SymbolRange[] = []
  function visit(node: ts.Node, containers: string[]) {
    const named = node as ts.NamedDeclaration
    const name = named.name?.getText(source)
    const owner = name ? [...containers, name] : containers
    if (ts.isFunctionLike(node) && !ts.isCallSignatureDeclaration(node) && !ts.isConstructSignatureDeclaration(node)) {
      const parentName = ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ? node.parent.name.getText(source) : undefined
      const label = name || parentName || `callback@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
      found.push({ name: [...containers, label].join(' › '), start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, end: source.getLineAndCharacterOfPosition(node.end).line + 1 })
      ts.forEachChild(node, child => visit(child, [...containers, label]))
      return
    }
    ts.forEachChild(node, child => visit(child, ts.isClassDeclaration(node) || ts.isModuleDeclaration(node) ? owner : containers))
  }
  visit(source, [])
  return found
}
function changedLines(hunk: ReviewHunk, side: 'old' | 'new') {
  const result: number[] = []
  let line = side === 'old' ? hunk.oldStart : hunk.newStart
  for (const text of hunk.lines) {
    if (text.startsWith('\\'))
      continue
    if (text[0] === (side === 'old' ? '-' : '+'))
      result.push(line)
    if (text[0] !== (side === 'old' ? '+' : '-'))
      line++
  }
  return result
}
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
  let diffBudget = 0
  for (const path of [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()) {
    const oldHash = before.files[path]
    const newHash = after.files[path]
    if (oldHash === newHash || omit.has(path))
      continue
    const oldText = oldHash ? get(oldHash) : ''
    const newText = newHash ? get(newHash) : ''
    const patch = diffBudget < 8 * 1024 * 1024 ? structuredPatch(path, path, oldText, newText, undefined, undefined, { context: 3, timeout: 100, maxEditLength: 20000 }) : undefined
    if (!patch) {
      gaps.push({ id: digest(path).slice(0, 24), kind: 'diff-budget', path, explanation: 'Diff 超出计算或正文预算。', source: 'host' })
      continue
    }
    diffBudget += oldText.length + newText.length
    const fileId = digest(`${before.id}:${after.id}:${path}`).slice(0, 24)
    const rows: ReviewHunk[] = patch.hunks.map((hunk, i) => ({ id: `${fileId}:${i}`, oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines, lines: hunk.lines }))
    const supported = /\.[cm]?[jt]sx?$/i.test(path)
    const oldSymbols = supported ? symbols(path, oldText) : []
    const newSymbols = supported ? symbols(path, newText) : []
    const fileTargets: ReviewTarget[] = []
    for (const side of ['old', 'new'] as const) {
      for (const symbol of side === 'old' ? oldSymbols : newSymbols) {
        const ids = rows.filter(row => changedLines(row, side).some(line => line >= symbol.start && line <= symbol.end)).map(row => row.id)
        if (!ids.length)
          continue
        // A unique same-file name may pair two sides. Ambiguous callbacks stay separate.
        const unique = oldSymbols.filter(s => s.name === symbol.name).length <= 1 && newSymbols.filter(s => s.name === symbol.name).length <= 1
        const existing = unique ? fileTargets.find(t => t.name === symbol.name && t.kind === 'function') : undefined
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
        if (!existing)
          fileTargets.push(target)
      }
    }
    const fileLevel = rows.filter(row => (['old', 'new'] as const).some(side => changedLines(row, side).some(line => !(side === 'old' ? oldSymbols : newSymbols).some(symbol => line >= symbol.start && line <= symbol.end))))
    if (fileLevel.length || !fileTargets.length)
      fileTargets.push({ id: `${fileId}:file`, fileId, name: supported ? '文件级变更' : '文件变更', kind: 'file', hunkIds: (fileLevel.length ? fileLevel : rows).map(row => row.id) })
    targets.push(...fileTargets)
    hunks[fileId] = rows
    files.push({ id: fileId, path, status: !oldHash ? 'added' : !newHash ? 'deleted' : 'modified', beforeDigest: oldHash, afterDigest: newHash, added: rows.reduce((n, h) => n + h.lines.filter(l => l.startsWith('+')).length, 0), removed: rows.reduce((n, h) => n + h.lines.filter(l => l.startsWith('-')).length, 0), hunkIds: rows.map(h => h.id), targetIds: fileTargets.map(t => t.id), languageSupported: supported })
  }
  return { files, targets, hunks, gaps }
}
export function sourceDocuments(snapshot: SourceSnapshot, get: (hash: string) => string) {
  const documents: ReviewDocument[] = []
  for (const [path, hash] of Object.entries(snapshot.files)) {
    const kind = /^docs\/adr\/.*\.md$/i.test(path) ? 'adr' : /^docs\/design\/.*\.md$/i.test(path) ? 'design' : /^docs\/(?:requirements\/.*|PRD)\.md$/i.test(path) ? 'requirement' : null
    if (!kind)
      continue
    const text = get(hash)
    const lines = text.split('\n')
    let fenced = false
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:```|~~~)/.test(lines[i]!))
        fenced = !fenced
      if (fenced)
        continue
      const heading = /^#{1,6}[^\S\n]+(\S.*)$/.exec(lines[i]!)
      if (!heading)
        continue
      const title = heading[1]!.trim().replace(/#+$/, '').trim()
      const explicit = /\{#([\w-]+)\}$/.exec(title)?.[1] ?? /^(?:REQ|AC|DESIGN)-[\w-]+/.exec(title)?.[0]
      const anchor = explicit ?? title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
      documents.push({ id: digest(`${snapshot.id}:${path}:${i}`).slice(0, 24), path, anchor, title: title.replace(/\s*\{#[\w-]+\}$/, ''), kind, digest: hash, startLine: i + 1, stableAnchor: !!explicit })
    }
  }
  for (const doc of documents) {
    if (documents.filter(d => d.path === doc.path && d.anchor === doc.anchor).length > 1)
      doc.stableAnchor = false
  }
  return documents
}
export function documentText(doc: ReviewDocument, documents: ReviewDocument[], get: (hash: string) => string) {
  const lines = get(doc.digest).split('\n')
  const next = documents.filter(d => d.path === doc.path && d.startLine > doc.startLine).sort((a, b) => a.startLine - b.startLine)[0]
  return lines.slice(doc.startLine - 1, next ? next.startLine - 1 : undefined).join('\n')
}
