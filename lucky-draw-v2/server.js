import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  mkdirSync('.data', { recursive: true });
  const generated = `SESSION_SECRET=${randomBytes(32).toString('hex')}\nADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\n`;
  if (!existsSync('.env.local')) { writeFileSync('.env.local', generated, { mode: 0o600 }); process.loadEnvFile('.env.local'); }
}
const { default: api } = await import('./api/index.js');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const root = resolve('public');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) return api(req, res);
  const target = path === '/' ? 'index.html' : path === '/admin' ? 'admin.html' : path.slice(1);
  const file = resolve(root, target);
  if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const data = readFileSync(file);
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT || 3001), '127.0.0.1', () => {
  console.log(`Local: http://localhost:${process.env.PORT || 3001}`);
  console.log('관리자: /admin · 비밀번호는 .env.local의 ADMIN_PASSWORD');
  console.log('로컬 참여 코드: OSAKEDA-TEST-01 / OSAKEDA-TEST-02 / OSAKEDA-TEST-03');
});
