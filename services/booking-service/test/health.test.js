// Unit test cho health.js: SERVING chỉ khi đã migration xong và database trả lời (spec 00 mục 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth } from '../src/health.js';

test('chưa chạy xong migration thì NOT_SERVING', async () => {
  const health = createHealth({ ping: async () => {} });
  assert.equal(await health.check(), 'NOT_SERVING');
});

test('đã sẵn sàng và database trả lời thì SERVING', async () => {
  const health = createHealth({ ping: async () => {} });
  health.markReady();
  assert.equal(await health.check(), 'SERVING');
});

test('database không trả lời thì NOT_SERVING', async () => {
  const health = createHealth({ ping: async () => { throw new Error('DB_PING_TIMEOUT'); } });
  health.markReady();
  assert.equal(await health.check(), 'NOT_SERVING');
});
