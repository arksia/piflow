export const AUTH_COOKIE = 'piflow_token'

interface RequestMessage {
  requestId: string
}

export type ClientMessage
  = | { type: 'list_sessions' }
    | { type: 'list_models' }
    | ({ type: 'open', path: string } & RequestMessage)
    | ({ type: 'new' } & RequestMessage)
    | { type: 'prompt', key: string, text: string }
    | { type: 'set_model', key: string, provider: string, modelId: string }
    | { type: 'set_thinking', key: string, level: string }
    | { type: 'get_usage', key?: string, provider?: string }
    | { type: 'abort', key: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'string')
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch {
    return null
  }

  if (!isRecord(value) || typeof value.type !== 'string')
    return null

  switch (value.type) {
    case 'list_sessions':
    case 'list_models':
      return { type: value.type }
    case 'open':
      return hasStrings(value, ['requestId', 'path']) ? value as ClientMessage : null
    case 'new':
      return hasStrings(value, ['requestId']) ? value as ClientMessage : null
    case 'prompt':
      return hasStrings(value, ['key', 'text']) ? value as ClientMessage : null
    case 'set_model':
      return hasStrings(value, ['key', 'provider', 'modelId']) ? value as ClientMessage : null
    case 'set_thinking':
      return hasStrings(value, ['key', 'level']) ? value as ClientMessage : null
    case 'get_usage':
      return typeof value.key === 'string' || typeof value.provider === 'string'
        ? value as ClientMessage
        : null
    case 'abort':
      return hasStrings(value, ['key']) ? value as ClientMessage : null
    default:
      return null
  }
}

export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host)
    return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host
  }
  catch {
    return false
  }
}

export function hasAuthCookie(header: string | undefined, token: string): boolean {
  return header?.split(';').some((part) => {
    const [name, value] = part.trim().split('=', 2)
    return name === AUTH_COOKIE && value === token
  }) ?? false
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

export function isValidAccessToken(token: string): boolean {
  return token.length >= 24 && /^[\w-]+$/.test(token)
}
