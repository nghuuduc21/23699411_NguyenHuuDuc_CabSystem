// Mục chấm 6 (đường 503) — dừng một service, dừng Redis rồi bật lại (spec 00: AC-HT-06, AC-HT-07).
// Test này ĐỔI trạng thái hệ thống; hook `after` luôn bật lại container và chờ healthy.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKEND_SERVICES,
  GATEWAY_URL,
  compose,
  getJson,
  waitFor,
  waitHealthy,
} from './helpers.js';

describe('AC-HT-06 (mục 6, 503): dừng rating-service', () => {
  after(async () => {
    compose('start', 'rating-service');
    await waitHealthy('rating-service');
    await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (r) => r.status === 200,
      { timeoutMs: 60_000 },
    );
  });

  test('AC-HT-06: GET /health/services → 503 unhealthy, rating-service unhealthy, 7 service còn lại healthy', async (t) => {
    const since = new Date(Date.now() - 1000).toISOString();
    const stop = compose('stop', 'rating-service');
    assert.equal(stop.status, 0, stop.stderr);

    const started = Date.now();
    const r = await getJson(`${GATEWAY_URL}/health/services`);
    t.diagnostic(`thời gian trả lời /health/services khi rating-service dừng: ${Date.now() - started} ms`);

    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'unhealthy');
    assert.equal(r.body.services['rating-service'], 'unhealthy');
    for (const s of BACKEND_SERVICES.filter((x) => x !== 'rating-service')) {
      assert.equal(r.body.services[s], 'healthy', `${s} = ${r.body.services[s]}`);
    }
    // Log Gateway có dòng warn nêu rating-service (lý do chi tiết chỉ nằm trong log — spec 00 H13).
    const logs = compose('logs', '--no-log-prefix', '--since', since, 'gateway').stdout;
    const line = logs.split(/\r?\n/).find((l) => l.includes('rating-service') && /warn/i.test(l));
    assert.ok(line, `log gateway không có dòng warn nêu rating-service: ${logs.slice(-1500)}`);
  });

  test('AC-HT-06: /health và /ready vẫn 200 khi một service dừng', async () => {
    assert.equal((await getJson(`${GATEWAY_URL}/health`)).status, 200);
    assert.equal((await getJson(`${GATEWAY_URL}/ready`)).status, 200);
  });

  test('AC-HT-06: bật lại rating-service → /health/services về 200 healthy', async () => {
    compose('start', 'rating-service');
    const r = await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (x) => x.status === 200,
      { timeoutMs: 60_000 },
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.services['rating-service'], 'healthy');
  });
});

describe('AC-HT-07 (mục 6, 503): dừng redis', () => {
  after(async () => {
    compose('start', 'redis');
    await waitHealthy('redis');
    await waitFor(() => getJson(`${GATEWAY_URL}/ready`), (r) => r.status === 200, { timeoutMs: 60_000 });
  });

  test('AC-HT-07: GET /ready → 503 not_ready, redis unhealthy', async () => {
    const stop = compose('stop', 'redis');
    assert.equal(stop.status, 0, stop.stderr);
    const r = await getJson(`${GATEWAY_URL}/ready`);
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'not_ready');
    assert.equal(r.body.checks.redis, 'unhealthy');
    assert.equal(r.body.checks.grpc_clients, 'healthy');
  });

  test('AC-HT-07: GET /health vẫn 200 healthy khi Redis dừng', async () => {
    const r = await getJson(`${GATEWAY_URL}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'healthy' });
  });

  test('AC-HT-07: Gateway vẫn phục vụ request khác khi Redis dừng (/health/services 200, route lạ 404)', async () => {
    assert.equal((await getJson(`${GATEWAY_URL}/health/services`)).status, 200);
    assert.equal((await getJson(`${GATEWAY_URL}/api/v1/khong-co`)).status, 404);
  });

  test('AC-HT-07: bật lại Redis → /ready tự về 200 ready, không phải khởi động lại Gateway', async () => {
    compose('start', 'redis');
    const r = await waitFor(() => getJson(`${GATEWAY_URL}/ready`), (x) => x.status === 200, { timeoutMs: 60_000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.redis, 'healthy');
  });
});

describe('AC-HT-16 (mục 6, 503): dừng customer-db (service còn chạy, mất database)', () => {
  after(async () => {
    compose('start', 'customer-db');
    await waitHealthy('customer-db');
    await waitHealthy('customer-service');
    await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (r) => r.status === 200,
      { timeoutMs: 90_000 },
    );
  });

  test('AC-HT-16: GET /health/services → 503 unhealthy, customer-service unhealthy, không có chữ NOT_SERVING/UNREACHABLE/SERVING/UP/DOWN/DEGRADED', async () => {
    const stop = compose('stop', 'customer-db');
    assert.equal(stop.status, 0, stop.stderr);
    const r = await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (x) => x.status === 503,
      { timeoutMs: 30_000 },
    );
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'unhealthy');
    assert.equal(r.body.services['customer-service'], 'unhealthy');
    for (const old of ['NOT_SERVING', 'UNREACHABLE', 'SERVING', 'UP', 'DOWN', 'DEGRADED']) {
      assert.ok(!r.text.includes(`"${old}"`), `body còn chữ ${old}: ${r.text}`);
    }
  });

  test('AC-HT-16: start customer-db → /health/services lại 200 healthy', async () => {
    compose('start', 'customer-db');
    const r = await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (x) => x.status === 200,
      { timeoutMs: 90_000 },
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'healthy');
    assert.equal(r.body.services['customer-service'], 'healthy');
  });
});
