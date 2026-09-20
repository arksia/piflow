import { memo, useLayoutEffect, useRef } from 'react'

interface Props {
  children?: React.ReactNode
}

interface TextChunk {
  key: number
  text: string
}

const MAX_CHUNKS = 24

function StreamChunk({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el)
      return
    void el.offsetWidth
    el.classList.add('is-in')
  }, [])
  return <span ref={ref} className="t-stream-w">{text}</span>
}

function StreamingText({ children }: Props) {
  const text = String(children ?? '')
  const previousRef = useRef('')
  const chunksRef = useRef<TextChunk[]>([])
  const nextKeyRef = useRef(0)
  const previous = previousRef.current
  let chunks = chunksRef.current

  if (text !== previous) {
    if (!previous || !text.startsWith(previous)) {
      chunks = [{ key: nextKeyRef.current++, text }]
    }
    else {
      const suffix = text.slice(previous.length)
      if (suffix) {
        chunks = [...chunks, { key: nextKeyRef.current++, text: suffix }]
        if (chunks.length > MAX_CHUNKS) {
          chunks = [
            { key: chunks[0]?.key ?? nextKeyRef.current++, text: previous },
            { key: nextKeyRef.current++, text: suffix },
          ]
        }
      }
    }
  }

  useLayoutEffect(() => {
    previousRef.current = text
    chunksRef.current = chunks
  }, [chunks, text])

  return (
    <>
      {chunks.map(chunk => (
        <StreamChunk key={chunk.key} text={chunk.text} />
      ))}
    </>
  )
}

export default memo(StreamingText)
