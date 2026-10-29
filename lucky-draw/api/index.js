import { createHmac, timingSafeEqual } from 'node:crypto';
import { Problem, initialize, getEvent, enter, draw, claim, rateLimit, adminData, saveEvent, cloneEvent, issueCodes, fulfill, revokeCode } from '../lib/event.js';

let boot;
const equal = (a, b) => { const x = Buffer.from(a || ''); const y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
const sign = text => createHmac('sha256', process.env.SESSION_SECRET).update(text).digest('base64url');
function token(payload) { const value = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 86400000 })).toString('base64url'); return `${value}.${sign(value)}`; }
function session(req, name) {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  try { const [value, mac] = raw.split('.'); if (!equal(sign(value), mac)) return null; const data = JSON.parse(Buffer.from(value, 'base64url')); return data.exp > Date.now() ? data : null; } catch { return null; }
}
function cookie(res, name, value, req, maxAge = 604800) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
async function body(req) {
  if (req.body && typeof req.body === 'object') {
    if (JSON.stringify(req.body).length > 65536) throw new Problem('요청이 너무 커요.', 413);
    return req.body;
  }
  if (typeof req.body === 'string') { if (req.body.length > 65536) throw new Problem('요청이 너무 커요.', 413); try { return JSON.parse(req.body); } catch { throw new Problem('요청 형식이 올바르지 않아요.'); } }
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Problem('요청이 너무 커요.', 413); }
  try { return JSON.parse(data || '{}'); } catch { throw new Problem('요청 형식이 올바르지 않아요.'); }
}
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) throw new Error('관리자 비밀번호와 세션 보안 설정이 필요합니다.');
    if (!boot) boot = initialize().catch(e => { boot = undefined; throw e; });
    await boot;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const action = url.searchParams.get('action') || 'event';
    if (!['GET', 'POST'].includes(req.method)) throw new Problem('지원하지 않는 요청이에요.', 405);
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host) throw new Problem('이 페이지에서 다시 시도해 주세요.', 403);
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new Problem('요청 형식이 올바르지 않아요.', 415);
    }
    const data = req.method === 'POST' ? await body(req) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Problem('요청 형식이 올바르지 않아요.');
    const slug = data.event || url.searchParams.get('event') || 'lucky-days';
    if (typeof slug !== 'string' || !/^[a-z0-9-]{1,80}$/.test(slug)) throw new Problem('이벤트 주소가 올바르지 않아요.');
    const mine = session(req, 'osk_customer');
    const admin = session(req, 'osk_admin')?.role === 'admin';
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
    let result;
    if (action === 'event' && req.method === 'GET') result = await getEvent(slug, mine);
    else if (action === 'enter' && req.method === 'POST') {
      if (!await rateLimit(`enter:${ip}`, 30)) throw new Problem('시도가 많아요. 15분 후 다시 시도해 주세요.', 429);
      const identity = await enter(slug, data.code); cookie(res, 'osk_customer', token(identity), req); result = { ok: true };
    } else if (action === 'draw' && req.method === 'POST') result = await draw(slug, mine, data.card);
    else if (action === 'claim' && req.method === 'POST') result = await claim(slug, mine, data.email, data.consent);
    else if (action === 'leave' && req.method === 'POST') { cookie(res, 'osk_customer', '', req, 0); result = { ok: true }; }
    else if (action === 'login' && req.method === 'POST') {
      if (!await rateLimit(`admin:${ip}`, 8)) throw new Problem('로그인 시도가 많아요. 15분 후 다시 시도해 주세요.', 429);
      if (!equal(String(data.password || ''), process.env.ADMIN_PASSWORD)) throw new Problem('관리자 비밀번호를 확인해 주세요.', 401);
      cookie(res, 'osk_admin', token({ role: 'admin' }), req); result = { ok: true };
    } else if (action.startsWith('admin-')) {
      if (!admin) throw new Problem('관리자 로그인이 필요해요.', 401);
      if (action === 'admin-data' && req.method === 'GET') result = await adminData();
      else if (req.method === 'POST') {
        if (action === 'admin-save') result = await saveEvent(data.id, data.config);
        else if (action === 'admin-clone') result = await cloneEvent(data.id);
        else if (action === 'admin-codes') result = await issueCodes(data.id, data.customers);
        else if (action === 'admin-fulfill') result = await fulfill(data.id);
        else if (action === 'admin-revoke') result = await revokeCode(data.id);
        else if (action === 'admin-logout') { cookie(res, 'osk_admin', '', req, 0); result = { ok: true }; }
        else throw new Problem('요청을 찾을 수 없어요.', 404);
      } else throw new Problem('요청을 찾을 수 없어요.', 404);
    } else throw new Problem('요청을 찾을 수 없어요.', 404);
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = e.status || 503;
    if (!e.status) console.error('Event service error:', e.code || e.name);
    res.end(JSON.stringify({ error: e.status ? e.message : '이벤트를 준비하고 있어요. 잠시 후 다시 시도해 주세요.' }));
  }
}
