import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../public/shared.js';

test('API failures stay readable, distinguish uncertain writes, and never retry or expose payloads in URLs', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const payload = { email:'private-test@example.com', code:'OSK-PRIVATE-TEST', consent:true };

  for (const failure of ['network', 'json']) {
    for (const write of [false, true]) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (failure === 'network') throw new TypeError('internal connection failure');
        return new Response('invalid JSON', { status:200 });
      };
      await assert.rejects(api(write ? 'claim' : 'event', write ? payload : undefined, 'lucky-days'), error => {
        assert.equal(error.uncertain, write);
        assert.match(error.message, /상태를 다시 확인해 주세요/);
        assert.doesNotMatch(error.message, /internal connection|invalid JSON/);
        return true;
      });
      assert.equal(calls.length, 1, 'A failed request must not automatically repeat a write.');
      const query = new URL(calls[0].url, 'http://localhost').searchParams;
      assert.deepEqual([...query.keys()], ['action', 'event']);
      assert.equal(query.get('event'), 'lucky-days');
      assert.ok(!calls[0].url.includes(payload.email));
      assert.ok(!calls[0].url.includes(payload.code));
      if (write) {
        assert.equal(calls[0].options.method, 'POST');
        assert.deepEqual(JSON.parse(calls[0].options.body), { ...payload, event:'lucky-days' });
      }
    }
  }

  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error:'참여 코드를 먼저 입력해 주세요.' }, { status:401 });
  };
  await assert.rejects(api('claim', payload, 'lucky-days'), error => {
    assert.equal(error.status, 401);
    assert.equal(error.uncertain, undefined);
    assert.equal(error.message, '참여 코드를 먼저 입력해 주세요.');
    return true;
  });
  assert.equal(calls, 1);
});
