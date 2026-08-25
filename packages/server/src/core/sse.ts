import type { ServerMessage, SessionStatusRecord } from '@piflow/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface SseHub {
  open: (req: IncomingMessage, res: ServerResponse) => void
  broadcast: (message: ServerMessage) => void
  setStatusSnapshotProvider: (provider: () => SessionStatusRecord[]) => void
}

export function createSseHub(cwd: string): SseHub {
  const clients = new Set<ServerResponse>()
  let statusSnapshotProvider: (() => SessionStatusRecord[]) | undefined

  function write(res: ServerResponse, message: ServerMessage) {
    res.write(`data: ${JSON.stringify(message)}\n\n`)
  }

  return {
    open(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders()
      clients.add(res)
      write(res, { type: 'hello', cwd })
      if (statusSnapshotProvider) {
        const statuses = statusSnapshotProvider()
        write(res, { type: 'status_snapshot', statuses })
      }
      const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
    },
    broadcast(message) {
      for (const res of clients)
        write(res, message)
    },
    setStatusSnapshotProvider(provider) {
      statusSnapshotProvider = provider
    },
  }
}
