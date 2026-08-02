export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  const data: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (data as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `request failed: ${response.status}`)
  }
  return data as T
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

export function sessionUrl(key: string, action: string) {
  return `/api/sessions/${encodeURIComponent(key)}/${action}`
}
