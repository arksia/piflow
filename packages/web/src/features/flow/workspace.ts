const PROJECT_KEY = 'piflow.flow-project'

export function readFlowProject(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ''
  }
  catch {
    return ''
  }
}

export function saveFlowProject(path: string): string {
  if (path)
    localStorage.setItem(PROJECT_KEY, path)
  return path
}
