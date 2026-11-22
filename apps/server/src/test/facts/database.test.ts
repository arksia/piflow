import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import { openDatabase } from '../../facts/database.ts'
import { createFactsStore } from '../../facts/store.ts'
import { openRunStore } from '../../runs/store.ts'

it('keeps one lease for both stores and releases it only at owner close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-owner-'))
  const database = await openDatabase(root)
  try {
    const runs = await openRunStore(root, database)
    const facts = createFactsStore(database)
    const fact = facts.beginSubmission({ projectPath: root, sessionId: 's', sessionPath: join(root, 's.jsonl'), text: 'x' })
    await runs.close()
    await assert.rejects(openDatabase(root), /另一个/)
    assert.equal(facts.readSubmission(root, fact.id)?.status, 'accepted')
    facts.observeQueued(fact.id)
    assert.equal(facts.readSubmission(root, fact.id)?.observation, 'queued-or-handled')
    database.close()
    database.close()
    const reopened = await openDatabase(root)
    try {
      const restored = createFactsStore(reopened)
      restored.recover()
      assert.equal(restored.readSubmission(root, fact.id)?.observation, 'execution-uncertain')
      assert.equal(restored.readSubmission(root, fact.id)?.settledAt, null)
    }
    finally { reopened.close() }
  }
  finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses future schemas without leaking the writer lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-future-'))
  try {
    const db = new DatabaseSync(join(root, 'runs.sqlite'))
    db.exec('PRAGMA user_version=999')
    db.close()
    await assert.rejects(openDatabase(root), /更新/)
    await assert.rejects(openDatabase(root), /更新/)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
