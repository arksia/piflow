import { memo, useEffect, useMemo, useState } from 'react'
import { segmentMarkdownForStreaming } from '../../markdown/streaming-markdown'
import MarkdownView from '../MarkdownView'

interface Props {
  text: string
}

const reduceMotion = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Reveal the active segment gradually, one animation frame at a time.
 * The step grows with the backlog, so fast bursts catch up quickly
 * while normal token flow looks like steady typing.
 */
function useTypewriter(target: string): string {
  const [shown, setShown] = useState(target)

  useEffect(() => {
    if (reduceMotion)
      return
    let frame = requestAnimationFrame(function tick() {
      setShown((current) => {
        // snap when caught up or when the target changed to different content
        if (current === target || !target.startsWith(current))
          return target
        const backlog = target.length - current.length
        return target.slice(0, current.length + Math.max(1, Math.ceil(backlog / 6)))
      })
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [target])

  return reduceMotion ? target : shown
}

function StreamingMarkdownView({ text }: Props) {
  const segmented = useMemo(() => segmentMarkdownForStreaming(text), [text])
  const revealed = useTypewriter(segmented.active)

  return (
    <>
      {segmented.frozen.map(segment => (
        <MarkdownView key={segment.key} text={segment.text} />
      ))}
      {segmented.active ? <MarkdownView text={revealed} streaming /> : null}
    </>
  )
}

export default memo(StreamingMarkdownView)
