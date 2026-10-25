import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ServerMessage, SessionState, SessionStatusRecord } from '@piflow/protocol'
import type { FastifyReply } from 'fastify'
import type { ServerResponse } from 'node:http'
import type { ExtensionManager } from '../../extensions/manager'
import type { FlowStore } from '../../flow/store'
import type { ProviderAuthManager } from '../../providers/provider-auth'
import type { SseHub } from '../../server/sse'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_EVENTS_PATH } from '@piflow/protocol'
import { build } from '../../app'
import { AUTH_COOKIE } from '../../auth'
import { loadConfig } from '../../server/config'
import { createSseHub } from '../../server/sse'

const token = '0123456789abcdef0123456789abcdef'

function testApp(sse: SseHub) {
  return build({
    config: loadConfig({ HOST: '127.0.0.1', PIFLOW_TOKEN: token, PORT: '3141' }),
    extensions: {} as ExtensionManager,
    flow: {} as FlowStore,
    getUsage: async () => null,
    logger: false,
    modelRuntime: {} as ModelRuntime,
    providerAuth: {} as ProviderAuthManager,
    serveStatic: async (res: ServerResponse) => {
      res.end()
    },
    sessions: { disposeAll: async () => {}, get: () => undefined } as unknown as SessionStore,
    sse,
  })
}

function client() {
  const sent: ServerMessage[] = []
  const reply = {
    sse: {
      isConnected: true,
      keepAlive() {},
      onClose() {},
      send(message: { data: ServerMessage }) {
        sent.push(message.data)
        return Promise.resolve()
      },
    },
  } as unknown as FastifyReply
  return { reply, sent }
}

it('writes hello and the snapshots as event-stream frames', async () => {
  const sse = createSseHub('/project')
  const snapshot: SessionStatusRecord[] = [
    { key: 'session-a', sessionFile: '/project/a.jsonl', status: 'idle', needsInputAt: null, updatedAt: '2024-01-01T00:00:00Z' },
  ]
  const state = {
    key: 'session-a',
    cwd: '/project',
    messages: [],
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    context: null,
    queue: { steering: [], followUp: [] },
    extensionRequests: [],
    error: null,
  } satisfies SessionState
  sse.setStatusSnapshotProvider(() => snapshot)
  sse.setStateSnapshotProvider(() => [state])
  const app = await testApp({
    ...sse,
    open(reply) {
      sse.open(reply)
      reply.sse.close()
    },
  })
  const response = await app.inject({
    headers: { accept: 'text/event-stream', cookie: `${AUTH_COOKIE}=${token}` },
    method: 'GET',
    url: API_EVENTS_PATH,
  })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /data: \{"type":"hello","cwd":"\/project"\}/)
  assert.match(response.body, /data: \{"type":"status_snapshot","statuses":\[\{"key":"session-a"/)
  assert.match(response.body, /data: \{"type":"state","state":\{"key":"session-a"/)
  await app.close()
})

it('broadcasts delta messages to connected clients', () => {
  const sse = createSseHub('/project')
  const first = client()
  const second = client()
  sse.open(first.reply)
  sse.open(second.reply)
  const delta: SessionStatusRecord = { key: 'session-b', sessionFile: null, status: 'running', needsInputAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' }
  sse.broadcast({ type: 'status_delta', status: delta })
  assert.deepEqual(first.sent.at(-1), { type: 'status_delta', status: delta })
  assert.deepEqual(second.sent.at(-1), { type: 'status_delta', status: delta })
})
