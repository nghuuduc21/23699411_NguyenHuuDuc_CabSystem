// Unit test thử lại S7 (cùng cách sửa lỗi L1 như booking-service): chỉ thử lại MỘT lần và chỉ khi UNAVAILABLE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callWithRetry } from '../src/clients.js';

const fail = (statusName) => Object.assign(new Error(statusName), { statusName });

test('UNAVAILABLE lần đầu → thử lại một lần với waitForReady = true', async () => {
  const seen = [];
  const r = await callWithRetry(async (wait) => {
    seen.push(wait);
    if (!wait) throw fail('UNAVAILABLE');
    return 'ok';
  });
  assert.equal(r, 'ok');
  assert.deepEqual(seen, [false, true]);
});

test('lỗi khác (NOT_FOUND, DEADLINE_EXCEEDED) → không thử lại', async () => {
  for (const name of ['NOT_FOUND', 'DEADLINE_EXCEEDED']) {
    let n = 0;
    await assert.rejects(callWithRetry(async () => { n += 1; throw fail(name); }), (err) => err.statusName === name);
    assert.equal(n, 1);
  }
});

test('UNAVAILABLE cả hai lần → ném lỗi (không thử lần ba)', async () => {
  let n = 0;
  await assert.rejects(callWithRetry(async () => { n += 1; throw fail('UNAVAILABLE'); }));
  assert.equal(n, 2);
});
