import type { Components } from 'react-markdown'
import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from '../../markdown/md'
import CodeBlock from '../CodeBlock'

interface Props {
  text: string
  streaming?: boolean
}

function MarkdownView({ text, streaming = false }: Props) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(text), [text])
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
  }), [streaming])

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownView)
