import type { FlowNode, SessionStatusRecord } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flowAttentionItems, sessionNeedsInputFor, sessionStatusFor } from './attention'

const nodes: FlowNode[] = [
  node('a', '/project/a.jsonl', 'Runtime'),
  node('b', '/project/b.jsonl', 'Canvas'),
  node('c', '/project/c.jsonl', 'Review'),
]

describe('Flow attention', () => {
  it('returns failed nodes oldest first', () => {
    const statuses: Record<string, SessionStatusRecord> = {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', '2026-08-29T10:02:00Z'),
      '/project/b.jsonl': status('/project/b.jsonl', 'running', '2026-08-29T10:00:00Z'),
      '/project/c.jsonl': status('/project/c.jsonl', 'failed', '2026-08-29T10:01:00Z'),
    }

    assert.deepEqual(flowAttentionItems(nodes, statuses).map(item => item.nodeId), ['c', 'a'])
  })

  it('returns sessions awaiting input before failed sessions', () => {
    const statuses: Record<string, SessionStatusRecord> = {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', '2026-08-29T10:00:00Z'),
      '/project/b.jsonl': status('/project/b.jsonl', 'running', '2026-08-29T10:02:00Z', '2026-08-29T10:02:00Z'),
    }

    assert.deepEqual(flowAttentionItems(nodes, statuses).map(item => [item.nodeId, item.reason]), [
      ['b', 'needs_input'],
      ['a', 'failed'],
    ])
    assert.equal(sessionNeedsInputFor('/project/b.jsonl', statuses), true)
  })

  it('defaults sessions without an authoritative record to idle', () => {
    assert.equal(sessionStatusFor('/project/missing.jsonl', {}), 'idle')
  })
})

function node(id: string, sessionPath: string, name: string): FlowNode {
  return {
    id,
    sessionPath,
    name,
    goal: '',
    position: { x: 0, y: 0 },
    createdAt: '2026-08-29T10:00:00Z',
    updatedAt: '2026-08-29T10:00:00Z',
  }
}

function status(
  sessionFile: string,
  value: SessionStatusRecord['status'],
  updatedAt: string,
  needsInputAt: string | null = null,
): SessionStatusRecord {
  return { key: sessionFile, sessionFile, status: value, needsInputAt, updatedAt }
}
