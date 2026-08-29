import type { SessionStatusRecord } from '@piflow/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { it } from 'node:test'
import { createSseHub } from './core/sse'

function mockRequest(): IncomingMessage {
  const req = new Readable({ read() {} }) as IncomingMessage
  req.destroy = () => req
  return req
}

function mockResponse(): { res: ServerResponse, chunks: string[] } {
  const chunks: string[] = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = () => res
  res.flushHeaders = () => {}
  return { res, chunks }
}

it('sends a status snapshot after hello on connect', () => {
  const sse = createSseHub('/project')
  const snapshot: SessionStatusRecord[] = [
    { key: 'session-a', sessionFile: '/project/a.jsonl', status: 'idle', needsInputAt: null, updatedAt: '2024-01-01T00:00:00Z' },
  ]
  sse.setStatusSnapshotProvider(() => snapshot)

  const req = mockRequest()
  const { res, chunks } = mockResponse()
  sse.open(req, res)

  const body = chunks.join('')
  assert.match(body, /data: \{"type":"hello","cwd":"\/project"\}/)
  assert.match(body, /data: \{"type":"status_snapshot","statuses":\[\{"key":"session-a","sessionFile":"\/project\/a.jsonl","status":"idle","needsInputAt":null,"updatedAt":"2024-01-01T00:00:00Z"\}\]\}/)
  req.emit('close')
})

it('broadcasts delta messages to connected clients', () => {
  const sse = createSseHub('/project')
  sse.setStatusSnapshotProvider(() => [])

  const firstReq = mockRequest()
  const secondReq = mockRequest()
  const firstRes = mockResponse()
  const secondRes = mockResponse()
  sse.open(firstReq, firstRes.res)
  sse.open(secondReq, secondRes.res)

  const delta: SessionStatusRecord = { key: 'session-b', sessionFile: null, status: 'running', needsInputAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' }
  sse.broadcast({ type: 'status_delta', status: delta })

  assert.match(firstRes.chunks.join(''), /data: \{"type":"status_delta","status":\{"key":"session-b","sessionFile":null,"status":"running"/)
  assert.match(secondRes.chunks.join(''), /data: \{"type":"status_delta","status":\{"key":"session-b","sessionFile":null,"status":"running"/)
  firstReq.emit('close')
  secondReq.emit('close')
})
