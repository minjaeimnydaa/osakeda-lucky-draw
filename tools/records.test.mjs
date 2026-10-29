import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTransfer, restoreTransfer } from './records.mjs';

const PROJECTS = ['lucky-draw', 'lucky-draw-v2'];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'osakeda-records-test-')); const handles = [];
  t.after(() => {
    for (const db of handles) db.close();
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('osakeda-records-test-'));
    rmSync(target, { recursive: true, force: true });
  });
  const clone = name => {
    const target = join(root, name);
    for (const project of PROJECTS) { mkdirSync(join(target, project), { recursive: true }); writeFileSync(join(target, project, 'server.js'), '// Synthetic project.\n'); }
    return target;
  };
  const source = clone('source'); const envs = {}; const counts = {};
  for (const [i, name] of PROJECTS.entries()) {
    const dir = join(source, name); mkdirSync(join(dir, '.data'));
    envs[name] = Buffer.from(`SESSION_SECRET=${String(i + 1).repeat(64)}\r\nADMIN_PASSWORD=synthetic-admin-${i + 1}-only\r\n`);
    writeFileSync(join(dir, '.env.local'), envs[name]);
    const file = join(dir, '.data', 'events.sqlite'); const db = new DatabaseSync(file); handles.push(db);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON;
      CREATE TABLE events (id TEXT PRIMARY KEY);
      CREATE TABLE codes (id TEXT PRIMARY KEY, event_id TEXT REFERENCES events(id));
      CREATE TABLE entries (id TEXT PRIMARY KEY, event_id TEXT REFERENCES events(id), prize INTEGER, email TEXT, fulfilled TEXT);
      INSERT INTO events VALUES ('synthetic-event');
      INSERT INTO codes VALUES ('code-a', 'synthetic-event'), ('code-b', 'synthetic-event');
      INSERT INTO entries VALUES ('loss', 'synthetic-event', NULL, NULL, NULL);`);
    db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)').run('win', 'synthetic-event', 0, i ? 'synthetic@example.test' : null, i ? '2026-10-29T00:00:00Z' : null);
    writeFileSync(join(dir, '.data', 'claw-motion-qa.sqlite'), 'Never transfer this unrelated QA file.');
    assert.ok(statSync(`${file}-wal`).size > 0);
    counts[name] = { events: 1, codes: 2, entries: 2, winners: 1, emails: i, fulfilled: i };
  }
  return { root, source, clone, envs, counts };
}
function assertEmptyDestination(root) {
  for (const name of PROJECTS) {
    assert.equal(existsSync(join(root, name, '.env.local')), false);
    assert.equal(existsSync(join(root, name, '.data', 'events.sqlite')), false);
  }
}
function alteredPayload(transfer, file, change) {
  const envelope = JSON.parse(readFileSync(transfer.backupFile, 'utf8'));
  const key = Buffer.from(readFileSync(transfer.keyFile, 'utf8').trim(), 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex')); decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]));
  change(payload);
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  writeFileSync(file, JSON.stringify({ ...envelope, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('base64') }));
}

test('online backup includes open WAL records and restores both exact env/database pairs', async t => {
  const f = fixture(t); const transfer = await createTransfer(f.source, join(f.root, 'private-transfer'));
  assert.deepEqual(transfer.projects, PROJECTS.map(name => ({ name, counts: f.counts[name] })));
  assert.deepEqual(readdirSync(dirname(transfer.backupFile)).sort(), ['records.osakeda-backup', 'restore-key.txt']);
  const bundle = readFileSync(transfer.backupFile, 'utf8');
  assert.ok(!bundle.includes(readFileSync(transfer.keyFile, 'utf8').trim()));
  assert.ok(!bundle.includes('synthetic@example.test'));
  const destination = f.clone('destination'); const restored = await restoreTransfer(transfer.backupFile, transfer.keyFile, destination);
  assert.deepEqual(restored.projects, transfer.projects);
  for (const name of PROJECTS) {
    assert.deepEqual(readFileSync(join(destination, name, '.env.local')), f.envs[name]);
    const db = new DatabaseSync(join(destination, name, '.data', 'events.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, f.counts[name].entries);
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    } finally { db.close(); }
    assert.deepEqual(readdirSync(join(destination, name, '.data')), ['events.sqlite']);
  }
});

test('restore rejects wrong keys, ciphertext tampering, hash mismatch and count mismatch before writing', async t => {
  const f = fixture(t); const transfer = await createTransfer(f.source, join(f.root, 'private-transfer'));
  const destination = f.clone('destination'); const wrongKey = join(f.root, 'wrong-key.txt'); writeFileSync(wrongKey, randomBytes(32).toString('hex'));
  await assert.rejects(restoreTransfer(transfer.backupFile, wrongKey, destination), /백업 파일 또는 복원 키/);
  const envelope = JSON.parse(readFileSync(transfer.backupFile, 'utf8')); const bytes = Buffer.from(envelope.data, 'base64'); bytes[0] ^= 1;
  const tampered = join(f.root, 'tampered.osakeda-backup'); writeFileSync(tampered, JSON.stringify({ ...envelope, data: bytes.toString('base64') }));
  await assert.rejects(restoreTransfer(tampered, transfer.keyFile, destination), /백업 파일 또는 복원 키/);
  const badHash = join(f.root, 'bad-hash.osakeda-backup');
  alteredPayload(transfer, badHash, payload => { payload.projects[1].hashes.env = '0'.repeat(64); });
  await assert.rejects(restoreTransfer(badHash, transfer.keyFile, destination), /확인 값/);
  const badCount = join(f.root, 'bad-count.osakeda-backup');
  alteredPayload(transfer, badCount, payload => { payload.projects[1].counts.entries++; });
  await assert.rejects(restoreTransfer(badCount, transfer.keyFile, destination), /기록 수/);
  assertEmptyDestination(destination);
});

test('any existing target, including SQLite sidecars, prevents all writes', async t => {
  const f = fixture(t); const transfer = await createTransfer(f.source, join(f.root, 'private-transfer'));
  for (const [i, file] of ['.env.local', '.data/events.sqlite', '.data/events.sqlite-wal', '.data/events.sqlite-shm', '.data/events.sqlite-journal'].entries()) {
    const destination = f.clone(`existing-${i}`); const target = join(destination, 'lucky-draw-v2', file);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'Existing file must survive.');
    await assert.rejects(restoreTransfer(transfer.backupFile, transfer.keyFile, destination), /기존 설정이나 데이터/);
    assert.equal(readFileSync(target, 'utf8'), 'Existing file must survive.');
    assert.equal(existsSync(join(destination, 'lucky-draw', '.env.local')), false);
    assert.equal(existsSync(join(destination, 'lucky-draw', '.data', 'events.sqlite')), false);
  }
});

test('backup refuses remote or custom databases and missing security settings', async t => {
  const f = fixture(t); const file = join(f.source, 'lucky-draw-v2', '.env.local');
  for (const suffix of ['DATABASE_URL=postgresql://invalid\n', 'SQLITE_PATH=.data/other.sqlite\n']) {
    writeFileSync(file, Buffer.concat([f.envs['lucky-draw-v2'], Buffer.from(suffix)]));
    await assert.rejects(createTransfer(f.source, join(f.root, 'private-transfer')), /기본 로컬 SQLite/);
  }
  writeFileSync(file, 'PORT=3001\n');
  await assert.rejects(createTransfer(f.source, join(f.root, 'private-transfer')), /세션 키와 관리자 비밀번호/);
  assert.equal(existsSync(join(f.root, 'private-transfer')), false);
});

test('failed restore rolls back its own targets even if cleaning one temporary snapshot also fails', async t => {
  const f = fixture(t); const transfer = await createTransfer(f.source, join(f.root, 'private-transfer')); const destination = f.clone('destination');
  const originalOpen = fs.openSync; const originalUnlink = fs.unlinkSync; const refusedFile = join(destination, 'lucky-draw-v2', '.data', 'events.sqlite'); let leftover;
  try {
    fs.openSync = (file, ...args) => { if (file === refusedFile) throw new Error('Synthetic write failure'); return originalOpen(file, ...args); };
    fs.unlinkSync = (file, ...args) => {
      if (!leftover && basename(file) === 'lucky-draw.sqlite' && basename(dirname(file)).startsWith('osakeda-records-')) { leftover = file; throw new Error('Synthetic cleanup failure'); }
      return originalUnlink(file, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(restoreTransfer(transfer.backupFile, transfer.keyFile, destination), /임시 파일 또는 미완료 복원 파일/);
  } finally {
    fs.openSync = originalOpen; fs.unlinkSync = originalUnlink; syncBuiltinESMExports();
    if (leftover) {
      assert.equal(dirname(dirname(resolve(leftover))), resolve(tmpdir()));
      assert.ok(basename(dirname(leftover)).startsWith('osakeda-records-'));
      originalUnlink(leftover); fs.rmdirSync(dirname(leftover));
    }
  }
  assertEmptyDestination(destination);
  for (const name of PROJECTS) {
    assert.equal(existsSync(join(destination, name, '.data')), false);
    assert.equal(readFileSync(join(destination, name, 'server.js'), 'utf8'), '// Synthetic project.\n');
  }
});
