import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const schema = [
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, config TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), customer TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), customer TEXT NOT NULL, day TEXT NOT NULL, card INTEGER NOT NULL, prize INTEGER, email TEXT, created TEXT NOT NULL, fulfilled TEXT, consent TEXT, UNIQUE(event_id, customer, day))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_win_per_customer ON entries(event_id, customer) WHERE prize IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS entries_event ON entries(event_id)`,
  `CREATE TABLE IF NOT EXISTS limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires TEXT NOT NULL)`
];
let ready;
let queue = Promise.resolve();
export function database() {
  if (!ready) ready = open().catch(e => { ready = undefined; throw e; });
  return ready;
}
async function open() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10000 });
    for (const sql of schema) await pool.query(sql);
    return {
      async transaction(work) {
        const c = await pool.connect();
        const tx = { async query(sql, params = []) { let i = 0; return (await c.query(sql.replace(/\?/g, () => `$${++i}`), params)).rows; }, postgres: true };
        try { await c.query('BEGIN'); const value = await work(tx); await c.query('COMMIT'); return value; }
        catch (e) { await c.query('ROLLBACK'); throw e; }
        finally { c.release(); }
      },
      close: () => pool.end()
    };
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('운영용 DATABASE_URL 설정이 필요합니다.');
  const { DatabaseSync } = await import('node:sqlite');
  const file = process.env.SQLITE_PATH || '.data/events.sqlite';
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  for (const sql of schema) sqlite.exec(sql);
  const tx = { async query(sql, params = []) { return sqlite.prepare(sql).all(...params); }, postgres: false };
  return {
    // ponytail: local SQLite serializes writes; production uses PostgreSQL row locks.
    transaction(work) {
      const task = queue.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try { const result = await work(tx); sqlite.exec('COMMIT'); return result; }
        catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      });
      queue = task.catch(() => {});
      return task;
    },
    close: () => sqlite.close()
  };
}
