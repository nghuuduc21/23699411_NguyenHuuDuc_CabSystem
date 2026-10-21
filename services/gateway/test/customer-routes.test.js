// Test A37, A38, A09, A10 qua HTTP thật (cổng ngẫu nhiên) với customer-service giả (spec 11).
// Kiểm tra phần việc của Gateway: role, hình thức body, dạng mã, đổi REST ↔ gRPC, metadata.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createCustomerHandlers } from '../src/handlers/customers.js';
import { createAuthenticator } from '../src/token.js';

const SECRET = 'demo-jwt-secret-chi-dung-cho-may-demo-32b';
const log = { info() {}, warn() {}, error() {} };

// customer-service giả: ghi lại request và metadata; `next` quyết định kết quả lần gọi tới.
const calls = [];
let next;
const fakeRpc = (name) => (request, metadata, options, callback) => {
  calls.push({ name, request, metadata: metadata.getMap(), deadline: options.deadline });
  const { err, res } = next(name, request);
  setImmediate(() => callback(err ?? null, res));
};
const customerClient = {
  CreateCustomer: fakeRpc('CreateCustomer'),
  GetCustomer: fakeRpc('GetCustomer'),
  UpdateCustomer: fakeRpc('UpdateCustomer'),
};

const revocations = { isRevoked: async () => false, revoke: async () => {} };
const health = { live() {}, ready() {}, services() {} };
const auth = createAuthHandlers({ authClient: {}, revocations, log });
const customers = createCustomerHandlers({ customerClient });
const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });

let server;
let base;
before(async () => {
  server = createApp({ routes: buildRoutes({ health, auth, customers }), log, authenticate }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  calls.length = 0;
  next = () => ({ res: { customer_id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01', phone: '0900000001' } });
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
async function expectJson(res, status, json) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), json);
}

test('A09: khách xem mã của mình → 200; mã gửi xuống service dạng chuỗi, metadata từ token', async () => {
  const res = await send('GET', '/api/v1/customers/1', { t: KH1, headers: { 'x-account-id': '2', 'x-role': 'admin' } });
  await expectJson(res, 200, { customer_id: 1, name: 'Nguyễn Văn An', phone: '0900000001', dob: '2000-01-01' });
  assert.equal(calls[0].name, 'GetCustomer');
  assert.deepEqual(calls[0].request, { customer_id: '1' });
  // Header giả của client bị bỏ qua: metadata lấy từ token.
  assert.equal(calls[0].metadata['x-account-id'], '1');
  assert.equal(calls[0].metadata['x-role'], 'customer');
  assert.ok(calls[0].deadline - Date.now() <= 3000);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('A09: lỗi NOT_OWNER, CUSTOMER_NOT_FOUND từ service; service dừng → 503', async () => {
  next = () => ({ err: { code: grpc.status.PERMISSION_DENIED, details: 'NOT_OWNER' } });
  await expectJson(await send('GET', '/api/v1/customers/2', { t: KH1 }), 403, { error: 'NOT_OWNER' });
  next = () => ({ err: { code: grpc.status.NOT_FOUND, details: 'CUSTOMER_NOT_FOUND' } });
  await expectJson(await send('GET', '/api/v1/customers/3000', { t: AD1 }), 404, { error: 'CUSTOMER_NOT_FOUND' });
  next = () => ({ err: { code: grpc.status.UNAVAILABLE, details: 'No connection established' } });
  await expectJson(await send('GET', '/api/v1/customers/me', { t: KH1 }), 503, { error: 'SERVICE_UNAVAILABLE' });
});

test('A09: mã sai dạng (abc, 1 OR 1=1, 0, -1, quá 16 chữ số) → 400 INVALID_ID, không gọi service (AC-HS-09, 17)', async () => {
  for (const id of ['abc', '1%20OR%201=1', '0', '-1', '01', '1.5', '12345678901234567']) {
    await expectJson(await send('GET', `/api/v1/customers/${id}`, { t: KH1 }), 400, { error: 'INVALID_ID' });
  }
  assert.equal(calls.length, 0);
});

test('A09: tài xế → 403 FORBIDDEN; không token → 401 TOKEN_MISSING (AC-HS-07, 08)', async () => {
  await expectJson(await send('GET', '/api/v1/customers/1', { t: TX1 }), 403, { error: 'FORBIDDEN' });
  // Sai role được trả TRƯỚC khi xét dạng mã.
  await expectJson(await send('GET', '/api/v1/customers/abc', { t: TX1 }), 403, { error: 'FORBIDDEN' });
  await expectJson(await send('GET', '/api/v1/customers/1'), 401, { error: 'TOKEN_MISSING' });
  assert.equal(calls.length, 0);
});

test('A38: mã = sub trong token; dob vắng trả null; admin, tài xế → 403', async () => {
  next = () => ({ res: { customer_id: 3, name: 'Pham Duc', phone: '0901234567' } });
  await expectJson(await send('GET', '/api/v1/customers/me', { t: token('3', 'customer') }), 200, { customer_id: 3, name: 'Pham Duc', phone: '0901234567', dob: null });
  assert.deepEqual(calls[0].request, { customer_id: '3' });
  await expectJson(await send('GET', '/api/v1/customers/me', { t: AD1 }), 403, { error: 'FORBIDDEN' });
  await expectJson(await send('GET', '/api/v1/customers/me', { t: TX1 }), 403, { error: 'FORBIDDEN' });
  assert.equal(calls.length, 1);
});

test('A37: 201, chỉ chuyển name / phone / dob; đọc JSON bất kể Content-Type; 409 từ service', async () => {
  next = () => ({ res: { customer_id: 1000, name: 'Pham Duc', phone: '0901234567' } });
  const res = await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'Pham Duc', phone: '0901234567' }, headers: { 'Content-Type': 'text/plain' } });
  await expectJson(res, 201, { customer_id: 1000, name: 'Pham Duc', phone: '0901234567', dob: null });
  assert.deepEqual(calls[0].request, { name: 'Pham Duc', phone: '0901234567' });
  await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'Pham Duc', phone: '0901234567', dob: '2001-03-10' } });
  assert.deepEqual(calls[1].request, { name: 'Pham Duc', phone: '0901234567', dob: '2001-03-10' });
  next = () => ({ err: { code: grpc.status.ALREADY_EXISTS, details: 'CUSTOMER_ALREADY_EXISTS' } });
  await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'Pham Duc', phone: '0901234567' } }), 409, { error: 'CUSTOMER_ALREADY_EXISTS' });
});

test('A37: admin, tài xế → 403 dù body hỏng; body sai → 400 (AC-HS-07, 10)', async () => {
  await expectJson(await send('POST', '/api/v1/customers', { t: AD1, body: { name: 'X', phone: '0901234567' } }), 403, { error: 'FORBIDDEN' });
  await expectJson(await send('POST', '/api/v1/customers', { t: TX1, body: '{hong' }), 403, { error: 'FORBIDDEN' });
  const P = '0901234567';
  for (const body of [{}, { dob: '2000-01-01', phone: P }, { name: 'X', phone: P, customer_id: 5 }, { name: 1, phone: P }, { name: '', phone: P },
    { name: 'X', phone: P, dob: null }, { name: 'X', phone: P, dob: 20000101 }, [], { name: 'X'.repeat(201), phone: P }]) {
    await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body }), 400, { error: 'INVALID_INPUT' });
  }
  await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body: '{hong' }), 400, { error: 'INVALID_JSON' });
  await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'a<b', phone: P } }), 400, { error: 'TEXT_CONTAINS_HTML' });
  assert.equal(calls.length, 0);
});

test('A10: chỉ field có mặt; "dob": null → clear_dob; <script> → 400 không gọi service (AC-HS-11, 16)', async () => {
  await expectJson(await send('PATCH', '/api/v1/customers/me', { t: KH1, body: { dob: '1999-12-31' } }), 200, { customer_id: 1, name: 'Nguyễn Văn An', phone: '0900000001', dob: '2000-01-01' });
  assert.deepEqual(calls[0].request, { dob: '1999-12-31' });
  await send('PATCH', '/api/v1/customers/me', { t: KH1, body: { name: 'An Nguyen', dob: null } });
  assert.deepEqual(calls[1].request, { name: 'An Nguyen', clear_dob: true });
  assert.equal(calls[1].metadata['x-account-id'], '1');
  calls.length = 0;
  await expectJson(await send('PATCH', '/api/v1/customers/me', { t: KH1, body: { name: '<script>alert(1)</script>' } }), 400, { error: 'TEXT_CONTAINS_HTML' });
  for (const body of [undefined, {}, { name: null }, { name: 'X', email: 'a@b.vn' }]) {
    await expectJson(await send('PATCH', '/api/v1/customers/me', { t: KH1, body }), 400, { error: 'INVALID_INPUT' });
  }
  await expectJson(await send('PATCH', '/api/v1/customers/me', { t: AD1, body: { name: 'X' } }), 403, { error: 'FORBIDDEN' });
  assert.equal(calls.length, 0);
});

// ---------- Số điện thoại trong hồ sơ (ADR-021; spec 11 mục 4.1, HS-Q6) ----------

test('A37 phone: thiếu, sai kiểu, null → INVALID_INPUT; `email` là field lạ; > 20 ký tự → INVALID_PHONE; không gọi service (AC-HS-10, 26)', async () => {
  for (const body of [{ name: 'X' }, { name: 'X', phone: 901234567 }, { name: 'X', phone: null }, { name: 'X', phone: {} },
    { name: 'X', phone: '0901234567', email: 'a@b.vn' }]) {
    await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body }), 400, { error: 'INVALID_INPUT' });
  }
  await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'X', phone: '0'.repeat(21) } }), 400, { error: 'INVALID_PHONE' });
  assert.equal(calls.length, 0);
  // Định dạng (`123`, rỗng, `09abc`) không kiểm ở Gateway (HS-Q6 a): chuyển xuống nguyên văn, service trả INVALID_PHONE.
  next = () => ({ err: { code: grpc.status.INVALID_ARGUMENT, details: 'INVALID_PHONE' } });
  for (const phone of ['123', '', '09abc']) {
    await expectJson(await send('POST', '/api/v1/customers', { t: KH1, body: { name: 'X', phone } }), 400, { error: 'INVALID_PHONE' });
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].request, { name: 'X', phone: '' });
});

test('A10 phone: đặt → chuyển nguyên văn; "phone": null hoặc sai kiểu → 400 INVALID_INPUT không gọi service (AC-HS-27, 28)', async () => {
  await send('PATCH', '/api/v1/customers/me', { t: KH1, body: { phone: ' +84 900-000-001 ' } });
  assert.deepEqual(calls[0].request, { phone: ' +84 900-000-001 ' });
  calls.length = 0;
  for (const body of [{ phone: null }, { phone: 5 }, { email: null }]) {
    await expectJson(await send('PATCH', '/api/v1/customers/me', { t: KH1, body }), 400, { error: 'INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
});

test('Đường dẫn cũ đã bỏ → 404 ROUTE_NOT_FOUND (AC-HS-18)', async () => {
  await expectJson(await send('PUT', '/api/v1/customers/me', { t: KH1, body: { name: 'X' } }), 404, { error: 'ROUTE_NOT_FOUND' });
  await expectJson(await send('POST', '/api/v1/customers/me', { t: KH1, body: { name: 'X' } }), 404, { error: 'ROUTE_NOT_FOUND' });
  await expectJson(await send('GET', '/customers/1', { t: KH1 }), 404, { error: 'ROUTE_NOT_FOUND' });
  await expectJson(await send('PATCH', '/api/v1/customers/1', { t: KH1, body: { name: 'X' } }), 404, { error: 'ROUTE_NOT_FOUND' });
  assert.equal(calls.length, 0);
});
