// Spec 20-29 — rate limit tại Gateway (mục 29, NFR17). AC-GH-01…10; AC-TX-43 (spec 12-13-21-23).
// 2026-10-14 (ADR-021): bốn route công khai auth/register, auth/login, auth/otp, auth/driver-register chung một bộ đếm IP.
// Chạy RIÊNG và CUỐI CÙNG bằng `npm run test:rate-limit`, với ngưỡng mẫu của `.env.example`
// (RATE_LIMIT_WINDOW_SECONDS=10, PUBLIC_MAX=5, ACCOUNT_MAX=30) — các nhóm test khác chạy với ngưỡng 1000 (GH-Q3).
// AC-GH-05, 06 tạm dựng lại gateway với RATE_LIMIT_ACCOUNT_MAX=3 (biến môi trường của tiến trình test đè `.env`
// khi Compose nội suy), xong dựng lại theo `.env` (30). AC-GH-07 dừng redis. Hook `after` luôn trả gateway về `.env`
// và bật lại redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CALLBACK_SECRET, SEED, SEED_PASSWORD, call, createTracker, login, newDriverPhone, newEmail, tamperMiddle } from './api.js';
import { compose, run, sleep, waitFor, waitHealthy } from './helpers.js';

const S = {};
const tr = createTracker();
const loginKH1 = () => call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
const h = (r, name) => r.headers.get(name);
const redisKeys = () => run('docker', ['exec', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*']).stdout.split(/\r?\n/).filter(Boolean);
const redisTtl = (key) => Number(run('docker', ['exec', 'redis', 'redis-cli', 'ttl', key]).stdout.trim());
const gatewayLogsSince = (since) => compose('logs', '--no-log-prefix', '--since', since, 'gateway').stdout;
const envOf = (name) => run('docker', ['exec', 'gateway', 'printenv', name]).stdout.trim();

async function gatewayUp(extraEnv = {}) {
  delete process.env.RATE_LIMIT_PUBLIC_MAX;
  delete process.env.RATE_LIMIT_ACCOUNT_MAX;
  Object.assign(process.env, extraEnv);
  const r = compose('up', '-d', 'gateway');
  for (const k of Object.keys(extraEnv)) delete process.env[k];
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await waitHealthy('gateway', 120_000), 'running healthy');
  await waitFor(() => fetch('http://localhost:3000/health').then((x) => x.status), (x) => x === 200, { timeoutMs: 30_000 });
}

// Đợi tới khi không còn bộ đếm IP nào (không request công khai nào trong cửa sổ trước) — tối đa 12 s.
async function waitIpWindowClear() {
  await waitFor(async () => redisKeys().filter((k) => k.startsWith('rl:ip:')), (ks) => ks.length === 0, { timeoutMs: 12_000, intervalMs: 500 });
}

before(async () => {
  assert.deepEqual(
    [envOf('RATE_LIMIT_WINDOW_SECONDS'), envOf('RATE_LIMIT_PUBLIC_MAX'), envOf('RATE_LIMIT_ACCOUNT_MAX')], ['10', '5', '30'],
    'Tiền điều kiện: gateway chạy với ngưỡng mẫu 10 / 5 / 30 (`docker compose up -d gateway` theo .env).',
  );
  await waitIpWindowClear();
  // Lấy token trước (tốn 2 lần đếm công khai), rồi đợi cửa sổ IP hết hạn để AC-GH-01 bắt đầu từ 0.
  S.kh1 = (await login(SEED.KH1)).token;
  S.kh2 = (await login(SEED.KH2)).token;
  await waitIpWindowClear();
});

after(async () => {
  tr.cleanup();
  if (run('docker', ['inspect', '-f', '{{.State.Running}}', 'redis']).stdout.trim() !== 'true') {
    compose('start', 'redis');
    await waitHealthy('redis', 120_000);
  }
  if (envOf('RATE_LIMIT_ACCOUNT_MAX') !== '30' || envOf('RATE_LIMIT_PUBLIC_MAX') !== '5') await gatewayUp();
});

test('AC-GH-01 + AC-GH-08 (mục 29): đăng nhập KH1 Send 6 lần liên tục → 1–5: 200, Limit 5, Remaining 4…0, Reset 1–10; lần 6: 429 RATE_LIMITED, Retry-After 1–10, Remaining 0, X-Request-Id; log rate_limited scope ip; Redis có rl:ip:<ip> TTL 1–10', async () => {
  S.since = new Date(Date.now() - 1000).toISOString();
  const res = [];
  for (let i = 0; i < 6; i += 1) res.push(await loginKH1());
  res.slice(0, 5).forEach((r, i) => {
    assert.equal(r.status, 200, `lần ${i + 1}: ${r.status} ${r.text}`);
    assert.equal(h(r, 'ratelimit-limit'), '5');
    assert.equal(h(r, 'ratelimit-remaining'), String(4 - i));
    const reset = Number(h(r, 'ratelimit-reset'));
    assert.ok(reset >= 1 && reset <= 10, `Reset ${reset}`);
    assert.equal(h(r, 'retry-after'), null, 'Retry-After chỉ có ở 429');
  });
  const six = res[5];
  assert.equal(six.status, 429, six.text);
  assert.deepEqual(six.body, { error: 'RATE_LIMITED' });
  const ra = Number(h(six, 'retry-after'));
  assert.ok(ra >= 1 && ra <= 10, `Retry-After ${ra}`);
  assert.equal(h(six, 'ratelimit-remaining'), '0');
  assert.equal(h(six, 'ratelimit-limit'), '5');
  assert.equal(h(six, 'ratelimit-reset'), String(ra));
  assert.ok(h(six, 'x-request-id'), 'có X-Request-Id');
  assert.equal(h(six, 'x-content-type-options'), 'nosniff');
  assert.equal(h(six, 'cache-control'), 'no-store');
  S.retry6 = ra;
  S.t6 = Date.now();
  // AC-GH-08: khóa Redis.
  const keys = redisKeys().filter((k) => k.startsWith('rl:ip:'));
  assert.equal(keys.length, 1, `khóa IP: ${keys.join(',')}`);
  S.ipKey = keys[0];
  const ttl = redisTtl(S.ipKey);
  assert.ok(ttl >= 1 && ttl <= 10, `TTL ${ttl}`);
  await sleep(500);
  const logs = gatewayLogsSince(S.since);
  const line = logs.split(/\r?\n/).find((l) => l.includes('"rate_limited"'));
  assert.ok(line, 'log gateway có rate_limited');
  const o = JSON.parse(line);
  assert.equal(o.scope, 'ip');
  assert.ok(o.request_id);
  assert.ok(!line.includes('172.') && !line.includes('::ffff'), 'log không ghi IP');
});

test('AC-GH-02 (mục 29, phần 1): Send thêm 5 lần trong Retry-After → 429 cả 5, Retry-After không tăng, không quay lại 10', async () => {
  let prev = S.retry6;
  for (let i = 0; i < 5; i += 1) {
    const r = await loginKH1();
    assert.equal(r.status, 429, `lần ${i + 7}`);
    const ra = Number(h(r, 'retry-after'));
    assert.ok(ra <= prev, `Retry-After tăng: ${prev} → ${ra}`);
    assert.ok(ra <= S.retry6);
    prev = ra;
    await sleep(300);
  }
  assert.ok(prev < 10);
});

test('AC-GH-03 (mục 29): IP đang bị chặn — A04 auth/register email mới → 429; A07 auth/otp → 429; A08 auth/driver-register → 429 (chung bộ đếm IP); A38 [KH1] → 200, RateLimit-Limit 30; /health → 200 không RateLimit-*; A05 kèm X-Forwarded-For → 429', async () => {
  const a = await call('POST', '/auth/register', { body: { email: tr.email(newEmail()), password: SEED_PASSWORD } });
  assert.equal(a.status, 429, a.text);
  assert.deepEqual(a.body, { error: 'RATE_LIMITED' });
  const o = await call('POST', '/auth/otp', { body: { phone: '0599000001' } });
  assert.equal(o.status, 429, o.text);
  const d = await call('POST', '/auth/driver-register', { body: { phone: '0599000001', otp: '000000', password: SEED_PASSWORD } });
  assert.equal(d.status, 429, d.text);
  const me = await call('GET', '/customers/me', { token: S.kh1 });
  assert.equal(me.status, 200, me.text);
  assert.equal(h(me, 'ratelimit-limit'), '30');
  const hl = await call('GET', 'http://localhost:3000/health');
  assert.equal(hl.status, 200);
  assert.equal(h(hl, 'ratelimit-limit'), null);
  assert.equal(h(hl, 'ratelimit-remaining'), null);
  const x = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD }, headers: { 'X-Forwarded-For': '1.2.3.4' } });
  assert.equal(x.status, 429, 'không tin X-Forwarded-For');
});

test('AC-GH-10 (mục 29): IP đang bị chặn — POST /api/v1/accounts (đường cũ) → 404 ROUTE_NOT_FOUND, không 429', async () => {
  const r = await call('POST', '/accounts', { body: { email: newEmail(), password: SEED_PASSWORD } });
  assert.equal(r.status, 404, r.text);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
  // Đối chứng: IP vẫn đang bị chặn ở route công khai thật.
  const l = await loginKH1();
  assert.equal(l.status, 429, l.text);
});

test('AC-GH-02 (mục 29, phần 2) + AC-GH-08: chờ hết Retry-After của lần 6 → khóa rl:ip biến mất; Send → 200, RateLimit-Remaining 4', async () => {
  const wait = S.t6 + S.retry6 * 1000 + 300 - Date.now();
  if (wait > 0) await sleep(wait);
  await waitFor(async () => redisKeys().filter((k) => k === S.ipKey), (ks) => ks.length === 0, { timeoutMs: 2000, intervalMs: 200 });
  assert.ok(!redisKeys().includes(S.ipKey), 'khóa IP vẫn còn sau hạn');
  const r = await loginKH1();
  assert.equal(r.status, 200, r.text);
  assert.equal(h(r, 'ratelimit-remaining'), '4');
});

test('AC-GH-04 (mục 29): A32 payment-callbacks gửi 10 lần liên tục → 401 / 404 cả 10, không 429, không RateLimit-*', async () => {
  for (let i = 0; i < 10; i += 1) {
    const r = await call('POST', '/payment-callbacks', { body: { txn_id: 'SIM-999-1' }, headers: i % 2 ? { 'X-Callback-Secret': CALLBACK_SECRET } : {} });
    assert.ok([401, 404].includes(r.status), `lần ${i + 1}: ${r.status}`);
    assert.equal(h(r, 'ratelimit-limit'), null);
  }
});

test('AC-GH-05 + AC-GH-06 (mục 29, tài khoản): ACCOUNT_MAX=3 — A38 [KH1] ×4 → 200 ×3, 429 (scope account); [KH2] → 200; A06 [KH1] → 429; KH1 bị chặn: không token → 401, token sửa → 401 TOKEN_INVALID, A19 không body → 429', async () => {
  await gatewayUp({ RATE_LIMIT_ACCOUNT_MAX: '3' });
  try {
    assert.equal(envOf('RATE_LIMIT_ACCOUNT_MAX'), '3');
    const since = new Date(Date.now() - 1000).toISOString();
    const res = [];
    for (let i = 0; i < 4; i += 1) res.push(await call('GET', '/customers/me', { token: S.kh1 }));
    assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 429]);
    assert.equal(h(res[0], 'ratelimit-limit'), '3');
    assert.deepEqual(res[3].body, { error: 'RATE_LIMITED' });
    const k2 = await call('GET', '/customers/me', { token: S.kh2 });
    assert.equal(k2.status, 200, 'tài khoản khác không bị chặn');
    const lo = await call('POST', '/auth/logout', { token: S.kh1 });
    assert.equal(lo.status, 429, 'A06 chung bộ đếm tài khoản');
    await sleep(500);
    const line = gatewayLogsSince(since).split(/\r?\n/).find((l) => l.includes('"rate_limited"'));
    assert.ok(line);
    const o = JSON.parse(line);
    assert.equal(o.scope, 'account');
    assert.equal(String(o.account_id), '1');
    // AC-GH-06: thứ tự 401 → 429 → 403 / 400.
    const n = await call('GET', '/customers/me');
    assert.equal(n.status, 401);
    assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
    const t = await call('GET', '/customers/me', { token: tamperMiddle(S.kh1) });
    assert.equal(t.status, 401);
    assert.deepEqual(t.body, { error: 'TOKEN_INVALID' });
    const b = await call('POST', '/bookings', { token: S.kh1 });
    assert.equal(b.status, 429, '429 trước 400');
    assert.deepEqual(b.body, { error: 'RATE_LIMITED' });
  } finally {
    await gatewayUp();
  }
  assert.equal(envOf('RATE_LIMIT_ACCOUNT_MAX'), '30');
});

test('AC-GH-07 (mục 29, Redis dừng): A05 KH1 ×7 → 200 cả 7, không RateLimit-*; log warn rate_limit_skipped có request_id; bật redis, chờ 2 s, Send ×6 → lần 6 là 429', async () => {
  await waitIpWindowClear();
  const since = new Date(Date.now() - 1000).toISOString();
  assert.equal(compose('stop', 'redis').status, 0);
  try {
    for (let i = 0; i < 7; i += 1) {
      const r = await loginKH1();
      assert.equal(r.status, 200, `lần ${i + 1}: ${r.status} ${r.text}`);
      assert.equal(h(r, 'ratelimit-limit'), null);
    }
    const lines = gatewayLogsSince(since).split(/\r?\n/).filter((l) => l.includes('rate_limit_skipped'));
    assert.ok(lines.length >= 7, `có ${lines.length} dòng rate_limit_skipped`);
    const o = JSON.parse(lines[0]);
    assert.equal(o.level, 'warn');
    assert.ok(o.request_id);
  } finally {
    compose('start', 'redis');
    assert.equal(await waitHealthy('redis', 120_000), 'running healthy');
  }
  await sleep(2000);
  const res = [];
  for (let i = 0; i < 6; i += 1) res.push(await loginKH1());
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200, 200, 429]);
});

test('AC-GH-09 (mục 29): xen kẽ 6 request công khai (register, login email, otp, driver-register OTP sai, login tài xế, login email) → 201/200/201/400/200, lần 6: 429', async () => {
  await sleep(10_500);
  await waitIpWindowClear();
  const ph = tr.phone(newDriverPhone());
  const res = [
    await call('POST', '/auth/register', { body: { email: tr.email(newEmail()), password: SEED_PASSWORD } }),
    await loginKH1(),
    await call('POST', '/auth/otp', { body: { phone: ph } }),
    await call('POST', '/auth/driver-register', { body: { phone: ph, otp: '000000', password: SEED_PASSWORD } }),
    await call('POST', '/auth/login', { body: { phone: SEED.TX1, password: SEED_PASSWORD } }),
    await loginKH1(),
  ];
  // OTP "000000" có thể trùng mã thật với xác suất 1/1 000 000 — bỏ qua.
  assert.deepEqual(res.map((r) => r.status), [201, 200, 201, 400, 200, 429], res.map((r) => r.text).join(' | '));
  assert.deepEqual(res[3].body, { error: 'OTP_INVALID' });
  assert.deepEqual(res[5].body, { error: 'RATE_LIMITED' });
});

test('AC-TX-43 (mục 21, 29): A07 auth/otp số mới ×6 → lần 6: 429; sau hết 429: POST /otps, /driver-accounts (đường cũ) → 404 ROUTE_NOT_FOUND', async () => {
  await sleep(10_500);
  await waitIpWindowClear();
  const res = [];
  for (let i = 0; i < 6; i += 1) res.push(await call('POST', '/auth/otp', { body: { phone: tr.phone(newDriverPhone()) } }));
  assert.deepEqual(res.map((r) => r.status), [201, 201, 201, 201, 201, 429], res.map((r) => r.text).join(' | '));
  const ra = Number(h(res[5], 'retry-after'));
  await sleep(ra * 1000 + 500);
  for (const [path, body] of [['/otps', { phone: '0599000002' }], ['/driver-accounts', { phone: '0599000002', otp: '123456', password: SEED_PASSWORD }]]) {
    const r = await call('POST', path, { body });
    assert.equal(r.status, 404, `${path}: ${r.text}`);
    assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
  }
});

test('AC-DN-32 (mục 29): A04 auth/register email mới ×6 liên tục → 201 ×5, lần 6: 429 RATE_LIMITED', async () => {
  await sleep(10_500);
  await waitIpWindowClear();
  const res = [];
  for (let i = 0; i < 6; i += 1) res.push(await call('POST', '/auth/register', { body: { email: tr.email(newEmail()), password: SEED_PASSWORD } }));
  assert.deepEqual(res.map((r) => r.status), [201, 201, 201, 201, 201, 429], res.map((r) => r.text).join(' | '));
  assert.deepEqual(res[5].body, { error: 'RATE_LIMITED' });
});
