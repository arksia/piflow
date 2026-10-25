import type { ServerMessage, SessionState, SessionStatusRecord } from '@piflow/protocol'
import type { FastifyReply } from 'fastify'

export interface SseHub {
  open: (reply: FastifyReply) => void
  broadcast: (message: ServerMessage) => void
  setStatusSnapshotProvider: (provider: () => SessionStatusRecord[]) => void
  setStateSnapshotProvider: (provider: () => SessionState[]) => void
}

export function createSseHub(cwd: string): SseHub {
  const clients = new Set<FastifyReply>()
  let statusSnapshotProvider: (() => SessionStatusRecord[]) | undefined
  let stateSnapshotProvider: (() => SessionState[]) | undefined

  function push(reply: FastifyReply, message: ServerMessage) {
    void reply.sse.send({ data: message }).catch(() => {
      clients.delete(reply)
    })
  }

  return {
    open(reply) {
      reply.sse.keepAlive()
      clients.add(reply)
      reply.sse.onClose(() => {
        clients.delete(reply)
      })
      push(reply, { type: 'hello', cwd })
      if (statusSnapshotProvider)
        push(reply, { type: 'status_snapshot', statuses: statusSnapshotProvider() })
      if (stateSnapshotProvider) {
        for (const state of stateSnapshotProvider())
          push(reply, { type: 'state', state })
      }
    },
    broadcast(message) {
      for (const reply of clients)
        push(reply, message)
    },
    setStatusSnapshotProvider(provider) {
      statusSnapshotProvider = provider
    },
    setStateSnapshotProvider(provider) {
      stateSnapshotProvider = provider
    },
  }
}
