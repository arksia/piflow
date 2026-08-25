export const AUTH_COOKIE = 'piflow_token'

export function hasAuthCookie(header: string | undefined, token: string): boolean {
  return header?.split(';').some((part) => {
    const [name, value] = part.trim().split('=', 2)
    return name === AUTH_COOKIE && value === token
  }) ?? false
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
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

export function isValidAccessToken(token: string): boolean {
  return token.length >= 24 && /^[\w-]+$/.test(token)
}
