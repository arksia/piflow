import MarkdownItShiki from '@shikijs/markdown-it'
import MarkdownIt from 'markdown-it'

export type Md = MarkdownIt

export function createMd(): Promise<Md> {
  const md = MarkdownIt({ html: false, linkify: true })
  return MarkdownItShiki({ theme: 'slack-dark' }).then((plugin) => {
    md.use(plugin)
    return md
  })
}
