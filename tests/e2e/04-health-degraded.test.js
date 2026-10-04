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

  test('AC-HT-06: GET /health/services → 503 DEGRADED, rating-service UNREACHABLE, 7 service còn lại SERVING', async (t) => {
    const stop = compose('stop', 'rating-service');
    assert.equal(stop.status, 0, stop.stderr);

    const started = Date.now();
    const r = await getJson(`${GATEWAY_URL}/health/services`);
    t.diagnostic(`thời gian trả lời /health/services khi rating-service dừng: ${Date.now() - started} ms`);

    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'DEGRADED');
    assert.equal(r.body.services['rating-service'], 'UNREACHABLE');
    for (const s of BACKEND_SERVICES.filter((x) => x !== 'rating-service')) {
      assert.equal(r.body.services[s], 'SERVING', `${s} = ${r.body.services[s]}`);
    }
  });

  test('AC-HT-06: /health và /ready vẫn 200 khi một service dừng', async () => {
    assert.equal((await getJson(`${GATEWAY_URL}/health`)).status, 200);
    assert.equal((await getJson(`${GATEWAY_URL}/ready`)).status, 200);
  });

  test('AC-HT-06: bật lại rating-service → /health/services về 200 UP', async () => {
    compose('start', 'rating-service');
    const r = await waitFor(
      () => getJson(`${GATEWAY_URL}/health/services`),
      (x) => x.status === 200,
      { timeoutMs: 60_000 },
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.services['rating-service'], 'SERVING');
  });
});

describe('AC-HT-07 (mục 6, 503): dừng redis', () => {
  after(async () => {
    compose('start', 'redis');
    await waitHealthy('redis');
    await waitFor(() => getJson(`${GATEWAY_URL}/ready`), (r) => r.status === 200, { timeoutMs: 60_000 });
  });

  test('AC-HT-07: GET /ready → 503 NOT_READY, redis DOWN', async () => {
    const stop = compose('stop', 'redis');
    assert.equal(stop.status, 0, stop.stderr);
    const r = await getJson(`${GATEWAY_URL}/ready`);
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'NOT_READY');
    assert.equal(r.body.checks.redis, 'DOWN');
    assert.equal(r.body.checks.grpc_clients, 'UP');
  });

  test('AC-HT-07: GET /health vẫn 200 UP khi Redis dừng', async () => {
    const r = await getJson(`${GATEWAY_URL}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'UP' });
  });

  test('AC-HT-07: Gateway vẫn phục vụ request khác khi Redis dừng (/health/services 200, route lạ 404)', async () => {
    assert.equal((await getJson(`${GATEWAY_URL}/health/services`)).status, 200);
    assert.equal((await getJson(`${GATEWAY_URL}/api/v1/khong-co`)).status, 404);
  });

  test('AC-HT-07: bật lại Redis → /ready tự về 200 READY, không phải khởi động lại Gateway', async () => {
    compose('start', 'redis');
    const r = await waitFor(() => getJson(`${GATEWAY_URL}/ready`), (x) => x.status === 200, { timeoutMs: 60_000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.redis, 'UP');
  });
});
