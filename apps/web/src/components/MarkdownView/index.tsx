import type { Components, Options as ReactMarkdownOptions } from 'react-markdown'
import { createContext, memo, use, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from '../../markdown/md'
import { rehypeStreamingText } from '../../markdown/streaming-text'
import CodeBlock from '../CodeBlock'

interface Props {
  text: string
  streaming?: boolean
  tail?: boolean
}

function StreamTailComponent() {
  return <span className="streaming-tail" aria-hidden="true" />
}

const StreamingContext = createContext(false)

const components: Components & { 'stream-tail': typeof StreamTailComponent } = {
  pre({ children }) {
    return <>{children}</>
  },
  'code': function MarkdownCode({ className, children, ...props }) {
    const streaming = use(StreamingContext)
    const language = className?.replace('language-', '').toLowerCase() ?? ''
    const raw = String(children).replace(/\n$/, '')
    const isBlock = className?.includes('language-') || raw.includes('\n')
    if (!isBlock) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      )
    }
    return <CodeBlock code={raw} language={language} streaming={streaming} />
  },
  'stream-tail': StreamTailComponent,
}

function MarkdownView({ text, streaming = false, tail = false }: Props) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(text), [text])
  const rehypePlugins = useMemo<NonNullable<ReactMarkdownOptions['rehypePlugins']>>(() => {
    if (!streaming)
      return markdownRehypePlugins ?? []
    return [...(markdownRehypePlugins ?? []), [rehypeStreamingText, { tail }]]
  }, [streaming, tail])

  return (
    <StreamingContext value={streaming}>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      </div>
    </StreamingContext>
  )
}

export default memo(MarkdownView)
