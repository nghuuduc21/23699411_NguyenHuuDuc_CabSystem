// Spec 14-15-16-19-30 — booking của khách (mục 14), đặt xe → tìm tài xế → Offer (mục 15), tài xế nhận chuyến
// (mục 16), tài xế đặt xe → 403 (mục 28). AC-DX-01…25 trừ phần phải dừng / restart container (AC-DX-04 phần
// restart, AC-DX-12, 17, 18, 21 — ở 91-dung-service-dat-xe.test.js).
//
// Tiền điều kiện: dữ liệu booking / payment / trip vừa đặt lại về seed (KH1 có đúng 7 booking 1…7, chưa có
// booking ≥ 1000); TX1, TX3 ONLINE, rảnh. Test chạy THEO THỨ TỰ trong file (các AC nối tiếp nhau như mục 8
// của spec). Mã do API tạo: chỉ khẳng định đúng 1000 khi dữ liệu vừa đặt lại (isFreshData), còn lại ≥ 1000.
// Sau mỗi AC tạo booking, booking đó được "dọn" bằng cách cho tài xế được mời TỪ CHỐI (drainBooking) để tài xế
// rảnh cho AC sau; hook `after` trả tài xế seed bị giữ cho booking test về ONLINE.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, tokenOf } from './api.js';
import {
  D0, FAR_FROM, FAR_TO, P0, approxFromNow, book, book201, bookingsDb, drainAllTestBookings, drainBooking,
  driversDb, grpcInternal, isFreshData, kafkaNew, kafkaSnapshot, paymentsDb, releaseSeedDrivers, tripsDb, waitBookingStatus,
  waitKafkaNew, waitOffer,
} from './dat-xe.js';
import { sleep, waitFor } from './helpers.js';

let kh1, kh2, kh3, tx1, tx3, tx4, ad1, fresh;
// Dữ liệu nối tiếp giữa các AC.
const S = {};

before(async () => {
  [kh1, kh2, kh3, tx1, tx3, tx4, ad1] = await Promise.all(
    [SEED.KH1, SEED.KH2, SEED.KH3, SEED.TX1, '0910000003', '0910000004', SEED.AD1].map((p) => tokenOf(p)),
  );
  fresh = isFreshData();
  const kh1Seed = bookingsDb('select string_agg(booking_id::text, \',\' order by booking_id) from bookings where customer_id = 1');
  assert.equal(kh1Seed, '1,2,3,4,5,6,7',
    'Tiền điều kiện: KH1 phải có đúng 7 booking seed. Đặt lại booking-db / payment-db / trip-db về seed rồi chạy lại.');
  assert.equal(
    driversDb("select string_agg(driver_id || ':' || availability, ',' order by driver_id) from drivers where driver_id in (11, 13, 14)"),
    '11:ONLINE,13:ONLINE,14:ONLINE', 'Tiền điều kiện: TX1, TX3, TX4 ONLINE (rảnh)');
  assert.equal(bookingsDb("select count(*) from driver_offers where status = 'PENDING'"), '0', 'Tiền điều kiện: không có Offer chờ');
});

after(async () => {
  await drainAllTestBookings();
  // Booking 7 (seed) nếu đang có Offer chờ thì không đụng ở đây — file 12 xử lý. Trả TX1 về ONLINE phòng khi
  // AC-DX-22 dừng giữa chừng.
  await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'ONLINE' } });
  releaseSeedDrivers();
});

// ---------- Mục 14 ----------
test('AC-DX-01 (mục 14): A20 /customers/1/bookings?limit=2 [KH1] → 7, 6; pagination {1, 2, 7, 4}; &page=2 → 5, 4', async () => {
  const r = await call('GET', '/customers/1/bookings?limit=2', { token: kh1 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.map((b) => b.booking_id), [7, 6]);
  assert.deepEqual(r.body.pagination, { page: 1, limit: 2, total: 7, total_pages: 4 });
  const b7 = r.body.data[0];
  assert.equal(b7.status, 'PENDING_PAYMENT');
  assert.equal(b7.vehicle, 'CAR_7');
  assert.equal(b7.pay, 'ONLINE');
  assert.equal(b7.fare, 56000);
  assert.ok(b7.created_at, 'có created_at');
  assert.deepEqual(Object.keys(b7).sort(), ['booking_id', 'created_at', 'fare', 'pay', 'status', 'vehicle']);
  const p2 = await call('GET', '/customers/1/bookings?limit=2&page=2', { token: kh1 });
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.body.data.map((b) => b.booking_id), [5, 4]);
  assert.deepEqual(p2.body.pagination, { page: 2, limit: 2, total: 7, total_pages: 4 });
});

test('AC-DX-02 (mục 14, B14): [KH1] customers/1/bookings?status=canceled → total 2 (6 rồi 1); [KH2] customers/2/bookings → data [], total 0', async () => {
  const r = await call('GET', '/customers/1/bookings?status=canceled', { token: kh1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.pagination.total, 2);
  assert.deepEqual(r.body.data.map((b) => b.booking_id), [6, 1]);
  const k2 = await call('GET', '/customers/2/bookings', { token: kh2 });
  assert.equal(k2.status, 200, k2.text);
  assert.deepEqual(k2.body.data, []);
  assert.equal(k2.body.pagination.total, 0);
});

test('AC-DX-03 (mục 14, 400/401/403): limit=abc, 51, page=0 → INVALID_PAGINATION; status=XYZ, sort=asc → INVALID_INPUT; không token 401; TX1 → 403 FORBIDDEN', async () => {
  for (const q of ['limit=abc', 'limit=51', 'page=0', 'limit=0']) {
    const r = await call('GET', `/customers/1/bookings?${q}`, { token: kh1 });
    assert.equal(r.status, 400, `${q} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: 'INVALID_PAGINATION' }, q);
  }
  for (const q of ['status=XYZ', 'sort=asc', 'customer_id=2']) {
    const r = await call('GET', `/customers/1/bookings?${q}`, { token: kh1 });
    assert.equal(r.status, 400, `${q} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: 'INVALID_INPUT' }, q);
  }
  const n = await call('GET', '/customers/1/bookings');
  assert.equal(n.status, 401);
  assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
  const r = await call('GET', '/customers/1/bookings', { token: tx1 });
  assert.equal(r.status, 403, r.text);
  assert.deepEqual(r.body, { error: 'FORBIDDEN' });
});

test('AC-DX-26 (mục 14, 403): [KH1] customers/2/bookings?limit=2 và customers/999/bookings → 403 NOT_OWNER', async () => {
  for (const p of ['/customers/2/bookings?limit=2', '/customers/999/bookings']) {
    const r = await call('GET', p, { token: kh1 });
    assert.equal(r.status, 403, `${p}: ${r.text}`);
    assert.deepEqual(r.body, { error: 'NOT_OWNER' }, p);
  }
});

test('AC-DX-27 (mục 14): [AD1] customers/1/bookings?limit=2 → 200 như AC-DX-01; customers/999/bookings → 200 data [], total 0', async () => {
  const a = await call('GET', '/customers/1/bookings?limit=2', { token: ad1 });
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.body.data.map((b) => b.booking_id), [7, 6]);
  assert.deepEqual(a.body.pagination, { page: 1, limit: 2, total: 7, total_pages: 4 });
  const b = await call('GET', '/customers/999/bookings', { token: ad1 });
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(b.body.data, []);
  assert.equal(b.body.pagination.total, 0);
});

test('AC-DX-28 (mục 14, 400/404): customers/abc/bookings, customers/me/bookings → 400 INVALID_ID; GET /bookings (đường cũ) → 404 ROUTE_NOT_FOUND', async () => {
  for (const p of ['/customers/abc/bookings', '/customers/me/bookings']) {
    const r = await call('GET', p, { token: kh1 });
    assert.equal(r.status, 400, `${p}: ${r.text}`);
    assert.deepEqual(r.body, { error: 'INVALID_ID' }, p);
  }
  const old = await call('GET', '/bookings?limit=2', { token: kh1 });
  assert.equal(old.status, 404, old.text);
  assert.deepEqual(old.body, { error: 'ROUTE_NOT_FOUND' });
});

test('AC-DX-04 (mục 14, seed): bookings 7, payments 7, trips 3, trip_status_history 11 dòng seed', () => {
  assert.equal(bookingsDb('select count(*) from bookings where booking_id < 1000'), '7');
  assert.equal(paymentsDb('select count(*) from payments where payment_id < 1000'), '7');
  assert.equal(tripsDb('select count(*) from trips where trip_id < 1000'), '3');
  assert.equal(tripsDb('select count(*) from trip_status_history where trip_id < 1000'), '11');
  // Bảng giá trong migration.
  assert.equal(
    paymentsDb("select string_agg(vehicle_type || ':' || base_fare || '/' || per_km_rate || '/' || min_fare, ',' order by vehicle_type) from fare_rates"),
    'CAR_4:20000/12000/30000,CAR_7:25000/15000/40000,MOTORBIKE:10000/5000/15000',
  );
});

test('AC-DX-25 (mục 12/21 — A21): bookings/7, 3 [KH1]; 7 [AD1] 200; 7 [KH2] 403 NOT_OWNER; 999 → 404; abc → 400; [TX1] → 403', async () => {
  const b7 = await call('GET', '/bookings/7', { token: kh1 });
  assert.equal(b7.status, 200, b7.text);
  assert.equal(b7.body.status, 'PENDING_PAYMENT');
  assert.equal(b7.body.vehicle, 'CAR_7');
  assert.equal(b7.body.pay, 'ONLINE');
  assert.equal(b7.body.fare, 56000);
  assert.equal(b7.body.payment_id, 7);
  assert.deepEqual(b7.body.from, P0);
  assert.deepEqual(b7.body.to, D0);
  const b3 = await call('GET', '/bookings/3', { token: kh1 });
  assert.equal(b3.status, 200);
  assert.equal(b3.body.status, 'DRIVER_ASSIGNED');
  assert.equal(b3.body.driver_id, 11);
  assert.equal(b3.body.trip_id, 3);
  const b1 = await call('GET', '/bookings/1', { token: kh1 });
  assert.equal(b1.body.canceled_by, 'customer');
  assert.ok(b1.body.cancel_reason);
  const a = await call('GET', '/bookings/7', { token: ad1 });
  assert.equal(a.status, 200);
  assert.equal(a.body.booking_id, 7);
  const k2 = await call('GET', '/bookings/7', { token: kh2 });
  assert.equal(k2.status, 403);
  assert.deepEqual(k2.body, { error: 'NOT_OWNER' });
  const nf = await call('GET', '/bookings/999', { token: kh1 });
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: 'BOOKING_NOT_FOUND' });
  for (const id of ['abc', '0', '7%20OR%201=1']) {
    const x = await call('GET', `/bookings/${id}`, { token: kh1 });
    assert.equal(x.status, 400, id);
    assert.deepEqual(x.body, { error: 'INVALID_ID' });
  }
  const t = await call('GET', '/bookings/7', { token: tx1 });
  assert.equal(t.status, 403);
  assert.deepEqual(t.body, { error: 'FORBIDDEN' });
});

// ---------- Mục 15 ----------
test('AC-DX-05 (mục 15, AC01): A19 tuyến mẫu [KH1] → 201 SEARCHING, CAR_4, CASH, distance_m ≈ 2026, fare 45000; Kafka booking.created key = booking_id, không tọa độ', async (tt) => {
  const snap = await kafkaSnapshot('booking.created');
  // Ảnh chụp K2 trước khi đặt: bộ ghép phát K2 ngay sau 201 (dùng ở AC-DX-06).
  S.snapK2 = await kafkaSnapshot('booking.offer-created');
  const r = await book(kh1);
  assert.equal(r.status, 201, r.text);
  const b = r.body;
  tt.diagnostic(`response: ${JSON.stringify(b)}`);
  assert.deepEqual(Object.keys(b).sort(), ['booking_id', 'distance_m', 'fare', 'pay', 'payment_id', 'status', 'vehicle']);
  assert.equal(b.status, 'SEARCHING');
  assert.equal(b.vehicle, 'CAR_4');
  assert.equal(b.pay, 'CASH');
  assert.ok(Math.abs(b.distance_m - 2026) <= 3, `distance_m ${b.distance_m}`);
  assert.equal(b.fare, 45000);
  if (fresh) {
    assert.equal(b.booking_id, 1000);
    assert.equal(b.payment_id, 1000);
  } else {
    assert.ok(b.booking_id >= 1000 && b.payment_id >= 1000);
  }
  S.A = b;
  const msgs = await waitKafkaNew('booking.created', snap, (m) => m.key === String(b.booking_id));
  assert.equal(msgs.length, 1, 'đúng một message booking.created cho booking này');
  const m = msgs[0];
  assert.equal(m.content.event_type, 'booking.created');
  assert.deepEqual(m.content.data, {
    booking_id: b.booking_id, customer_id: 1, vehicle_type: 'CAR_4', payment_method: 'CASH', status: 'SEARCHING',
  });
  assert.doesNotMatch(m.raw, /10\.8|106\.6|lat|lng|address/i, 'message không chứa tọa độ, địa chỉ');
});

test('AC-DX-06 (mục 15, AC03, AC05): ≈ 1 s sau A23 [TX1] → một Offer PENDING, distance_m 111, expires_at ≈ +300 s, CASH, 45000; Kafka offer-created driver_id 11', async (tt) => {
  const o = await waitOffer(tx1, S.A.booking_id);
  assert.ok(o, 'TX1 phải có Offer trong 2 giây');
  const list = await call('GET', '/offers', { token: tx1 });
  tt.diagnostic(`A23 TX1: ${list.text}`);
  assert.equal(list.body.data.length, 1);
  assert.deepEqual(list.body.pagination, { page: 1, limit: 10, total: 1, total_pages: 1 });
  assert.equal(o.status, 'PENDING');
  assert.equal(o.distance_m, 111);
  assert.equal(o.pay, 'CASH');
  assert.equal(o.fare, 45000);
  assert.deepEqual(o.from, P0);
  assert.deepEqual(o.to, D0);
  assert.ok(approxFromNow(o.expires_at, 300), `expires_at ${o.expires_at}`);
  assert.deepEqual(Object.keys(o).sort(), ['booking_id', 'distance_m', 'expires_at', 'fare', 'from', 'offer_id', 'pay', 'status', 'to']);
  if (fresh) assert.equal(o.offer_id, 1000);
  S.offerA = o.offer_id;
  // Chỉ xét message MỚI so với ảnh chụp trước khi đặt xe (Kafka còn message của lần chạy trước, cùng mã 1000).
  const k2 = await waitKafkaNew('booking.offer-created', S.snapK2, (m) => m.key === String(S.A.booking_id));
  assert.equal(k2.length, 1, `message booking.offer-created cho offer ${o.offer_id}`);
  assert.equal(k2[0].content.data.driver_id, 11);
  // TX2 xe máy, TX5 Offline, TX6 bận, TX8 xa: không ai khác có Offer cho booking này.
  assert.equal(bookingsDb(`select string_agg(driver_id::text, ',') from driver_offers where booking_id = ${S.A.booking_id}`), '11');
});

test('AC-DX-07 (mục 15, AC26): A30 payment của booking [KH1] → CASH PENDING 45000, fare {2026, 20000, 12000, 30000}, không expires_at; motorbike → 21000; CAR_7 → 56000', async () => {
  const p = await call('GET', `/payments/${S.A.payment_id}`, { token: kh1 });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.payment_id, S.A.payment_id);
  assert.equal(p.body.booking_id, S.A.booking_id);
  assert.equal(p.body.method, 'CASH');
  assert.equal(p.body.status, 'PENDING');
  assert.equal(p.body.amount, 45000);
  assert.deepEqual(p.body.fare, { distance_m: S.A.distance_m, base_fare: 20000, per_km_rate: 12000, min_fare: 30000 });
  assert.equal(p.body.expires_at, undefined);
  assert.equal(p.body.customer_id, undefined);
  const mb = await book(kh1, { vehicle: 'motorbike' });
  assert.equal(mb.status, 201, mb.text);
  assert.equal(mb.body.vehicle, 'MOTORBIKE');
  assert.equal(mb.body.fare, 21000);
  const c7 = await book(kh1, { vehicle: 'CAR_7' });
  assert.equal(c7.status, 201, c7.text);
  assert.equal(c7.body.vehicle, 'CAR_7');
  assert.equal(c7.body.fare, 56000);
  // Dọn: TX2 / TX4 đang được mời cho hai booking này.
  await sleep(500);
  assert.equal(await drainBooking(mb.body.booking_id), 'NO_DRIVER_FOUND');
  assert.equal(await drainBooking(c7.body.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-DX-08 (mục 15, AC21, BRULE13): [KH2] pay online, CAR_7 → 201 PENDING_PAYMENT, payment_expires_at ≈ +600 s; ≈ 2 s sau TX4 không có Offer cho booking đó', async () => {
  const r = await book(kh2, { pay: 'online', vehicle: 'CAR_7' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.status, 'PENDING_PAYMENT');
  assert.equal(r.body.pay, 'ONLINE');
  assert.equal(r.body.fare, 56000);
  assert.ok(approxFromNow(r.body.payment_expires_at, 600), `payment_expires_at ${r.body.payment_expires_at}`);
  await sleep(2000);
  const o = await call('GET', '/offers', { token: tx4 });
  assert.equal(o.status, 200);
  assert.ok(!o.body.data.some((x) => x.booking_id === r.body.booking_id), 'chưa trả tiền thì không tìm tài xế');
  assert.equal(bookingsDb(`select count(*) from driver_offers where booking_id = ${r.body.booking_id}`), '0');
  const g = await call('GET', `/bookings/${r.body.booking_id}`, { token: kh2 });
  assert.equal(g.body.status, 'PENDING_PAYMENT');
});

test('AC-DX-09 (mục 15, 400, AC02): thiếu to; from 1 phần tử; from chuỗi; lat 91; to = from; BUS; CARD; customer_id; from_address <b> → đúng mã; bookings, payments không tăng', async () => {
  const before = [bookingsDb('select count(*) from bookings'), paymentsDb('select count(*) from payments')];
  const cases = [
    [{ from: P0 }, 'INVALID_INPUT'],
    [{ from: [10.82], to: D0 }, 'INVALID_INPUT'],
    [{ from: [10.82, 106.68, 1], to: D0 }, 'INVALID_INPUT'],
    [{ from: '10.82,106.68', to: D0 }, 'INVALID_INPUT'],
    [{ from: ['10.82', '106.68'], to: D0 }, 'INVALID_INPUT'],
    [{ from: [91, 106.68], to: D0 }, 'INVALID_COORDINATES'],
    [{ from: [10.82, 181], to: D0 }, 'INVALID_COORDINATES'],
    [{ from: P0, to: P0 }, 'SAME_PICKUP_AND_DESTINATION'],
    [{ from: P0, to: D0, vehicle: 'BUS' }, 'INVALID_INPUT'],
    [{ from: P0, to: D0, pay: 'CARD' }, 'INVALID_INPUT'],
    [{ from: P0, to: D0, customer_id: 2 }, 'INVALID_INPUT'],
    [{ from: P0, to: D0, fare: 1000 }, 'INVALID_INPUT'],
    [{ from: P0, to: D0, from_address: '<b>x</b>' }, 'TEXT_CONTAINS_HTML'],
    ['{hong', 'INVALID_JSON'],
  ];
  for (const [body, code] of cases) {
    const r = await call('POST', '/bookings', { token: kh1, body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, JSON.stringify(body));
  }
  assert.deepEqual([bookingsDb('select count(*) from bookings'), paymentsDb('select count(*) from payments')], before);
});

test('AC-DX-10 (mục 15, 28): A19 không token → 401 TOKEN_MISSING; [TX1] không body → 403 FORBIDDEN (role trước body); [AD1] → 403', async () => {
  const n = await call('POST', '/bookings', { body: { from: P0, to: D0 } });
  assert.equal(n.status, 401);
  assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
  const t = await call('POST', '/bookings', { token: tx1 });
  assert.equal(t.status, 403, t.text);
  assert.deepEqual(t.body, { error: 'FORBIDDEN' });
  const t2 = await call('POST', '/bookings', { token: tx1, body: { from: P0, to: D0 } });
  assert.equal(t2.status, 403);
  const a = await call('POST', '/bookings', { token: ad1, body: { from: P0, to: D0 } });
  assert.equal(a.status, 403);
  assert.deepEqual(a.body, { error: 'FORBIDDEN' });
});

test('AC-DX-11 (mục 15, Q56): KH3 (chưa có hồ sơ khách) đặt tuyến mẫu → 201 SEARCHING', async () => {
  const r = await book(kh3);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.status, 'SEARCHING');
  // Dọn: TX1 đang có Offer của AC-DX-05 → booking này mời TX3; TX3 từ chối → không còn ai → NO_DRIVER_FOUND.
  await sleep(500);
  assert.equal(await drainBooking(r.body.booking_id), 'NO_DRIVER_FOUND');
});

// ---------- Mục 16 ----------
test('AC-DX-19 (mục 16, AC06): A24 PATCH /offers/{id} ACCEPTED [TX1] → 200 DRIVER_ASSIGNED + trip_id; A21 có driver_id 11; TX1 BUSY; trips ACCEPTED 45000 CASH; history 1 dòng; Kafka trip.status-changed', async (tt) => {
  const snapK5 = await kafkaSnapshot('trip.status-changed');
  const r = await call('PATCH', `/offers/${S.offerA}`, { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(r.status, 200, r.text);
  tt.diagnostic(`response: ${r.text}`);
  assert.ok(r.body.trip_id >= 1000);
  if (fresh) assert.equal(r.body.trip_id, 1000);
  assert.deepEqual(r.body, {
    offer_id: S.offerA, status: 'ACCEPTED', booking_id: S.A.booking_id, booking_status: 'DRIVER_ASSIGNED',
    trip_id: r.body.trip_id, trip_status: 'ACCEPTED',
  });
  S.tripA = r.body.trip_id;
  const g = await call('GET', `/bookings/${S.A.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'DRIVER_ASSIGNED');
  assert.equal(g.body.driver_id, 11);
  assert.equal(g.body.trip_id, S.tripA);
  const d = await call('GET', '/drivers/11', { token: ad1 });
  assert.equal(d.body.status, 'BUSY');
  assert.equal(driversDb('select current_booking_id from drivers where driver_id = 11'), String(S.A.booking_id));
  assert.equal(
    tripsDb(`select status || '|' || fare_amount || '|' || payment_method || '|' || driver_id || '|' || customer_id from trips where trip_id = ${S.tripA}`),
    'ACCEPTED|45000|CASH|11|1',
  );
  assert.equal(tripsDb(`select count(*) || '|' || max(to_status) || '|' || max(changed_by_role) from trip_status_history where trip_id = ${S.tripA}`), '1|ACCEPTED|driver');
  assert.equal(bookingsDb(`select count(*) from driver_assignments where booking_id = ${S.A.booking_id} and trip_id = ${S.tripA}`), '1');
  const k5 = await waitKafkaNew('trip.status-changed', snapK5, (m) => m.key === String(S.tripA));
  await sleep(1000);
  assert.equal((await kafkaNew('trip.status-changed', snapK5)).length, 1, 'chỉ một message K5 mới');
  assert.equal(k5.length, 1, 'đúng một message K5');
  assert.equal(k5[0].content.data.status, 'ACCEPTED');
  assert.equal(k5[0].content.data.previous_status, null);
  assert.equal(k5[0].content.data.driver_id, 11);
});

test('AC-DX-20 (mục 16, 409/403/404/400): A24 lại → 409; bằng TX3 → 403 NOT_OWNER; offers/999 → 404; abc → 400 INVALID_ID; PENDING, body rỗng → 400; [KH1] → 403', async () => {
  const again = await call('PATCH', `/offers/${S.offerA}`, { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(again.status, 409, again.text);
  assert.deepEqual(again.body, { error: 'INVALID_STATUS_TRANSITION' });
  const rej = await call('PATCH', `/offers/${S.offerA}`, { token: tx1, body: { status: 'REJECTED' } });
  assert.equal(rej.status, 409);
  assert.deepEqual(rej.body, { error: 'INVALID_STATUS_TRANSITION' });
  const other = await call('PATCH', `/offers/${S.offerA}`, { token: tx3, body: { status: 'ACCEPTED' } });
  assert.equal(other.status, 403, other.text);
  assert.deepEqual(other.body, { error: 'NOT_OWNER' });
  const nf = await call('PATCH', '/offers/999', { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: 'OFFER_NOT_FOUND' });
  const bad = await call('PATCH', '/offers/abc', { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'INVALID_ID' });
  for (const body of [{ status: 'PENDING' }, { status: 'EXPIRED' }, {}, { status: 'ACCEPTED', x: 1 }]) {
    const x = await call('PATCH', `/offers/${S.offerA}`, { token: tx1, body });
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.deepEqual(x.body, { error: 'INVALID_INPUT' }, JSON.stringify(body));
  }
  const empty = await call('PATCH', `/offers/${S.offerA}`, { token: tx1 });
  assert.equal(empty.status, 400, empty.text);
  assert.deepEqual(empty.body, { error: 'INVALID_INPUT' });
  const nj = await call('PATCH', `/offers/${S.offerA}`, { token: tx1, body: '{hong' });
  assert.equal(nj.status, 400);
  assert.deepEqual(nj.body, { error: 'INVALID_JSON' });
  const k = await call('PATCH', `/offers/${S.offerA}`, { token: kh1, body: { status: 'ACCEPTED' } });
  assert.equal(k.status, 403);
  assert.deepEqual(k.body, { error: 'FORBIDDEN' });
  const n = await call('PATCH', `/offers/${S.offerA}`, { body: { status: 'ACCEPTED' } });
  assert.equal(n.status, 401);
  // A23 lỗi: role khách / admin, status lạ, phân trang sai.
  for (const tok of [kh1, ad1]) {
    const x = await call('GET', '/offers', { token: tok });
    assert.equal(x.status, 403);
  }
  const s1 = await call('GET', '/offers?status=XYZ', { token: tx1 });
  assert.deepEqual([s1.status, s1.body], [400, { error: 'INVALID_INPUT' }]);
  const s2 = await call('GET', '/offers?limit=51', { token: tx1 });
  assert.deepEqual([s2.status, s2.body], [400, { error: 'INVALID_PAGINATION' }]);
  const s3 = await call('GET', '/offers?status=accepted', { token: tx1 });
  assert.equal(s3.status, 200);
  assert.ok(s3.body.data.some((o) => o.offer_id === S.offerA && o.status === 'ACCEPTED'));
});

// ---------- gRPC nội bộ ----------
const driverRpc = (method, request, metadata = { 'x-role': 'system' }) => grpcInternal({
  target: 'driver-service:50053', proto: 'driver.proto', pkg: 'cab.driver.v1', service: 'DriverService', method, request, metadata,
});
const tripRpc = (request, metadata = { 'x-role': 'system' }) => grpcInternal({
  target: 'trip-service:50055', proto: 'trip.proto', pkg: 'cab.trip.v1', service: 'TripService', method: 'CreateTrip', request, metadata,
});

test('AC-DX-23 (mục 16, D8, gRPC nội bộ): ReserveDriver(11, B) ×2 → BUSY kèm driver_name "Tài Xế 1", plate "59A-00001"; (11, B2) → DRIVER_NOT_AVAILABLE; Release(11, B2) false; Release(11, B) true → ONLINE; thiếu x-role / customer', () => {
  // TX1 đang BUSY cho booking của AC-DX-19 (chưa có spec 17 để hoàn thành chuyến) → nhả trước bằng chính rpc.
  const pre = driverRpc('ReleaseDriver', { driver_id: 11, booking_id: S.A.booking_id });
  assert.deepEqual(pre, { response: { driver_id: 11, released: true } });
  assert.equal(driversDb('select availability from drivers where driver_id = 11'), 'ONLINE');
  const B = 900000 + Math.floor(Math.random() * 1000);
  const B2 = B + 1;
  // Đổi 2026-10-21 (DX25): cả hai lần trả thêm driver_name, plate (booking chép sang CreateTrip).
  const busy = { driver_id: 11, booking_id: B, status: 'BUSY', driver_name: 'Tài Xế 1', plate: '59A-00001' };
  const r1 = driverRpc('ReserveDriver', { driver_id: 11, booking_id: B });
  assert.deepEqual(r1, { response: busy });
  const r2 = driverRpc('ReserveDriver', { driver_id: 11, booking_id: B });
  assert.deepEqual(r2, { response: busy });
  const r3 = driverRpc('ReserveDriver', { driver_id: 11, booking_id: B2 });
  assert.equal(r3.error?.status, 'FAILED_PRECONDITION', JSON.stringify(r3));
  assert.equal(r3.error.details, 'DRIVER_NOT_AVAILABLE');
  assert.deepEqual(driverRpc('ReleaseDriver', { driver_id: 11, booking_id: B2 }), { response: { driver_id: 11, released: false } });
  assert.equal(driversDb('select availability || \'|\' || current_booking_id from drivers where driver_id = 11'), `BUSY|${B}`);
  assert.deepEqual(driverRpc('ReleaseDriver', { driver_id: 11, booking_id: B }), { response: { driver_id: 11, released: true } });
  assert.equal(driversDb("select availability || '|' || coalesce(current_booking_id::text, '-') from drivers where driver_id = 11"), 'ONLINE|-');
  const nf = driverRpc('ReserveDriver', { driver_id: 999, booking_id: B });
  assert.equal(nf.error?.details, 'DRIVER_NOT_FOUND', JSON.stringify(nf));
  const off = driverRpc('ReserveDriver', { driver_id: 15, booking_id: B });
  assert.equal(off.error?.details, 'DRIVER_NOT_AVAILABLE', 'TX5 OFFLINE');
  const noRole = driverRpc('ReserveDriver', { driver_id: 11, booking_id: B }, {});
  assert.deepEqual(noRole.error && [noRole.error.status, noRole.error.details], ['UNAUTHENTICATED', 'IDENTITY_MISSING']);
  const cust = driverRpc('ReserveDriver', { driver_id: 11, booking_id: B }, { 'x-role': 'customer', 'x-account-id': '1' });
  assert.deepEqual(cust.error && [cust.error.status, cust.error.details], ['PERMISSION_DENIED', 'FORBIDDEN']);
  const relCust = driverRpc('ReleaseDriver', { driver_id: 11, booking_id: B }, { 'x-role': 'driver', 'x-account-id': '11' });
  assert.equal(relCust.error?.details, 'FORBIDDEN');
  assert.equal(driversDb('select availability from drivers where driver_id = 11'), 'ONLINE');
});

test('AC-DX-24 (mục 16, T1, gRPC nội bộ): CreateTrip hai lần cùng booking, cùng tài xế → cùng trip_id, created true rồi false, Kafka một message; tài xế khác → BOOKING_ALREADY_ASSIGNED; không x-role → IDENTITY_MISSING, x-role sai → FORBIDDEN (DX22); thiếu / rỗng driver_name, driver_plate → INVALID_INPUT; trips lưu đúng tên, biển số (DX25)', async () => {
  const B = 800000 + Math.floor(Math.random() * 1000);
  const req = {
    booking_id: B, customer_id: 1, driver_id: 11, vehicle_type: 'CAR_4', pickup_lat: P0[0], pickup_lng: P0[1],
    destination_lat: D0[0], destination_lng: D0[1], payment_method: 'CASH', fare_amount: 45000,
    driver_name: 'Tài Xế 1', driver_plate: '59A-00001',
  };
  const snapK5 = await kafkaSnapshot('trip.status-changed');
  try {
    const a = tripRpc(req);
    assert.ok(a.response, JSON.stringify(a));
    assert.equal(a.response.status, 'ACCEPTED');
    assert.equal(a.response.created, true);
    const b = tripRpc(req);
    assert.deepEqual(b.response, { trip_id: a.response.trip_id, status: 'ACCEPTED', created: false });
    const c = tripRpc({ ...req, driver_id: 13 });
    assert.deepEqual(c.error && [c.error.status, c.error.details], ['FAILED_PRECONDITION', 'BOOKING_ALREADY_ASSIGNED']);
    const e = tripRpc(req, { 'x-role': 'driver', 'x-account-id': '11' });
    assert.deepEqual(e.error && [e.error.status, e.error.details], ['PERMISSION_DENIED', 'FORBIDDEN']);
    assert.equal(tripsDb(`select count(*) from trips where booking_id = ${B}`), '1');
    assert.equal(tripsDb(`select count(*) from trip_status_history where trip_id = ${a.response.trip_id}`), '1');
    await sleep(2000);
    const k5 = (await kafkaNew('trip.status-changed', snapK5)).filter((m) => m.content?.data?.booking_id === B);
    assert.equal(k5.length, 1, `Kafka chỉ một message ACCEPTED cho booking ${B}, có ${k5.length}`);
    // DX22 (chốt 2026-10-05): thiếu x-role → UNAUTHENTICATED / IDENTITY_MISSING; x-role sai (customer) → FORBIDDEN.
    const d = tripRpc(req, {});
    assert.deepEqual(d.error && [d.error.status, d.error.details], ['UNAUTHENTICATED', 'IDENTITY_MISSING']);
    const f = tripRpc(req, { 'x-role': 'customer', 'x-account-id': '1' });
    assert.deepEqual(f.error && [f.error.status, f.error.details], ['PERMISSION_DENIED', 'FORBIDDEN']);
    // Thêm 2026-10-21 (DX25): dòng trips lưu đúng họ tên, biển số đã gửi.
    assert.equal(tripsDb(`select driver_name || '|' || driver_plate from trips where booking_id = ${B}`), 'Tài Xế 1|59A-00001');
    // Thiếu / rỗng driver_name, driver_plate (booking mới) → INVALID_ARGUMENT INVALID_INPUT, không tạo Trip.
    const B3 = B + 500;
    const { driver_name: _n, driver_plate: _p, ...noSnap } = req;
    const bad = [
      { ...noSnap, booking_id: B3 },
      { ...req, booking_id: B3, driver_name: '' },
      { ...req, booking_id: B3, driver_plate: '' },
      { ...req, booking_id: B3, driver_name: '   ' },
      { ...noSnap, booking_id: B3, driver_name: 'Tài Xế 1' },
    ];
    bad.forEach((x, i) => {
      const g = tripRpc(x);
      assert.deepEqual(g.error && [g.error.status, g.error.details], ['INVALID_ARGUMENT', 'INVALID_INPUT'], `#${i} ${JSON.stringify(g)}`);
    });
    assert.equal(tripsDb(`select count(*) from trips where booking_id = ${B3}`), '0');
  } finally {
    tripsDb(`delete from trip_status_history where trip_id in (select trip_id from trips where booking_id in (${B}, ${B + 500})); delete from trips where booking_id in (${B}, ${B + 500})`);
  }
});

// ---------- Mục 15: từ chối, B10, không có tài xế, hết hạn ----------
test('AC-DX-13 (mục 15, AC07, AC23, BRULE15): TX1 từ chối → 200 REJECTED; ≈ 1 s sau TX3 có Offer cùng booking (334 m); TX1 data []; Payment vẫn PENDING; không có K3 mới', async () => {
  const snapK3 = await kafkaSnapshot('booking.no-driver-found');
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o, 'TX1 có Offer');
  const r = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'REJECTED' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { offer_id: o.offer_id, status: 'REJECTED' });
  const o3 = await waitOffer(tx3, b.booking_id);
  assert.ok(o3, 'TX3 phải có Offer trong 2 giây');
  assert.equal(o3.distance_m, 334);
  const l1 = await call('GET', '/offers', { token: tx1 });
  assert.deepEqual(l1.body.data, []);
  const rejected = await call('GET', '/offers?status=REJECTED', { token: tx1 });
  assert.ok(rejected.body.data.some((x) => x.offer_id === o.offer_id));
  const p = await call('GET', `/payments/${b.payment_id}`, { token: kh1 });
  assert.equal(p.body.status, 'PENDING');
  const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'SEARCHING');
  await sleep(1000);
  const k3 = (await kafkaNew('booking.no-driver-found', snapK3)).filter((m) => m.key === String(b.booking_id));
  assert.equal(k3.length, 0, 'từ chối không phát K3');
  // Từ chối lại Offer đã từ chối → 409.
  const again = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'REJECTED' } });
  assert.equal(again.status, 409);
  assert.equal(await drainBooking(b.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-DX-14 (mục 15, B10): TX1, TX3 rảnh; A19 [KH1] rồi A19 [KH2] → booking 1 mời TX1, booking 2 mời TX3', async () => {
  const b1 = await book201(kh1);
  const o1 = await waitOffer(tx1, b1.booking_id);
  assert.ok(o1, 'booking 1 mời TX1');
  const b2 = await book201(kh2);
  const o2 = await waitOffer(tx3, b2.booking_id);
  assert.ok(o2, 'booking 2 mời TX3 (TX1 đang có Offer chờ)');
  assert.equal(bookingsDb(`select string_agg(driver_id::text, ',') from driver_offers where booking_id = ${b2.booking_id}`), '13');
  assert.equal(bookingsDb("select count(*) from driver_offers where driver_id = 11 and status = 'PENDING'"), '1');
  await drainBooking(b1.booking_id);
  await drainBooking(b2.booking_id);
  await drainAllTestBookings();
});

test('AC-DX-15 (mục 15, AC09): A19 tại (10.90, 106.68) → 201 SEARCHING; ≈ 1 s sau A21 NO_DRIVER_FOUND; Kafka booking.no-driver-found offers_tried 0', async () => {
  const snap = await kafkaSnapshot('booking.no-driver-found');
  const r = await call('POST', '/bookings', { token: kh1, body: { from: FAR_FROM, to: FAR_TO } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.status, 'SEARCHING');
  const s = await waitBookingStatus(r.body.booking_id, 'NO_DRIVER_FOUND');
  assert.equal(s, 'NO_DRIVER_FOUND');
  const g = await call('GET', `/bookings/${r.body.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'NO_DRIVER_FOUND');
  const k3 = await waitKafkaNew('booking.no-driver-found', snap, (m) => m.key === String(r.body.booking_id));
  assert.equal(k3.length, 1);
  assert.deepEqual(k3[0].content.data, { booking_id: r.body.booking_id, customer_id: 1, offers_tried: 0 });
});

test('AC-DX-16 (mục 15, AC08, BRULE06): Offer TX1 hết hạn (UPDATE expires_at = now()) → EXPIRED; TX3 có Offer mới; A24 Offer cũ → 409 INVALID_STATUS_TRANSITION', async (tt) => {
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o);
  bookingsDb(`update driver_offers set expires_at = now() where offer_id = ${o.offer_id}`);
  // Gọi ngay, trước khi tiến trình nền (mỗi 1 s) kịp chạy: mong đợi 409 OFFER_EXPIRED; nếu tiến trình đã chạy
  // trước thì 409 INVALID_STATUS_TRANSITION. Không tất định — ghi lại mã nhận được.
  const early = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
  tt.diagnostic(`A24 ngay sau khi hết hạn: ${early.status} ${early.text}`);
  assert.equal(early.status, 409, early.text);
  assert.ok(['OFFER_EXPIRED', 'INVALID_STATUS_TRANSITION'].includes(early.body.error), early.text);
  const exp = await waitFor(
    () => call('GET', '/offers?status=EXPIRED', { token: tx1 }),
    (x) => x?.body?.data?.some((y) => y.offer_id === o.offer_id), { timeoutMs: 3000, intervalMs: 300 },
  );
  assert.ok(exp.body.data.some((y) => y.offer_id === o.offer_id && y.status === 'EXPIRED'), 'Offer TX1 EXPIRED');
  const o3 = await waitOffer(tx3, b.booking_id, 3000);
  assert.ok(o3, 'TX3 có Offer mới');
  const late = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(late.status, 409);
  assert.deepEqual(late.body, { error: 'INVALID_STATUS_TRANSITION' });
  assert.equal(driversDb('select availability from drivers where driver_id = 11'), 'ONLINE');
  assert.equal(await drainBooking(b.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-DX-22 (mục 16, D8, DX-Q6): Offer PENDING của TX1; TX1 OFFLINE → 200; A24 → 409 DRIVER_NOT_AVAILABLE; Offer vẫn PENDING; bật lại ONLINE', async () => {
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o);
  try {
    const off = await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'OFFLINE' } });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.body.status, 'OFFLINE');
    const r = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.body, { error: 'DRIVER_NOT_AVAILABLE' });
    assert.equal(bookingsDb(`select status from driver_offers where offer_id = ${o.offer_id}`), 'PENDING');
    assert.equal(bookingsDb(`select status from bookings where booking_id = ${b.booking_id}`), 'SEARCHING');
    assert.equal(tripsDb(`select count(*) from trips where booking_id = ${b.booking_id}`), '0');
  } finally {
    const on = await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'ONLINE' } });
    assert.equal(on.status, 200, on.text);
  }
  // Bật lại rồi nhận được (Offer còn hạn).
  const ok = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.booking_status, 'DRIVER_ASSIGNED');
  releaseSeedDrivers();
});
