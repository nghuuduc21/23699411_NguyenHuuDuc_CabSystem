// Test A22, A27–A29, A33 qua HTTP thật (cổng ngẫu nhiên) với booking / trip / notification-service giả (spec 17-18
// mục 4). Kiểm phần việc của Gateway: role đường dẫn TRƯỚC body, chọn biến thể theo `status`, role biến thể, hình thức
// `reason`, mã trong đường dẫn, query, metadata danh tính, lọc field, đổi lỗi gRPC → HTTP.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createBookingHandlers } from '../src/handlers/bookings.js';
import { createTripHandlers } from '../src/handlers/trips.js';
import { createNotificationHandlers } from '../src/handlers/notifications.js';
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
const health = { live() {}, ready() {}, services() {} };
const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });

let server;
let base;
before(async () => {
  const routes = buildRoutes({
    health,
    auth: createAuthHandlers({ authClient: {}, revocations, log }),
    bookings: createBookingHandlers({ bookingClient: fakeClient(['GetBooking', 'CancelBooking']) }),
    trips: createTripHandlers({ tripClient: fakeClient(['GetTrip', 'UpdateTripStatus', 'CancelTrip']) }),
    notifications: createNotificationHandlers({ notificationClient: fakeClient(['ListNotifications']) }),
  });
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
const expectError = async (res, status, error) => {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), { error });
};

// ---------- A28 / A29 ----------

test('A28: tài xế ARRIVED → UpdateTripStatus, status chữ hoa, trip_id dạng chuỗi, metadata; response có history', async () => {
  next = () => ({ res: { trip_id: 1000, status: 'ARRIVED', history: [{ status: 'ACCEPTED', at: 'a' }, { status: 'ARRIVED', at: 'b' }] } });
  const res = await send('PATCH', '/api/v1/trips/1000', { t: TX1, body: { status: 'arrived' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { trip_id: 1000, status: 'ARRIVED', history: [{ status: 'ACCEPTED', at: 'a' }, { status: 'ARRIVED', at: 'b' }] });
  assert.equal(calls[0].name, 'UpdateTripStatus');
  assert.deepEqual(calls[0].request, { trip_id: '1000', status: 'ARRIVED' });
  assert.equal(calls[0].metadata['x-account-id'], '11');
  assert.equal(calls[0].metadata['x-role'], 'driver');
});

test('A28: nhảy cóc → 409 INVALID_STATUS_TRANSITION; 404, 403 NOT_OWNER từ service; trip-service dừng → 503', async () => {
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'INVALID_STATUS_TRANSITION' } });
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1, body: { status: 'COMPLETED' } }), 409, 'INVALID_STATUS_TRANSITION');
  next = () => ({ err: { code: grpc.status.NOT_FOUND, details: 'TRIP_NOT_FOUND' } });
  await expectError(await send('PATCH', '/api/v1/trips/999', { t: TX1, body: { status: 'ARRIVED' } }), 404, 'TRIP_NOT_FOUND');
  next = () => ({ err: { code: grpc.status.PERMISSION_DENIED, details: 'NOT_OWNER' } });
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1, body: { status: 'ARRIVED' } }), 403, 'NOT_OWNER');
  next = () => ({ err: { code: grpc.status.UNAVAILABLE, details: 'x' } });
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1, body: { status: 'ARRIVED' } }), 503, 'SERVICE_UNAVAILABLE');
});

test('A28 / A29 hình thức (AC-CD-06): ACCEPTED, BUSY, body rỗng, reason ở A28, số → 400; abc → INVALID_ID; không phải JSON → INVALID_JSON', async () => {
  for (const body of [{ status: 'ACCEPTED' }, { status: 'BUSY' }, {}, { status: 'ARRIVED', reason: 'x' }, { status: 5 }, [1], { status: 'CANCELED', reason: 'x', foo: 1 }]) {
    await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1, body }), 400, 'INVALID_INPUT');
  }
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1 }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/trips/abc', { t: TX1, body: { status: 'ARRIVED' } }), 400, 'INVALID_ID');
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: TX1, body: '{abc' }), 400, 'INVALID_JSON');
  assert.equal(calls.length, 0);
});

test('A28 / A29 quyền: khách gửi A28 → 403; admin → 403 dù không body (CD-Q7); không token → 401', async () => {
  await expectError(await send('PATCH', '/api/v1/trips/1000', { t: KH1, body: { status: 'ARRIVED' } }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/trips/5', { t: AD1 }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/trips/5', { t: AD1, body: { status: 'CANCELED', reason: 'x' } }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/trips/5', { body: { status: 'CANCELED', reason: 'x' } }), 401, 'TOKEN_MISSING');
  assert.equal(calls.length, 0);
});

test('A29: khách hủy trip 5 → CancelTrip { trip_id, reason }; response 4 field', async () => {
  next = () => ({ res: { trip_id: 5, status: 'CANCELED', canceled_by: 'customer', reason: 'ban viec' } });
  const res = await send('PATCH', '/api/v1/trips/5', { t: KH1, body: { status: 'canceled', reason: 'ban viec' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { trip_id: 5, status: 'CANCELED', canceled_by: 'customer', reason: 'ban viec' });
  assert.equal(calls[0].name, 'CancelTrip');
  assert.deepEqual(calls[0].request, { trip_id: '5', reason: 'ban viec' });
  // Tài xế cũng hủy được (FR41).
  await send('PATCH', '/api/v1/trips/5', { t: TX1, body: { status: 'CANCELED', reason: 'xe hong' } });
  assert.equal(calls[1].name, 'CancelTrip');
});

test('A29 reason (AC-CD-10): thiếu / null / khoảng trắng → REASON_REQUIRED; HTML; 256 ký tự, số → INVALID_INPUT; 409 từ service', async () => {
  const cases = [
    [{ status: 'CANCELED' }, 'REASON_REQUIRED'],
    [{ status: 'CANCELED', reason: null }, 'REASON_REQUIRED'],
    [{ status: 'CANCELED', reason: '  ' }, 'REASON_REQUIRED'],
    [{ status: 'CANCELED', reason: '<b>x</b>' }, 'TEXT_CONTAINS_HTML'],
    [{ status: 'CANCELED', reason: 'a'.repeat(256) }, 'INVALID_INPUT'],
    [{ status: 'CANCELED', reason: 5 }, 'INVALID_INPUT'],
  ];
  for (const [body, error] of cases) await expectError(await send('PATCH', '/api/v1/trips/5', { t: KH1, body }), 400, error);
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'TRIP_NOT_CANCELABLE' } });
  await expectError(await send('PATCH', '/api/v1/trips/4', { t: KH1, body: { status: 'CANCELED', reason: 'x' } }), 409, 'TRIP_NOT_CANCELABLE');
});

// ---------- A27 ----------

test('A27: cả ba role gọi được; lọc field, bỏ field optional rỗng; history chỉ status, at', async () => {
  next = () => ({ res: {
    trip_id: 1000, booking_id: 1000, status: 'ACCEPTED', vehicle: 'CAR_4', pay: 'CASH', fare: 45000, customer_id: 1, driver_id: 11,
    from: [10.82, 106.68], to: [10.83, 106.69], created_at: 'c', history: [{ status: 'ACCEPTED', at: 'a', extra: 1 }], _started_at: 'started_at',
    driver: { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001', _name: 'name', _plate: 'plate' },
  } });
  for (const t of [KH1, TX1, AD1]) {
    const res = await send('GET', '/api/v1/trips/1000', { t });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      trip_id: 1000, booking_id: 1000, status: 'ACCEPTED', vehicle: 'CAR_4', pay: 'CASH', fare: 45000, customer_id: 1, driver_id: 11,
      from: [10.82, 106.68], to: [10.83, 106.69], created_at: 'c', history: [{ status: 'ACCEPTED', at: 'a' }],
      driver: { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001' }, // CD10: bản chụp lúc nhận chuyến
    });
  }
  assert.deepEqual(calls[0].request, { trip_id: '1000' });
  await expectError(await send('GET', '/api/v1/trips/abc', { t: KH1 }), 400, 'INVALID_ID');
  await expectError(await send('GET', '/api/v1/trips/1000'), 401, 'TOKEN_MISSING');
  // A26 chưa làm → 404.
  await expectError(await send('GET', '/api/v1/trips', { t: AD1 }), 404, 'ROUTE_NOT_FOUND');
});

// ---------- A22 ----------

test('A22: khách hủy booking → CancelBooking { booking_id, reason }; response 3 field', async () => {
  next = () => ({ res: { booking_id: 1001, status: 'CANCELED', canceled_by: 'customer' } });
  const res = await send('PATCH', '/api/v1/bookings/1001', { t: KH1, body: { status: 'CANCELED', reason: 'doi y' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { booking_id: 1001, status: 'CANCELED', canceled_by: 'customer' });
  assert.deepEqual(calls[0].request, { booking_id: '1001', reason: 'doi y' });
  assert.equal(calls[0].name, 'CancelBooking');
});

test('A22 lỗi (AC-CD-18): status khác / thiếu reason / field lạ → 400; tài xế, admin 403 trước body; 409 từ service', async () => {
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: KH1, body: { status: 'SEARCHING', reason: 'x' } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: KH1, body: { status: 'CANCELED' } }), 400, 'REASON_REQUIRED');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: KH1, body: { status: 'CANCELED', reason: 'x', fare: 1 } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: KH1, body: { reason: 'x' } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/bookings/abc', { t: KH1, body: { status: 'CANCELED', reason: 'x' } }), 400, 'INVALID_ID');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { t: AD1 }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/bookings/7', { body: { status: 'CANCELED', reason: 'x' } }), 401, 'TOKEN_MISSING');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'BOOKING_ALREADY_ASSIGNED' } });
  await expectError(await send('PATCH', '/api/v1/bookings/3', { t: KH1, body: { status: 'CANCELED', reason: 'x' } }), 409, 'BOOKING_ALREADY_ASSIGNED');
});

// ---------- A33 ----------

test('A33: mặc định page 1 limit 10; data chỉ key có giá trị; cả ba role; metadata danh tính', async () => {
  next = () => ({ res: {
    data: [{ type: 'TRIP_ACCEPTED', title: 't', body: 'b', data: { trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'ACCEPTED', _amount: 'amount' }, created_at: 'c' }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
  } });
  const res = await send('GET', '/api/v1/notifications', { t: KH1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    data: [{ type: 'TRIP_ACCEPTED', title: 't', body: 'b', data: { trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'ACCEPTED' }, created_at: 'c' }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
  });
  assert.deepEqual(calls[0].request, { page: 1, limit: 10 });
  assert.equal(calls[0].metadata['x-account-id'], '1');
  for (const t of [TX1, AD1]) assert.equal((await send('GET', '/api/v1/notifications?limit=1&page=2', { t })).status, 200);
  assert.deepEqual(calls[2].request, { page: 2, limit: 1 });
});

test('A33 lỗi (AC-TB-04): limit=abc, page=0 → INVALID_PAGINATION; foo=1 → INVALID_INPUT; không token 401; service dừng 503', async () => {
  await expectError(await send('GET', '/api/v1/notifications?limit=abc', { t: KH1 }), 400, 'INVALID_PAGINATION');
  await expectError(await send('GET', '/api/v1/notifications?page=0', { t: KH1 }), 400, 'INVALID_PAGINATION');
  await expectError(await send('GET', '/api/v1/notifications?foo=1', { t: KH1 }), 400, 'INVALID_INPUT');
  await expectError(await send('GET', '/api/v1/notifications'), 401, 'TOKEN_MISSING');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.UNAVAILABLE, details: 'x' } });
  await expectError(await send('GET', '/api/v1/notifications', { t: KH1 }), 503, 'SERVICE_UNAVAILABLE');
});

test('mọi lời gọi gRPC của các route trên: waitForReady === true, deadline 3 000 ms (H14, AC-HT-19)', () => {
  recorder.assertAllCallsWaitForReady();
});
