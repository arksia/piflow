import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { AUTH_COOKIE, isLoopbackHost, isValidAccessToken } from '../auth'

export interface ServerConfig {
  port: number
  host: string
  rootCwd: string
  isLoopback: boolean
  authToken: string
  authHeader: string
  webDist: string
  dataDir: string
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_WEB_DIST = resolve(__dirname, '../../../web/dist')

export function loadConfig(env = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3141)
  const host = env.HOST ?? '127.0.0.1'
  const rootCwd = resolve(env.INIT_CWD ?? process.cwd())
  const isLoopback = isLoopbackHost(host)
  const configuredToken = env.PIFLOW_TOKEN

  if (!isLoopback && !configuredToken)
    throw new Error('PIFLOW_TOKEN is required when HOST is not a loopback address')
  if (configuredToken && !isValidAccessToken(configuredToken))
    throw new Error('PIFLOW_TOKEN must contain at least 24 URL-safe characters')

  const authToken = configuredToken ?? crypto.randomUUID()

  return {
    port,
    host,
    rootCwd,
    isLoopback,
    authToken,
    authHeader: `${AUTH_COOKIE}=${authToken}; HttpOnly; SameSite=Strict; Path=/`,
    webDist: DEFAULT_WEB_DIST,
    dataDir: resolve(env.PIFLOW_DATA_DIR ?? resolve(homedir(), '.piflow')),
  }
}
