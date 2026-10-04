// Unit test cho health.js với client gRPC giả và Redis giả (A01–A03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkService, createHealthHandlers } from '../src/health.js';

const NAMES = ['auth-service', 'customer-service', 'rating-service'];

// Client giả: 'SERVING' / 'NOT_SERVING' trả lời bình thường; 'DOWN' trả lỗi như service đã dừng.
function fakeClient(state) {
  return {
    Check(req, opts, callback) {
      assert.ok(opts.deadline, 'mọi lời gọi gRPC phải có deadline');
      if (state === 'DOWN') callback(Object.assign(new Error('UNAVAILABLE'), { code: 14 }));
      else callback(null, { status: state });
    },
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function handlers({ redisUp = true, states = {} } = {}) {
  const healthClients = Object.fromEntries(NAMES.map((n) => [n, fakeClient(states[n] ?? 'SERVING')]));
  return createHealthHandlers({ redisPing: async () => redisUp, healthClients, expectedServices: NAMES });
}

test('checkService đổi đúng ba trạng thái', async () => {
  assert.equal(await checkService(fakeClient('SERVING')), 'SERVING');
  assert.equal(await checkService(fakeClient('NOT_SERVING')), 'NOT_SERVING');
  assert.equal(await checkService(fakeClient('DOWN')), 'UNREACHABLE');
});

test('A01 /health luôn 200 UP, kể cả khi Redis dừng', () => {
  const res = fakeRes();
  handlers({ redisUp: false }).live({}, res);
  assert.deepEqual([res.statusCode, res.payload], [200, { status: 'UP' }]);
});

test('A02 /ready: Redis trả lời → 200 READY; Redis dừng → 503 NOT_READY, redis DOWN', async () => {
  let res = fakeRes();
  await handlers().ready({}, res);
  assert.deepEqual([res.statusCode, res.payload], [200, { status: 'READY', checks: { redis: 'UP', grpc_clients: 'UP' } }]);
  res = fakeRes();
  await handlers({ redisUp: false }).ready({}, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, { status: 'NOT_READY', checks: { redis: 'DOWN', grpc_clients: 'UP' } });
});

test('A03: mọi service SERVING → 200 UP', async () => {
  const res = fakeRes();
  await handlers().services({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { status: 'UP', services: { 'auth-service': 'SERVING', 'customer-service': 'SERVING', 'rating-service': 'SERVING' } });
});

test('A03: một service dừng, một mất database → 503 DEGRADED, ghi rõ service nào', async () => {
  const res = fakeRes();
  await handlers({ states: { 'rating-service': 'DOWN', 'customer-service': 'NOT_SERVING' } }).services({}, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, {
    status: 'DEGRADED',
    services: { 'auth-service': 'SERVING', 'customer-service': 'NOT_SERVING', 'rating-service': 'UNREACHABLE' },
  });
});
