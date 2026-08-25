import { memo } from 'react'
import MarkdownView from '../MarkdownView'

interface Props {
  text: string
}

function StreamingMarkdownView({ text }: Props) {
  return <MarkdownView text={text} streaming tail />
}

export default memo(StreamingMarkdownView)
