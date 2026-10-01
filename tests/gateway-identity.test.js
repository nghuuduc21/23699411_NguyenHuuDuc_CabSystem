import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../services/gateway/src/app.js';
import { createIdentityClient } from '../services/gateway/src/identity-client.js';
import {
  createIdentityServer,
  listen,
} from '../services/identity/src/grpc-server.js';

// Dựng Identity gRPC server thật với dependency giả (không cần PostgreSQL),
// rồi dựng Gateway gọi đến nó. Trả về địa chỉ HTTP của Gateway.
async function startSystem(t, identityDeps) {
  const identity = createIdentityServer({
    checkDatabase: async () => {},
    registerAccount: async () => {
      throw new Error('registerAccount không được gọi trong test này');
    },
    ...identityDeps,
  });

  // Cổng 0: hệ điều hành chọn cổng trống.
  const port = await listen(identity, '127.0.0.1:0');
  t.after(() => identity.forceShutdown());

  return startGateway(t, `127.0.0.1:${port}`);
}

async function startGateway(t, identityAddress) {
  const app = createApp({
    identityClient: createIdentityClient(identityAddress),
  });

  const gateway = createServer(app);

  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });

  t.after(() => new Promise((resolve) => gateway.close(resolve)));

  return `http://127.0.0.1:${gateway.address().port}`;
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  full_name: 'Nguyen Van A',
  phone: '0901234567',
  password: '12345678',
};

test('Gateway trả 200 khi Identity ready qua gRPC', async (t) => {
  const gatewayUrl = await startSystem(t, {});

  const response = await fetch(`${gatewayUrl}/health/services`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ready',
    services: { identity: 'healthy' },
  });
});

test('Gateway trả 503 khi database của Identity lỗi', async (t) => {
  const gatewayUrl = await startSystem(t, {
    checkDatabase: async () => {
      throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    },
  });

  const response = await fetch(`${gatewayUrl}/health/services`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'not_ready',
    services: { identity: 'unavailable' },
  });

  // Dependency lỗi nhưng bản thân Gateway vẫn còn phản hồi.
  const health = await fetch(`${gatewayUrl}/health`);
  assert.equal(health.status, 200);
});

test('Gateway trả 503 khi không kết nối được Identity', async (t) => {
  // Cổng 1: không có service nào lắng nghe.
  const gatewayUrl = await startGateway(t, '127.0.0.1:1');

  const health = await fetch(`${gatewayUrl}/health/services`);
  assert.equal(health.status, 503);

  const register = await postJson(
    `${gatewayUrl}/api/v1/auth/register`,
    validBody,
  );
  assert.equal(register.status, 503);
  assert.deepEqual(await register.json(), { error: 'IDENTITY_UNAVAILABLE' });
});

test('Đăng ký thành công: REST → gRPC → REST, trả 201', async (t) => {
  let received;

  const gatewayUrl = await startSystem(t, {
    registerAccount: async (request) => {
      received = request;

      return {
        account: {
          account_id: 7,
          full_name: 'Nguyen Van A',
          email: null,
          phone: '0901234567',
          role: 'customer',
          status: 'active',
          created_at: new Date('2026-09-30T10:00:00Z'),
        },
      };
    },
  });

  const response = await postJson(`${gatewayUrl}/api/v1/auth/register`, {
    ...validBody,
    unknown_field: 'bị bỏ qua',
  });

  // Identity nhận đúng dữ liệu qua gRPC, không có field lạ.
  assert.deepEqual({ ...received }, validBody);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    account: {
      account_id: '7',
      full_name: 'Nguyen Van A',
      email: null,
      phone: '0901234567',
      role: 'customer',
      status: 'active',
      created_at: '2026-09-30T10:00:00.000Z',
    },
  });
});

test('Lỗi nghiệp vụ từ Identity được đổi sang HTTP 400 và 409', async (t) => {
  const errors = ['INVALID_PHONE', 'ACCOUNT_ALREADY_EXISTS'];

  const gatewayUrl = await startSystem(t, {
    registerAccount: async () => ({ error: errors.shift() }),
  });

  const invalid = await postJson(`${gatewayUrl}/api/v1/auth/register`, validBody);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'INVALID_PHONE' });

  const duplicate = await postJson(`${gatewayUrl}/api/v1/auth/register`, validBody);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'ACCOUNT_ALREADY_EXISTS' });
});

test('Lỗi database khi đăng ký trả 503 REGISTRATION_UNAVAILABLE', async (t) => {
  const gatewayUrl = await startSystem(t, {
    registerAccount: async () => {
      throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    },
  });

  const response = await postJson(`${gatewayUrl}/api/v1/auth/register`, validBody);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'REGISTRATION_UNAVAILABLE' });
});

test('Gateway chặn field sai kiểu trước khi gọi gRPC', async (t) => {
  let called = false;

  const gatewayUrl = await startSystem(t, {
    registerAccount: async () => {
      called = true;
      return { error: 'SHOULD_NOT_HAPPEN' };
    },
  });

  // Nếu không chặn, protobuf sẽ tự đổi số thành chuỗi "901234567".
  const response = await postJson(`${gatewayUrl}/api/v1/auth/register`, {
    ...validBody,
    phone: 901234567,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'INVALID_BODY' });
  assert.equal(called, false);
});
