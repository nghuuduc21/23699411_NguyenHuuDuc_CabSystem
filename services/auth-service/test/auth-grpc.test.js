// Gọi thật AuthService qua gRPC (cổng ngẫu nhiên) với logic giả: kiểm tra đổi lỗi nghiệp vụ → gRPC status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';
import { AuthError } from '../src/domain/rules.js';
import { runSeed, SEED_ACCOUNTS } from '../src/seed.js';

const silent = { info() {}, warn() {}, error() {} };

test('RegisterCustomer / Login: kết quả và lỗi đổi đúng status + details', async () => {
  const seen = [];
  const auth = {
    async registerCustomer(req) {
      seen.push(req);
      if (req.phone === 'dup') throw new AuthError('ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
      if (req.phone === 'boom') throw new Error('database dừng');
      return { account_id: 1000, role: 'customer' };
    },
    async login(req) {
      seen.push(req);
      if (req.password === 'sai') throw new AuthError('UNAUTHENTICATED', 'INVALID_CREDENTIALS');
      return { token: 't', account_id: 1, role: 'customer', expires_in: 3600 };
    },
  };
  const server = createGrpcServer({ health: { check: async () => 'SERVING' }, auth, log: silent });
  const port = await startGrpcServer(server, 0);
  const { AuthService } = loadProto('auth.proto').cab.auth.v1;
  const client = new AuthService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const call = (method, req) => new Promise((resolve) => {
    client[method](req, { deadline: Date.now() + 2000 }, (err, res) => resolve({ err, res }));
  });
  try {
    let r = await call('RegisterCustomer', { phone: '0901234567', password: '12345678' });
    assert.deepEqual(r.res, { account_id: 1000, role: 'customer' });
    // Field 2 (`email`) đã reserved: request không còn khóa email (ADR-019).
    assert.equal('email' in seen[0], false);
    r = await call('RegisterCustomer', { phone: 'dup', password: 'x' });
    assert.equal(r.err.code, grpc.status.ALREADY_EXISTS);
    assert.equal(r.err.details, 'PHONE_ALREADY_EXISTS');
    r = await call('RegisterCustomer', { phone: 'boom', password: 'x' });
    assert.equal(r.err.code, grpc.status.INTERNAL);
    assert.equal(r.err.details, 'INTERNAL');
    r = await call('Login', { phone: '0900000001', password: 'sai' });
    assert.equal(r.err.code, grpc.status.UNAUTHENTICATED);
    assert.equal(r.err.details, 'INVALID_CREDENTIALS');
    // Bên gọi gửi khóa `email` lạ: proto không còn field này nên server không nhận được; thiếu phone → undefined.
    r = await call('Login', { email: 'a@b.vn', password: '12345678' });
    assert.equal(r.res.expires_in, 3600);
    assert.equal(seen.at(-1).phone, undefined);
    assert.equal('email' in seen.at(-1), false);
  } finally {
    client.close();
    server.forceShutdown();
  }
});

test('seed: 13 tài khoản theo quy luật mã, câu SQL có tham số, OVERRIDING SYSTEM VALUE, ON CONFLICT', async () => {
  assert.deepEqual(SEED_ACCOUNTS.map((a) => a.id), [1, 2, 3, 9, 11, 12, 13, 14, 15, 16, 17, 18, 99]);
  assert.equal(SEED_ACCOUNTS.find((a) => a.id === 9).status, 'LOCKED');
  assert.equal(SEED_ACCOUNTS.find((a) => a.id === 18).phone, '0910000008');
  const queries = [];
  const pool = { async query(sql, params) { queries.push({ sql, params }); return { rowCount: 1 }; } };
  const rows = await runSeed({ pool, log: silent, config: { seedPassword: '12345678' }, hash: async () => 'scrypt$a$b' });
  assert.equal(rows, SEED_ACCOUNTS.length);
  for (const q of queries) {
    assert.match(q.sql, /OVERRIDING SYSTEM VALUE/);
    assert.match(q.sql, /ON CONFLICT DO NOTHING/);
    assert.ok(!q.params.includes('12345678'), 'không ghi mật khẩu rõ');
  }
});
