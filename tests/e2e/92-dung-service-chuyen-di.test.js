// Spec 17-18, 20-29 và 00 (ADR-020) — các AC phải DỪNG hoặc RESTART container:
//   AC-CD-08 (trip dừng → 503), AC-CD-19 (payment dừng, hủy vẫn 200, hoàn khi chạy lại), AC-HT-06 (driver dừng,
//   chuyến vẫn hoàn thành, tài xế rảnh khi chạy lại), AC-TB-05, AC-TB-06 (notification dừng / restart),
//   AC-DG-07 (trip dừng → đánh giá 503, không lưu), AC-DG-13 (restart rating không nhân đôi seed),
//   AC-HT-15 (spec 00: restart / dừng-bật đổi IP → kênh gRPC không nối nhầm service).
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

test('AC-HT-15 (spec 00, mục 6, ADR-020): restart customer + rating; rồi dừng cả hai và bật NGƯỢC thứ tự (đổi IP) → /health/services 8 SERVING; A09, A36 trả đúng dữ liệu ngay lần gọi đầu', async () => {
  const check = async (label) => {
    const h = await fetch('http://localhost:3000/health/services').then((x) => x.json());
    assert.equal(h.status, 'UP', `${label}: ${JSON.stringify(h)}`);
    assert.ok(Object.values(h.services).every((s) => s === 'SERVING'), `${label}: ${JSON.stringify(h.services)}`);
    const c = await call('GET', '/customers/1', { token: kh1 });
    assert.equal(c.status, 200, `${label} A09: ${c.status} ${c.text}`);
    assert.equal(c.body.customer_id, 1);
    assert.equal(c.body.name, 'Nguyễn Văn An');
    const r = await call('GET', '/ratings?driver_id=11', { token: kh1 });
    assert.equal(r.status, 200, `${label} A36: ${r.status} ${r.text}`);
    assert.equal(r.body.driver_id, 11);
    assert.ok(r.body.count >= 1);
  };
  const ip = (n) => compose('exec', '-T', n, 'hostname', '-i').stdout.trim();
  const before = [ip('customer-service'), ip('rating-service')];
  assert.equal(compose('restart', 'customer-service', 'rating-service').status, 0);
  await healthyAgain('customer-service');
  await healthyAgain('rating-service');
  await check('sau restart');
  assert.equal(compose('stop', 'customer-service', 'rating-service').status, 0);
  assert.equal(compose('start', 'rating-service').status, 0);
  assert.equal(compose('start', 'customer-service').status, 0);
  await healthyAgain('rating-service');
  await healthyAgain('customer-service');
  const after = [ip('customer-service'), ip('rating-service')];
  await check(`sau dừng / bật ngược (IP ${before.join(' ')} → ${after.join(' ')})`);
});
