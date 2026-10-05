// Unit test client gRPC của booking-service: thử lại MỘT lần khi UNAVAILABLE (lỗi L1, báo cáo 2026-10-05).
// Phần 1 thử hàm callWithRetry thuần. Phần 2 dựng server gRPC thật trên 127.0.0.1 (cổng ngẫu nhiên) giả làm
// payment / driver / trip để kiểm tra từng rpc có được thử lại đúng như chú thích trong src/clients.js không.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { callWithRetry, createServiceClients } from '../src/clients.js';
import { loadProto } from '../src/grpc/server.js';

const grpcError = (statusName) => Object.assign(new Error(statusName), { statusName });

test('callWithRetry: UNAVAILABLE lần đầu → thử lại một lần với waitForReady, trả kết quả lần hai', async () => {
  const seen = [];
  const out = await callWithRetry(async (waitForReady) => {
    seen.push(waitForReady);
    if (!waitForReady) throw grpcError('UNAVAILABLE');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.deepEqual(seen, [false, true]);
});

test('callWithRetry: chỉ thử lại MỘT lần; lỗi khác UNAVAILABLE không thử lại', async () => {
  let n = 0;
  await assert.rejects(callWithRetry(async () => { n += 1; throw grpcError('UNAVAILABLE'); }), /UNAVAILABLE/);
  assert.equal(n, 2);
  for (const name of ['FAILED_PRECONDITION', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND']) {
    n = 0;
    await assert.rejects(callWithRetry(async () => { n += 1; throw grpcError(name); }), new RegExp(name));
    assert.equal(n, 1, name);
  }
});

// ---- Server gRPC giả: đếm số lần mỗi rpc được gọi; `plan[rpc]` = danh sách kết quả theo thứ tự lần gọi. ----
const counts = {};
const plan = {};
function handler(name, ok) {
  return (call, callback) => {
    counts[name] = (counts[name] ?? 0) + 1;
    const step = (plan[name] ?? [])[counts[name] - 1] ?? 'OK';
    if (step === 'OK') callback(null, ok(call.request));
    else callback({ code: grpc.status[step], details: step });
  };
}

let server;
let clients;
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
    ReserveDriver: handler('ReserveDriver', (r) => ({ driver_id: r.driver_id, booking_id: r.booking_id, status: 'BUSY' })),
    ReleaseDriver: handler('ReleaseDriver', (r) => ({ driver_id: r.driver_id, released: true })),
  });
  const port = await new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)));
  });
  const addr = `127.0.0.1:${port}`;
  clients = createServiceClients({ driverAddr: addr, paymentAddr: addr, tripAddr: addr });
});
after(() => {
  clients.close();
  server.forceShutdown();
});

const reset = (name, steps) => {
  counts[name] = 0;
  plan[name] = steps;
};

test('CreatePayment, CreateTrip, ReserveDriver, ReleaseDriver: UNAVAILABLE lần đầu → lần hai thành công (rpc lặp an toàn)', async () => {
  const cases = [
    ['CreatePayment', () => clients.createPayment({ booking_id: 1000, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' }, 'r1')],
    ['CreateTrip', () => clients.createTrip({ booking_id: 1000, customer_id: 1, driver_id: 11, vehicle_type: 'CAR_4', payment_method: 'CASH', fare_amount: 45000 }, 'r2')],
    ['ReserveDriver', () => clients.reserveDriver({ driver_id: 11, booking_id: 1000 }, 'r3')],
    ['ReleaseDriver', () => clients.releaseDriver({ driver_id: 11, booking_id: 1000 }, 'r4')],
  ];
  for (const [name, run] of cases) {
    reset(name, ['UNAVAILABLE', 'OK']);
    const res = await run();
    assert.ok(res, name);
    assert.equal(counts[name], 2, `${name} phải được gọi đúng 2 lần`);
  }
});

test('CreatePayment: UNAVAILABLE cả hai lần → báo UNAVAILABLE (booking trả 503), không thử lần ba', async () => {
  reset('CreatePayment', ['UNAVAILABLE', 'UNAVAILABLE', 'OK']);
  await assert.rejects(
    clients.createPayment({ booking_id: 1001, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' }, 'r5'),
    (err) => err.statusName === 'UNAVAILABLE',
  );
  assert.equal(counts.CreatePayment, 2);
});

test('lỗi nghiệp vụ (FAILED_PRECONDITION) không thử lại; FindNearbyDrivers không thử lại ở client (bộ ghép tự thử 3 lần)', async () => {
  reset('ReserveDriver', ['FAILED_PRECONDITION']);
  await assert.rejects(clients.reserveDriver({ driver_id: 11, booking_id: 1002 }, 'r6'), (err) => err.statusName === 'FAILED_PRECONDITION');
  assert.equal(counts.ReserveDriver, 1);

  reset('FindNearbyDrivers', ['UNAVAILABLE', 'OK']);
  await assert.rejects(
    clients.findNearbyDrivers({ lat: 10.82, lng: 106.68, vehicle: 'CAR_4', page: 1, limit: 50 }, 'r7'),
    (err) => err.statusName === 'UNAVAILABLE',
  );
  assert.equal(counts.FindNearbyDrivers, 1);
});

// Tái hiện L1 với kênh thật: service chưa chạy → lời gọi lỗi, kênh rơi vào "lỗi kết nối"; service chạy lên → lời gọi
// đầu tiên phải THÀNH CÔNG nhờ lần thử lại có waitForReady (không có waitForReady thì lần thử lại cũng UNAVAILABLE ngay).
test('L1: service vừa chạy lại → lời gọi đầu tiên thành công (thử lại chờ kênh nối lại)', async () => {
  const probe = new grpc.Server();
  const port = await new Promise((resolve, reject) => {
    probe.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)));
  });
  probe.forceShutdown(); // giữ số cổng, nhưng chưa có ai nghe
  const addr = `127.0.0.1:${port}`;
  const c = createServiceClients({ driverAddr: addr, paymentAddr: addr, tripAddr: addr });
  const req = { booking_id: 2000, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' };
  const later = new grpc.Server();
  try {
    await assert.rejects(c.createPayment(req, 'r8'), (err) => ['UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(err.statusName));
    later.addService(loadProto('payment.proto').cab.payment.v1.PaymentService.service, {
      CreatePayment: (call, callback) => callback(null, { payment_id: 2000, amount: 45000, status: 'PENDING' }),
    });
    await new Promise((resolve, reject) => {
      later.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    const res = await c.createPayment(req, 'r9');
    assert.equal(res.payment_id, 2000);
  } finally {
    c.close();
    later.forceShutdown();
  }
});
