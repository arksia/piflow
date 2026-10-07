import type { FlowNode, SessionStatusRecord } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flowAttentionItems, sessionAttention, sessionNeedsInputFor, sessionRailStatus, sessionStatusFor } from './attention'

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

  it('uses one quiet label set and only shouts for input or failure', () => {
    const statuses: Record<string, SessionStatusRecord> = {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', '2026-08-29T10:00:00Z'),
      '/project/b.jsonl': status('/project/b.jsonl', 'running', '2026-08-29T10:00:00Z', '2026-08-29T10:00:00Z'),
      '/project/c.jsonl': status('/project/c.jsonl', 'running', '2026-08-29T10:00:00Z'),
    }
    assert.deepEqual(sessionAttention('/project/b.jsonl', statuses), { kind: 'needs_input', label: '待回答' })
    assert.deepEqual(sessionAttention('/project/a.jsonl', statuses), { kind: 'failed', label: '失败' })
    assert.deepEqual(sessionAttention('/project/c.jsonl', statuses), { kind: 'running', label: '运行中' })
    assert.deepEqual(sessionAttention('/project/c.jsonl', {}, new Set(['/project/c.jsonl'])), { kind: 'unread', label: '已完成' })
    assert.equal(sessionAttention('/project/missing.jsonl', {}), null)
  })

  it('puts session status on the rail and drops a failure once that occurrence was opened', () => {
    const failed = status('/project/a.jsonl', 'failed', 't1')
    const statuses: Record<string, SessionStatusRecord> = { '/project/a.jsonl': failed }
    assert.equal(sessionRailStatus('/project/a.jsonl', statuses), 'error')
    assert.equal(sessionRailStatus('/project/a.jsonl', statuses, undefined, { '/project/a.jsonl': 't1' }), null)
    assert.equal(sessionRailStatus('/project/a.jsonl', {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', 't2'),
    }, undefined, { '/project/a.jsonl': 't1' }), 'error')
    assert.equal(sessionRailStatus('/project/b.jsonl', {
      '/project/b.jsonl': status('/project/b.jsonl', 'failed', 't1', 't1'),
    }), 'needs_input')
    assert.equal(sessionRailStatus('/project/c.jsonl', {
      '/project/c.jsonl': status('/project/c.jsonl', 'running', 't1'),
    }), 'working')
    assert.equal(sessionRailStatus('/project/c.jsonl', {}, new Set(['/project/c.jsonl'])), 'done')
    assert.equal(sessionRailStatus('/project/missing.jsonl', {}), null)
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
