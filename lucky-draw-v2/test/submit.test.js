import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { getDrawState } from '../public/participation.js';

const initialEvent = {
  title:'오사케다 이벤트', subtitle:'구매 고객 이벤트', status:'active', identified:false,
  soldOut:false, result:null, day:1, days:5, now:'2026-10-29T03:00:00Z',
  start:'2026-10-29T00:00:00+09:00', end:'2026-11-03T00:00:00+09:00',
  test:true, delivery:'영업일 3일 내 발급', privacy:'발급 목적 수집', contact:'',
  prizes:[{ rank:1, name:'기프트카드', detail:'100,000원', total:1, remaining:1 }]
};
const winner = { id:'saved-win', card:3, day:1, claimed:false, fulfilled:false, email:null,
  prize:{ rank:1, name:'기프트카드', detail:'100,000원' } };

async function page(api) {
  const nodes = new Map();
  const shares = []; const toasts = [];
  const element = selector => {
    if (!nodes.has(selector)) {
      const attributes = new Map(); const classes = new Set(); const listeners = new Map();
      nodes.set(selector, {
        value:'', checked:false, textContent:'', hidden:false, disabled:false, open:false,
        dataset:{ card:selector.match(/data-card="(\d+)"/)?.[1] }, listeners,
        classList:{ add:c => classes.add(c), remove:c => classes.delete(c), toggle:(c,on) => on ? classes.add(c) : classes.delete(c) },
        setAttribute:(k,v) => attributes.set(k,v), removeAttribute:k => attributes.delete(k), getAttribute:k => attributes.get(k),
        addEventListener(type, listener) { listeners.set(type, listener); },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
        click() { if (!this.disabled) return fire(selector, 'click'); }
      });
    }
    return nodes.get(selector);
  };
  const dialogs = ['#code-dialog','#result-dialog','#story-dialog'].map(element);
  const tickets = Array.from({ length:9 }, (_,i) => element(`[data-card="${i+1}"]`));
  const context = createContext({
    $:element, api, esc:String, toast:message => toasts.push(message), download() {}, formatDate:() => '10. 29.', getDrawState,
    URLSearchParams, URL, location:{ search:'', origin:'http://localhost:3001' },
    navigator:{ share:async () => shares.push('share'), clipboard:{ writeText:async () => shares.push('copy') } },
    matchMedia:() => ({ matches:true, addEventListener() {} }), setInterval() {},
    document:{
      querySelector:s => s === 'dialog[open]' ? dialogs.find(d => d.open) || null : element(s),
      querySelectorAll:s => s === 'dialog' ? dialogs : s === '.machine-ticket' ? tickets : [],
      addEventListener() {}
    }
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('load().catch(err =>', 'globalThis.ready = load().catch(err =>');
  runInContext(source, context);
  await context.ready;
  const fire = async (selector, type, submitter) => {
    const listener = element(selector).listeners.get(type);
    assert.equal(typeof listener, 'function', `${selector} has a ${type} handler`);
    await listener({ preventDefault() {}, submitter });
  };
  return { element, fire, shares, toasts };
}

test('a confirmed code retries only the failed state lookup', async () => {
  let reads = 0; const entries = [];
  const { element, fire } = await page(async (action, data) => {
    if (action === 'enter') { entries.push(data); return { ok:true }; }
    assert.equal(action, 'event');
    if (++reads === 2) throw new Error('refresh unavailable');
    return { ...initialEvent, identified:reads > 1 };
  });
  await fire('#enter-button', 'click');
  element('#code-input').value = '  osk-customer-code  ';
  const button = element('#code-form button[type="submit"]');
  await fire('#code-form', 'submit', button);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, 'OSK-CUSTOMER-CODE');
  assert.equal(element('#code-dialog').open, true);
  assert.match(element('#code-error').textContent, /코드는 확인됐어요/);
  assert.notEqual(element('#code-input').getAttribute('aria-invalid'), 'true');
  assert.equal(button.textContent, '참여 상태 다시 확인');
  assert.equal(button.disabled, false);
  assert.equal(element('#code-input').disabled, false);
  assert.equal(element('#code-form').getAttribute('aria-busy'), 'false');
  await fire('#code-form', 'submit', button);
  assert.equal(entries.length, 1);
  assert.equal(reads, 3);
  assert.equal(element('#code-dialog').open, false);
  assert.equal(element('#code-input').value, '');
  assert.equal(element('#enter-button').textContent, '지금 뽑기');
});

test('a saved claim remains successful when the subsequent lookup fails', async () => {
  let reads = 0; let claims = 0;
  const { element, fire } = await page(async action => {
    if (action === 'claim') { claims++; return { saved:true }; }
    assert.equal(action, 'event');
    if (++reads > 1) throw new Error('refresh unavailable');
    return { ...initialEvent, identified:true, result:winner };
  });
  await fire('#enter-button', 'click');
  assert.equal(element('#result-dismiss').hidden, true);
  assert.equal(element('#result-actions').hidden, true);
  element('#email').value = 'winner@example.com'; element('#consent').checked = true;
  const button = element('#claim-form button[type="submit"]');
  await fire('#claim-form', 'submit', button);
  assert.equal(claims, 1);
  assert.equal(reads, 2);
  assert.equal(element('#result-dialog').open, true);
  assert.equal(element('#claim-error').textContent, '');
  assert.equal(element('#claim-form').hidden, true);
  assert.equal(element('#claim-success').hidden, false);
  assert.equal(element('#result-dismiss').hidden, false);
  assert.equal(element('#result-actions').hidden, false);
  assert.match(element('#claim-success').textContent, /수령 이메일이 등록되었어요/);
  assert.match(element('#connection-message').textContent, /이메일 등록은 완료/);
  assert.equal(element('#enter-button').textContent, '발급 안내 확인하기');
  assert.equal(element('#email').value, '');
  assert.equal(element('#consent').checked, false);
  assert.equal(button.disabled, false);
  await fire('#result-dismiss', 'click');
  assert.equal(element('#result-dialog').open, false);
});

test('reverification after a 401 preserves the unsent claim fields', async () => {
  let claims = 0; let entries = 0;
  const { element, fire } = await page(async action => {
    if (action === 'claim') { claims++; throw Object.assign(new Error('참여 코드를 다시 확인해 주세요.'), { status:401 }); }
    if (action === 'enter') { entries++; return { ok:true }; }
    assert.equal(action, 'event');
    return { ...initialEvent, identified:true, result:winner };
  });
  await fire('#enter-button', 'click');
  element('#email').value = 'unsent@example.com'; element('#consent').checked = true;
  await fire('#claim-form', 'submit', element('#claim-form button[type="submit"]'));
  assert.equal(element('#reverify-code').hidden, false);
  await fire('#reverify-code', 'click');
  assert.equal(element('#code-dialog').open, true);
  assert.equal(element('#result-dialog').open, false);
  element('#code-input').value = 'OSK-SAME-CUSTOMER';
  await fire('#code-form', 'submit', element('#code-form button[type="submit"]'));
  assert.equal(entries, 1);
  assert.equal(claims, 1);
  assert.equal(element('#result-dialog').open, true);
  assert.equal(element('#claim-form').hidden, false);
  assert.equal(element('#email').value, 'unsent@example.com');
  assert.equal(element('#consent').checked, true);
  assert.equal(element('#claim-error').textContent, '');
  assert.equal(element('#result-dismiss').hidden, true);
  assert.equal(element('#result-actions').hidden, true);
});

test('a state refresh after Korean midnight releases yesterday’s losing result', async () => {
  let reads = 0;
  const { element, fire } = await page(async action => {
    assert.equal(action, 'event');
    return ++reads === 1
      ? { ...initialEvent, identified:true, result:{ id:'yesterday', card:2, day:1, prize:null } }
      : { ...initialEvent, identified:true, day:2, now:'2026-10-30T00:00:00+09:00', result:null };
  });
  assert.equal(element('#enter-button').textContent, '오늘의 결과 확인하기');
  await fire('#retry-load', 'click');
  assert.equal(element('#enter-button').textContent, '지금 뽑기');
  assert.equal(element('#board-status').textContent, '오늘 참여 가능');
  assert.equal(element('#enter-button').disabled, false);
});

test('code verification locks duplicate submissions and background actions after its dialog closes', async () => {
  let reads = 0; let entries = 0; let finishEnter;
  const waiting = new Promise(resolve => { finishEnter = resolve; });
  const { element, fire, shares, toasts } = await page(async action => {
    if (action === 'enter') { entries++; await waiting; return { ok:true }; }
    assert.equal(action, 'event', 'A draw or claim must not overlap code verification.');
    reads++;
    return { ...initialEvent, identified:true };
  });
  await fire('#change-code', 'click');
  element('#code-input').value = 'OSK-NEXT-CUSTOMER';
  const button = element('#code-form button[type="submit"]');
  const pending = fire('#code-form', 'submit', button);
  assert.equal(entries, 1);
  assert.equal(element('#code-input').disabled, true);
  assert.equal(element('#code-form').getAttribute('aria-busy'), 'true');
  for (const id of ['enter-button','dock-button','change-code','retry-load','share','copy-link','save-story','result-share','result-story','download-story']) {
    assert.equal(element(`#${id}`).disabled, true, `${id} is locked during verification`);
  }
  await fire('#code-form', 'submit', button);
  await fire('#code-input', 'input');
  assert.equal(button.textContent, '코드를 확인하고 있어요…');
  element('#code-dialog').close(); // Closing/Esc must not unlock the old customer's background UI.
  for (const id of ['enter-button','dock-button','change-code','retry-load','share','copy-link','save-story']) await fire(`#${id}`, 'click');
  await fire('#claim-form', 'submit', element('#claim-form button[type="submit"]'));
  assert.equal(element('#code-dialog').open, false);
  assert.equal(entries, 1);
  assert.equal(reads, 1);
  assert.equal(shares.length, 0);
  assert.equal(toasts.length, 0);
  finishEnter(); await pending;
  assert.equal(reads, 2);
  assert.equal(entries, 1);
  assert.equal(element('#code-input').disabled, false);
  assert.equal(element('#code-form').getAttribute('aria-busy'), 'false');
  assert.equal(element('#enter-button').disabled, false);
  assert.equal(element('#change-code').disabled, false);
  assert.equal(element('#share').disabled, false);
  assert.equal(element('#enter-button').textContent, '지금 뽑기');
});

test('completed results offer an explicit dismissal while sharing remains optional', async () => {
  for (const result of [{ id:'lost', card:1, day:1, prize:null }, { ...winner, claimed:true }, { ...winner, claimed:true, fulfilled:true }]) {
    const { element, fire, shares } = await page(async action => {
      assert.equal(action, 'event');
      return { ...initialEvent, identified:true, result };
    });
    await fire('#enter-button', 'click');
    assert.equal(element('#claim-form').hidden, true);
    assert.equal(element('#result-dismiss').hidden, false);
    assert.equal(element('#result-actions').hidden, false);
    await fire('#result-dismiss', 'click');
    assert.equal(element('#result-dialog').open, false);
    assert.equal(shares.length, 0);
    await fire('#enter-button', 'click');
    await fire('#result-share', 'click');
    assert.deepEqual(shares, ['share']);
  }
});

test('the draw benefit advertises only available prizes and their remaining quantity', async () => {
  const prizes = [
    { rank:1, name:'기프트카드', detail:'100,000원', total:1, remaining:1 },
    { rank:2, name:'기프트카드', detail:'50,000원', total:1, remaining:1 },
    { rank:3, name:'기프트카드', detail:'10,000원', total:3, remaining:3 }
  ];
  const cases = [
    { remaining:[1,1,3], expected:'1등 100,000원 · 남은 경품 5개' },
    { remaining:[0,1,3], expected:'2등 50,000원 · 남은 경품 4개' },
    { remaining:[0,0,0], expected:'준비된 경품이 모두 소진되었어요.' }
  ];
  for (const c of cases) {
    const { element } = await page(async action => {
      assert.equal(action, 'event');
      return { ...initialEvent, soldOut:c.remaining.every(n => n === 0), prizes:prizes.map((p,i) => ({ ...p, remaining:c.remaining[i] })) };
    });
    assert.equal(element('#draw-benefit').textContent, c.expected);
  }
});
