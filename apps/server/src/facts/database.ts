import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** One owner holds the OS lease until all execution and database users have closed. */
export async function openDatabase(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lease = new DatabaseSync(join(dataDir, 'runs-owner.sqlite'))
  let db: DatabaseSync | undefined
  try {
    try {
      lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
    }
    catch { throw new Error('运行数据目录正被另一个 piflow 实例使用。') }
    db = new DatabaseSync(join(dataDir, 'runs.sqlite'))
    await chmod(join(dataDir, 'runs.sqlite'), 0o600)
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    migrate(db)
  }
  catch (error) {
    db?.close()
    lease.close()
    throw error
  }
  const connection = db
  let closed = false
  return {
    db: connection,
    transaction<T>(work: () => T): T {
      connection.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        connection.exec('COMMIT')
        return result
      }
      catch (error) {
        connection.exec('ROLLBACK')
        throw error
      }
    },
    close() {
      if (closed)
        return
      closed = true
      try {
        connection.close()
      }
      finally { lease.close() }
    },
  }
}

function migrate(db: DatabaseSync) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version > 3)
    throw new Error('运行数据库来自更新的 piflow 版本，请升级后重试')
  db.exec('BEGIN IMMEDIATE')
  try {
    if (version < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, project_path TEXT NOT NULL, created_at TEXT NOT NULL,
          orchestrator_id TEXT NOT NULL, role_id TEXT NOT NULL, status TEXT NOT NULL,
          metadata TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', output_version INTEGER NOT NULL DEFAULT 1,
          output_base INTEGER NOT NULL DEFAULT 0, output_end INTEGER NOT NULL DEFAULT 0,
          output_truncated INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS runs_project_created ON runs(project_path, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS runs_active ON runs(project_path, status);
        CREATE TABLE IF NOT EXISTS run_tools (
          run_id TEXT NOT NULL REFERENCES runs(id), tool_id TEXT NOT NULL,
          sequence INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY(run_id, tool_id), UNIQUE(run_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS run_deliveries (run_id TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL);
      `)
    }
    if (version < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (path TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, project_path TEXT NOT NULL REFERENCES projects(path),
          native_path TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_path,native_path)
        );
        CREATE TABLE IF NOT EXISTS submissions (
          id TEXT PRIMARY KEY, project_path TEXT NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions(id), session_path TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('accepted','settled','failed')),
          input_digest TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT,
          FOREIGN KEY(project_path,session_path) REFERENCES sessions(project_path,native_path)
        );
        CREATE INDEX IF NOT EXISTS submissions_project_created ON submissions(project_path,created_at DESC,id DESC);
        ALTER TABLE submissions ADD COLUMN observation TEXT NOT NULL DEFAULT 'legacy';
      `)
    }
    db.exec('PRAGMA user_version=3; COMMIT;')
  }
  catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export type FactsDatabase = Awaited<ReturnType<typeof openDatabase>>
