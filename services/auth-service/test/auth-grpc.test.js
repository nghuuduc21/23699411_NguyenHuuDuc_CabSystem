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
      if (req.email === 'dup') throw new AuthError('ALREADY_EXISTS', 'EMAIL_ALREADY_EXISTS');
      if (req.email === 'boom') throw new Error('database dừng');
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
    let r = await call('RegisterCustomer', { email: 'new1@cab.vn', password: '12345678' });
    assert.deepEqual(r.res, { account_id: 1000, role: 'customer' });
    // Số 1 (`phone`) đã reserved (ADR-021): request không còn khóa phone; email đi qua số 2.
    assert.equal('phone' in seen[0], false);
    assert.equal(seen[0].email, 'new1@cab.vn');
    r = await call('RegisterCustomer', { email: 'dup', password: 'x' });
    assert.equal(r.err.code, grpc.status.ALREADY_EXISTS);
    assert.equal(r.err.details, 'EMAIL_ALREADY_EXISTS');
    r = await call('RegisterCustomer', { email: 'boom', password: 'x' });
    assert.equal(r.err.code, grpc.status.INTERNAL);
    assert.equal(r.err.details, 'INTERNAL');
    r = await call('Login', { email: 'kh1@cab.vn', password: 'sai' });
    assert.equal(r.err.code, grpc.status.UNAUTHENTICATED);
    assert.equal(r.err.details, 'INVALID_CREDENTIALS');
    // `optional`: field không gửi tới server là undefined — phân biệt được "không gửi" với chuỗi rỗng.
    r = await call('Login', { email: 'kh1@cab.vn', password: '12345678' });
    assert.equal(r.res.expires_in, 3600);
    assert.equal(seen.at(-1).email, 'kh1@cab.vn');
    assert.equal(seen.at(-1).phone, undefined);
    r = await call('Login', { phone: '0910000001', password: '12345678' });
    assert.equal(seen.at(-1).phone, '0910000001');
    assert.equal(seen.at(-1).email, undefined);
  } finally {
    client.close();
    server.forceShutdown();
  }
});

test('seed: 13 tài khoản theo quy luật mã, câu SQL có tham số, OVERRIDING SYSTEM VALUE, ON CONFLICT', async () => {
  assert.deepEqual(SEED_ACCOUNTS.map((a) => a.id), [1, 2, 3, 9, 11, 12, 13, 14, 15, 16, 17, 18, 99]);
  assert.equal(SEED_ACCOUNTS.find((a) => a.id === 9).status, 'LOCKED');
  // ADR-021: tài xế dùng số, mọi người khác dùng email (đúng CHECK accounts_identity_by_role).
  for (const a of SEED_ACCOUNTS) {
    if (a.role === 'driver') assert.ok(a.phone && a.email === null);
    else assert.ok(a.email && a.phone === null);
  }
  assert.equal(SEED_ACCOUNTS.find((a) => a.id === 1).email, 'kh1@cab.vn');
  assert.equal(SEED_ACCOUNTS.find((a) => a.id === 99).email, 'admin@cab.vn');
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
