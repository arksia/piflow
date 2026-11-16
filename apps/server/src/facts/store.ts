import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SubmissionStatus = 'accepted' | 'settled' | 'failed'

export interface SubmissionFact {
  id: string
  projectPath: string
  sessionId: string
  sessionPath: string
  status: SubmissionStatus
  inputDigest: string
  createdAt: string
  settledAt: string | null
}

export async function openFactsStore(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const databasePath = join(dataDir, 'runs.sqlite')
  const db = new DatabaseSync(databasePath)
  await chmod(databasePath, 0o600)
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS projects (
      path TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path),
      native_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_path, native_path)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      session_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted', 'settled', 'failed')),
      input_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY(project_path, session_path) REFERENCES sessions(project_path, native_path)
    );
    CREATE INDEX IF NOT EXISTS submissions_project_created
      ON submissions(project_path, created_at DESC, id DESC);
  `)

  function ensureSession(projectPath: string, sessionId: string, sessionPath: string, createdAt: string) {
    db.prepare('INSERT INTO projects(path,created_at) VALUES(?,?) ON CONFLICT(path) DO NOTHING').run(projectPath, createdAt)
    db.prepare(`INSERT INTO sessions(id,project_path,native_path,created_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO NOTHING`).run(sessionId, projectPath, sessionPath, createdAt)
    const existing = db.prepare('SELECT project_path,native_path FROM sessions WHERE id=?').get(sessionId)
    if (existing?.project_path !== projectPath || existing?.native_path !== sessionPath)
      throw new Error(`pi Session identity is already registered to another project: ${sessionId}`)
  }

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
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
      inputDigest: hashInput(input.text, input.images),
      createdAt: new Date().toISOString(),
      settledAt: null,
    }
    transaction(() => {
      ensureSession(input.projectPath, input.sessionId, input.sessionPath, fact.createdAt)
      db.prepare(`INSERT INTO submissions(id,project_path,session_id,session_path,status,input_digest,created_at,settled_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(fact.id, fact.projectPath, fact.sessionId, fact.sessionPath, fact.status, fact.inputDigest, fact.createdAt, fact.settledAt)
    })
    return fact
  }

  function settleSubmission(id: string, status: Extract<SubmissionStatus, 'settled' | 'failed'>) {
    const settledAt = new Date().toISOString()
    const result = db.prepare(`UPDATE submissions SET status=?,settled_at=? WHERE id=? AND status='accepted'`).run(status, settledAt, id)
    if (Number(result.changes) !== 1)
      throw new Error(`submission is not pending: ${id}`)
  }

  function readSubmission(projectPath: string, id: string): SubmissionFact | undefined {
    const row = db.prepare(`SELECT id,project_path,session_id,session_path,status,input_digest,created_at,settled_at
      FROM submissions WHERE project_path=? AND id=?`).get(projectPath, id)
    return row
      ? {
          id: String(row.id),
          projectPath: String(row.project_path),
          sessionId: String(row.session_id),
          sessionPath: String(row.session_path),
          status: String(row.status) as SubmissionStatus,
          inputDigest: String(row.input_digest),
          createdAt: String(row.created_at),
          settledAt: row.settled_at === null ? null : String(row.settled_at),
        }
      : undefined
  }

  return {
    beginSubmission,
    close: () => db.close(),
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

export type FactsStore = Awaited<ReturnType<typeof openFactsStore>>
