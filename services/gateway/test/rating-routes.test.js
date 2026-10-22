// Test A34–A36 qua HTTP thật (cổng ngẫu nhiên) với rating-service giả (spec 20-29 mục 4.1, 4.2). Kiểm phần việc của
// Gateway: role đường dẫn TRƯỚC body, hình thức body / query, chọn biến thể theo query, metadata danh tính, lọc field,
// đổi lỗi gRPC → HTTP.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createRatingHandlers } from '../src/handlers/ratings.js';
import { createAuthenticator } from '../src/token.js';
import { createCallOptionsRecorder } from './grpc-call-options.js';

const recorder = createCallOptionsRecorder();

const SECRET = 'demo-jwt-secret-chi-dung-cho-may-demo-32b';
const log = { info() {}, warn() {}, error() {} };

const calls = [];
let next;
const fakeRpc = (name) => (request, metadata, options, callback) => {
  recorder.recordCallOptions(name, metadata, options);
  calls.push({ name, request, metadata: metadata.getMap() });
  const { err, res } = next(name, request);
  setImmediate(() => callback(err ?? null, res));
};
const fakeClient = (names) => Object.fromEntries(names.map((n) => [n, fakeRpc(n)]));
const revocations = { isRevoked: async () => false, revoke: async () => {} };

let server;
let base;
before(async () => {
  const routes = buildRoutes({
    health: { live() {}, ready() {}, services() {} },
    auth: createAuthHandlers({ authClient: {}, revocations, log }),
    ratings: createRatingHandlers({ ratingClient: fakeClient(['CreateRating', 'GetRatingByTrip', 'GetDriverRating']) }),
  });
  const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });
  server = createApp({ routes, log, authenticate }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  calls.length = 0;
  next = () => ({ res: {} });
});

const token = (sub, role) => jwt.sign({ role }, SECRET, { algorithm: 'HS256', expiresIn: 3600, subject: sub, jwtid: `jti-${Math.random()}` });
const KH1 = token('1', 'customer');
const TX1 = token('11', 'driver');
const AD1 = token('99', 'admin');
const send = (method, p, { t, body } = {}) => fetch(base + p, {
  method,
  headers: t ? { Authorization: `Bearer ${t}` } : {},
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const json = async (res) => [res.status, await res.json()];

test('AC-DG-01 (Gateway): A34 → 201, chuyển trip_id / score, metadata danh tính; lọc field phụ của oneof', async () => {
  next = () => ({ res: { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1, _comment: 'comment' } });
  const r = await send('POST', '/api/v1/ratings', { t: KH1, body: { trip_id: 4, score: 5 } });
  assert.deepEqual(await json(r), [201, { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1 }]);
  assert.equal(calls[0].name, 'CreateRating');
  assert.deepEqual(calls[0].request, { trip_id: 4, score: 5 });
  assert.equal(calls[0].metadata['x-account-id'], '1');
  assert.equal(calls[0].metadata['x-role'], 'customer');
});

test('A34: comment cắt khoảng trắng rồi chuyển; response có comment', async () => {
  next = () => ({ res: { rating_id: 1001, trip_id: 1000, driver_id: 11, score: 4, comment: 'Tai xe vui ve', driver_avg: 4.5, driver_count: 2 } });
  const r = await send('POST', '/api/v1/ratings', { t: KH1, body: { trip_id: 1000, score: 4, comment: '  Tai xe vui ve ' } });
  const [status, body] = await json(r);
  assert.equal(status, 201);
  assert.equal(body.comment, 'Tai xe vui ve');
  assert.equal(body.driver_avg, 4.5);
  assert.equal(calls[0].request.comment, 'Tai xe vui ve');
});

test('AC-DG-05 (Gateway): hình thức body sai → 400, không gọi service', async () => {
  const invalid = [
    { trip_id: 4 }, { trip_id: 4, score: 0 }, { trip_id: 4, score: 6 }, { trip_id: 4, score: 4.5 }, { trip_id: 4, score: '5' },
    { trip_id: '4', score: 5 }, { trip_id: 0, score: 5 }, { trip_id: -1, score: 5 }, { trip_id: 4, score: 5, driver_id: 13 },
    { trip_id: 4, score: 5, comment: 'a'.repeat(501) }, { trip_id: 4, score: 5, comment: '   ' }, { trip_id: 4.5, score: 5 },
    { trip_id: 4, score: 5, comment: 5 }, [], { trip_id: 2 ** 53, score: 5 },
  ];
  for (const body of invalid) {
    assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { t: KH1, body })), [400, { error: 'INVALID_INPUT' }], JSON.stringify(body).slice(0, 60));
  }
  assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { t: KH1, body: { trip_id: 4, score: 5, comment: '<b>x</b>' } })), [400, { error: 'TEXT_CONTAINS_HTML' }]);
  assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { t: KH1, body: '{abc' })), [400, { error: 'INVALID_JSON' }]);
  assert.equal(calls.length, 0);
});

test('AC-DG-06 (Gateway): không token → 401; tài xế không body → 403 (role trước body); admin → 403', async () => {
  assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { body: { trip_id: 4, score: 5 } })), [401, { error: 'TOKEN_MISSING' }]);
  assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { t: TX1 })), [403, { error: 'FORBIDDEN' }]);
  assert.deepEqual(await json(await send('POST', '/api/v1/ratings', { t: AD1, body: { trip_id: 4, score: 5 } })), [403, { error: 'FORBIDDEN' }]);
  assert.equal(calls.length, 0);
});

test('A34: lỗi gRPC → HTTP (404, 403 NOT_OWNER, 409 ×2, UNAVAILABLE → 503)', async () => {
  const cases = [
    [grpc.status.NOT_FOUND, 'TRIP_NOT_FOUND', 404],
    [grpc.status.PERMISSION_DENIED, 'NOT_OWNER', 403],
    [grpc.status.FAILED_PRECONDITION, 'TRIP_NOT_COMPLETED', 409],
    [grpc.status.ALREADY_EXISTS, 'RATING_ALREADY_EXISTS', 409],
    [grpc.status.UNAVAILABLE, 'TRIP_UNAVAILABLE', 503],
  ];
  for (const [code, details, http] of cases) {
    next = () => ({ err: { code, details } });
    const [status, body] = await json(await send('POST', '/api/v1/ratings', { t: KH1, body: { trip_id: 4, score: 5 } }));
    assert.equal(status, http, details);
    assert.deepEqual(body, { error: http === 503 ? 'SERVICE_UNAVAILABLE' : details });
  }
});

test('AC-DG-09 (Gateway): ?trip_id=4 → A35 GetRatingByTrip, mã gửi dạng chuỗi; cả ba role được gọi', async () => {
  next = () => ({ res: { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, created_at: '2026-10-05T01:00:00.000Z' } });
  for (const t of [KH1, TX1, AD1]) {
    const [status, body] = await json(await send('GET', '/api/v1/ratings?trip_id=4', { t }));
    assert.equal(status, 200);
    assert.deepEqual(body, { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, created_at: '2026-10-05T01:00:00.000Z' });
  }
  assert.equal(calls[0].name, 'GetRatingByTrip');
  assert.deepEqual(calls[0].request, { trip_id: '4' });
});

test('AC-DG-10 (Gateway): ?driver_id → A36; count luôn có (kể cả 0), avg chỉ khi có', async () => {
  next = () => ({ res: { driver_id: 11, avg: 5, count: 1 } });
  assert.deepEqual(await json(await send('GET', '/api/v1/ratings?driver_id=11', { t: KH1 })), [200, { driver_id: 11, avg: 5, count: 1 }]);
  next = () => ({ res: { driver_id: 999 } }); // count 0 có thể bị bỏ khi nạp proto không điền mặc định
  assert.deepEqual(await json(await send('GET', '/api/v1/ratings?driver_id=999', { t: KH1 })), [200, { driver_id: 999, count: 0 }]);
  assert.equal(calls[0].name, 'GetDriverRating');
});

test('AC-DG-11 (Gateway): query sai → 400 (INVALID_INPUT / INVALID_ID); không token → 401', async () => {
  const cases = [
    ['/api/v1/ratings', 'INVALID_INPUT'],
    ['/api/v1/ratings?trip_id=4&driver_id=11', 'INVALID_INPUT'],
    ['/api/v1/ratings?trip_id=abc', 'INVALID_ID'],
    ['/api/v1/ratings?trip_id=4%20OR%201=1', 'INVALID_ID'],
    ['/api/v1/ratings?trip_id=4&page=1', 'INVALID_INPUT'],
    ['/api/v1/ratings?trip_id=4&trip_id=5', 'INVALID_INPUT'],
    ['/api/v1/ratings?driver_id=0', 'INVALID_ID'],
  ];
  for (const [p, error] of cases) assert.deepEqual(await json(await send('GET', p, { t: KH1 })), [400, { error }], p);
  assert.deepEqual(await json(await send('GET', '/api/v1/ratings?trip_id=4')), [401, { error: 'TOKEN_MISSING' }]);
  assert.equal(calls.length, 0);
});

test('mọi lời gọi gRPC của các route trên: waitForReady === true, deadline 3 000 ms (H14, AC-HT-19)', () => {
  recorder.assertAllCallsWaitForReady();
});
