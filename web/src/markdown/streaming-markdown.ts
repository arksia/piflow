interface MarkdownSegment {
  key: string
  text: string
}

interface SegmentedMarkdown {
  frozen: MarkdownSegment[]
  active: string
}

const ORDERED_LIST_RE = /^\s{0,3}\d+[.)]\s+/
const UNORDERED_LIST_RE = /^\s{0,3}[*+-]\s+/
const LIST_CONTINUATION_RE = /^(?:\s{2,}|\t+)/
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/
const SETEXT_HEADING_RE = /^ {0,3}(?:=+|-+)\s*$/
const BLOCKQUOTE_RE = /^ {0,3}> ?/
const FENCE_START_RE = /^ {0,3}(`{3,}|~{3,})/
const HTML_BLOCK_RE = /^ {0,3}<[a-z][\w:-]*(?:\s|>|$)/i
const DISPLAY_MATH_START_RE = /^ {0,3}\$\$\s*$/
const BRACKET_MATH_START_RE = /^ {0,3}\\\[\s*$/

export function segmentMarkdownForStreaming(markdown: string): SegmentedMarkdown {
  if (!markdown)
    return { frozen: [], active: '' }

  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  const blocks = tokenizeMarkdownBlocks(lines, lineBreak)
  if (blocks.length <= 1)
    return { frozen: [], active: markdown }

  const frozenBlocks = blocks.slice(0, -1)
  const active = blocks[blocks.length - 1] ?? ''
  let offset = 0
  const frozen = frozenBlocks.map((text) => {
    const key = `frozen:${offset}`
    offset += text.length
    return { key, text }
  })
  return { frozen, active }
}

function tokenizeMarkdownBlocks(lines: string[], lineBreak: string): string[] {
  const blocks: string[] = []
  let index = 0
  let leadingBlanks: string[] = []

  while (index < lines.length) {
    while (index < lines.length && isBlankLine(lines[index]))
      leadingBlanks.push(lines[index++] ?? '')

    if (index >= lines.length)
      break

    const { nextIndex, content } = readMarkdownBlock(lines, index)
    index = nextIndex

    const trailingBlanks: string[] = []
    while (index < lines.length && isBlankLine(lines[index]))
      trailingBlanks.push(lines[index++] ?? '')

    blocks.push([...leadingBlanks, ...content, ...trailingBlanks].join(lineBreak))
    leadingBlanks = []
  }

  if (!blocks.length)
    return [lines.join(lineBreak)]

  if (leadingBlanks.length)
    blocks[blocks.length - 1] += lineBreak + leadingBlanks.join(lineBreak)

  return blocks
}

function readMarkdownBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const line = lines[startIndex] ?? ''

  if (isFenceStart(line))
    return readFenceBlock(lines, startIndex)

  if (isDisplayMathStart(line) || isBracketMathStart(line))
    return readDelimitedBlock(lines, startIndex, isDisplayMathStart(line) ? /^ {0,3}\$\$\s*$/ : /^ {0,3}\\\]\s*$/)

  if (isBlockquoteStart(line))
    return readBlockquoteBlock(lines, startIndex)

  if (isListStart(line))
    return readListBlock(lines, startIndex)

  if (isTableStart(lines, startIndex))
    return readTableBlock(lines, startIndex)

  if (isHtmlBlockStart(line))
    return readHtmlBlock(lines, startIndex)

  if (isSingleLineBlock(line))
    return { nextIndex: startIndex + 1, content: [line] }

  return readParagraphBlock(lines, startIndex)
}

function readFenceBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const opening = lines[startIndex] ?? ''
  const fenceMatch = opening.match(FENCE_START_RE)
  if (!fenceMatch)
    return { nextIndex: startIndex + 1, content: [opening] }

  const marker = fenceMatch[1]![0]!
  const size = fenceMatch[1]!.length
  const content = [opening]
  let index = startIndex + 1

  while (index < lines.length) {
    const line = lines[index] ?? ''
    content.push(line)
    if (new RegExp(`^ {0,3}${escapeForRegExp(marker)}{${size},}\\s*$`).test(line)) {
      index++
      break
    }
    index++
  }

  return { nextIndex: index, content }
}

function readDelimitedBlock(
  lines: string[],
  startIndex: number,
  closePattern: RegExp,
): { nextIndex: number, content: string[] } {
  const content = [lines[startIndex] ?? '']
  let index = startIndex + 1

  while (index < lines.length) {
    const line = lines[index] ?? ''
    content.push(line)
    index++
    if (closePattern.test(line))
      break
  }

  return { nextIndex: index, content }
}

function readBlockquoteBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const content: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlankLine(line)) {
      const nextLine = readNextNonBlankLine(lines, index + 1)
      if (nextLine && isBlockquoteStart(nextLine)) {
        content.push(line)
        index++
        continue
      }
      break
    }

    if (!isBlockquoteStart(line))
      break

    content.push(line)
    index++
  }

  return { nextIndex: index, content }
}

function readListBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const content: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlankLine(line)) {
      const nextLine = readNextNonBlankLine(lines, index + 1)
      if (nextLine && (isListStart(nextLine) || isListContinuation(nextLine))) {
        content.push(line)
        index++
        continue
      }
      break
    }

    if (!isListStart(line) && !isListContinuation(line))
      break

    content.push(line)
    index++
  }

  return { nextIndex: index, content }
}

function readTableBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const content = [lines[startIndex] ?? '', lines[startIndex + 1] ?? '']
  let index = startIndex + 2

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlankLine(line) || !isTableRow(line))
      break
    content.push(line)
    index++
  }

  return { nextIndex: index, content }
}

function readHtmlBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const content = [lines[startIndex] ?? '']
  let index = startIndex + 1

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlankLine(line))
      break
    content.push(line)
    index++
  }

  return { nextIndex: index, content }
}

function readParagraphBlock(lines: string[], startIndex: number): { nextIndex: number, content: string[] } {
  const content: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlankLine(line))
      break

    if (content.length > 0 && startsNewBlock(lines, index))
      break

    content.push(line)
    index++

    if (content.length === 1 && index < lines.length && isSetextHeadingUnderline(lines[index])) {
      content.push(lines[index] ?? '')
      index++
      break
    }
  }

  return { nextIndex: index, content }
}

function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return (
    isFenceStart(line)
    || isDisplayMathStart(line)
    || isBracketMathStart(line)
    || isBlockquoteStart(line)
    || isListStart(line)
    || isTableStart(lines, index)
    || isHtmlBlockStart(line)
    || isSingleLineBlock(line)
  )
}

function isBlankLine(line: string | undefined): boolean {
  return !line || line.trim() === ''
}

function isFenceStart(line: string): boolean {
  return FENCE_START_RE.test(line)
}

function isDisplayMathStart(line: string): boolean {
  return DISPLAY_MATH_START_RE.test(line)
}

function isBracketMathStart(line: string): boolean {
  return BRACKET_MATH_START_RE.test(line)
}

function isBlockquoteStart(line: string): boolean {
  return BLOCKQUOTE_RE.test(line)
}

function isListStart(line: string): boolean {
  return ORDERED_LIST_RE.test(line) || UNORDERED_LIST_RE.test(line)
}

function isListContinuation(line: string): boolean {
  return LIST_CONTINUATION_RE.test(line)
}

function isTableStart(lines: string[], index: number): boolean {
  const current = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return isTableRow(current) && isTableDivider(next)
}

function isTableRow(line: string): boolean {
  return line.includes('|')
}

function isHtmlBlockStart(line: string): boolean {
  return HTML_BLOCK_RE.test(line)
}

function isSingleLineBlock(line: string): boolean {
  return ATX_HEADING_RE.test(line) || isThematicBreak(line)
}

function isSetextHeadingUnderline(line: string | undefined): boolean {
  return !!line && SETEXT_HEADING_RE.test(line)
}

function readNextNonBlankLine(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index]
    if (!isBlankLine(line))
      return line ?? null
  }
  return null
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!trimmed)
    return false

  const cells = trimmed.split('|').map(cell => cell.trim())
  return cells.length > 0 && cells.every((cell) => {
    if (!cell)
      return false
    const normalized = cell.replace(/:/g, '')
    return normalized.length >= 3 && /^-+$/.test(normalized)
  })
}

function isThematicBreak(line: string): boolean {
  const normalized = line.trim().replace(/[ \t]/g, '')
  if (normalized.length < 3)
    return false
  return /^-+$/.test(normalized) || /^\*+$/.test(normalized) || /^_+$/.test(normalized)
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
