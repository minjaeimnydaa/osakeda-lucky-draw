import { randomBytes, randomInt, randomUUID, createHmac, createHash } from 'node:crypto';
import { database } from './db.js';

export class Problem extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const hash = value => createHash('sha256').update(value).digest('hex');
export const customerHash = value => createHmac('sha256', process.env.SESSION_SECRET).update(value.trim().toLowerCase()).digest('hex');
export const dayKey = (now = new Date()) => new Date(+now + 9 * 3600000).toISOString().slice(0, 10);
export const dayNumber = (start, now = new Date()) => Math.floor((Date.parse(dayKey(now)) - Date.parse(dayKey(new Date(start)))) / 86400000) + 1;
export function defaultConfig(local = false) {
  const start = new Date(`${dayKey()}T00:00:00+09:00`);
  return {
    title: '행운을 고르는 5일', subtitle: '오사케다 고객만을 위한 작은 설렘',
    start: start.toISOString(), end: new Date(+start + 5 * 86400000).toISOString(),
    status: local ? 'active' : 'draft', test: local,
    delivery: local ? '테스트 이벤트입니다. 실제 기프트카드는 발급되지 않습니다.' : '',
    contact: '', privacy: local ? '테스트 이메일은 로컬 기기에 저장됩니다. 운영 시 수집 목적과 보관 기간을 설정해 주세요.' : '',
    prizes: [
      { name: '오사케다 기프트카드', detail: '100,000원', total: 1, chance: 1 },
      { name: '오사케다 기프트카드', detail: '50,000원', total: 1, chance: 2 },
      { name: '오사케다 기프트카드', detail: '10,000원', total: 3, chance: 7 }
    ]
  };
}
async function eventRow(tx, slug, lock = false) {
  const [row] = await tx.query(`SELECT * FROM events WHERE slug = ?${lock && tx.postgres ? ' FOR UPDATE' : ''}`, [slug]);
  if (!row) throw new Problem('이벤트를 찾을 수 없어요.', 404);
  return { ...row, config: JSON.parse(row.config) };
}
export async function initialize() {
  const db = await database();
  await db.transaction(async tx => {
    const [existing] = await tx.query('SELECT id FROM events WHERE slug = ?', ['lucky-days']);
    if (!existing) {
      const id = randomUUID();
      const local = !process.env.DATABASE_URL && !process.env.VERCEL && process.env.NODE_ENV !== 'production';
      await tx.query('INSERT INTO events(id, slug, config) VALUES(?, ?, ?) ON CONFLICT(slug) DO NOTHING', [id, 'lucky-days', JSON.stringify(defaultConfig(local))]);
      if (local) for (let i = 1; i <= 3; i++) await tx.query('INSERT INTO codes(id,event_id,customer,hash,label) VALUES(?,?,?,?,?)', [randomUUID(), id, customerHash(`demo-${i}`), hash(`OSAKEDA-TEST-0${i}`), `테스트 고객 ${i}`]);
    }
  });
}
function state(c, now) {
  if (c.status !== 'active') return c.status;
  if (+now < Date.parse(c.start)) return 'upcoming';
  if (+now >= Date.parse(c.end)) return 'ended';
  return 'active';
}
const publicEntry = (e, c) => e ? { id: e.id, card: e.card, prize: e.prize === null ? null : { ...c.prizes[e.prize], rank: e.prize + 1, chance: undefined }, day: dayNumber(c.start, new Date(e.created)), created: e.created, claimed: !!e.email, fulfilled: !!e.fulfilled, email: e.email ? e.email.replace(/^(.{1,2}).*(@.*)$/, '$1•••$2') : null } : null;
export async function getEvent(slug, session, now = new Date()) {
  return (await database()).transaction(async tx => {
    const row = await eventRow(tx, slug); const c = row.config;
    const counts = await tx.query('SELECT prize, COUNT(*) AS n FROM entries WHERE event_id = ? AND prize IS NOT NULL GROUP BY prize', [row.id]);
    const prizes = c.prizes.map((p, i) => ({ rank: i + 1, name: p.name, detail: p.detail, total: p.total, remaining: Math.max(0, p.total - Number(counts.find(x => x.prize === i)?.n || 0)) }));
    let mine = null; let identified = false;
    if (session?.event === row.id) {
      const [code] = await tx.query('SELECT * FROM codes WHERE id = ? AND active = 1', [session.code]);
      if (code) {
        identified = true;
        const entries = await tx.query('SELECT * FROM entries WHERE event_id = ? AND customer = ? ORDER BY created DESC', [row.id, code.customer]);
        mine = entries.find(e => e.prize !== null) || entries.find(e => e.day === dayKey(now));
      }
    }
    return { slug: row.slug, title: c.title, subtitle: c.subtitle, start: c.start, end: c.end, day: Math.max(1, dayNumber(c.start, now)), days: Math.ceil((Date.parse(c.end) - Date.parse(`${dayKey(new Date(c.start))}T00:00:00+09:00`)) / 86400000), status: state(c, now), soldOut: prizes.every(p => p.remaining === 0), test: c.test, delivery: c.delivery, contact: c.contact, privacy: c.privacy, prizes, identified, result: publicEntry(mine, c), now: now.toISOString() };
  });
}
export async function enter(slug, raw) {
  if (typeof raw !== 'string' || raw.length > 120) throw new Problem('참여 코드를 확인해 주세요.');
  return (await database()).transaction(async tx => {
    const row = await eventRow(tx, slug);
    const [code] = await tx.query('SELECT * FROM codes WHERE event_id = ? AND hash = ? AND active = 1', [row.id, hash(raw.trim().toUpperCase())]);
    if (!code) throw new Problem('유효한 참여 코드가 아니에요. 구매 시 받은 코드를 확인해 주세요.');
    return { event: row.id, code: code.id };
  });
}
export async function draw(slug, session, card, now = new Date(), roll = () => randomInt(1000000) / 10000) {
  if (!Number.isInteger(card) || card < 1 || card > 9) throw new Problem('카드를 다시 선택해 주세요.');
  return (await database()).transaction(async tx => {
    const row = await eventRow(tx, slug, true); const c = row.config;
    if (session?.event !== row.id) throw new Problem('참여 코드를 먼저 입력해 주세요.', 401);
    const [code] = await tx.query('SELECT * FROM codes WHERE id = ? AND event_id = ? AND active = 1', [session.code, row.id]);
    if (!code) throw new Problem('사용할 수 없는 참여 코드예요.', 401);
    const existing = await tx.query('SELECT * FROM entries WHERE event_id = ? AND customer = ? ORDER BY created DESC', [row.id, code.customer]);
    const previous = existing.find(e => e.prize !== null) || existing.find(e => e.day === dayKey(now));
    if (previous) return publicEntry(previous, c);
    if (state(c, now) !== 'active') throw new Problem('지금은 참여 가능한 시간이 아니에요.');
    const counts = await tx.query('SELECT prize, COUNT(*) AS n FROM entries WHERE event_id = ? AND prize IS NOT NULL GROUP BY prize', [row.id]);
    const available = c.prizes.map((p, i) => Number(counts.find(x => x.prize === i)?.n || 0) < p.total);
    if (!available.some(Boolean)) throw new Problem('준비된 경품이 모두 소진되었어요.');
    let boundary = 0; let prize = null; const r = roll();
    for (let i = 0; i < c.prizes.length; i++) {
      boundary += c.prizes[i].chance;
      if (r < boundary) { if (available[i]) prize = i; break; }
    }
    const entry = { id: randomUUID(), event_id: row.id, customer: code.customer, day: dayKey(now), card, prize, created: now.toISOString() };
    await tx.query('INSERT INTO entries(id,event_id,customer,day,card,prize,created) VALUES(?,?,?,?,?,?,?)', [entry.id, row.id, code.customer, entry.day, card, prize, entry.created]);
    return publicEntry(entry, c);
  });
}
export async function claim(slug, session, email, consent) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Problem('올바른 이메일 주소를 입력해 주세요.');
  if (consent !== true) throw new Problem('경품 발급을 위한 개인정보 수집에 동의해 주세요.');
  return (await database()).transaction(async tx => {
    const row = await eventRow(tx, slug, true);
    if (session?.event !== row.id) throw new Problem('참여 코드를 다시 입력해 주세요.', 401);
    const [code] = await tx.query('SELECT * FROM codes WHERE id = ? AND event_id = ? AND active = 1', [session.code, row.id]);
    if (!code) throw new Problem('참여 코드를 다시 확인해 주세요.', 401);
    const [entry] = await tx.query('SELECT * FROM entries WHERE event_id = ? AND customer = ? AND prize IS NOT NULL', [row.id, code.customer]);
    if (!entry) throw new Problem('당첨 내역이 없어요.');
    if (entry.email) return { saved: true };
    await tx.query('UPDATE entries SET email = ?, consent = ? WHERE id = ?', [email.trim().toLowerCase(), JSON.stringify({ at: new Date().toISOString(), notice: row.config.privacy }), entry.id]);
    return { saved: true };
  });
}
export async function rateLimit(key, max, minutes = 15) {
  return (await database()).transaction(async tx => {
    const now = new Date().toISOString();
    await tx.query('DELETE FROM limits WHERE expires < ?', [now]);
    const [row] = await tx.query('INSERT INTO limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count = limits.count + 1 RETURNING count', [hash(key), new Date(Date.now() + minutes * 60000).toISOString()]);
    if (Number(row.count) > max) return false;
    return true;
  });
}
export async function adminData() {
  return (await database()).transaction(async tx => {
    const events = await tx.query('SELECT * FROM events ORDER BY slug');
    const winners = await tx.query('SELECT id,event_id,prize,email,created,fulfilled FROM entries WHERE prize IS NOT NULL ORDER BY created DESC');
    const stats = await tx.query('SELECT event_id,day,COUNT(*) AS n FROM entries GROUP BY event_id,day');
    const codes = await tx.query('SELECT id,event_id,label,active FROM codes ORDER BY label');
    return { events: events.map(r => ({ ...r, config: JSON.parse(r.config) })), winners, stats, codes };
  });
}
function validate(c) {
  if (!c || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 60 || typeof c.subtitle !== 'string' || c.subtitle.length > 150) throw new Problem('이벤트 이름과 소개를 확인해 주세요.');
  if (!['draft', 'active', 'paused'].includes(c.status)) throw new Problem('이벤트 상태를 확인해 주세요.');
  if (!Number.isFinite(Date.parse(c.start)) || !Number.isFinite(Date.parse(c.end)) || Date.parse(c.end) <= Date.parse(c.start) || Date.parse(c.end) - Date.parse(c.start) > 90 * 86400000) throw new Problem('이벤트 기간은 시작 이후부터 최대 90일로 설정해 주세요.');
  if (!Array.isArray(c.prizes) || c.prizes.length !== 3 || c.prizes.some(p => typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || typeof p.detail !== 'string' || p.detail.length > 80 || !Number.isInteger(p.total) || p.total < 0 || p.total > 100000 || !Number.isFinite(p.chance) || p.chance < 0 || p.chance > 100) || c.prizes.reduce((s, p) => s + p.chance, 0) > 100) throw new Problem('경품 수량과 확률을 확인해 주세요. 확률 합계는 100% 이하여야 해요.');
  for (const field of ['privacy', 'contact', 'delivery']) if (typeof c[field] !== 'string' || c[field].length > 3000) throw new Problem('안내 문구가 올바르지 않아요.');
  if (!c.test && c.status === 'active' && (!c.privacy.trim() || !c.contact.trim() || !c.delivery.trim())) throw new Problem('공개 전 개인정보 안내, 문의처, 발급 일정을 입력해 주세요.');
}
export async function saveEvent(id, next) {
  validate(next);
  return (await database()).transaction(async tx => {
    const [row] = await tx.query(`SELECT * FROM events WHERE id = ?${tx.postgres ? ' FOR UPDATE' : ''}`, [id]);
    if (!row) throw new Problem('이벤트를 찾을 수 없어요.', 404);
    const old = JSON.parse(row.config);
    const entries = await tx.query('SELECT prize,COUNT(*) AS n FROM entries WHERE event_id = ? GROUP BY prize', [id]);
    if (entries.length && (old.start !== next.start || old.end !== next.end || JSON.stringify(old.prizes.map(p => [p.name,p.detail,p.chance])) !== JSON.stringify(next.prizes.map(p => [p.name,p.detail,p.chance])))) throw new Problem('참여 기록이 있는 이벤트의 기간·경품·확률은 변경할 수 없어요. 새 이벤트로 복제해 주세요.');
    for (let i = 0; i < 3; i++) if (next.prizes[i].total < Number(entries.find(e => e.prize === i)?.n || 0)) throw new Problem('당첨된 수량보다 경품 수량을 줄일 수 없어요.');
    next = { title: next.title.trim(), subtitle: next.subtitle, start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString(), status: next.status, test: old.test, delivery: next.delivery, contact: next.contact, privacy: next.privacy, prizes: next.prizes.map(p => ({ name: p.name, detail: p.detail, total: p.total, chance: p.chance })) };
    await tx.query('UPDATE events SET config = ? WHERE id = ?', [JSON.stringify(next), id]);
    return { saved: true };
  });
}
export async function cloneEvent(id) {
  return (await database()).transaction(async tx => {
    const [row] = await tx.query('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) throw new Problem('이벤트를 찾을 수 없어요.', 404);
    const config = { ...JSON.parse(row.config), title: `${JSON.parse(row.config).title.slice(0, 50)} (복사)`, status: 'draft' };
    const newId = randomUUID(); const slug = `lucky-${randomBytes(4).toString('hex')}`;
    await tx.query('INSERT INTO events(id,slug,config) VALUES(?,?,?)', [newId, slug, JSON.stringify(config)]);
    return { id: newId, slug };
  });
}
export async function issueCodes(id, customers) {
  if (!Array.isArray(customers) || customers.length < 1 || customers.length > 500 || customers.some(c => typeof c !== 'string' || !c.trim() || c.length > 160)) throw new Problem('고객 식별값을 1~500개 입력해 주세요.');
  return (await database()).transaction(async tx => {
    const [event] = await tx.query(`SELECT id FROM events WHERE id = ?${tx.postgres ? ' FOR UPDATE' : ''}`, [id]);
    if (!event) throw new Problem('이벤트를 찾을 수 없어요.', 404);
    const result = [];
    for (const customer of [...new Set(customers.map(c => c.trim().toLowerCase()))]) {
      const code = `OSK-${randomBytes(10).toString('hex').toUpperCase()}`;
      await tx.query('INSERT INTO codes(id,event_id,customer,hash,label) VALUES(?,?,?,?,?)', [randomUUID(), id, customerHash(customer), hash(code), `고객 ${hash(customer).slice(0, 8)}`]);
      result.push({ customer, code });
    }
    return result;
  });
}
export async function fulfill(id) {
  return (await database()).transaction(async tx => {
    const rows = await tx.query('UPDATE entries SET fulfilled = ? WHERE id = ? AND email IS NOT NULL AND prize IS NOT NULL AND fulfilled IS NULL RETURNING id', [new Date().toISOString(), id]);
    if (!rows.length) throw new Problem('이메일이 등록된 미발급 당첨 건만 완료 처리할 수 있어요.');
    return { saved: true };
  });
}
export async function revokeCode(id) {
  return (await database()).transaction(async tx => {
    await tx.query('UPDATE codes SET active = 0 WHERE id = ?', [id]);
    return { saved: true };
  });
}
