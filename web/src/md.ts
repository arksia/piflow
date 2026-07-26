import MarkdownIt from "markdown-it";
import MarkdownItShiki from "@shikijs/markdown-it";

export type Md = MarkdownIt;

export function createMd(): Promise<Md> {
  const md = MarkdownIt({ html: false, linkify: true });
  return MarkdownItShiki({ theme: "slack-dark" as never }).then((plugin) => {
    md.use(plugin);
    return md;
  });
}
