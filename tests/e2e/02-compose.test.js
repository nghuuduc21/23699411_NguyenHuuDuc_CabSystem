// Mục chấm 5, 8 — container của Compose và chỉ hai cổng mở ra máy (spec 00: AC-HT-04, AC-HT-10, AC-HT-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CONTAINERS, DATABASES, compose, composePs, run, tcpProbe } from './helpers.js';

test('AC-HT-04 (mục 5): docker compose ps -a có đúng 21 container của spec', () => {
  const names = composePs().map((c) => c.Name).sort();
  assert.deepEqual(names, [...ALL_CONTAINERS].sort());
});

test('AC-HT-04 (mục 5): 20 container running (healthy), kafka-init exited (0)', () => {
  const ps = composePs();
  for (const c of ps) {
    if (c.Name === 'kafka-init') {
      assert.equal(c.State, 'exited', 'kafka-init phải đã thoát');
      assert.equal(c.ExitCode, 0, 'kafka-init phải thoát mã 0');
    } else {
      assert.equal(c.State, 'running', `${c.Name} không chạy`);
      assert.equal(c.Health, 'healthy', `${c.Name} không healthy (${c.Health})`);
    }
  }
});

test('AC-HT-04 (mục 5): 8 container database riêng (7 postgres:16-alpine, notification-db mongo:7.0)', () => {
  const byName = new Map(composePs().map((c) => [c.Name, c]));
  for (const db of DATABASES) {
    assert.ok(byName.has(db), `thiếu ${db}`);
    const want = db === 'notification-db' ? 'mongo:7.0' : 'postgres:16-alpine';
    assert.equal(byName.get(db).Image, want, `${db} dùng image ${byName.get(db).Image}`);
  }
});

test('AC-HT-10 (mục 8): chỉ gateway (3000) và kafka-ui (8080) có cổng ra máy', () => {
  const published = {};
  for (const c of composePs()) {
    const ports = (c.Publishers || []).filter((p) => p.PublishedPort > 0).map((p) => `${p.PublishedPort}->${p.TargetPort}`);
    if (ports.length) published[c.Name] = [...new Set(ports)];
  }
  assert.deepEqual(published, { gateway: ['3000->3000'], 'kafka-ui': ['8080->8080'] });
});

// MongoDB 27017 không thử bằng kết nối: máy kiểm thử có MongoDB riêng nghe 27017 (không phải container
// của project) nên sẽ "thành công nhầm". notification-db đã được chứng minh không mở cổng ở AC-HT-10.
// ADR-020 (2026-10-05): mỗi service một cổng gRPC riêng 50051…50058 — thử đủ 8 cổng.
const GRPC_PORTS = [
  [50051, 'auth-service'], [50052, 'customer-service'], [50053, 'driver-service'], [50054, 'booking-service'],
  [50055, 'trip-service'], [50056, 'payment-service'], [50057, 'notification-service'], [50058, 'rating-service'],
];
for (const [port, what] of [
  ...GRPC_PORTS.map(([p, n]) => [p, `gRPC của ${n}`]),
  [5432, 'PostgreSQL'],
  [6379, 'Redis'],
  [9092, 'Kafka'],
  [9093, 'Kafka controller'],
]) {
  test(`AC-HT-11 (mục 8): gọi thẳng localhost:${port} (${what}) từ máy bị từ chối`, async () => {
    const result = await tcpProbe(port);
    assert.notEqual(result, 'CONNECTED', `localhost:${port} mở ra máy`);
  });
}

for (const port of [50051, 50058]) {
  test(`AC-HT-11 (mục 8): Postman-style GET http://localhost:${port} không có response`, async () => {
    await assert.rejects(fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(3000) }));
  });
}

test('AC-HT-14 (mục 5, 6, ADR-020): mỗi service log "gRPC đang nghe" đúng cổng riêng; biến *_GRPC_ADDR ở gateway, booking, trip, rating đúng <tên>:<cổng>', () => {
  const portOf = Object.fromEntries(GRPC_PORTS.map(([p, n]) => [n, p]));
  for (const [port, svc] of GRPC_PORTS) {
    const r = compose('logs', '--no-log-prefix', svc);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.includes('gRPC đang nghe'));
    assert.ok(lines.length > 0, `${svc} không có dòng "gRPC đang nghe"`);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.port, port, `${svc} nghe cổng ${last.port}`);
  }
  const envOf = (container) => {
    const r = run('docker', ['exec', container, 'printenv']);
    assert.equal(r.status, 0, r.stderr);
    return Object.fromEntries(r.stdout.split(/\r?\n/).filter((l) => /_GRPC_ADDR=/.test(l)).map((l) => l.split('=')));
  };
  const addr = (svc) => `${svc}:${portOf[svc]}`;
  assert.deepEqual(envOf('gateway'), {
    AUTH_GRPC_ADDR: addr('auth-service'), CUSTOMER_GRPC_ADDR: addr('customer-service'),
    DRIVER_GRPC_ADDR: addr('driver-service'), BOOKING_GRPC_ADDR: addr('booking-service'),
    TRIP_GRPC_ADDR: addr('trip-service'), PAYMENT_GRPC_ADDR: addr('payment-service'),
    NOTIFICATION_GRPC_ADDR: addr('notification-service'), RATING_GRPC_ADDR: addr('rating-service'),
  });
  assert.deepEqual(envOf('booking-service'), {
    DRIVER_GRPC_ADDR: addr('driver-service'), TRIP_GRPC_ADDR: addr('trip-service'), PAYMENT_GRPC_ADDR: addr('payment-service'),
  });
  assert.deepEqual(envOf('trip-service'), { DRIVER_GRPC_ADDR: addr('driver-service') });
  assert.deepEqual(envOf('rating-service'), { TRIP_GRPC_ADDR: addr('trip-service') });
});
