import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { openDatabase } from '../../facts/database.ts'
import { createFactsStore } from '../../facts/store.ts'

it('commits submission identity and outcome without storing input text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-facts-'))
  const database = await openDatabase(join(root, 'data'))
  const facts = createFactsStore(database)
  try {
    const submission = facts.beginSubmission({
      projectPath: root,
      sessionId: 'session-1',
      sessionPath: join(root, 'session.jsonl'),
      text: 'private prompt text',
    })
    assert.equal(submission.status, 'accepted')
    assert.equal(submission.inputDigest.length, 64)
    assert.equal('text' in submission, false)
    assert.equal(facts.readSubmission(root, submission.id)?.status, 'accepted')
    assert.equal(facts.readSubmission(join(root, 'other-project'), submission.id), undefined)
    assert.throws(() => facts.beginSubmission({
      projectPath: join(root, 'other-project'),
      sessionId: 'session-1',
      sessionPath: join(root, 'other-session.jsonl'),
      text: 'wrong scope',
    }), /already registered/)

    facts.settleSubmission(submission.id, 'settled')
    assert.equal(facts.readSubmission(root, submission.id)?.status, 'settled')
    assert.throws(() => facts.settleSubmission(submission.id, 'failed'), /not pending/)
  }
  finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})
