// AC-HT-13: bảng đổi gRPC status → HTTP. Dùng một service gRPC GIẢ thật sự trả lỗi qua mạng,
// để chắc `details` đi qua dây vẫn đúng như service gửi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { loadProto } from '../src/grpc/clients.js';
import { grpcErrorToHttp } from '../src/grpc/errors.js';

const { Health } = loadProto('health.proto').grpc.health.v1;
let server;
let client;

// Service giả: tên service gửi lên quyết định lỗi trả về.
const FAKE_ERRORS = {
  notfound: { code: grpc.status.NOT_FOUND, details: 'CUSTOMER_NOT_FOUND' },
  invalid: { code: grpc.status.INVALID_ARGUMENT, details: 'INVALID_INPUT' },
  internal: { code: grpc.status.INTERNAL, details: 'lỗi gì đó' },
  precondition: { code: grpc.status.FAILED_PRECONDITION, details: 'INVALID_STATUS_TRANSITION' },
};

before(async () => {
  server = new grpc.Server();
  server.addService(Health.service, {
    Check: (call, callback) => callback(FAKE_ERRORS[call.request.service]),
  });
  const port = await new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)));
  });
  client = new Health(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
});

after(() => {
  client.close();
  server.forceShutdown();
});

function callFake(kind) {
  return new Promise((resolve) => {
    client.Check({ service: kind }, { deadline: Date.now() + 1000 }, (err) => resolve(err));
  });
}

test('NOT_FOUND + CUSTOMER_NOT_FOUND → 404 CUSTOMER_NOT_FOUND', async () => {
  assert.deepEqual(grpcErrorToHttp(await callFake('notfound')), { status: 404, body: { error: 'CUSTOMER_NOT_FOUND' } });
});

test('INVALID_ARGUMENT + INVALID_INPUT → 400 INVALID_INPUT', async () => {
  assert.deepEqual(grpcErrorToHttp(await callFake('invalid')), { status: 400, body: { error: 'INVALID_INPUT' } });
});

test('INTERNAL + "lỗi gì đó" → 503 SERVICE_UNAVAILABLE, không lộ details', async () => {
  assert.deepEqual(grpcErrorToHttp(await callFake('internal')), { status: 503, body: { error: 'SERVICE_UNAVAILABLE' } });
});

test('FAILED_PRECONDITION → 409', async () => {
  assert.deepEqual(grpcErrorToHttp(await callFake('precondition')), { status: 409, body: { error: 'INVALID_STATUS_TRANSITION' } });
});

test('đủ bảng: UNAUTHENTICATED 401, PERMISSION_DENIED 403, ALREADY_EXISTS 409', () => {
  assert.equal(grpcErrorToHttp({ code: grpc.status.UNAUTHENTICATED, details: 'INVALID_CREDENTIALS' }).status, 401);
  assert.equal(grpcErrorToHttp({ code: grpc.status.PERMISSION_DENIED, details: 'NOT_OWNER' }).status, 403);
  assert.equal(grpcErrorToHttp({ code: grpc.status.ALREADY_EXISTS, details: 'PHONE_ALREADY_EXISTS' }).status, 409);
});

test('UNAVAILABLE, DEADLINE_EXCEEDED, UNKNOWN → 503 dù details trông như mã lỗi', () => {
  for (const code of [grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED, grpc.status.UNKNOWN]) {
    assert.deepEqual(grpcErrorToHttp({ code, details: 'SOME_CODE' }).body, { error: 'SERVICE_UNAVAILABLE' });
  }
});

test('details sai dạng mã lỗi → 503', () => {
  for (const details of ['', 'AB', 'not_upper', 'CO DAU CACH', undefined, 'A'.repeat(65)]) {
    assert.equal(grpcErrorToHttp({ code: grpc.status.NOT_FOUND, details }).status, 503);
  }
});
