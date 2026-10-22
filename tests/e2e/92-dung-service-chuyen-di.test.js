// Spec 17-18, 20-29 và 00 (ADR-020) — các AC phải DỪNG hoặc RESTART container:
//   AC-CD-08 (trip dừng → 503), AC-CD-19 (payment dừng, hủy vẫn 200, hoàn khi chạy lại), AC-HT-06 (driver dừng,
//   chuyến vẫn hoàn thành, tài xế rảnh khi chạy lại), AC-TB-05, AC-TB-06 (notification dừng / restart),
//   AC-DG-07 (trip dừng → đánh giá 503, không lưu), AC-DG-13 (restart rating không nhân đôi seed),
//   AC-HT-15 (spec 00: 8 lần restart / dừng-bật đổi IP → kênh gRPC không nối nhầm, lời gọi đầu không 503 — H14),
//   AC-CD-22 (migration 002 trên trip-db "cũ").
// Chạy bằng `npm run test:dung-service`. Mỗi test bật lại container ở `finally` và chờ healthy + /health/services 200.
// "≈ 3 s sau khi chạy lại" đo từ lúc container healthy; test chờ tối đa 5 s và ghi thời gian thực tế.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, psql, tokenOf } from './api.js';
import { book201, drainAllTestBookings, releaseSeedDrivers, waitOffer } from './dat-xe.js';
import { advance, newTrip, notes, payNow, waitDriverFree, waitNote } from './chuyen-di.js';
import { compose, waitFor, waitHealthy } from './helpers.js';

let kh1, tx1, ad1;

before(async () => {
  [kh1, tx1, ad1] = await Promise.all([SEED.KH1, SEED.TX1, SEED.AD1].map((p) => tokenOf(p)));
  await drainAllTestBookings();
  releaseSeedDrivers();
});

after(async () => {
  await drainAllTestBookings();
  releaseSeedDrivers();
});

async function healthyAgain(service) {
  const h = await waitHealthy(service, 180_000);
  assert.equal(h, 'running healthy', `${service} không healthy lại: ${h}`);
  await waitFor(() => fetch('http://localhost:3000/health/services').then((r) => r.status), (x) => x === 200, { timeoutMs: 60_000 });
}

async function withStopped(service, fn, afterStart) {
  const s = compose('stop', service);
  assert.equal(s.status, 0, s.stderr);
  let started = false;
  try {
    await fn();
    compose('start', service);
    started = true;
    await healthyAgain(service);
    if (afterStart) await afterStart();
  } finally {
    if (!started) {
      compose('start', service);
      await healthyAgain(service);
    }
  }
}

const payment = async (id) => (await call('GET', `/payments/${id}`, { token: kh1 })).body;

test('AC-CD-08 (mục 17, 503): dừng trip-service → A28 → 503 SERVICE_UNAVAILABLE; A27 → 503', async () => {
  await withStopped('trip-service', async () => {
    const r = await call('PATCH', '/trips/4', { token: tx1, body: { status: 'ARRIVED' } });
    assert.equal(r.status, 503, r.text);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const g = await call('GET', '/trips/4', { token: kh1 });
    assert.equal(g.status, 503);
  });
});

test('AC-CD-19 (mục 18, NFR05): dừng payment-service → A22 booking ONLINE đã trả → 200; A29 chuyến ONLINE → 200; bật lại → ≈ 3 s cả hai REFUNDED', async (tt) => {
  const trip = await newTrip(kh1, tx1, { online: true });
  const b = await book201(kh1, { pay: 'ONLINE' });
  const p = await payNow(kh1, b.payment_id);
  assert.equal(p.body.status, 'COMPLETED');
  await withStopped('payment-service', async () => {
    const a = await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'doi y' } });
    assert.equal(a.status, 200, `A22 khi Payment dừng: ${a.status} ${a.text}`);
    const c = await call('PATCH', `/trips/${trip.trip_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'ban viec' } });
    assert.equal(c.status, 200, `A29 khi Payment dừng: ${c.status} ${c.text}`);
  }, async () => {
    const t0 = Date.now();
    const both = await waitFor(
      async () => [await payment(b.payment_id), await payment(trip.payment_id)],
      (x) => x.every((y) => y?.status === 'REFUNDED'),
      { timeoutMs: 5000, intervalMs: 250 },
    );
    tt.diagnostic(`REFUNDED sau ${Date.now() - t0} ms kể từ khi payment-service healthy: ${both.map((y) => y?.status).join(', ')}`);
    assert.deepEqual(both.map((y) => [y.status, y.status_reason]), [['REFUNDED', 'BOOKING_CANCELED'], ['REFUNDED', 'TRIP_CANCELED']]);
  });
  assert.equal(await waitDriverFree(11, 3000), 'ONLINE:-');
});

test('AC-HT-06 (NFR05): chuyến ACCEPTED mới; dừng driver-service → A28 tới COMPLETED đều 200; bật lại → ≈ 3 s TX1 ONLINE', async (tt) => {
  const trip = await newTrip(kh1, tx1);
  await withStopped('driver-service', async () => {
    const last = await advance(trip.trip_id, tx1, 'ACCEPTED', 'COMPLETED');
    assert.equal(last.body.status, 'COMPLETED');
  }, async () => {
    const t0 = Date.now();
    const s = await waitDriverFree(11, 5000);
    tt.diagnostic(`TX1 rảnh sau ${Date.now() - t0} ms kể từ khi driver-service healthy`);
    assert.equal(s, 'ONLINE:-');
    const d = await call('GET', '/drivers/11', { token: ad1 });
    assert.equal(d.body.status, 'ONLINE');
  });
});

test('AC-TB-05 (NFR05, N1): dừng notification-service → đặt xe 201, nhận 200; A33 → 503; bật lại → ≈ 3 s có BOOKING_CREATED, TRIP_ACCEPTED', async (tt) => {
  await drainAllTestBookings();
  const S = {};
  await withStopped('notification-service', async () => {
    const b = await call('POST', '/bookings', { token: kh1, body: { from: [10.82, 106.68], to: [10.83, 106.69] } });
    assert.equal(b.status, 201, b.text);
    S.b = b.body;
    const o = await waitOffer(tx1, b.body.booking_id, 3000);
    assert.ok(o, 'TX1 có Offer');
    const a = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
    assert.equal(a.status, 200, a.text);
    S.trip = a.body.trip_id;
    const n = await call('GET', '/notifications', { token: kh1 });
    assert.equal(n.status, 503);
    assert.deepEqual(n.body, { error: 'SERVICE_UNAVAILABLE' });
  }, async () => {
    const t0 = Date.now();
    const list = await waitNote(kh1, (x) => x.type === 'TRIP_ACCEPTED' && x.data.trip_id === S.trip, 5000);
    tt.diagnostic(`thông báo có sau ${Date.now() - t0} ms kể từ khi notification-service healthy`);
    assert.ok(list.some((x) => x.type === 'TRIP_ACCEPTED' && x.data.trip_id === S.trip));
    assert.ok(list.some((x) => x.type === 'BOOKING_CREATED' && x.data.booking_id === S.b.booking_id));
  });
  await advance(S.trip, tx1, 'ACCEPTED', 'COMPLETED');
  await waitDriverFree(11, 3000);
});

test('AC-TB-06 (N4): restart notification-service → A33 [KH1] total không đổi (consumer đọc lại không tạo trùng)', async () => {
  await new Promise((r) => setTimeout(r, 2000)); // để thông báo của chuyến vừa hoàn thành ghi xong
  const before = (await notes(kh1)).pagination.total;
  const r = compose('restart', 'notification-service');
  assert.equal(r.status, 0, r.stderr);
  await healthyAgain('notification-service');
  await new Promise((x) => setTimeout(x, 3000));
  assert.equal((await notes(kh1)).pagination.total, before);
});

test('AC-DG-07 (mục 20, 503): chuyến COMPLETED chưa đánh giá; dừng trip-service → A34 → 503, không lưu gì; bật lại → gửi lại → 201', async () => {
  const trip = await newTrip(kh1, tx1);
  await advance(trip.trip_id, tx1, 'ACCEPTED', 'COMPLETED');
  await waitDriverFree(11, 3000);
  const ratingDb = (sql) => psql('rating-db', 'rating', sql);
  const before = ratingDb("select coalesce((select rating_count || '|' || rating_sum from driver_ratings where driver_id = 11), '-')");
  await withStopped('trip-service', async () => {
    const r = await call('POST', '/ratings', { token: kh1, body: { trip_id: trip.trip_id, score: 5 } });
    assert.equal(r.status, 503, r.text);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    assert.equal(ratingDb(`select count(*) from ratings where trip_id = ${trip.trip_id}`), '0');
    assert.equal(ratingDb("select coalesce((select rating_count || '|' || rating_sum from driver_ratings where driver_id = 11), '-')"), before);
  }, async () => {
    const r = await call('POST', '/ratings', { token: kh1, body: { trip_id: trip.trip_id, score: 5 } });
    assert.equal(r.status, 201, `A34 đầu tiên sau khi trip-service chạy lại: ${r.status} ${r.text}`);
    assert.equal(r.body.driver_id, 11);
  });
});

test('AC-DG-13 (mục 20, seed): restart rating-service → số dòng ratings và driver_ratings y hệt trước restart', async () => {
  const snap = () => [
    psql('rating-db', 'rating', 'select count(*) from ratings'),
    psql('rating-db', 'rating', "select string_agg(driver_id || ':' || rating_count || ':' || rating_sum, ',' order by driver_id) from driver_ratings"),
  ];
  const before = snap();
  const r = compose('restart', 'rating-service');
  assert.equal(r.status, 0, r.stderr);
  await healthyAgain('rating-service');
  assert.deepEqual(snap(), before);
});

// Đổi 2026-10-21 (spec 00 AC-HT-15, L2 của báo cáo 2026-10-21): lặp chuỗi restart → gọi ≥ 8 lần. Lần lẻ: `restart`
// năm service; lần chẵn: dừng cả năm rồi bật NGƯỢC thứ tự để Docker cấp lại IP đổi chỗ cho nhau. Sau mỗi lần, MỌI API
// phải 200 ngay lần gọi đầu (cho phép chậm hơn, ≤ 3 s, vì waitForReady chờ kênh nối lại).
test('AC-HT-15 (spec 00, mục 6, ADR-020, H14): 8 lần restart / dừng-bật ngược customer, booking, payment, trip, rating → /health/services 8 healthy; A09, trips/5, bookings/5, payments/5, A36 đều 200 ngay lần gọi đầu, ≤ 3 s', async (tt) => {
  const SVCS = ['customer-service', 'booking-service', 'payment-service', 'trip-service', 'rating-service'];
  const ip = (n) => compose('exec', '-T', n, 'hostname', '-i').stdout.trim();
  const calls = [
    ['A09 customers/1', '/customers/1', (b) => b.customer_id === 1 && b.name === 'Nguyễn Văn An'],
    ['A27 trips/5', '/trips/5', (b) => b.trip_id === 5],
    ['A21 bookings/5', '/bookings/5', (b) => b.booking_id === 5],
    ['payments/5', '/payments/5', (b) => b.payment_id === 5],
    ['A36 ratings?driver_id=11', '/ratings?driver_id=11', (b) => b.driver_id === 11 && b.count >= 1],
  ];
  const failures = [];
  for (let round = 1; round <= 8; round += 1) {
    const before = SVCS.map(ip);
    if (round % 2 === 1) {
      assert.equal(compose('restart', ...SVCS).status, 0);
    } else {
      assert.equal(compose('stop', ...SVCS).status, 0);
      for (const n of [...SVCS].reverse()) assert.equal(compose('start', n).status, 0);
    }
    for (const n of SVCS) assert.equal(await waitHealthy(n, 180_000), 'running healthy', `${n} lần ${round}`);
    const h = await fetch('http://localhost:3000/health/services').then(async (x) => ({ status: x.status, body: await x.json() }));
    const after = SVCS.map(ip);
    const line = [`lần ${round} (${round % 2 ? 'restart' : 'dừng / bật ngược'}; IP ${before.join(' ')} → ${after.join(' ')}): health ${h.status}`];
    if (h.status !== 200 || !Object.values(h.body.services).every((x) => x === 'healthy')) failures.push(`lần ${round} health ${JSON.stringify(h.body)}`);
    for (const [label, url, ok] of calls) {
      const t0 = Date.now();
      const r = await call('GET', url, { token: kh1 });
      const ms = Date.now() - t0;
      line.push(`${label} ${r.status} ${ms} ms`);
      if (r.status !== 200 || !ok(r.body)) failures.push(`lần ${round} ${label}: ${r.status} ${r.text} (${ms} ms)`);
      else if (ms > 3000) failures.push(`lần ${round} ${label}: 200 nhưng ${ms} ms (> 3 s)`);
    }
    tt.diagnostic(line.join(' | '));
  }
  assert.deepEqual(failures, []);
});

// Mới 2026-10-21 (spec 17-18 AC-CD-22): migration 002 trên database "cũ". Giả lập database chạy từ trước migration 002:
// bỏ hai cột, hai ràng buộc và dòng 002 trong schema_migrations (trip-db luôn được đặt lại về seed sau đợt test).
test('AC-CD-22 (migration 002): trip-db chưa có driver_name / driver_plate → khởi động trip-service chạy 002: hai cột text nullable, hai ràng buộc; T3/T4/T5 điền tên, biển số; chuyến cũ chỉ có driver_id ở A27; khởi động lại lần hai không lỗi, không ghi đè', async () => {
  const tdb = (sql) => psql('trip-db', 'trip', sql);
  const old = await newTrip(kh1, tx1);
  try {
    tdb('ALTER TABLE trips DROP CONSTRAINT trips_driver_name_len, DROP CONSTRAINT trips_driver_plate_format, DROP COLUMN driver_name, DROP COLUMN driver_plate; '
      + "DELETE FROM schema_migrations WHERE version = '002_ten-bien-so-tai-xe.sql'");
    const since1 = new Date(Date.now() - 1000).toISOString();
    assert.equal(compose('restart', 'trip-service').status, 0);
    await healthyAgain('trip-service');
    const log1 = compose('logs', '--no-log-prefix', '--since', since1, 'trip-service').stdout;
    assert.match(log1, /002_ten-bien-so-tai-xe\.sql/, 'log khởi động phải ghi đã chạy 002');
    assert.equal(
      tdb("select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from information_schema.columns where table_name = 'trips' and column_name in ('driver_name', 'driver_plate')"),
      'driver_name:text:YES,driver_plate:text:YES',
    );
    assert.equal(
      tdb("select string_agg(conname, ',' order by conname) from pg_constraint where conname in ('trips_driver_name_len', 'trips_driver_plate_format')"),
      'trips_driver_name_len,trips_driver_plate_format',
    );
    const seedRows = () => tdb("select string_agg(trip_id || '|' || driver_name || '|' || driver_plate, ',' order by trip_id) from trips where trip_id in (3, 4, 5)");
    assert.equal(seedRows(), '3|Tài Xế 1|59A-00001,4|Tài Xế 3|59A-00003,5|Tài Xế 6|59A-00006');
    const a = await call('GET', `/trips/${old.trip_id}`, { token: kh1 });
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(a.body.driver, { driver_id: 11 }, 'chuyến tạo trước migration: driver chỉ có driver_id');
    // Lần hai: không chạy lại 002, không lỗi, không ghi đè.
    const since2 = new Date(Date.now() - 1000).toISOString();
    assert.equal(compose('restart', 'trip-service').status, 0);
    await healthyAgain('trip-service');
    const log2 = compose('logs', '--no-log-prefix', '--since', since2, 'trip-service').stdout;
    assert.ok(!/"level":"error"/.test(log2), `log lần hai có lỗi: ${log2.slice(-1500)}`);
    assert.ok(!/đã chạy","file":"002/.test(log2), 'lần hai không được chạy lại 002');
    assert.equal(tdb("select count(*) from schema_migrations where version = '002_ten-bien-so-tai-xe.sql'"), '1');
    assert.equal(seedRows(), '3|Tài Xế 1|59A-00001,4|Tài Xế 3|59A-00003,5|Tài Xế 6|59A-00006');
  } finally {
    await advance(old.trip_id, tx1, 'ACCEPTED', 'COMPLETED').catch(() => {});
    await waitDriverFree(11, 3000);
  }
});
