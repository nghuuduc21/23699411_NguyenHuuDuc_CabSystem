// Đường lỗi "service phía sau không sẵn sàng" của spec 09-10, 11, 12-13-21-23 (503 và NFR05).
// File này DỪNG rồi BẬT LẠI container (`docker compose stop/start`), nên KHÔNG nằm trong `npm test`:
// chạy riêng bằng `npm run test:dung-service` khi không có ai khác đang dùng hệ thống.
// Mỗi test bật lại container ở `finally` và chờ healthy trước khi sang test sau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED, SEED_PASSWORD, call, createTracker, newEmail, newDriverWithApplication, tokenOf,
} from './api.js';
import { compose, run, waitFor, waitHealthy } from './helpers.js';

const t = createTracker();
after(() => t.cleanup());

async function withStopped(service, fn) {
  const s = compose('stop', service);
  assert.equal(s.status, 0, s.stderr);
  try {
    await fn();
  } finally {
    compose('start', service);
    const h = await waitHealthy(service, 180_000);
    assert.equal(h, 'running healthy', `${service} không healthy lại: ${h}`);
    // Gateway nối lại kênh gRPC: chờ /health/services về 200.
    await waitFor(() => fetch('http://localhost:3000/health/services').then((r) => r.status), (x) => x === 200, { timeoutMs: 60_000 });
  }
}

test('AC-DN-06 (mục 9, 503): dừng auth-service → POST /auth/register hợp lệ → 503 SERVICE_UNAVAILABLE', async () => {
  await withStopped('auth-service', async () => {
    const r = await call('POST', '/auth/register', { body: { email: t.email(newEmail()), password: SEED_PASSWORD } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const l = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
    assert.equal(l.status, 503);
  });
});

test('AC-DN-18 (mục 27, 503): dừng redis → POST /auth/logout → 503 SERVICE_UNAVAILABLE; log Gateway có cảnh báo Redis; request khác vẫn qua', async () => {
  const tok = await tokenOf(SEED.KH1);
  const since = new Date().toISOString();
  await withStopped('redis', async () => {
    const r = await call('POST', '/auth/logout', { token: tok });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const g = await call('GET', '/customers/me', { token: tok });
    assert.equal(g.status, 200, 'Redis dừng: Gateway phải cho request đi qua');
    const logs = run('docker', ['logs', '--since', since, 'gateway']);
    assert.match(logs.stdout + logs.stderr, /redis/i);
  });
});

test('AC-HS-12 (mục 11, 503): dừng customer-service → GET /customers/me → 503; đăng nhập vẫn 200 (NFR05)', async () => {
  const tok = await tokenOf(SEED.KH1);
  await withStopped('customer-service', async () => {
    const r = await call('GET', '/customers/me', { token: tok });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const l = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
    assert.equal(l.status, 200);
  });
});

test('AC-TX-33 (mục 13, 503): dừng driver-service → A12 → 503; đăng nhập vẫn 200', async () => {
  const tok = await tokenOf(SEED.KH1);
  await withStopped('driver-service', async () => {
    const r = await call('GET', '/drivers?lat=10.82&lng=106.68', { token: tok });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const l = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
    assert.equal(l.status, 200);
  });
});

test('AC-TX-18 (mục 22, Kafka dừng): A15 trên hồ sơ PENDING mới → 200 APPROVED trong ≤ 2 giây; log driver-service có EVENT_PUBLISH_FAILED', async () => {
  const E = await newDriverWithApplication(t);
  const ad = await tokenOf(SEED.AD1);
  const since = new Date().toISOString();
  await withStopped('kafka', async () => {
    const start = Date.now();
    const r = await call('PATCH', `/drivers/${E.driver_id}`, { token: ad, body: { approval_status: 'APPROVED' } });
    const ms = Date.now() - start;
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { driver_id: E.driver_id, approval_status: 'APPROVED' });
    assert.ok(ms <= 2000, `mất ${ms} ms`);
    const logs = run('docker', ['logs', '--since', since, 'driver-service']);
    assert.match(logs.stdout + logs.stderr, /EVENT_PUBLISH_FAILED/);
  });
});
