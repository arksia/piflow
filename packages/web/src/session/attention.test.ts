import type { SessionStatusRecord } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sessionAttention, sessionNeedsInputFor, sessionRailStatus, sessionStatusFor } from './attention'

function status(
  sessionFile: string,
  value: SessionStatusRecord['status'],
  updatedAt: string,
  needsInputAt: string | null = null,
): SessionStatusRecord {
  return { key: sessionFile, sessionFile, status: value, needsInputAt, updatedAt }
}

describe('session attention', () => {
  it('defaults missing status to idle and reports pending input', () => {
    assert.equal(sessionStatusFor('/project/missing.jsonl', {}), 'idle')
    assert.equal(sessionNeedsInputFor('/project/a.jsonl', {
      '/project/a.jsonl': status('/project/a.jsonl', 'running', 't1', 't1'),
    }), true)
  })

  it('prioritizes input and failure over running and unread states', () => {
    const statuses: Record<string, SessionStatusRecord> = {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', 't1'),
      '/project/b.jsonl': status('/project/b.jsonl', 'running', 't1', 't1'),
      '/project/c.jsonl': status('/project/c.jsonl', 'running', 't1'),
    }
    assert.deepEqual(sessionAttention('/project/b.jsonl', statuses), { kind: 'needs_input', label: '待回答' })
    assert.deepEqual(sessionAttention('/project/a.jsonl', statuses), { kind: 'failed', label: '失败' })
    assert.deepEqual(sessionAttention('/project/c.jsonl', statuses), { kind: 'running', label: '运行中' })
    assert.deepEqual(sessionAttention('/project/c.jsonl', {}, new Set(['/project/c.jsonl'])), { kind: 'unread', label: '已完成' })
    assert.equal(sessionAttention('/project/missing.jsonl', {}), null)
  })

  it('marks rail attention and hides a failure after that occurrence was opened', () => {
    const statuses: Record<string, SessionStatusRecord> = {
      '/project/a.jsonl': status('/project/a.jsonl', 'failed', 't1'),
    }
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
