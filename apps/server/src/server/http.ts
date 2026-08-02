import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

export function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

export async function readBody<T extends object = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000)
      throw new Error('request body too large')
  }
  return (body ? JSON.parse(body) : {}) as T
}

export type StaticHandler = (res: ServerResponse, path: string) => Promise<void>

export function createStaticHandler(webDist: string): StaticHandler {
  return async (res, path) => {
    let file = normalize(join(webDist, path))
    if (!file.startsWith(webDist)) {
      res.writeHead(403).end()
      return
    }
    if (path === '/' || !existsSync(file))
      file = join(webDist, 'index.html')
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
    }
    catch {
      res.writeHead(404).end()
    }
  }
}
