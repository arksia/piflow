const KINDS: Record<string, string> = {
  read: '读取',
  write: '写入',
  edit: '编辑',
  bash: '命令',
  grep: '搜索',
  find: '查找',
  ls: '列出',
  glob: '匹配',
  codemode: '脚本',
}

export function toolKind(name: string) {
  const known = KINDS[name]
  if (known)
    return known
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    const tool = parts.pop()
    const server = parts.slice(1).join('-')
    if (server && tool)
      return `${server}/${tool}`
  }
  return name
}

export function toolTarget(args: Record<string, unknown>) {
  const value = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? args.message ?? ''
  return String(value)
}

export function toolPath(args: Record<string, unknown>) {
  return typeof args.path === 'string' && args.path ? args.path : null
}

export function reviewOpenByDefault(status: 'running' | 'error' | 'done' | 'pending', hasDiff: boolean) {
  return status === 'error' || hasDiff
}
