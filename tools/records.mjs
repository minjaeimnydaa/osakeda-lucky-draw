import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const PROJECTS = ['lucky-draw', 'lucky-draw-v2'];
const FORMAT = 'osakeda-records';
const COUNT_KEYS = ['events', 'codes', 'entries', 'winners', 'emails', 'fulfilled'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sidecars = file => [file, `${file}-wal`, `${file}-shm`, `${file}-journal`];
function present(file) {
  try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function remove(file) {
  try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function removeEmpty(dir) {
  try { rmdirSync(dir); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}
function cleanup(files, directories = []) {
  let failure;
  for (const file of files) { try { remove(file); } catch (error) { failure ||= error; } }
  for (const dir of directories) { try { removeEmpty(dir); } catch (error) { failure ||= error; } }
  if (failure) throw new Error('임시 파일 또는 미완료 복원 파일을 정리하지 못했습니다. 생성된 폴더를 확인해 주세요.');
}
function writeNew(file, bytes, created) {
  const fd = openSync(file, 'wx', 0o600);
  created.push(file);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}
function projectDir(root, name) {
  const dir = join(root, name);
  if (!present(dir) || lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory() || !existsSync(join(dir, 'server.js')) || !lstatSync(join(dir, 'server.js')).isFile()) {
    throw new Error(`${name}: 먼저 저장소의 프로젝트 폴더를 준비해 주세요.`);
  }
  const data = join(dir, '.data');
  if (present(data) && (lstatSync(data).isSymbolicLink() || !lstatSync(data).isDirectory())) throw new Error(`${name}: 데이터 폴더를 확인해 주세요.`);
  return dir;
}
function validateEnv(bytes, name) {
  let env;
  try { env = parseEnv(bytes.toString('utf8')); } catch { throw new Error(`${name}: 환경 설정 파일을 확인해 주세요.`); }
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) throw new Error(`${name}: 세션 키와 관리자 비밀번호가 필요합니다.`);
  const sqlitePath = env.SQLITE_PATH?.replaceAll('\\', '/');
  if (env.DATABASE_URL || (sqlitePath && !['.data/events.sqlite', './.data/events.sqlite'].includes(sqlitePath))) {
    throw new Error(`${name}: 기본 로컬 SQLite 데이터만 이전할 수 있습니다.`);
  }
}
function inspectDatabase(file, normalize = false) {
  const db = new DatabaseSync(file, { readOnly: !normalize });
  try {
    if (normalize) db.exec('PRAGMA journal_mode=DELETE;');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('백업 데이터의 무결성 검사를 통과하지 못했습니다.');
    const entry = db.prepare('SELECT COUNT(*) AS entries, SUM(prize IS NOT NULL) AS winners, SUM(email IS NOT NULL) AS emails, SUM(fulfilled IS NOT NULL) AS fulfilled FROM entries').get();
    return {
      events: Number(db.prepare('SELECT COUNT(*) AS n FROM events').get().n),
      codes: Number(db.prepare('SELECT COUNT(*) AS n FROM codes').get().n),
      ...Object.fromEntries(['entries', 'winners', 'emails', 'fulfilled'].map(key => [key, Number(entry[key])]))
    };
  } finally { db.close(); }
}
function refuseExisting(root) {
  for (const name of PROJECTS) {
    const dir = projectDir(root, name);
    if ([join(dir, '.env.local'), ...sidecars(join(dir, '.data', 'events.sqlite'))].some(present)) {
      throw new Error(`${name}: 기존 설정이나 데이터가 있어 복원을 중단했습니다. 새로 복제한 폴더에서 실행해 주세요.`);
    }
  }
}
function encrypt(payload, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return JSON.stringify({ format: FORMAT, version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('base64') });
}
function decrypt(backupFile, keyFile) {
  try {
    const key = readFileSync(keyFile, 'utf8').trim();
    const envelope = JSON.parse(readFileSync(backupFile, 'utf8'));
    if (!/^[a-f0-9]{64}$/i.test(key) || envelope.format !== FORMAT || envelope.version !== 1 || !/^[a-f0-9]{24}$/i.test(envelope.iv) || !/^[a-f0-9]{32}$/i.test(envelope.tag) || typeof envelope.data !== 'string') throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('백업 파일 또는 복원 키가 올바르지 않습니다.'); }
}
function decodeProjects(payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.projects) || payload.projects.length !== PROJECTS.length || !PROJECTS.every(name => payload.projects.filter(p => p?.name === name).length === 1)) throw new Error('백업 구성 형식이 올바르지 않습니다.');
  return PROJECTS.map(name => {
    const item = payload.projects.find(p => p.name === name);
    if (typeof item.env !== 'string' || typeof item.database !== 'string') throw new Error('백업 파일 구성이 올바르지 않습니다.');
    const env = Buffer.from(item.env, 'base64'); const database = Buffer.from(item.database, 'base64');
    if (!env.length || !database.length || env.toString('base64') !== item.env || database.toString('base64') !== item.database || hash(env) !== item.hashes?.env || hash(database) !== item.hashes?.database) throw new Error('백업 파일의 확인 값이 일치하지 않습니다.');
    if (!item.counts || Object.keys(item.counts).length !== COUNT_KEYS.length || !COUNT_KEYS.every(key => Number.isSafeInteger(item.counts[key]) && item.counts[key] >= 0)) throw new Error('백업 기록 수가 올바르지 않습니다.');
    validateEnv(env, name);
    return { name, env, database, counts: item.counts };
  });
}

export async function createTransfer(root, outputRoot = join(root, 'private-transfer')) {
  root = resolve(root); outputRoot = resolve(outputRoot);
  if (process.env.DATABASE_URL || process.env.SQLITE_PATH || process.env.SESSION_SECRET) throw new Error('별도로 지정된 데이터베이스 또는 세션 환경 설정을 해제한 뒤 실행해 주세요.');
  const sources = PROJECTS.map(name => {
    const dir = projectDir(root, name); const envFile = join(dir, '.env.local'); const databaseFile = join(dir, '.data', 'events.sqlite');
    if (!present(envFile) || !present(databaseFile) || lstatSync(envFile).isSymbolicLink() || lstatSync(databaseFile).isSymbolicLink()) throw new Error(`${name}: 이전할 로컬 설정과 데이터가 필요합니다.`);
    const env = readFileSync(envFile); validateEnv(env, name);
    return { name, envFile, databaseFile, env };
  });
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const folder = mkdtempSync(join(outputRoot, 'records-'));
  const backupFile = join(folder, 'records.osakeda-backup'); const keyFile = join(folder, 'restore-key.txt');
  const created = []; const snapshots = []; let success = false;
  try {
    const projects = [];
    for (const source of sources) {
      const snapshot = join(folder, `${source.name}.sqlite`); snapshots.push(snapshot);
      writeNew(snapshot, Buffer.alloc(0), created);
      const db = new DatabaseSync(source.databaseFile, { readOnly: true });
      try { db.exec('PRAGMA busy_timeout=5000;'); await backup(db, snapshot); } finally { db.close(); }
      const counts = inspectDatabase(snapshot, true); const database = readFileSync(snapshot);
      projects.push({ name: source.name, env: source.env.toString('base64'), database: database.toString('base64'), hashes: { env: hash(source.env), database: hash(database) }, counts });
    }
    if (sources.some(source => !readFileSync(source.envFile).equals(source.env))) throw new Error('백업 중 설정이 변경되었습니다. 다시 실행해 주세요.');
    // ponytail: local event backups fit in memory; stream the bundle if records become large.
    const key = randomBytes(32);
    writeNew(backupFile, encrypt({ version: 1, projects }, key), created);
    writeNew(keyFile, `${key.toString('hex')}\n`, created);
    success = true;
    return { backupFile, keyFile, projects: projects.map(({ name, counts }) => ({ name, counts })) };
  } finally {
    cleanup([...snapshots.flatMap(sidecars), ...(!success ? created.reverse() : [])], success ? [] : [folder]);
  }
}

export async function restoreTransfer(backupFile, keyFile, destinationRoot) {
  destinationRoot = resolve(destinationRoot);
  const projects = decodeProjects(decrypt(backupFile, keyFile));
  refuseExisting(destinationRoot);
  const staging = mkdtempSync(join(tmpdir(), 'osakeda-records-'));
  const staged = []; const created = []; const directories = []; let success = false;
  try {
    for (const project of projects) {
      const snapshot = join(staging, `${project.name}.sqlite`); staged.push(snapshot);
      writeNew(snapshot, project.database, []);
      const counts = inspectDatabase(snapshot);
      if (!COUNT_KEYS.every(key => counts[key] === project.counts[key])) throw new Error(`${project.name}: 백업 기록 수가 일치하지 않습니다.`);
    }
    refuseExisting(destinationRoot);
    for (const project of projects) {
      const dir = projectDir(destinationRoot, project.name); const data = join(dir, '.data');
      if (!present(data)) { mkdirSync(data, { mode: 0o700 }); directories.push(data); }
      writeNew(join(dir, '.env.local'), project.env, created);
      writeNew(join(data, 'events.sqlite'), project.database, created);
    }
    success = true;
    return { destinationRoot, projects: projects.map(({ name, counts }) => ({ name, counts })) };
  } finally {
    cleanup([...(!success ? created.reverse() : []), ...staged.flatMap(sidecars)], [...(!success ? directories.reverse() : []), staging]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const [command, backupFile, keyFile, ...extra] = process.argv.slice(2);
    if (extra.length || !(['backup', 'restore'].includes(command)) || (command === 'backup' && (backupFile || keyFile)) || (command === 'restore' && (!backupFile || !keyFile))) throw new Error('사용법: node tools/records.mjs backup 또는 node tools/records.mjs restore <백업 파일> <복원 키 파일>');
    console.log(JSON.stringify(command === 'backup' ? await createTransfer(root) : await restoreTransfer(backupFile, keyFile, root), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
