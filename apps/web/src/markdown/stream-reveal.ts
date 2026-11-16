/** Bound presentation lag without splitting a UTF-16 surrogate pair. */
export function nextRevealLength(text: string, visible: number, elapsed: number): number {
  const remaining = text.length - visible
  if (remaining <= 0)
    return text.length
  const frame = Math.min(64, Math.max(0, elapsed)) / 32
  const step = Math.max(1, Math.ceil(Math.max(2, remaining / 5) * frame))
  let next = Math.min(text.length, Math.max(visible + step, text.length - 600))
  const previous = text.charCodeAt(next - 1)
  if (next < text.length && previous >= 0xD800 && previous <= 0xDBFF)
    next++
  return next
}
