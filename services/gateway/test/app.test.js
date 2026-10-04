// Test quy định chung của Gateway qua HTTP thật (cổng ngẫu nhiên): 404, header bảo vệ,
// đọc body JSON bất kể Content-Type, GET bỏ qua body, lỗi không lường trước → 503.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const logs = [];
const log = {
  info: (msg, fields) => logs.push({ msg, ...fields }),
  warn() {},
  error: (msg, fields) => logs.push({ msg, ...fields }),
};

// Route thử chỉ có trong test để kiểm tra phần đọc body và lỗi (spec 00 chưa có route POST nào).
const routes = [
  { method: 'GET', path: '/health', handler: (req, res) => res.json({ status: 'UP' }) },
  { method: 'GET', path: '/echo', handler: (req, res) => res.json({ body: req.body }) },
  { method: 'POST', path: '/echo', handler: (req, res) => res.json({ body: req.body }) },
  { method: 'GET', path: '/boom', handler: async () => { throw new Error('bi mat noi bo'); } },
];

let server;
let base;
before(async () => {
  server = createApp({ routes, log }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('route không tồn tại → 404 ROUTE_NOT_FOUND (gồm /api/health và /api/v1/khong-co)', async () => {
  for (const p of ['/api/v1/khong-co', '/api/health', '/customers/1']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'ROUTE_NOT_FOUND' });
  }
});

test('mọi response có header bảo vệ và X-Request-Id do Gateway sinh', async () => {
  for (const p of ['/health', '/khong-co']) {
    const res = await fetch(base + p, { headers: { 'X-Request-Id': 'client-tu-dat' } });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(res.headers.get('x-powered-by'), null);
  }
});

test('body đọc là JSON dù Content-Type là text/plain', async () => {
  const res = await fetch(`${base}/echo`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"An"}' });
  assert.deepEqual(await res.json(), { body: { name: 'An' } });
});

test('body rỗng = {}; JSON hỏng → 400 INVALID_JSON', async () => {
  let res = await fetch(`${base}/echo`, { method: 'POST' });
  assert.deepEqual(await res.json(), { body: {} });
  res = await fetch(`${base}/echo`, { method: 'POST', body: '{hong' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'INVALID_JSON' });
});

test('route không tồn tại kèm body hỏng vẫn là 404', async () => {
  const res = await fetch(`${base}/api/v1/khong-co`, { method: 'POST', body: '{hong' });
  assert.equal(res.status, 404);
});

test('lỗi không lường trước → 503 SERVICE_UNAVAILABLE, không lộ thông điệp', async () => {
  const res = await fetch(`${base}/boom`);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '{"error":"SERVICE_UNAVAILABLE"}');
});

test('log một dòng mỗi request, không có header Authorization hay query', async () => {
  logs.length = 0;
  await fetch(`${base}/health?lat=10.82`, { headers: { Authorization: 'Bearer bi-mat' } });
  const line = logs.find((l) => l.msg === 'request');
  assert.equal(line.path, '/health');
  assert.equal(line.status, 200);
  assert.ok(!JSON.stringify(logs).includes('bi-mat'));
  assert.ok(!JSON.stringify(logs).includes('10.82'));
});
