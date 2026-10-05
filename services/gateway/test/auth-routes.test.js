// Test A04–A06 qua HTTP thật (cổng ngẫu nhiên) với auth-service giả và Redis giả (spec 09-10).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createAuthenticator, readBearer } from '../src/token.js';

const SECRET = 'demo-jwt-secret-chi-dung-cho-may-demo-32b';
const warns = [];
const log = { info() {}, warn: (msg, f) => warns.push({ msg, ...f }), error() {} };

// auth-service giả: ghi lại request và metadata; `next` quyết định kết quả lần gọi tới.
const calls = [];
let next;
const fakeRpc = (name) => (request, metadata, options, callback) => {
  calls.push({ name, request, metadata: metadata.getMap(), deadline: options.deadline });
  const { err, res } = next(name, request);
  setImmediate(() => callback(err ?? null, res));
};
const authClient = { RegisterCustomer: fakeRpc('RegisterCustomer'), Login: fakeRpc('Login') };

// Redis giả: `down` mô phỏng Redis dừng (lệnh ném lỗi).
const revoked = new Map();
const redis = { down: false };
const revocations = {
  async isRevoked(jti) {
    if (redis.down) throw Object.assign(new Error('closed'), { code: 'CONNECTION_CLOSED' });
    return revoked.has(jti);
  },
  async revoke(jti, ttl) {
    if (redis.down) throw Object.assign(new Error('closed'), { code: 'CONNECTION_CLOSED' });
    revoked.set(jti, ttl);
  },
};

const health = { live: (req, res) => res.json({ status: 'UP' }), ready() {}, services() {} };
const auth = createAuthHandlers({ authClient, revocations, log });
const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });

let server;
let base;
before(async () => {
  server = createApp({ routes: buildRoutes({ health, auth }), log, authenticate }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  calls.length = 0;
  warns.length = 0;
  redis.down = false;
  next = () => ({ res: {} });
});

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const sign = (payload, opts = {}) => jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: 3600, ...opts });
const goodToken = (extra = {}) => sign({ role: 'customer', ...extra }, { subject: '1', jwtid: `jti-${Math.random()}` });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

test('A04: 201, chỉ chuyển field có mặt, metadata do Gateway dựng (bỏ x-account-id của client)', async () => {
  next = () => ({ res: { account_id: 1000, role: 'customer' } });
  const res = await post('/api/v1/accounts', { phone: '0901234567', password: '12345678' }, { 'Content-Type': 'text/plain', 'x-account-id': '99', 'x-role': 'admin' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { account_id: 1000, role: 'customer' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, { phone: '0901234567', password: '12345678' });
  assert.match(calls[0].metadata['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].metadata['x-account-id'], undefined);
  assert.equal(calls[0].metadata['x-role'], undefined);
  assert.ok(calls[0].deadline - Date.now() <= 3000);
});

test('A04: thiếu password, field lạ role, sai kiểu, body mảng → 400 INVALID_INPUT, không gọi service', async () => {
  for (const body of [{ phone: '0901234567' }, { phone: '0901234567', password: '12345678', role: 'admin' }, { phone: 901234567, password: '12345678' }, [], { phone: '', password: 'x' }]) {
    const res = await post('/api/v1/accounts', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { error: 'INVALID_INPUT' });
  }
  const res = await post('/api/v1/accounts', '{hong');
  assert.deepEqual(await res.json(), { error: 'INVALID_JSON' });
  assert.equal(calls.length, 0);
});

test('A04 / A05: gửi `email` → 400 INVALID_INPUT (field lạ), không gọi service (ADR-019; AC-DN-21, 22)', async () => {
  let res = await post('/api/v1/accounts', { phone: '0901234569', password: '12345678', email: 'a@b.vn' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'INVALID_INPUT' });
  for (const body of [{ email: 'kh1@cab.vn', password: '12345678' }, { phone: '0900000001', email: 'kh1@cab.vn', password: '12345678' }]) {
    res = await post('/api/v1/auth/login', body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
});

test('A04: lỗi gRPC đổi sang HTTP (409, 400, 503)', async () => {
  const cases = [
    [{ code: grpc.status.ALREADY_EXISTS, details: 'PHONE_ALREADY_EXISTS' }, 409, 'PHONE_ALREADY_EXISTS'],
    [{ code: grpc.status.INVALID_ARGUMENT, details: 'INVALID_PHONE' }, 400, 'INVALID_PHONE'],
    [{ code: grpc.status.UNAVAILABLE, details: 'No connection established' }, 503, 'SERVICE_UNAVAILABLE'],
    [{ code: grpc.status.INTERNAL, details: 'INTERNAL' }, 503, 'SERVICE_UNAVAILABLE'],
  ];
  for (const [err, status, error] of cases) {
    next = () => ({ err });
    const res = await post('/api/v1/accounts', { phone: '0901234567', password: '12345678' });
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { error });
  }
});

test('A05: 200 trả nguyên token; đúng một định danh; 401/403 từ service', async () => {
  next = () => ({ res: { token: 'eyJ.x.y', account_id: 1, role: 'customer', expires_in: 3600 } });
  let res = await post('/api/v1/auth/login', { phone: '0900000001', password: '12345678' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { token: 'eyJ.x.y', account_id: 1, role: 'customer', expires_in: 3600 });
  for (const body of [{ password: 'x' }, { phone: '0900000001', email: 'a@b.vn', password: 'x' }, { phone: '0900000001' }]) {
    res = await post('/api/v1/auth/login', body);
    assert.deepEqual(await res.json(), { error: 'INVALID_INPUT' });
  }
  next = () => ({ err: { code: grpc.status.UNAUTHENTICATED, details: 'INVALID_CREDENTIALS' } });
  res = await post('/api/v1/auth/login', { phone: '0900000001', password: 'sai' });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'INVALID_CREDENTIALS' });
  next = () => ({ err: { code: grpc.status.PERMISSION_DENIED, details: 'ACCOUNT_LOCKED' } });
  res = await post('/api/v1/auth/login', { phone: '0900000009', password: '12345678' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'ACCOUNT_LOCKED' });
});

test('thiếu /api/v1 → 404 ROUTE_NOT_FOUND', async () => {
  for (const p of ['/auth/login', '/accounts']) {
    const res = await post(p, { phone: '0900000001', password: '12345678' });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'ROUTE_NOT_FOUND' });
  }
});

test('A06: không token → TOKEN_MISSING; sai dạng / sửa / alg none / claim sai → TOKEN_INVALID; hết hạn → TOKEN_EXPIRED', async () => {
  const check = async (headers, error) => {
    const res = await post('/api/v1/auth/logout', '', headers);
    assert.equal(res.status, 401, error);
    assert.deepEqual(await res.json(), { error });
  };
  await check({}, 'TOKEN_MISSING');
  await check({ Authorization: 'Bearer ' }, 'TOKEN_MISSING');
  await check({ Authorization: 'Basic abc' }, 'TOKEN_INVALID');

  // Sửa một ký tự ở GIỮA token (trong payload), không phải ký tự cuối.
  const token = goodToken();
  const mid = Math.floor(token.length / 2);
  const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
  await check(bearer(tampered), 'TOKEN_INVALID');

  // Payload đổi role thành admin nhưng giữ chữ ký cũ.
  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...jwt.decode(token), role: 'admin' })).toString('base64url');
  await check(bearer(`${h}.${forged}.${s}`), 'TOKEN_INVALID');

  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${forged}.`;
  await check(bearer(none), 'TOKEN_INVALID');
  await check(bearer(jwt.sign({ role: 'customer' }, 'khoa-khac-'.repeat(4), { subject: '1', jwtid: 'j', expiresIn: 60 })), 'TOKEN_INVALID');
  await check(bearer(sign({ role: 'superadmin' }, { subject: '1', jwtid: 'j' })), 'TOKEN_INVALID');
  await check(bearer(sign({ role: 'customer' }, { subject: 'abc', jwtid: 'j' })), 'TOKEN_INVALID');
  await check(bearer(sign({ role: 'customer' }, { subject: '1' })), 'TOKEN_INVALID'); // thiếu jti
  const expired = jwt.sign({ role: 'customer', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, { algorithm: 'HS256', subject: '1', jwtid: 'j' });
  await check(bearer(expired), 'TOKEN_EXPIRED');
});

test('A06: đăng xuất → 200 LOGGED_OUT, TTL = thời gian còn lại; dùng lại token → TOKEN_REVOKED', async () => {
  const token = goodToken();
  const { jti } = jwt.decode(token);
  let res = await post('/api/v1/auth/logout', '', bearer(token));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'LOGGED_OUT' });
  assert.ok(revoked.get(jti) >= 3598 && revoked.get(jti) <= 3600);
  res = await post('/api/v1/auth/logout', '', bearer(token));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'TOKEN_REVOKED' });
  // Token khác của cùng tài khoản vẫn dùng được.
  res = await post('/api/v1/auth/logout', '', bearer(goodToken()));
  assert.equal(res.status, 200);
});

test('A06: Redis dừng → kiểm tra cho qua kèm cảnh báo, nhưng ghi thu hồi thất bại → 503', async () => {
  redis.down = true;
  const res = await post('/api/v1/auth/logout', '', bearer(goodToken()));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'SERVICE_UNAVAILABLE' });
  assert.equal(warns.length, 2);
  assert.ok(!JSON.stringify(warns).includes('eyJ'), 'log không chứa token');
});

test('thứ tự: token sai thì 401 dù body hỏng (401 trước 400)', async () => {
  const res = await post('/api/v1/auth/logout', '{hong', {});
  assert.equal(res.status, 401);
});

test('readBearer: phân biệt thiếu và sai dạng', () => {
  assert.deepEqual(readBearer(undefined), { error: 'TOKEN_MISSING' });
  assert.deepEqual(readBearer('bearer abc'), { token: 'abc' });
  assert.deepEqual(readBearer('Bearer a b'), { error: 'TOKEN_INVALID' });
  assert.deepEqual(readBearer('abc'), { error: 'TOKEN_INVALID' });
});
