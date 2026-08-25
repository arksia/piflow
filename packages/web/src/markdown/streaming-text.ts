interface TextNode {
  type: 'text'
  value: string
}

interface ElementNode {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: HastNode[]
}

interface HastNode {
  type: string
  children?: HastNode[]
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
}

interface ParentNode extends HastNode {
  children: HastNode[]
}

const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'stream-text'])
const TAIL_PARENT_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function isTextNode(node: HastNode): node is TextNode {
  return node.type === 'text' && typeof node.value === 'string' && node.value.length > 0
}

function isElementNode(node: HastNode): node is ElementNode {
  return node.type === 'element' && typeof node.tagName === 'string' && Array.isArray(node.children)
}

function isParentNode(node: HastNode): node is ParentNode {
  return Array.isArray(node.children)
}

function hasClass(node: ElementNode, className: string): boolean {
  const value = node.properties?.className
  return Array.isArray(value) ? value.includes(className) : value === className
}

function transformChildren(parent: ParentNode, insideSkippedElement: boolean) {
  const skip = insideSkippedElement || (
    isElementNode(parent)
    && (SKIP_TAGS.has(parent.tagName) || hasClass(parent, 'katex'))
  )
  const children: HastNode[] = []

  for (const child of parent.children) {
    if (isTextNode(child) && child.value.trim() && !skip) {
      children.push({
        type: 'element',
        tagName: 'stream-text',
        properties: {},
        children: [{ type: 'text', value: child.value }],
      })
      continue
    }

    if (isElementNode(child))
      transformChildren(child, skip)
    children.push(child)
  }

  parent.children = children
}

function tailNode(): ElementNode {
  return {
    type: 'element',
    tagName: 'stream-tail',
    properties: {},
    children: [],
  }
}

function appendTail(parent: ParentNode): boolean {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index]
    if (!child || !isElementNode(child))
      continue
    if (SKIP_TAGS.has(child.tagName) || hasClass(child, 'katex'))
      continue
    if (TAIL_PARENT_TAGS.has(child.tagName)) {
      child.children.push(tailNode())
      return true
    }
    if (appendTail(child))
      return true
  }
  return false
}

export function rehypeStreamingText(options?: { tail?: boolean }) {
  return (tree: HastNode) => {
    if (isParentNode(tree)) {
      transformChildren(tree, false)
      if (options?.tail && !appendTail(tree))
        tree.children.push(tailNode())
    }
  }
}
