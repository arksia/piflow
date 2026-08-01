/* eslint-disable react/dom-no-dangerously-set-innerhtml */
import { memo, startTransition, useEffect, useState } from 'react'

interface Props {
  code: string
  language?: string
  streaming?: boolean
}

function CodeBlock({ code, language, streaming = false }: Props) {
  const codeKey = `${language ?? ''}\u0000${code}`
  const [highlighted, setHighlighted] = useState<{ key: string, html: string } | null>(null)

  useEffect(() => {
    if (streaming)
      return

    let cancelled = false

    void import('../../shiki').then(async ({ getHighlightedCodeSnapshot, highlightCodeBlock }) => {
      const cached = getHighlightedCodeSnapshot(code, language)
      if (cached) {
        if (!cancelled)
          setHighlighted({ key: codeKey, html: cached })
        return
      }

      const nextHtml = await highlightCodeBlock(code, language)
      if (cancelled || !nextHtml)
        return
      startTransition(() => {
        setHighlighted({ key: codeKey, html: nextHtml })
      })
    })

    return () => {
      cancelled = true
    }
  }, [code, codeKey, language, streaming])

  const highlightedHtml = highlighted?.key === codeKey ? highlighted.html : null

  if (streaming || !highlightedHtml) {
    return (
      <pre className="md-code-block">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="md-code-shell"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  )
}

export default memo(CodeBlock)
