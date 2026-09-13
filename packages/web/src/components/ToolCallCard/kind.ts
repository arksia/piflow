const KINDS: Record<string, string> = {
  read: '读取',
  write: '写入',
  edit: '编辑',
  bash: '命令',
  grep: '搜索',
  find: '查找',
  ls: '列出',
  glob: '匹配',
}

export function toolKind(name: string) {
  return KINDS[name] ?? name
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
