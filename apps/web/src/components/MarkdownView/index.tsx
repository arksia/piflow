import type { ReactNode } from 'react'
import type { Components, Options as ReactMarkdownOptions } from 'react-markdown'
import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from '../../markdown/md'
import { rehypeStreamingText } from '../../markdown/streaming-text'
import CodeBlock from '../CodeBlock'
import StreamingText from '../StreamingText'

interface Props {
  text: string
  streaming?: boolean
  tail?: boolean
}

function StreamTextComponent({ children }: { children?: ReactNode }) {
  return <StreamingText>{children}</StreamingText>
}

function StreamTailComponent() {
  return <span className="streaming-tail" aria-hidden="true">▋</span>
}

function MarkdownView({ text, streaming = false, tail = false }: Props) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(text), [text])
  const rehypePlugins = useMemo<NonNullable<ReactMarkdownOptions['rehypePlugins']>>(() => {
    if (!streaming)
      return markdownRehypePlugins ?? []
    return [...(markdownRehypePlugins ?? []), [rehypeStreamingText, { tail }]]
  }, [streaming, tail])
  const components = useMemo<Components>(() => ({
    pre({ children }) {
      return <>{children}</>
    },
    code({ className, children, ...props }) {
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
    'stream-text': StreamTextComponent,
    'stream-tail': StreamTailComponent,
  }), [streaming])

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownView)
