// Mục chấm 6 — ba endpoint health khi mọi thứ healthy; route không tồn tại; quy định chung của Gateway
// (spec 00: AC-HT-05, AC-HT-08, mục 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKEND_SERVICES, GATEWAY_URL, getJson, rawRequest } from './helpers.js';

test('AC-HT-05 (mục 6): GET /health → 200 {"status":"UP"}', async () => {
  const r = await getJson(`${GATEWAY_URL}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'UP' });
});

test('AC-HT-05 (mục 6): GET /ready → 200 READY, redis UP, grpc_clients UP', async () => {
  const r = await getJson(`${GATEWAY_URL}/ready`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'READY', checks: { redis: 'UP', grpc_clients: 'UP' } });
});

test('AC-HT-05 (mục 6): GET /health/services → 200 UP, đủ 8 service SERVING', async () => {
  const r = await getJson(`${GATEWAY_URL}/health/services`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'UP');
  assert.deepEqual(Object.keys(r.body.services).sort(), [...BACKEND_SERVICES].sort());
  for (const s of BACKEND_SERVICES) assert.equal(r.body.services[s], 'SERVING', `${s} = ${r.body.services[s]}`);
});

test('AC-HT-05 (mục 6): ba endpoint health không cần token và không trả 401', async () => {
  for (const p of ['/health', '/ready', '/health/services']) {
    const r = await getJson(`${GATEWAY_URL}${p}`);
    assert.notEqual(r.status, 401, p);
    assert.notEqual(r.status, 403, p);
  }
});

test('AC-HT-08: GET /api/v1/khong-co → 404 {"error":"ROUTE_NOT_FOUND"}', async () => {
  const r = await getJson(`${GATEWAY_URL}/api/v1/khong-co`);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
});

test('AC-HT-08: GET /api/health → 404 ROUTE_NOT_FOUND (health chỉ có ở /health)', async () => {
  const r = await getJson(`${GATEWAY_URL}/api/health`);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
});

test('AC-HT-08: GET /api/v1/health → 404 ROUTE_NOT_FOUND (health nằm ngoài /api/v1)', async () => {
  const r = await getJson(`${GATEWAY_URL}/api/v1/health`);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
});

test('AC-HT-08: POST body hỏng vào route không tồn tại vẫn 404, không phải 400', async () => {
  const r = await rawRequest(`${GATEWAY_URL}/api/v1/khong-co`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{hong',
  });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
});

test('Spec 00 mục 4: GET bỏ qua body — GET /health kèm body hỏng vẫn 200', async () => {
  const r = await rawRequest(`${GATEWAY_URL}/health`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: '{hong',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'UP' });
});

test('Spec 00 mục 4: method không đăng ký (POST /health) → 404 ROUTE_NOT_FOUND', async () => {
  const r = await rawRequest(`${GATEWAY_URL}/health`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
});

test('Spec 00 mục 4: header bảo vệ và X-Request-Id trên response 200 và 404', async () => {
  for (const p of ['/health', '/api/v1/khong-co']) {
    const r = await getJson(`${GATEWAY_URL}${p}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'", p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
    assert.ok(r.headers.get('x-request-id'), `${p} thiếu X-Request-Id`);
    assert.equal(r.headers.get('x-powered-by'), null, `${p} lộ X-Powered-By`);
  }
});

test('Spec 00 mục 4: mỗi request một X-Request-Id khác nhau, Gateway bỏ qua mã client gửi', async () => {
  const a = await rawRequest(`${GATEWAY_URL}/health`, { headers: { 'X-Request-Id': 'client-id' } });
  const b = await rawRequest(`${GATEWAY_URL}/health`);
  assert.ok(a.headers['x-request-id']);
  assert.notEqual(a.headers['x-request-id'], 'client-id');
  assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id']);
});
