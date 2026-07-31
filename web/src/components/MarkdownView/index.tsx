import { use } from 'react'
import { MdContext } from '../../md'

interface Props {
  text: string
}

export default function MarkdownView({ text }: Props) {
  const md = use(MdContext)
  if (!md)
    throw new Error('Markdown renderer not initialized')

  // MarkdownIt has raw HTML disabled; Shiki is the only HTML producer.
  // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
  return <div className="md" dangerouslySetInnerHTML={{ __html: md.render(text) }} />
}
