// Unit test cho health.js với client gRPC giả và Redis giả (A01–A03).
// Sửa 2026-10-14 (spec 00 H13): chữ ra ngoài chỉ có healthy / unhealthy / ready / not_ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkService, createHealthHandlers } from '../src/health.js';

const NAMES = ['auth-service', 'customer-service', 'rating-service'];

// Client giả: 'SERVING' / 'NOT_SERVING' trả lời bình thường; 'DOWN' lỗi như service đã dừng; 'SLOW' quá deadline.
function fakeClient(state) {
  return {
    Check(req, metadata, opts, callback) {
      assert.ok(opts.deadline, 'mọi lời gọi gRPC phải có deadline');
      assert.equal(metadata.getOptions().waitForReady, true, 'Health/Check phải bật waitForReady (H14)');
      if (state === 'DOWN') callback(Object.assign(new Error('UNAVAILABLE'), { code: 14 }));
      else if (state === 'SLOW') callback(Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 4 }));
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

function handlers({ redisUp = true, states = {}, log } = {}) {
  const healthClients = Object.fromEntries(NAMES.map((n) => [n, fakeClient(states[n] ?? 'SERVING')]));
  return createHealthHandlers({ redisPing: async () => redisUp, healthClients, expectedServices: NAMES, log });
}

test('checkService: healthy khi SERVING; lý do riêng cho NOT_SERVING, không kết nối, quá hạn', async () => {
  assert.deepEqual(await checkService(fakeClient('SERVING')), { healthy: true });
  assert.deepEqual(await checkService(fakeClient('NOT_SERVING')), { healthy: false, reason: 'NOT_SERVING' });
  assert.deepEqual(await checkService(fakeClient('DOWN')), { healthy: false, reason: 'UNREACHABLE' });
  assert.deepEqual(await checkService(fakeClient('SLOW')), { healthy: false, reason: 'DEADLINE_EXCEEDED' });
});

test('A01 /health luôn 200 {"status":"healthy"}, kể cả khi Redis dừng (AC-HT-05, 07)', () => {
  const res = fakeRes();
  handlers({ redisUp: false }).live({}, res);
  assert.deepEqual([res.statusCode, res.payload], [200, { status: 'healthy' }]);
});

test('A02 /ready: Redis trả lời → 200 ready; Redis dừng → 503 not_ready, redis unhealthy (AC-HT-05, 07)', async () => {
  let res = fakeRes();
  await handlers().ready({}, res);
  assert.deepEqual([res.statusCode, res.payload], [200, { status: 'ready', checks: { redis: 'healthy', grpc_clients: 'healthy' } }]);
  res = fakeRes();
  await handlers({ redisUp: false }).ready({}, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, { status: 'not_ready', checks: { redis: 'unhealthy', grpc_clients: 'healthy' } });
});

test('A03: mọi service SERVING → 200 healthy, đúng thứ tự key (AC-HT-05)', async () => {
  const res = fakeRes();
  await handlers().services({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { status: 'healthy', services: { 'auth-service': 'healthy', 'customer-service': 'healthy', 'rating-service': 'healthy' } });
  assert.deepEqual(Object.keys(res.payload.services), NAMES);
});

test('A03: một service dừng, một mất database → 503 unhealthy cùng chữ; lý do chỉ ở log (AC-HT-06, 16, 17)', async () => {
  const warns = [];
  const log = { info() {}, warn: (msg, f) => warns.push({ msg, ...f }), error() {} };
  const res = fakeRes();
  await handlers({ states: { 'rating-service': 'DOWN', 'customer-service': 'NOT_SERVING' }, log }).services({ requestId: 'r1' }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, {
    status: 'unhealthy',
    services: { 'auth-service': 'healthy', 'customer-service': 'unhealthy', 'rating-service': 'unhealthy' },
  });
  // Body không còn chữ cũ.
  const body = JSON.stringify(res.payload);
  for (const old of ['NOT_SERVING', 'UNREACHABLE', 'SERVING', 'UP', 'DOWN', 'DEGRADED']) assert.ok(!body.includes(old), old);
  assert.deepEqual(warns, [
    { msg: 'service_unhealthy', service: 'customer-service', reason: 'NOT_SERVING', request_id: 'r1' },
    { msg: 'service_unhealthy', service: 'rating-service', reason: 'UNREACHABLE', request_id: 'r1' },
  ]);
});

test('checkService: deadline 1 000 ms và waitForReady === true (AC-HT-19)', async () => {
  let seen;
  const t0 = Date.now();
  await checkService({ Check(req, metadata, opts, cb) { seen = { metadata, opts }; cb(null, { status: 'SERVING' }); } });
  assert.equal(seen.metadata.getOptions().waitForReady, true);
  const left = seen.opts.deadline - t0;
  assert.ok(left >= 1000 && left <= 1050, `deadline ${left} ms`);
});
