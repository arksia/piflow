import type { FactsDatabase } from './database.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export type SubmissionObservation = 'legacy' | 'host-accepted' | 'prompt-returned' | 'queued-or-handled' | 'prompt-rejected' | 'execution-uncertain'

export type SubmissionStatus = 'accepted' | 'settled' | 'failed'

export interface SubmissionFact {
  id: string
  projectPath: string
  sessionId: string
  sessionPath: string
  status: SubmissionStatus
  observation: SubmissionObservation
  inputDigest: string
  createdAt: string
  settledAt: string | null
}

export function createFactsStore(database: FactsDatabase) {
  const { db, transaction } = database

  function ensureSession(projectPath: string, sessionId: string, sessionPath: string, createdAt: string) {
    db.prepare('INSERT INTO projects(path,created_at) VALUES(?,?) ON CONFLICT(path) DO NOTHING').run(projectPath, createdAt)
    db.prepare(`INSERT INTO sessions(id,project_path,native_path,created_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO NOTHING`).run(sessionId, projectPath, sessionPath, createdAt)
    const existing = db.prepare('SELECT project_path,native_path FROM sessions WHERE id=?').get(sessionId)
    if (existing?.project_path !== projectPath || existing?.native_path !== sessionPath)
      throw new Error(`pi Session identity is already registered to another project: ${sessionId}`)
  }

  function registerSession(projectPath: string, sessionId: string, sessionPath: string) {
    const now = new Date().toISOString()
    transaction(() => {
      ensureSession(projectPath, sessionId, sessionPath, now)
    })
  }

  function beginSubmission(input: { projectPath: string, sessionId: string, sessionPath: string, text: string, images?: readonly { mimeType: string, data: string }[] }) {
    const fact: SubmissionFact = {
      id: crypto.randomUUID(),
      projectPath: input.projectPath,
      sessionId: input.sessionId,
      sessionPath: input.sessionPath,
      status: 'accepted',
      observation: 'host-accepted',
      inputDigest: hashInput(input.text, input.images),
      createdAt: new Date().toISOString(),
      settledAt: null,
    }
    transaction(() => {
      ensureSession(input.projectPath, input.sessionId, input.sessionPath, fact.createdAt)
      db.prepare(`INSERT INTO submissions(id,project_path,session_id,session_path,status,input_digest,created_at,settled_at,observation)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(fact.id, fact.projectPath, fact.sessionId, fact.sessionPath, fact.status, fact.inputDigest, fact.createdAt, fact.settledAt, fact.observation)
    })
    return fact
  }

  function settleSubmission(id: string, status: Extract<SubmissionStatus, 'settled' | 'failed'>) {
    const settledAt = new Date().toISOString()
    const result = db.prepare(`UPDATE submissions SET status=?,settled_at=?,observation=? WHERE id=? AND status='accepted'`).run(status, settledAt, status === 'settled' ? 'prompt-returned' : 'prompt-rejected', id)
    if (Number(result.changes) !== 1)
      throw new Error(`submission is not pending: ${id}`)
  }

  function readSubmission(projectPath: string, id: string): SubmissionFact | undefined {
    const row = db.prepare(`SELECT id,project_path,session_id,session_path,status,input_digest,created_at,settled_at,observation
      FROM submissions WHERE project_path=? AND id=?`).get(projectPath, id)
    return row
      ? {
          id: String(row.id),
          projectPath: String(row.project_path),
          sessionId: String(row.session_id),
          sessionPath: String(row.session_path),
          status: String(row.status) as SubmissionStatus,
          observation: String(row.observation) as SubmissionObservation,
          inputDigest: String(row.input_digest),
          createdAt: String(row.created_at),
          settledAt: row.settled_at === null ? null : String(row.settled_at),
        }
      : undefined
  }

  return {
    beginSubmission,
    interruptSession(projectPath: string, sessionId: string) {
      db.prepare('UPDATE submissions SET observation=\'execution-uncertain\' WHERE project_path=? AND session_id=? AND status=\'accepted\'').run(projectPath, sessionId)
    },
    observeUncertain(id: string) {
      db.prepare('UPDATE submissions SET observation=\'execution-uncertain\' WHERE id=? AND status=\'accepted\'').run(id)
    },
    recover() {
      db.prepare('UPDATE submissions SET observation=\'execution-uncertain\' WHERE status=\'accepted\'').run()
    },
    observeQueued(id: string) {
      db.prepare('UPDATE submissions SET observation=\'queued-or-handled\' WHERE id=? AND status=\'accepted\'').run(id)
    },
    readSubmission,
    registerSession,
    settleSubmission,
  }
}

function hashInput(text: string, images?: readonly { mimeType: string, data: string }[]) {
  const hash = createHash('sha256')
  const part = (value: string) => hash.update(`${Buffer.byteLength(value)}:`).update(value)
  part(text)
  for (const image of images ?? []) {
    part(image.mimeType)
    part(image.data)
  }
  return hash.digest('hex')
}

export type FactsStore = Awaited<ReturnType<typeof createFactsStore>>
