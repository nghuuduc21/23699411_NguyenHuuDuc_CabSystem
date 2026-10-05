// Test rate limit (spec 20-29 mục 4.3–4.5, 5.4; AC-GH-01 … AC-GH-07) qua HTTP thật (cổng ngẫu nhiên) với Redis giả
// trong bộ nhớ (đồng hồ điều khiển được) và auth / customer-service giả. Kiểm: lần max + 1 → 429 kèm Retry-After,
// handler gRPC KHÔNG được gọi; header RateLimit-*; cửa sổ neo theo request đầu, spam không kéo dài; bộ đếm IP chung cho
// 4 route công khai; bộ đếm tài khoản riêng; 401 trước 429 trước 403; route không đếm; Redis dừng → cho qua.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createCustomerHandlers } from '../src/handlers/customers.js';
import { createBookingHandlers } from '../src/handlers/bookings.js';
import { createPaymentHandlers } from '../src/handlers/payments.js';
import { createAuthenticator } from '../src/token.js';
import { createRateLimiter } from '../src/rate-limit.js';

const SECRET = 'demo-jwt-secret-chi-dung-cho-may-demo-32b';
const logs = [];
const log = { info: (msg, f) => logs.push({ level: 'info', msg, ...f }), warn: (msg, f) => logs.push({ level: 'warn', msg, ...f }), error() {} };

// Redis giả: chỉ các lệnh rate-limit.js dùng; `now` điều khiển được để thử hết hạn mà không phải chờ.
let now = 0;
let redisDown = false;
const store = new Map(); // key → { value, expiresAt | null }
const live = (key) => {
  const e = store.get(key);
  if (e && e.expiresAt !== null && e.expiresAt <= now) store.delete(key);
  return store.get(key);
};
const fakeRedis = {
  multi() {
    const ops = [];
    const chain = {
      set(key, value, ex, seconds, nx) { ops.push(() => { if (live(key)) return null; store.set(key, { value: Number(value), expiresAt: now + seconds * 1000 }); return 'OK'; }); assert.equal(ex, 'EX'); assert.equal(nx, 'NX'); return chain; },
      incr(key) { ops.push(() => { const e = live(key) ?? { value: 0, expiresAt: null }; e.value += 1; store.set(key, e); return e.value; }); return chain; },
      ttl(key) { ops.push(() => { const e = live(key); if (!e) return -2; if (e.expiresAt === null) return -1; return Math.round((e.expiresAt - now) / 1000); }); return chain; },
      async exec() {
        if (redisDown) throw Object.assign(new Error("Stream isn't writeable"), { code: undefined });
        return ops.map((op) => [null, op()]);
      },
    };
    return chain;
  },
  async expire(key, seconds) { const e = live(key); if (e) e.expiresAt = now + seconds * 1000; return 1; },
};

let grpcCalls = 0;
const fakeRpc = (res) => (request, metadata, options, callback) => { grpcCalls += 1; setImmediate(() => callback(null, res)); };

let server;
let base;
before(async () => {
  const revocations = { isRevoked: async () => false, revoke: async () => {} };
  const authClient = {
    Login: fakeRpc({ token: 't', account_id: 1, role: 'customer', expires_in: 3600 }),
    RegisterCustomer: fakeRpc({ account_id: 1000, role: 'customer' }),
    RequestDriverOtp: fakeRpc({ phone: '0911', expires_in: 300 }),
  };
  const routes = buildRoutes({
    health: { live: (req, res) => res.json({ status: 'UP' }), ready() {}, services() {} },
    auth: createAuthHandlers({ authClient, revocations, log }),
    customers: createCustomerHandlers({ customerClient: { GetCustomer: fakeRpc({ customer_id: 1, name: 'An' }) } }),
    bookings: createBookingHandlers({ bookingClient: {} }),
    payments: createPaymentHandlers({ paymentClient: { HandleProviderCallback: (r, m, o, cb) => { grpcCalls += 1; setImmediate(() => cb({ code: 16, details: 'CALLBACK_UNAUTHORIZED' })); } } }),
  });
  const rateLimiter = createRateLimiter({ redis: fakeRedis, windowSeconds: 10, publicMax: 5, accountMax: 3, log });
  const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });
  server = createApp({ routes, log, authenticate, rateLimiter }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  store.clear();
  logs.length = 0;
  grpcCalls = 0;
  now = 1_000_000;
  redisDown = false;
});

const token = (sub, role) => jwt.sign({ role }, SECRET, { algorithm: 'HS256', expiresIn: 3600, subject: sub, jwtid: `jti-${Math.random()}` });
const KH1 = token('1', 'customer');
const KH2 = token('2', 'customer');
const TX1 = token('11', 'driver');
const send = (method, p, { t, body, headers = {} } = {}) => fetch(base + p, {
  method,
  headers: { ...headers, ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const login = (headers) => send('POST', '/api/v1/auth/login', { body: { phone: '0900000001', password: '12345678' }, headers });
const rl = (res) => ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'].map((h) => res.headers.get(h));

test('AC-GH-01: đăng nhập 6 lần liên tục → 5 lần 200 (Remaining 4…0), lần 6 → 429 RATE_LIMITED + Retry-After; gRPC chỉ được gọi 5 lần', async () => {
  for (let i = 1; i <= 5; i += 1) {
    const r = await login();
    assert.equal(r.status, 200);
    assert.deepEqual(rl(r), ['5', String(5 - i), '10', null]);
  }
  const r6 = await login();
  assert.equal(r6.status, 429);
  assert.deepEqual(await r6.json(), { error: 'RATE_LIMITED' });
  assert.deepEqual(rl(r6), ['5', '0', '10', '10']);
  assert.match(r6.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal(r6.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(grpcCalls, 5, 'request bị chặn không được tới service');
  const line = logs.find((l) => l.msg === 'rate_limited');
  assert.equal(line.scope, 'ip');
  assert.ok(!JSON.stringify(line).includes('127.0.0.1'), 'không ghi IP vào log');
});

test('AC-GH-02: spam lúc bị chặn KHÔNG kéo dài cửa sổ; hết Retry-After → 200, Remaining 4', async () => {
  for (let i = 0; i < 6; i += 1) await login();
  now += 4000;
  const r = await login();
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '6', 'Retry-After giảm dần, không quay lại 10');
  now += 6000;
  const ok = await login();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('ratelimit-remaining'), '4');
});

test('AC-GH-03: IP bị chặn → A04, A07 cũng 429 (chung bộ đếm IP); route có token vẫn 200 (bộ đếm tài khoản riêng); /health không đếm; X-Forwarded-For không có tác dụng', async () => {
  for (let i = 0; i < 6; i += 1) await login();
  assert.equal((await send('POST', '/api/v1/accounts', { body: { phone: '0901234567', password: '12345678' } })).status, 429);
  assert.equal((await send('POST', '/api/v1/otps', { body: { phone: '0911111111' } })).status, 429);
  const me = await send('GET', '/api/v1/customers/me', { t: KH1 });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('ratelimit-limit'), '3');
  const h = await send('GET', '/health');
  assert.equal(h.status, 200);
  assert.deepEqual(rl(h), [null, null, null, null]);
  assert.equal((await login({ 'X-Forwarded-For': '1.2.3.4' })).status, 429);
});

test('AC-GH-04: callback cổng thanh toán gửi 10 lần → không 429, không header RateLimit-*', async () => {
  for (let i = 0; i < 10; i += 1) {
    const r = await send('POST', '/api/v1/payment-callbacks', { body: { txn_id: 'SIM-999-1' } });
    assert.notEqual(r.status, 429);
    assert.equal(r.headers.get('ratelimit-limit'), null);
  }
});

test('AC-GH-05: ngưỡng tài khoản 3 → KH1 lần 4 → 429 scope account; KH2 vẫn 200; đăng xuất của KH1 cũng 429 (chung bộ đếm)', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await send('GET', '/api/v1/customers/me', { t: KH1 })).status, 200);
  const r4 = await send('GET', '/api/v1/customers/me', { t: KH1 });
  assert.equal(r4.status, 429);
  assert.equal(r4.headers.get('retry-after'), '10');
  assert.equal((await send('GET', '/api/v1/customers/me', { t: KH2 })).status, 200);
  assert.equal((await send('POST', '/api/v1/auth/logout', { t: KH1 })).status, 429);
  const line = logs.find((l) => l.msg === 'rate_limited');
  assert.equal(line.scope, 'account');
  assert.equal(line.account_id, '1');
  assert.ok(!JSON.stringify(logs).includes(KH1), 'không ghi token vào log');
});

test('AC-GH-06: KH1 đang bị chặn — không token / token sửa → 401 (401 trước 429); POST /bookings không body → 429 (429 trước 400); tài xế bị chặn gọi route khách → 429 trước 403', async () => {
  for (let i = 0; i < 4; i += 1) await send('GET', '/api/v1/customers/me', { t: KH1 });
  const none = await send('GET', '/api/v1/customers/me');
  assert.deepEqual([none.status, await none.json()], [401, { error: 'TOKEN_MISSING' }]);
  const tampered = `${KH1.slice(0, -1)}${KH1.endsWith('A') ? 'B' : 'A'}`;
  const bad = await send('GET', '/api/v1/customers/me', { t: tampered });
  assert.deepEqual([bad.status, await bad.json()], [401, { error: 'TOKEN_INVALID' }]);
  const b = await send('POST', '/api/v1/bookings', { t: KH1 });
  assert.deepEqual([b.status, await b.json()], [429, { error: 'RATE_LIMITED' }]);
  // Tài xế: 3 lần 403 (vẫn bị đếm), lần 4 → 429 chứ không 403.
  for (let i = 0; i < 3; i += 1) assert.equal((await send('POST', '/api/v1/bookings', { t: TX1 })).status, 403);
  assert.equal((await send('POST', '/api/v1/bookings', { t: TX1 })).status, 429);
});

test('AC-GH-07: Redis dừng → cho qua cả 7 lần, không header RateLimit-*, log warn rate_limit_skipped kèm request_id', async () => {
  redisDown = true;
  for (let i = 0; i < 7; i += 1) {
    const r = await login();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('ratelimit-limit'), null);
  }
  const warn = logs.find((l) => l.msg === 'rate_limit_skipped');
  assert.equal(warn.level, 'warn');
  assert.match(warn.request_id, /^[0-9a-f-]{36}$/);
  redisDown = false;
  for (let i = 0; i < 5; i += 1) assert.equal((await login()).status, 200);
  assert.equal((await login()).status, 429);
});

test('key không có hạn (TTL -1) → đặt lại hạn, không chặn mãi', async () => {
  store.set('rl:acc:1', { value: 0, expiresAt: null });
  // Bỏ qua SET NX vì key đã có; INCR giữ "không hạn"; rate-limit.js phải gọi EXPIRE.
  const r = await send('GET', '/api/v1/customers/me', { t: KH1 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('ratelimit-reset'), '10');
  assert.notEqual(store.get('rl:acc:1').expiresAt, null);
});
