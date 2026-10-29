import test from 'node:test';
import assert from 'node:assert/strict';
import { getDrawState } from '../public/participation.js';

const event = { status: 'active', soldOut: false, identified: true, start: '2026-10-27T15:00:00Z', end: '2026-10-31T15:00:00Z', now: '2026-10-29T14:59:59Z' };

test('a winner keeps a clear next step through registration and issuance, even after closure', () => {
  const closed = { ...event, status: 'ended', soldOut: true };
  const win = { prize: { rank: 1 }, claimed: false, fulfilled: false };
  const pending = getDrawState(closed, win);
  assert.equal(pending.phase, 'claim');
  assert.equal(pending.button, '수령 이메일 등록하기');
  assert.equal(pending.disabled, false);
  assert.equal(pending.nextAt, null);
  assert.equal(getDrawState(closed, { ...win, claimed: true }).phase, 'waiting');
  const issued = getDrawState(closed, { ...win, claimed: true, fulfilled: true });
  assert.equal(issued.phase, 'fulfilled');
  assert.match(issued.hint, /이메일/);
});

test('a loss offers the next Korean midnight only while another event day is available', () => {
  const loss = { prize: null, day: 2 };
  const done = getDrawState(event, loss);
  assert.equal(done.phase, 'done');
  assert.equal(done.nextAt, '2026-10-29T15:00:00.000Z');
  assert.match(done.hint, /10월 30일 00:00\(한국 시간\)/);
  assert.equal(getDrawState({ ...event, now: '2026-10-29T15:00:00Z' }, loss).nextAt, '2026-10-30T15:00:00.000Z');
  for (const unavailable of [
    { ...event, end: done.nextAt },
    { ...event, status: 'paused' },
    { ...event, status: 'ended' },
    { ...event, soldOut: true }
  ]) {
    const state = getDrawState(unavailable, loss);
    assert.equal(state.nextAt, null);
    assert.doesNotMatch(state.hint, /내일|00:00|부터 다시 참여/);
    assert.equal(state.disabled, false, 'saved results remain available');
  }
  assert.match(getDrawState({ ...event, status: 'paused' }, loss).hint, /중지/);
  assert.match(getDrawState({ ...event, soldOut: true }, loss).hint, /소진/);
});

test('codes remain usable for result recovery while new participation is closed', () => {
  assert.equal(getDrawState({ ...event, identified: false }, null).phase, 'verify');
  assert.equal(getDrawState(event, null).phase, 'ready');
  const upcoming = getDrawState({ ...event, status: 'upcoming', identified: false }, null);
  assert.equal(upcoming.phase, 'closed');
  assert.equal(upcoming.button, '참여 내역 확인하기');
  assert.equal(upcoming.disabled, false);
  assert.match(upcoming.hint, /10월 28일 00:00/);
  assert.equal(getDrawState({ ...event, status: 'paused' }, null).disabled, true);
});
