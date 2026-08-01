import { memo, useMemo } from 'react'
import { segmentMarkdownForStreaming } from '../../markdown/streaming-markdown'
import MarkdownView from '../MarkdownView'

interface Props {
  text: string
}

function StreamingMarkdownView({ text }: Props) {
  const segmented = useMemo(() => segmentMarkdownForStreaming(text), [text])

  return (
    <>
      {segmented.frozen.map(segment => (
        <MarkdownView key={segment.key} text={segment.text} />
      ))}
      {segmented.active ? <MarkdownView text={segmented.active} streaming /> : null}
    </>
  )
}

export default memo(StreamingMarkdownView)
