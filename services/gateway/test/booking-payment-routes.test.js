// Test A19–A21, A23–A25, A30–A32 qua HTTP thật (cổng ngẫu nhiên) với booking-service, payment-service giả
// (spec 14-15-16-19-30). Kiểm tra phần việc của Gateway: role trước body, hình thức body / query, giá trị mặc
// định, chọn biến thể, metadata (idempotency-key, x-callback-secret), header Idempotency-Replayed, lọc field.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createBookingHandlers } from '../src/handlers/bookings.js';
import { createPaymentHandlers } from '../src/handlers/payments.js';
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
const bookingClient = fakeClient(['CreateBooking', 'ListBookings', 'GetBooking', 'ListOffers', 'AcceptOffer', 'RejectOffer']);
const paymentClient = fakeClient(['GetPayment', 'PayPayment', 'HandleProviderCallback']);

const revocations = { isRevoked: async () => false, revoke: async () => {} };
const health = { live() {}, ready() {}, services() {} };
const auth = createAuthHandlers({ authClient: {}, revocations, log });
const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });

let server;
let base;
before(async () => {
  const routes = buildRoutes({
    health, auth, bookings: createBookingHandlers({ bookingClient }), payments: createPaymentHandlers({ paymentClient }),
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
const send = (method, p, { t, body, headers = {} } = {}) => fetch(base + p, {
  method,
  headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...headers },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const expectError = async (res, status, error) => {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), { error });
};
const ROUTE = { from: [10.82, 106.68], to: [10.83, 106.69] };

// ---------- A19 ----------

test('A19: 201, điền mặc định CAR_4 / CASH, metadata danh tính, bỏ field from/to rỗng của proto', async () => {
  next = () => ({ res: { booking_id: 1000, status: 'SEARCHING', vehicle: 'CAR_4', pay: 'CASH', distance_m: 2026, fare: 45000, payment_id: 1000, from: [], to: [] } });
  const res = await send('POST', '/api/v1/bookings', { t: KH1, body: ROUTE });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { booking_id: 1000, status: 'SEARCHING', vehicle: 'CAR_4', pay: 'CASH', distance_m: 2026, fare: 45000, payment_id: 1000 });
  assert.equal(calls[0].name, 'CreateBooking');
  assert.deepEqual(calls[0].request, { ...ROUTE, vehicle: 'CAR_4', pay: 'CASH' });
  assert.equal(calls[0].metadata['x-account-id'], '1');
  assert.equal(calls[0].metadata['x-role'], 'customer');

  await send('POST', '/api/v1/bookings', { t: KH1, body: { ...ROUTE, vehicle: 'motorbike', pay: 'online', from_address: 'IUH' } });
  assert.deepEqual(calls[1].request, { ...ROUTE, vehicle: 'MOTORBIKE', pay: 'ONLINE', from_address: 'IUH' });
});

test('A19: hình thức sai → 400 đúng mã, không gọi service (AC-DX-09)', async () => {
  const cases = [
    [{ from: ROUTE.from }, 'INVALID_INPUT'],
    [{ ...ROUTE, from: [10.82] }, 'INVALID_INPUT'],
    [{ ...ROUTE, from: '10.82,106.68' }, 'INVALID_INPUT'],
    [{ ...ROUTE, from: ['10.82', 106.68] }, 'INVALID_INPUT'],
    [{ ...ROUTE, from: [91, 106.68] }, 'INVALID_COORDINATES'],
    [{ ...ROUTE, pay: 'CARD' }, 'INVALID_INPUT'],
    [{ ...ROUTE, customer_id: 2 }, 'INVALID_INPUT'],
    [{ ...ROUTE, fare: 1 }, 'INVALID_INPUT'],
    [{ ...ROUTE, from_address: '<b>x</b>' }, 'TEXT_CONTAINS_HTML'],
    [[1, 2], 'INVALID_INPUT'],
  ];
  for (const [body, error] of cases) await expectError(await send('POST', '/api/v1/bookings', { t: KH1, body }), 400, error);
  await expectError(await send('POST', '/api/v1/bookings', { t: KH1, body: '{abc' }), 400, 'INVALID_JSON');
  assert.equal(calls.length, 0);
});

test('A19: 401 không token; tài xế / admin → 403 dù không có body (role trước body — mục 28)', async () => {
  await expectError(await send('POST', '/api/v1/bookings', { body: ROUTE }), 401, 'TOKEN_MISSING');
  await expectError(await send('POST', '/api/v1/bookings', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('POST', '/api/v1/bookings', { t: AD1, body: '{abc' }), 403, 'FORBIDDEN');
});

test('A19: lỗi service → HTTP (400 của Payment qua Booking, 503 khi dừng)', async () => {
  next = () => ({ err: { code: grpc.status.INVALID_ARGUMENT, details: 'SAME_PICKUP_AND_DESTINATION' } });
  await expectError(await send('POST', '/api/v1/bookings', { t: KH1, body: { from: ROUTE.from, to: ROUTE.from } }), 400, 'SAME_PICKUP_AND_DESTINATION');
  next = () => ({ err: { code: grpc.status.UNAVAILABLE, details: 'SERVICE_UNAVAILABLE' } });
  await expectError(await send('POST', '/api/v1/bookings', { t: KH1, body: ROUTE }), 503, 'SERVICE_UNAVAILABLE');
});

// ---------- A20, A21 ----------

test('A20: query → message; mặc định page 1, limit 10; status chữ hoa; lọc key của phần tử', async () => {
  next = () => ({ res: { data: [{ booking_id: 7, status: 'PENDING_PAYMENT', vehicle: 'CAR_7', pay: 'ONLINE', fare: 56000, created_at: 'x', distance_m: 0, from: [] }], pagination: { page: 1, limit: 2, total: 7, total_pages: 4 } } });
  const res = await send('GET', '/api/v1/customers/1/bookings?limit=2&status=canceled', { t: KH1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    data: [{ booking_id: 7, status: 'PENDING_PAYMENT', vehicle: 'CAR_7', pay: 'ONLINE', fare: 56000, created_at: 'x' }],
    pagination: { page: 1, limit: 2, total: 7, total_pages: 4 },
  });
  // Mã khách trong đường dẫn gửi dạng chuỗi (số lớn không bị làm tròn); service so với mã trong token.
  assert.deepEqual(calls[0].request, { status: 'CANCELED', page: 1, limit: 2, customer_id: '1' });
  assert.equal(calls[0].metadata['x-account-id'], '1');
  await send('GET', '/api/v1/customers/1/bookings', { t: KH1 });
  assert.deepEqual(calls[1].request, { page: 1, limit: 10, customer_id: '1' });
  // Admin xem mọi mã (AC-DX-27).
  await send('GET', '/api/v1/customers/1/bookings?limit=2', { t: AD1 });
  assert.deepEqual(calls[2].request, { page: 1, limit: 2, customer_id: '1' });
  assert.equal(calls[2].metadata['x-role'], 'admin');
});

test('A20: 400 / 401 / 403; mã sai dạng → INVALID_ID; đường cũ → 404 (AC-DX-03, 28)', async () => {
  const P = '/api/v1/customers/1/bookings';
  for (const q of ['limit=abc', 'limit=51', 'page=0']) await expectError(await send('GET', `${P}?${q}`, { t: KH1 }), 400, 'INVALID_PAGINATION');
  for (const q of ['status=XYZ', 'sort=asc']) await expectError(await send('GET', `${P}?${q}`, { t: KH1 }), 400, 'INVALID_INPUT');
  await expectError(await send('GET', P), 401, 'TOKEN_MISSING');
  await expectError(await send('GET', P, { t: TX1 }), 403, 'FORBIDDEN');
  for (const id of ['abc', 'me', '1%20OR%201=1', '0']) await expectError(await send('GET', `/api/v1/customers/${id}/bookings`, { t: KH1 }), 400, 'INVALID_ID');
  await expectError(await send('GET', '/api/v1/bookings?limit=2', { t: KH1 }), 404, 'ROUTE_NOT_FOUND');
  assert.equal(calls.length, 0);
});

test('A20: khách xem mã khác → 403 NOT_OWNER do service trả (AC-DX-26)', async () => {
  next = () => ({ err: { code: grpc.status.PERMISSION_DENIED, details: 'NOT_OWNER' } });
  await expectError(await send('GET', '/api/v1/customers/2/bookings?limit=2', { t: KH1 }), 403, 'NOT_OWNER');
  assert.deepEqual(calls[0].request, { page: 1, limit: 2, customer_id: '2' });
});

test('A21: mã dạng chuỗi; admin xem được; tài xế 403; mã sai 400; field optional vắng thì không có key', async () => {
  next = () => ({ res: { booking_id: 3, status: 'DRIVER_ASSIGNED', vehicle: 'CAR_4', pay: 'CASH', distance_m: 2026, fare: 45000, payment_id: 3, from: [10.82, 106.68], to: [10.83, 106.69], driver_id: 11, trip_id: 3, created_at: 'x', _driver_id: 'driver_id' } });
  const res = await send('GET', '/api/v1/bookings/3', { t: AD1 });
  assert.deepEqual(await res.json(), { booking_id: 3, status: 'DRIVER_ASSIGNED', vehicle: 'CAR_4', pay: 'CASH', distance_m: 2026, fare: 45000, payment_id: 3, from: [10.82, 106.68], to: [10.83, 106.69], driver_id: 11, trip_id: 3, created_at: 'x' });
  assert.deepEqual(calls[0].request, { booking_id: '3' });
  await expectError(await send('GET', '/api/v1/bookings/abc', { t: KH1 }), 400, 'INVALID_ID');
  await expectError(await send('GET', '/api/v1/bookings/7', { t: TX1 }), 403, 'FORBIDDEN');
  next = () => ({ err: { code: grpc.status.PERMISSION_DENIED, details: 'NOT_OWNER' } });
  await expectError(await send('GET', '/api/v1/bookings/7', { t: KH1 }), 403, 'NOT_OWNER');
});

// ---------- A23–A25 ----------

test('A23: chỉ tài xế; status không gửi thì không có trong message (service lọc PENDING)', async () => {
  next = () => ({ res: { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } } });
  const res = await send('GET', '/api/v1/offers', { t: TX1 });
  assert.deepEqual(await res.json(), { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } });
  assert.deepEqual(calls[0].request, { page: 1, limit: 10 });
  await send('GET', '/api/v1/offers?status=expired', { t: TX1 });
  assert.deepEqual(calls[1].request, { status: 'EXPIRED', page: 1, limit: 10 });
  await expectError(await send('GET', '/api/v1/offers', { t: KH1 }), 403, 'FORBIDDEN');
  await expectError(await send('GET', '/api/v1/offers?status=NEW', { t: TX1 }), 400, 'INVALID_INPUT');
});

test('PATCH /offers/{id}: ACCEPTED → AcceptOffer, rejected → RejectOffer; còn lại 400 (AC-DX-20)', async () => {
  next = (name) => ({ res: name === 'AcceptOffer'
    ? { offer_id: 1000, status: 'ACCEPTED', booking_id: 1000, booking_status: 'DRIVER_ASSIGNED', trip_id: 1000, trip_status: 'ACCEPTED' }
    : { offer_id: 1000, status: 'REJECTED' } });
  let res = await send('PATCH', '/api/v1/offers/1000', { t: TX1, body: { status: 'ACCEPTED' } });
  assert.deepEqual(await res.json(), { offer_id: 1000, status: 'ACCEPTED', booking_id: 1000, booking_status: 'DRIVER_ASSIGNED', trip_id: 1000, trip_status: 'ACCEPTED' });
  assert.equal(calls[0].name, 'AcceptOffer');
  assert.deepEqual(calls[0].request, { offer_id: '1000' });
  res = await send('PATCH', '/api/v1/offers/1000', { t: TX1, body: { status: 'rejected' } });
  assert.deepEqual(await res.json(), { offer_id: 1000, status: 'REJECTED' });
  assert.equal(calls[1].name, 'RejectOffer');
  for (const body of [{ status: 'PENDING' }, {}, undefined, { status: 'ACCEPTED', x: 1 }]) {
    await expectError(await send('PATCH', '/api/v1/offers/1000', { t: TX1, body }), 400, 'INVALID_INPUT');
  }
  await expectError(await send('PATCH', '/api/v1/offers/abc', { t: TX1, body: { status: 'ACCEPTED' } }), 400, 'INVALID_ID');
  await expectError(await send('PATCH', '/api/v1/offers/1000', { t: KH1, body: { status: 'ACCEPTED' } }), 403, 'FORBIDDEN');
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'INVALID_STATUS_TRANSITION' } });
  await expectError(await send('PATCH', '/api/v1/offers/1000', { t: TX1, body: { status: 'ACCEPTED' } }), 409, 'INVALID_STATUS_TRANSITION');
});

// ---------- A30–A32 ----------

test('A30: fare và transactions chỉ giữ key cho phép', async () => {
  next = () => ({ res: {
    payment_id: 7, booking_id: 7, method: 'ONLINE', status: 'COMPLETED', amount: 56000,
    fare: { distance_m: 2026, base_fare: 25000, per_km_rate: 15000, min_fare: 40000 }, expires_at: 'e', paid_at: 'p',
    transactions: [{ txn_id: 'SIM-7-1', type: 'CHARGE', attempt_no: 1, status: 'SUCCEEDED', amount: 56000, _attempt_no: 'attempt_no' }],
  } });
  const res = await send('GET', '/api/v1/payments/7', { t: KH1 });
  assert.deepEqual(await res.json(), {
    payment_id: 7, booking_id: 7, method: 'ONLINE', status: 'COMPLETED', amount: 56000,
    fare: { distance_m: 2026, base_fare: 25000, per_km_rate: 15000, min_fare: 40000 }, expires_at: 'e', paid_at: 'p',
    transactions: [{ txn_id: 'SIM-7-1', type: 'CHARGE', attempt_no: 1, status: 'SUCCEEDED', amount: 56000 }],
  });
  await expectError(await send('GET', '/api/v1/payments/7', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('GET', '/api/v1/payments/abc', { t: KH1 }), 400, 'INVALID_ID');
});

test('A31: Idempotency-Key → metadata; replayed → header, bỏ khỏi body', async () => {
  const body = { payment_id: 7, status: 'PENDING', txn_id: 'SIM-7-1', txn_status: 'PENDING', attempt_no: 1, attempts_left: 2, expires_at: 'e' };
  next = () => ({ res: { ...body, replayed: false } });
  let res = await send('POST', '/api/v1/payments/7/transactions', { t: KH1, body: { simulate_result: 'manual' }, headers: { 'Idempotency-Key': ' k1 ' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('idempotency-replayed'), null);
  assert.deepEqual(await res.json(), body);
  assert.deepEqual(calls[0].request, { payment_id: '7', simulate_result: 'MANUAL' });
  assert.equal(calls[0].metadata['idempotency-key'], 'k1');
  next = () => ({ res: { ...body, replayed: true } });
  res = await send('POST', '/api/v1/payments/7/transactions', { t: KH1, headers: { 'Idempotency-Key': 'k1' } });
  assert.equal(res.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(await res.json(), body);
  assert.deepEqual(calls[1].request, { payment_id: '7' });
});

test('A31: thiếu khóa / body sai / role sai', async () => {
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: KH1 }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: KH1, headers: { 'Idempotency-Key': '   ' } }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: KH1, headers: { 'Idempotency-Key': 'k'.repeat(101) } }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: KH1, body: { simulate_result: 'X' }, headers: { 'Idempotency-Key': 'k1' } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: KH1, body: { amount: 1 }, headers: { 'Idempotency-Key': 'k1' } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/payments/7/transactions', { t: AD1, headers: { 'Idempotency-Key': 'k1' } }), 403, 'FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('A32: không cần token; X-Callback-Secret → metadata; header client không lọt x-role', async () => {
  next = () => ({ res: { txn_id: 'SIM-7-1', txn_status: 'SUCCEEDED', payment_id: 7, status: 'COMPLETED', replayed: true } });
  const res = await send('POST', '/api/v1/payment-callbacks', { body: { txn_id: 'SIM-7-1' }, headers: { 'X-Callback-Secret': 'cab-secret', 'x-role': 'system' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(await res.json(), { txn_id: 'SIM-7-1', txn_status: 'SUCCEEDED', payment_id: 7, status: 'COMPLETED' });
  assert.deepEqual(calls[0].request, { txn_id: 'SIM-7-1' });
  assert.equal(calls[0].metadata['x-callback-secret'], 'cab-secret');
  assert.equal(calls[0].metadata['x-role'], undefined);
  // Không có header → không có metadata (service trả 401).
  await send('POST', '/api/v1/payment-callbacks', { body: { txn_id: 'SIM-7-1', result: 'failed', amount: 56000 } });
  assert.equal(calls[1].metadata['x-callback-secret'], undefined);
  assert.deepEqual(calls[1].request, { txn_id: 'SIM-7-1', result: 'FAILED', amount: 56000 });
});

test('A32: hình thức sai → 400 (AC-TT-11)', async () => {
  for (const body of [{}, { txn_id: 'SIM-7-1', result: 'OK' }, { txn_id: 'SIM-7-1', amount: 0 }, { txn_id: 'SIM-7-1', amount: '1' }, { txn_id: 1 }, { txn_id: 'SIM-7-1', x: 1 }]) {
    await expectError(await send('POST', '/api/v1/payment-callbacks', { body, headers: { 'X-Callback-Secret': 'cab-secret' } }), 400, 'INVALID_INPUT');
  }
  await expectError(await send('POST', '/api/v1/payment-callbacks', { body: '{x' }), 400, 'INVALID_JSON');
  next = () => ({ err: { code: grpc.status.UNAUTHENTICATED, details: 'INVALID_CALLBACK_SECRET' } });
  await expectError(await send('POST', '/api/v1/payment-callbacks', { body: { txn_id: 'SIM-7-1' }, headers: { 'X-Callback-Secret': 'sai' } }), 401, 'INVALID_CALLBACK_SECRET');
});

test('mọi lời gọi gRPC của các route trên: waitForReady === true, deadline 3 000 ms (H14, AC-HT-19)', () => {
  recorder.assertAllCallsWaitForReady();
});
