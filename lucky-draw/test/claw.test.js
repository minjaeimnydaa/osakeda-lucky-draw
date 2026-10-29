import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

test('saved win survives interrupted motion, failed refresh, and an older background response', async () => {
  const nodes = new Map();
  const element = selector => {
    if (!nodes.has(selector)) {
      const attributes = new Map(); const classes = new Set();
      nodes.set(selector, {
        textContent: '', hidden: false, disabled: false, open: false,
        dataset: { card: selector.match(/data-card="(\d+)"/)?.[1] },
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c) },
        setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k), getAttribute: k => attributes.get(k),
        addEventListener() {}, focus() {}, scrollIntoView() {},
        getBoundingClientRect: () => ({ top: 20, bottom: 400 }),
        showModal() { this.open = true; }, close() { this.open = false; },
        animate: () => ({ finished: Promise.reject(new Error('motion interrupted')), cancel() {} })
      });
    }
    return nodes.get(selector);
  };
  const tickets = Array.from({ length: 9 }, (_, i) => element(`[data-card="${i + 1}"]`));
  const winningResult = { id: 'saved-win', card: 7, day: 1, claimed: false, fulfilled: false, prize: { rank: 1, name: '기프트카드', detail: '100,000원' } };
  const initial = { title: '오사케다 이벤트', subtitle: '구매 고객 이벤트', status: 'active', identified: true, soldOut: false, result: null, day: 1, days: 5, start: '2026-10-28T00:00:00+09:00', end: '2026-11-02T00:00:00+09:00', test: true, delivery: '영업일 3일 내 발급', privacy: '발급 목적 수집', contact: '', prizes: [{ rank: 1, name: '기프트카드', detail: '100,000원', total: 1 }] };
  let eventRequests = 0; let draws = 0; let finishStale;
  const staleResponse = new Promise(resolve => { finishStale = resolve; });
  const context = createContext({
    $: element, esc: String, toast() {}, formatDate: () => '10. 28.', download() {},
    URLSearchParams, URL, location: { search: '', origin: 'http://localhost' }, innerHeight: 844,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    getComputedStyle: () => ({ transform: 'none' }), DOMMatrix: class { m41 = 0; },
    setInterval() {},
    document: { querySelector: element, querySelectorAll: s => s === '.machine-ticket' ? tickets : [], addEventListener() {} },
    async api(action) {
      if (action === 'draw') { draws++; return winningResult; }
      if (action !== 'event') throw new Error(`unexpected API: ${action}`);
      eventRequests++;
      if (eventRequests === 1) return initial;
      if (eventRequests === 2) return staleResponse;
      throw new Error('refresh unavailable');
    }
  });
  // Expose only the existing initial load promise; run the shipped frontend unchanged otherwise.
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/, '')
    .replace('load().catch(err =>', 'globalThis.ready = load().catch(err =>');
  runInContext(source, context);
  await context.ready;
  const oldLoad = runInContext('load()', context);
  const draw = runInContext('pick()', context);
  assert.equal(element('#enter-button').disabled, true);
  assert.equal(element('#change-code').disabled, true);
  await runInContext('pick()', context); // A rapid second click must not send another draw.
  await draw;

  assert.equal(draws, 1);
  assert.equal(element('#result-dialog').open, true);
  assert.match(element('#result-title').textContent, /1등 당첨/);
  assert.equal(element('#claim-form').hidden, false);
  assert.equal(element('#enter-button').disabled, false);
  assert.equal(element('#change-code').disabled, false);
  assert.equal(element('#machine').getAttribute('aria-busy'), 'false');
  assert.equal(element('[data-card="7"]').classList.contains('is-picked'), true);

  finishStale({ ...initial, title: '오래된 화면' });
  await oldLoad;
  assert.equal(element('#event-title').textContent, initial.title);
  assert.equal(element('#enter-button').textContent, '나의 결과 확인하기');
  assert.equal(element('#result-dialog').open, true);
});
