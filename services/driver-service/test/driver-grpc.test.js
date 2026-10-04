// Gọi thật cab.driver.v1.DriverService qua cổng ngẫu nhiên với logic giả: kiểm tra tầng gRPC đọc đúng
// metadata, field `optional` vắng thì logic nhận undefined, và lỗi nghiệp vụ → gRPC status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';
import { DriverError } from '../src/domain/rules.js';

const log = { info() {}, warn() {}, error() {} };

test('DriverService: request, metadata, optional, lỗi nghiệp vụ, lỗi không lường trước', async () => {
  const seen = [];
  const remember = (name, result) => async (req, identity) => { seen.push({ name, req, identity }); return typeof result === 'function' ? result(req) : result; };
  const drivers = {
    submitApplication: remember('submit', { driver_id: 1000, name: 'A', vehicle: 'CAR_4', plate: '59A-99999', status: 'OFFLINE', approval_status: 'PENDING', license: 'GPLX-99' }),
    getDriver: remember('get', { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE' }),
    listDrivers: remember('list', { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } }),
    findNearbyDrivers: remember('nearby', { data: [{ driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', distance_m: 111 }], pagination: { page: 1, limit: 2, total: 4, total_pages: 2 } }),
    async approveDriver() { throw new DriverError('FAILED_PRECONDITION', 'APPLICATION_ALREADY_REVIEWED'); },
    async rejectDriver() { throw new Error('database dừng'); },
    setAvailability: remember('availability', (req) => ({ driver_id: 11, status: req.status })),
    updateLocation: remember('location', (req) => ({ driver_id: 11, lat: req.lat, lng: req.lng })),
  };
  const server = createGrpcServer({ health: { check: async () => 'SERVING' }, drivers, log });
  const port = await startGrpcServer(server, 0);
  const { DriverService } = loadProto('driver.proto').cab.driver.v1;
  const client = new DriverService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const call = (method, request, md = { 'x-account-id': '11', 'x-role': 'driver' }) => new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    for (const [k, v] of Object.entries(md)) metadata.set(k, v);
    client[method](request, metadata, { deadline: Date.now() + 1000 }, (err, res) => resolve({ err, res }));
  });
  try {
    // Phần công khai: field optional không có giá trị → vắng ở phía nhận.
    let { err, res } = await call('GetDriver', { driver_id: '11' }, { 'x-account-id': '1', 'x-role': 'customer' });
    assert.equal(err, null);
    assert.equal(res.license, undefined);
    assert.equal(res.approval_status, undefined);
    assert.equal(seen[0].req.driver_id, 11); // int64 gửi dạng chuỗi → số
    assert.deepEqual(seen[0].identity, { accountId: '1', role: 'customer' });

    // A17 không gửi tọa độ: logic nhận lat / lng = undefined (phân biệt được với 0).
    await call('SetAvailability', { status: 'ONLINE' });
    assert.equal(seen[1].req.lat, undefined);
    assert.equal(seen[1].req.lng, undefined);
    await call('SetAvailability', { status: 'ONLINE', lat: 10.82, lng: 0 });
    assert.equal(seen[2].req.lat, 10.82);
    assert.equal(seen[2].req.lng, 0);

    // A12 không gửi vehicle → undefined (mọi loại xe).
    ({ res } = await call('FindNearbyDrivers', { lat: 10.82, lng: 106.68, page: 1, limit: 2 }, { 'x-account-id': '1', 'x-role': 'customer' }));
    assert.equal(seen[3].req.vehicle, undefined);
    assert.equal(res.data[0].distance_m, 111);
    assert.equal(res.pagination.total, 4);

    // Danh sách rỗng vẫn có data: [] và total: 0.
    ({ res } = await call('ListDrivers', { page: 1, limit: 10 }, { 'x-account-id': '99', 'x-role': 'admin' }));
    assert.deepEqual(res.data, []);
    assert.equal(res.pagination.total, 0);

    ({ err } = await call('ApproveDriver', { driver_id: '17' }));
    assert.equal(err.code, grpc.status.FAILED_PRECONDITION);
    assert.equal(err.details, 'APPLICATION_ALREADY_REVIEWED');

    ({ err } = await call('RejectDriver', { driver_id: '17', reason: 'x' }));
    assert.equal(err.code, grpc.status.INTERNAL);
    assert.equal(err.details, 'INTERNAL'); // không lộ thông điệp "database dừng"
  } finally {
    client.close();
    server.forceShutdown();
  }
});
