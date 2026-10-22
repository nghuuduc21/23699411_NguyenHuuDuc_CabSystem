// Unit test client gRPC của booking-service (spec 00 H14, AC-HT-19): MỌI lời gọi S2, S3, S4, S5 bật waitForReady,
// deadline 1 000 ms, metadata mang x-role: system và x-request-id. Dựng server gRPC thật trên 127.0.0.1
// (cổng ngẫu nhiên) giả làm payment / driver / trip; server đọc lại metadata và deadline mà nó nhận được.
// Riêng `waitForReady` là tùy chọn phía client (không gửi qua mạng), nên đọc bằng `metadata.getOptions()` của
// chính đối tượng Metadata client tạo ra (systemMetadata).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { call, createServiceClients, SERVICE_DEADLINE_MS, systemMetadata } from '../src/clients.js';
import { loadProto } from '../src/grpc/server.js';

test('systemMetadata: waitForReady === true; có x-role system, x-request-id; không có x-account-id', () => {
  const md = systemMetadata('r1');
  assert.equal(md.getOptions().waitForReady, true);
  assert.deepEqual(md.get('x-role'), ['system']);
  assert.deepEqual(md.get('x-request-id'), ['r1']);
  assert.deepEqual(md.get('x-account-id'), []);
  assert.equal(SERVICE_DEADLINE_MS, 1000);
});

test('call: lời gọi truyền metadata waitForReady === true và deadline = now + 1 000 ms (AC-HT-19)', async () => {
  let captured;
  const fakeClient = {
    ReserveDriver(req, metadata, options, cb) { captured = { metadata, options }; cb(null, { status: 'BUSY' }); },
  };
  const t0 = Date.now();
  await call(fakeClient, 'ReserveDriver', { driver_id: 11, booking_id: 1000 }, 'r1');
  assert.equal(captured.metadata.getOptions().waitForReady, true);
  assert.deepEqual(captured.metadata.get('x-role'), ['system']);
  assert.deepEqual(captured.metadata.get('x-request-id'), ['r1']);
  const left = captured.options.deadline - t0;
  assert.ok(left >= SERVICE_DEADLINE_MS && left <= SERVICE_DEADLINE_MS + 50, `deadline ${left} ms`);
});

// ---- Server gRPC giả: ghi lại metadata và deadline mỗi rpc nhận được. ----
const seen = {};
function handler(name, ok) {
  return (call, callback) => {
    seen[name] = { role: call.metadata.get('x-role')[0], requestId: call.metadata.get('x-request-id')[0], deadline: call.getDeadline() };
    callback(null, ok(call.request));
  };
}

let server;
let clients;
let addr;
before(async () => {
  server = new grpc.Server();
  server.addService(loadProto('payment.proto').cab.payment.v1.PaymentService.service, {
    CreatePayment: handler('CreatePayment', (r) => ({ payment_id: r.booking_id, amount: 45000, status: 'PENDING' })),
  });
  server.addService(loadProto('trip.proto').cab.trip.v1.TripService.service, {
    CreateTrip: handler('CreateTrip', () => ({ trip_id: 1000, status: 'ACCEPTED', created: true })),
  });
  server.addService(loadProto('driver.proto').cab.driver.v1.DriverService.service, {
    FindNearbyDrivers: handler('FindNearbyDrivers', () => ({ data: [] })),
    ReserveDriver: handler('ReserveDriver', (r) => ({ driver_id: r.driver_id, booking_id: r.booking_id, status: 'BUSY', driver_name: 'Tài Xế 1', plate: '59A-00001' })),
    ReleaseDriver: handler('ReleaseDriver', (r) => ({ driver_id: r.driver_id, released: true })),
  });
  const port = await new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)));
  });
  addr = `127.0.0.1:${port}`;
  clients = createServiceClients({ driverAddr: addr, paymentAddr: addr, tripAddr: addr });
});
after(() => {
  clients.close();
  server.forceShutdown();
});

test('S2, S3, S4, S5: server nhận x-role system, x-request-id, deadline ≈ 1 s; ReserveDriver trả họ tên, biển số', async () => {
  const cases = [
    ['FindNearbyDrivers', () => clients.findNearbyDrivers({ lat: 10.82, lng: 106.68, vehicle: 'CAR_4', page: 1, limit: 50 }, 'r2')],
    ['ReserveDriver', () => clients.reserveDriver({ driver_id: 11, booking_id: 1000 }, 'r2')],
    ['ReleaseDriver', () => clients.releaseDriver({ driver_id: 11, booking_id: 1000 }, 'r2')],
    ['CreatePayment', () => clients.createPayment({ booking_id: 1000, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' }, 'r2')],
    ['CreateTrip', () => clients.createTrip({ booking_id: 1000, customer_id: 1, driver_id: 11, vehicle_type: 'CAR_4', payment_method: 'CASH', fare_amount: 45000, driver_name: 'Tài Xế 1', driver_plate: '59A-00001' }, 'r2')],
  ];
  for (const [name, run] of cases) {
    const before = Date.now();
    const res = await run();
    assert.ok(res, name);
    assert.equal(seen[name].role, 'system', name);
    assert.equal(seen[name].requestId, 'r2', name);
    const left = new Date(seen[name].deadline).getTime() - before;
    assert.ok(left > 0 && left <= SERVICE_DEADLINE_MS + 50, `${name}: deadline ${left} ms`);
    if (name === 'ReserveDriver') {
      assert.equal(res.driver_name, 'Tài Xế 1');
      assert.equal(res.plate, '59A-00001');
    }
  }
});

// Tái hiện L1 / L2 với kênh thật: service chưa chạy → lời gọi hết deadline (chờ chứ không bị từ chối ngay);
// service chạy lên → lời gọi đầu tiên THÀNH CÔNG nhờ waitForReady, không cần gọi lại.
test('L2: service dừng → lỗi sau ≈ deadline (không ngay); vừa chạy lại → lời gọi đầu thành công', async () => {
  const probe = new grpc.Server();
  const port = await new Promise((resolve, reject) => {
    probe.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)));
  });
  probe.forceShutdown(); // giữ số cổng, nhưng chưa có ai nghe
  const down = `127.0.0.1:${port}`;
  const c = createServiceClients({ driverAddr: down, paymentAddr: down, tripAddr: down });
  const req = { booking_id: 2000, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' };
  const later = new grpc.Server();
  try {
    const t0 = Date.now();
    await assert.rejects(c.createPayment(req, 'r8'), (err) => err.statusName === 'DEADLINE_EXCEEDED');
    assert.ok(Date.now() - t0 >= SERVICE_DEADLINE_MS - 50, 'phải chờ tới hết deadline');
    later.addService(loadProto('payment.proto').cab.payment.v1.PaymentService.service, {
      CreatePayment: (call, callback) => callback(null, { payment_id: 2000, amount: 45000, status: 'PENDING' }),
    });
    await new Promise((resolve, reject) => {
      later.bindAsync(down, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    const res = await c.createPayment(req, 'r9');
    assert.equal(res.payment_id, 2000);
  } finally {
    c.close();
    later.forceShutdown();
  }
});
