import { memo, useEffect, useRef, useState } from 'react'
import { nextRevealLength } from '../../markdown/stream-reveal'
import MarkdownView from '../MarkdownView'

function StreamingMarkdownView({ text, streaming = true }: { text: string, streaming?: boolean }) {
  const [visible, setVisible] = useState(text)
  const progressRef = useRef(text)
  const lastFrameRef = useRef(0)

  useEffect(() => {
    if (!streaming)
      return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    function reveal(now: number) {
      const previous = text.startsWith(progressRef.current) ? progressRef.current : ''
      const elapsed = lastFrameRef.current ? now - lastFrameRef.current : 32
      if (elapsed >= 32 || motion.matches) {
        lastFrameRef.current = now
        progressRef.current = motion.matches ? text : text.slice(0, nextRevealLength(text, previous.length, elapsed))
        setVisible(progressRef.current)
      }
      if (progressRef.current !== text)
        frame = requestAnimationFrame(reveal)
    }
    frame = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(frame)
  }, [text, streaming])

  // Completion, abort and snapshots must never wait for a presentation queue.
  const displayed = streaming && text.startsWith(visible) ? visible : text
  return <MarkdownView text={displayed} streaming={streaming} tail={streaming} />
}

export default memo(StreamingMarkdownView)
