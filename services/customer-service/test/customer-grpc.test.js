// Gọi thật cab.customer.v1.CustomerService qua mạng nội bộ của máy (cổng ngẫu nhiên) với logic giả:
// kiểm tra tầng gRPC đọc đúng metadata và đổi lỗi nghiệp vụ → gRPC status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';
import { CustomerError } from '../src/domain/rules.js';

const log = { info() {}, warn() {}, error() {} };

test('rpc chuyển request + danh tính từ metadata; lỗi nghiệp vụ thành status kèm details', async () => {
  const seen = [];
  const customers = {
    async getCustomer(req, identity) {
      seen.push({ req, identity });
      if (req.customer_id === 2) throw new CustomerError('PERMISSION_DENIED', 'NOT_OWNER');
      return { customer_id: req.customer_id, name: 'Nguyễn Văn An' };
    },
    async createCustomer() {
      throw new Error('database dừng');
    },
    async updateCustomer(req) {
      seen.push({ req });
      return { customer_id: 1, name: 'An', dob: req.dob };
    },
  };
  const server = createGrpcServer({ health: { check: async () => 'SERVING' }, customers, log });
  const port = await startGrpcServer(server, 0);
  const { CustomerService } = loadProto('customer.proto').cab.customer.v1;
  const client = new CustomerService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const call = (method, request, md = {}) => new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    for (const [k, v] of Object.entries(md)) metadata.set(k, v);
    client[method](request, metadata, { deadline: Date.now() + 1000 }, (err, res) => resolve({ err, res }));
  });
  try {
    let { err, res } = await call('GetCustomer', { customer_id: 1 }, { 'x-account-id': '1', 'x-role': 'customer' });
    assert.equal(err, null);
    assert.equal(res.customer_id, 1);
    assert.equal(res.name, 'Nguyễn Văn An');
    assert.equal(res.dob, undefined); // optional không gửi = không có
    assert.deepEqual(seen[0].identity, { accountId: '1', role: 'customer' });

    ({ err } = await call('GetCustomer', { customer_id: 2 }, { 'x-account-id': '1', 'x-role': 'customer' }));
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(err.details, 'NOT_OWNER');

    // Không metadata → logic nhận undefined (logic thật sẽ trả IDENTITY_MISSING).
    await call('GetCustomer', { customer_id: 1 });
    assert.deepEqual(seen[2].identity, { accountId: undefined, role: undefined });

    // Lỗi không lường trước → INTERNAL, không lộ thông điệp.
    ({ err } = await call('CreateCustomer', { name: 'X' }));
    assert.equal(err.code, grpc.status.INTERNAL);
    assert.equal(err.details, 'INTERNAL');

    // Field optional vắng = undefined; clear_dob đi qua đúng.
    ({ err, res } = await call('UpdateCustomer', { dob: '1999-12-31' }));
    assert.equal(res.dob, '1999-12-31');
    assert.equal(seen[3].req.name, undefined);
    assert.equal(seen[3].req.clear_dob, false);
    await call('UpdateCustomer', { clear_dob: true });
    assert.equal(seen[4].req.dob, undefined);
    assert.equal(seen[4].req.clear_dob, true);
  } finally {
    client.close();
    server.forceShutdown();
  }
});
