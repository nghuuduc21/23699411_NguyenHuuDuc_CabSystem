// Test A07, A08, A11–A18, A39 qua HTTP thật (cổng ngẫu nhiên) với auth-service, driver-service giả
// (spec 12-13-21-23). Kiểm tra phần việc của Gateway: role của đường dẫn và của biến thể, hình thức
// body / query, chọn biến thể, đổi REST ↔ gRPC, metadata, lọc field optional.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { buildRoutes } from '../src/routes.js';
import { createAuthHandlers } from '../src/handlers/auth.js';
import { createDriverHandlers } from '../src/handlers/drivers.js';
import { createAuthenticator } from '../src/token.js';

const SECRET = 'demo-jwt-secret-chi-dung-cho-may-demo-32b';
const log = { info() {}, warn() {}, error() {} };

// Service giả: ghi lại request và metadata; `next` quyết định kết quả lần gọi tới.
const calls = [];
let next;
const fakeRpc = (name) => (request, metadata, options, callback) => {
  calls.push({ name, request, metadata: metadata.getMap(), deadline: options.deadline });
  const { err, res } = next(name, request);
  setImmediate(() => callback(err ?? null, res));
};
const fakeClient = (names) => Object.fromEntries(names.map((n) => [n, fakeRpc(n)]));
const driverClient = fakeClient(['SubmitApplication', 'GetDriver', 'ListDrivers', 'FindNearbyDrivers', 'ApproveDriver', 'RejectDriver', 'SetAvailability', 'UpdateLocation']);
const authClient = fakeClient(['RequestDriverOtp', 'RegisterDriver']);

const revocations = { isRevoked: async () => false, revoke: async () => {} };
const health = { live() {}, ready() {}, services() {} };
const auth = createAuthHandlers({ authClient, revocations, log });
const drivers = createDriverHandlers({ driverClient });
const authenticate = createAuthenticator({ secret: SECRET, isRevoked: revocations.isRevoked, log });

let server;
let base;
before(async () => {
  server = createApp({ routes: buildRoutes({ health, auth, drivers }), log, authenticate }).listen(0, '127.0.0.1');
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
async function expectJson(res, status, json) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), json);
}
const expectError = async (res, status, error) => expectJson(res, status, { error });

// ---------- A07, A08 ----------

test('A07: 201, chỉ chuyển phone; bỏ key phụ `_otp` của oneof (AC-TX-01)', async () => {
  next = () => ({ res: { phone: '0911111111', expires_in: 300, otp: '482915', _otp: 'otp' } });
  await expectJson(await send('POST', '/api/v1/otps', { body: { phone: '0911111111' } }), 201, { phone: '0911111111', expires_in: 300, otp: '482915' });
  assert.equal(calls[0].name, 'RequestDriverOtp');
  assert.deepEqual(calls[0].request, { phone: '0911111111' });
  next = () => ({ res: { phone: '0911111111', expires_in: 300 } });
  await expectJson(await send('POST', '/api/v1/otps', { body: { phone: '0911111111' } }), 201, { phone: '0911111111', expires_in: 300 });
});

test('A07: hình thức sai → 400; lỗi của service đổi sang HTTP', async () => {
  await expectError(await send('POST', '/api/v1/otps', { body: {} }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/otps', { body: { phone: 911 } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/otps', { body: { phone: '0911111111', x: 1 } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/otps', { body: '{abc' }), 400, 'INVALID_JSON');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.ALREADY_EXISTS, details: 'PHONE_ALREADY_EXISTS' } });
  await expectError(await send('POST', '/api/v1/otps', { body: { phone: '0910000001' } }), 409, 'PHONE_ALREADY_EXISTS');
  next = () => ({ err: { code: grpc.status.UNAVAILABLE, details: 'x' } });
  await expectError(await send('POST', '/api/v1/otps', { body: { phone: '0911111111' } }), 503, 'SERVICE_UNAVAILABLE');
});

test('A08: 201 kèm token; `role` trong body → 400 (AC-TX-02, 08)', async () => {
  next = () => ({ res: { account_id: 1000, role: 'driver', token: 'eyJ', expires_in: 3600 } });
  const body = { phone: '0911111111', otp: '482915', password: '12345678' };
  await expectJson(await send('POST', '/api/v1/driver-accounts', { body }), 201, { account_id: 1000, role: 'driver', token: 'eyJ', expires_in: 3600 });
  assert.deepEqual(calls[0].request, body);
  await expectError(await send('POST', '/api/v1/driver-accounts', { body: { ...body, role: 'admin' } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/driver-accounts', { body: { phone: '0911111111', password: '12345678' } }), 400, 'INVALID_INPUT');
  next = () => ({ err: { code: grpc.status.INVALID_ARGUMENT, details: 'OTP_EXPIRED' } });
  await expectError(await send('POST', '/api/v1/driver-accounts', { body }), 400, 'OTP_EXPIRED');
});

// ---------- A11 ----------

test('A11: 201; vehicle mặc định CAR_4, chữ hoa; metadata từ token (AC-TX-03)', async () => {
  next = () => ({ res: { driver_id: 1000, name: 'Tai Xe Moi', vehicle: 'CAR_4', plate: '59A-99999', status: 'OFFLINE', approval_status: 'PENDING', license: 'GPLX-99', _license: 'license' } });
  const res = await send('POST', '/api/v1/drivers', { t: token('1000', 'driver'), body: { name: 'Tai Xe Moi', license: 'GPLX-99', plate: '59A-99999' } });
  await expectJson(res, 201, { driver_id: 1000, name: 'Tai Xe Moi', vehicle: 'CAR_4', plate: '59A-99999', status: 'OFFLINE', approval_status: 'PENDING', license: 'GPLX-99' });
  assert.deepEqual(calls[0].request, { name: 'Tai Xe Moi', license: 'GPLX-99', plate: '59A-99999', vehicle: 'CAR_4' });
  assert.equal(calls[0].metadata['x-account-id'], '1000');
  assert.equal(calls[0].metadata['x-role'], 'driver');
  await send('POST', '/api/v1/drivers', { t: TX1, body: { name: 'A', license: 'B', plate: 'C', vehicle: 'motorbike', color: 'Do' } });
  assert.deepEqual(calls[1].request, { name: 'A', license: 'B', plate: 'C', vehicle: 'MOTORBIKE', color: 'Do' });
});

test('A11 nộp lại (FR43): service trả resubmitted = true → 200 kèm cờ; không có cờ → 201 (AC-TX-34, TX12)', async () => {
  const resubmitted = { driver_id: 17, name: 'Tai Xe 7', vehicle: 'CAR_4', plate: '59A-00007', status: 'OFFLINE', approval_status: 'PENDING', license: 'GPLX-00007' };
  next = () => ({ res: { ...resubmitted, resubmitted: true, _resubmitted: 'resubmitted' } });
  const res = await send('POST', '/api/v1/drivers', { t: token('17', 'driver'), body: { name: 'Tai Xe 7', license: 'GPLX-00007', plate: '59A-00007' } });
  await expectJson(res, 200, { ...resubmitted, resubmitted: true });
  // proto3 optional bool không đặt → vắng / false: lần nộp đầu vẫn 201, không có cờ.
  next = () => ({ res: { ...resubmitted, resubmitted: false } });
  await expectJson(await send('POST', '/api/v1/drivers', { t: token('17', 'driver'), body: { name: 'Tai Xe 7', license: 'GPLX-00007', plate: '59A-00007' } }), 201, resubmitted);
});

test('A11: 401 / 403 trước hình thức; body sai → 400 (AC-TX-10, 11)', async () => {
  const ok = { name: 'Tai Xe Moi', license: 'GPLX-99', plate: '59A-99999' };
  await expectError(await send('POST', '/api/v1/drivers', { body: ok }), 401, 'TOKEN_MISSING');
  await expectError(await send('POST', '/api/v1/drivers', { t: KH1, body: '{hong' }), 403, 'FORBIDDEN');
  await expectError(await send('POST', '/api/v1/drivers', { t: AD1, body: ok }), 403, 'FORBIDDEN');
  await expectError(await send('POST', '/api/v1/drivers', { t: TX1, body: { name: 'x', plate: 'y' } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/drivers', { t: TX1, body: { ...ok, name: '<b>x</b>' } }), 400, 'TEXT_CONTAINS_HTML');
  await expectError(await send('POST', '/api/v1/drivers', { t: TX1, body: { ...ok, approval_status: 'APPROVED' } }), 400, 'INVALID_INPUT');
  await expectError(await send('POST', '/api/v1/drivers', { t: TX1, body: { ...ok, driver_id: 5 } }), 400, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.ALREADY_EXISTS, details: 'LICENSE_PLATE_ALREADY_EXISTS' } });
  await expectError(await send('POST', '/api/v1/drivers', { t: TX1, body: ok }), 409, 'LICENSE_PLATE_ALREADY_EXISTS');
});

// ---------- A14 ----------

test('A14: mã gửi dạng chuỗi; field vắng không có key; INVALID_ID; 404 (AC-TX-26, 28)', async () => {
  next = () => ({ res: { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE' } });
  await expectJson(await send('GET', '/api/v1/drivers/11', { t: KH1 }), 200, { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE' });
  assert.deepEqual(calls[0].request, { driver_id: '11' });
  for (const id of ['abc', '11%20OR%201=1', '0', '-1']) await expectError(await send('GET', `/api/v1/drivers/${id}`, { t: KH1 }), 400, 'INVALID_ID');
  await expectError(await send('GET', '/api/v1/drivers/11'), 401, 'TOKEN_MISSING');
  assert.equal(calls.length, 1);
  next = () => ({ err: { code: grpc.status.NOT_FOUND, details: 'DRIVER_NOT_FOUND' } });
  await expectError(await send('GET', '/api/v1/drivers/999', { t: TX1 }), 404, 'DRIVER_NOT_FOUND');
});

// ---------- GET /drivers: A12, A13 ----------

test('A12: tọa độ, phân trang mặc định, vehicle chữ hoa; response chỉ 5 key mỗi tài xế (AC-TX-29)', async () => {
  next = () => ({ res: { data: [{ driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', distance_m: 111 }], pagination: { page: 1, limit: 2, total: 4, total_pages: 2 } } });
  const res = await send('GET', '/api/v1/drivers?lat=10.82&lng=106.68&limit=2', { t: KH1 });
  await expectJson(res, 200, { data: [{ driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', distance_m: 111 }], pagination: { page: 1, limit: 2, total: 4, total_pages: 2 } });
  assert.equal(calls[0].name, 'FindNearbyDrivers');
  assert.deepEqual(calls[0].request, { lat: 10.82, lng: 106.68, page: 1, limit: 2 });
  await send('GET', '/api/v1/drivers?lat=10.82&lng=106.68&vehicle=car_4&page=2', { t: AD1 });
  assert.deepEqual(calls[1].request, { lat: 10.82, lng: 106.68, vehicle: 'CAR_4', page: 2, limit: 10 });
});

test('A12: query sai → 400 đúng mã, không gọi service (AC-TX-31)', async () => {
  const cases = [
    ['lat=10.82', 'INVALID_INPUT'],
    ['lat=91&lng=106.68', 'INVALID_COORDINATES'],
    ['lat=abc&lng=1', 'INVALID_INPUT'],
    ['lat=10.82&lng=106.68&limit=0', 'INVALID_PAGINATION'],
    ['lat=10.82&lng=106.68&limit=51', 'INVALID_PAGINATION'],
    ['lat=10.82&lng=106.68&page=0', 'INVALID_PAGINATION'],
    ['lat=10.82&lng=106.68&radius=2000', 'INVALID_INPUT'],
    ['lat=10.82&lng=106.68&approval_status=PENDING', 'INVALID_INPUT'],
    ['lat=10.82&lat=10.83&lng=106.68', 'INVALID_INPUT'],
    ['lat=10.82&lng=', 'INVALID_INPUT'],
  ];
  for (const [query, error] of cases) await expectError(await send('GET', `/api/v1/drivers?${query}`, { t: KH1 }), 400, error);
  assert.equal(calls.length, 0);
});

test('A12 / A13: tài xế → 403 trước khi đọc query; khách không có lat → 403 (AC-TX-32)', async () => {
  await expectError(await send('GET', '/api/v1/drivers?lat=10.82&lng=106.68', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('GET', '/api/v1/drivers?lat=abc', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('GET', '/api/v1/drivers', { t: KH1 }), 403, 'FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('A13: admin; approval_status chữ hoa; giá trị lạ, query lạ → 400; created_at giữ (AC-TX-13)', async () => {
  next = () => ({ res: { data: [{ driver_id: 17, name: 'Tài Xế 7', vehicle: 'CAR_4', plate: '59A-00007', status: 'OFFLINE', approval_status: 'PENDING', created_at: '2026-10-04T00:00:00.000Z' }], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 } } });
  const res = await send('GET', '/api/v1/drivers?approval_status=pending', { t: AD1 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data[0].created_at, '2026-10-04T00:00:00.000Z');
  assert.equal(calls[0].name, 'ListDrivers');
  assert.deepEqual(calls[0].request, { approval_status: 'PENDING', page: 1, limit: 10 });
  await send('GET', '/api/v1/drivers', { t: AD1 });
  assert.deepEqual(calls[1].request, { page: 1, limit: 10 });
  await expectError(await send('GET', '/api/v1/drivers?approval_status=DONE', { t: AD1 }), 400, 'INVALID_INPUT');
  await expectError(await send('GET', '/api/v1/drivers?x=1', { t: AD1 }), 400, 'INVALID_INPUT');
  await expectError(await send('GET', '/api/v1/drivers?limit=abc', { t: AD1 }), 400, 'INVALID_PAGINATION');
});

// ---------- PATCH /drivers/{id}: A15, A16 ----------

test('A15 / A16: chọn rpc theo approval_status; reason chuyển xuống (AC-TX-14, 15)', async () => {
  next = (name) => ({ res: name === 'ApproveDriver' ? { driver_id: 1000, approval_status: 'APPROVED' } : { driver_id: 17, approval_status: 'REJECTED', reason: 'thieu giay to' } });
  await expectJson(await send('PATCH', '/api/v1/drivers/1000', { t: AD1, body: { approval_status: 'approved' } }), 200, { driver_id: 1000, approval_status: 'APPROVED' });
  assert.equal(calls[0].name, 'ApproveDriver');
  assert.deepEqual(calls[0].request, { driver_id: '1000' });
  await expectJson(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'REJECTED', reason: 'thieu giay to' } }), 200, { driver_id: 17, approval_status: 'REJECTED', reason: 'thieu giay to' });
  assert.equal(calls[1].name, 'RejectDriver');
  assert.deepEqual(calls[1].request, { driver_id: '17', reason: 'thieu giay to' });
});

test('A15 / A16: 403 trước body; INVALID_ID; REASON_REQUIRED; INVALID_INPUT; HTML (AC-TX-16, 17)', async () => {
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: KH1 }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: TX1 }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/drivers/abc', { t: AD1, body: { approval_status: 'APPROVED' } }), 400, 'INVALID_ID');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'REJECTED' } }), 400, 'REASON_REQUIRED');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'REJECTED', reason: '   ' } }), 400, 'REASON_REQUIRED');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'REJECTED', reason: 'x'.repeat(256) } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'REJECTED', reason: '<script>' } }), 400, 'TEXT_CONTAINS_HTML');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'PENDING' } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'APPROVED', reason: 'x' } }), 400, 'INVALID_INPUT');
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1 }), 400, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'APPLICATION_ALREADY_REVIEWED' } });
  await expectError(await send('PATCH', '/api/v1/drivers/17', { t: AD1, body: { approval_status: 'APPROVED' } }), 409, 'APPLICATION_ALREADY_REVIEWED');
});

// ---------- PATCH /drivers/me: A17, A39, A18 ----------

test('A17 / A39 / A18: chọn rpc theo body; status chữ hoa; "me" không bị coi là mã (AC-TX-19, 20, 25)', async () => {
  next = (name, request) => ({ res: name === 'UpdateLocation' ? { driver_id: 15, ...request } : { driver_id: 11, status: request.status, ...(request.status === 'ONLINE' ? { lat: 10.821, lng: 106.68 } : {}) } });
  await expectJson(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: { status: 'offline' } }), 200, { driver_id: 11, status: 'OFFLINE' });
  assert.deepEqual(calls[0].request, { status: 'OFFLINE' });
  assert.equal(calls[0].name, 'SetAvailability');
  await expectJson(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: { status: 'ONLINE' } }), 200, { driver_id: 11, status: 'ONLINE', lat: 10.821, lng: 106.68 });
  await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: { status: 'ONLINE', lat: 10.82, lng: 106.68 } });
  assert.deepEqual(calls[2].request, { status: 'ONLINE', lat: 10.82, lng: 106.68 });
  await expectJson(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: { lat: 10.8205, lng: 106.68 } }), 200, { driver_id: 15, lat: 10.8205, lng: 106.68 });
  assert.equal(calls[3].name, 'UpdateLocation');
});

test('A17 / A39 / A18: body sai → 400; khách, admin → 403 (AC-TX-23, 24, 25)', async () => {
  const cases = [
    [{ status: 'BUSY' }, 'INVALID_INPUT'],
    [{}, 'INVALID_INPUT'],
    [{ status: 'OFFLINE', lat: 10.82, lng: 106.68 }, 'INVALID_INPUT'],
    [{ status: 'ONLINE', lat: 10.82 }, 'INVALID_INPUT'],
    [{ lat: 91, lng: 106.68 }, 'INVALID_COORDINATES'],
    [{ lat: 10.82 }, 'INVALID_INPUT'],
    [{ lat: '10.82', lng: 106.68 }, 'INVALID_INPUT'],
    [{ lat: 10.82, lng: 106.68, x: 1 }, 'INVALID_INPUT'],
    [{ status: 1 }, 'INVALID_INPUT'],
  ];
  for (const [body, error] of cases) await expectError(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body }), 400, error);
  await expectError(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: '{hong' }), 400, 'INVALID_JSON');
  await expectError(await send('PATCH', '/api/v1/drivers/me', { t: KH1, body: { status: 'OFFLINE' } }), 403, 'FORBIDDEN');
  await expectError(await send('PATCH', '/api/v1/drivers/me', { t: AD1, body: { status: 'OFFLINE' } }), 403, 'FORBIDDEN');
  assert.equal(calls.length, 0);
  next = () => ({ err: { code: grpc.status.FAILED_PRECONDITION, details: 'DRIVER_NOT_APPROVED' } });
  await expectError(await send('PATCH', '/api/v1/drivers/me', { t: TX1, body: { status: 'ONLINE' } }), 409, 'DRIVER_NOT_APPROVED');
});
