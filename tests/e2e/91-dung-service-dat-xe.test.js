// Spec 14-15-16-19-30 — các AC phải DỪNG hoặc RESTART container: AC-DX-04 (phần restart), AC-DX-12, AC-DX-17,
// AC-DX-18, AC-DX-21, AC-TT-13. Không nằm trong `test:nghiep-vu`; chạy bằng `npm run test:dung-service` khi không
// ai khác đang dùng hệ thống. Mỗi test bật lại container ở `finally`, chờ healthy và chờ /health/services về 200.
// Booking-service sau khi chạy lại cần một khoảng (đo được 6–26 s) mới nhận lại message Kafka K6 — test chờ CÓ
// GIỚI HẠN và ghi thời gian thực tế.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, tokenOf } from './api.js';
import {
  book, book201, bookingsDb, drainAllTestBookings, drainBooking, driversDb, kafkaSnapshot, paymentsDb, releaseSeedDrivers,
  tripsDb, waitBookingStatus, waitKafkaNew, waitOffer,
} from './dat-xe.js';
import { compose, waitFor, waitHealthy } from './helpers.js';

let kh1, tx1, ad1;

before(async () => {
  [kh1, tx1, ad1] = await Promise.all([SEED.KH1, SEED.TX1, SEED.AD1].map((p) => tokenOf(p)));
  await drainAllTestBookings();
});

// Mỗi test bắt đầu với tài xế seed rảnh, không còn Offer chờ (test trước dừng giữa chừng cũng không kéo lệch test sau).
beforeEach(async () => {
  await drainAllTestBookings();
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

function restart(...services) {
  const r = compose('restart', ...services);
  assert.equal(r.status, 0, r.stderr);
}

const counts = () => [
  bookingsDb('select count(*) from bookings'), paymentsDb('select count(*) from payments'),
  tripsDb('select count(*) from trips'), tripsDb('select count(*) from trip_status_history'),
];

test('AC-DX-04 (mục 14, restart): restart booking, payment, trip → seed không nhân đôi (7, 7, 3, 11 dòng seed; tổng số dòng không đổi)', async () => {
  const before = counts();
  restart('booking-service', 'payment-service', 'trip-service');
  for (const s of ['booking-service', 'payment-service', 'trip-service']) await healthyAgain(s);
  assert.deepEqual(counts(), before, 'tổng số dòng trước / sau restart');
  assert.equal(bookingsDb('select count(*) from bookings where booking_id < 1000'), '7');
  assert.equal(paymentsDb('select count(*) from payments where payment_id < 1000'), '7');
  assert.equal(tripsDb('select count(*) from trips where trip_id < 1000'), '3');
  // 11 dòng lịch sử seed (T3, T4 đủ 5 bước, T5 một bước). Spec 17-18 (mục 18) hủy chuyến seed 5 → thêm đúng một dòng
  // ACCEPTED → CANCELED (không phải seed); không tính dòng đó, và không có cặp (chuyến, trạng thái) nào lặp.
  assert.equal(tripsDb("select count(*) from trip_status_history where trip_id < 1000 and to_status <> 'CANCELED'"), '11');
  assert.equal(tripsDb('select count(*) - count(distinct (trip_id, to_status)) from trip_status_history where trip_id < 1000'), '0');
});

test('AC-DX-18 (mục 15, NFR15): booking SEARCHING có Offer PENDING; restart booking-service → Offer cũ vẫn PENDING, không có Offer thứ hai', async () => {
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o, 'TX1 có Offer');
  restart('booking-service');
  await healthyAgain('booking-service');
  await new Promise((r) => setTimeout(r, 3000)); // cho bước "khởi động: dispatch booking SEARCHING" chạy xong
  const l = await call('GET', '/offers', { token: tx1 });
  assert.equal(l.status, 200, l.text);
  assert.deepEqual(l.body.data.map((x) => [x.offer_id, x.status]), [[o.offer_id, 'PENDING']]);
  assert.equal(bookingsDb(`select count(*) from driver_offers where booking_id = ${b.booking_id}`), '1');
  assert.equal(await drainBooking(b.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-DX-12 (mục 15, 503): dừng payment-service → A19 → 503 SERVICE_UNAVAILABLE, bookings không thêm dòng; start → A19 → 201', async (tt) => {
  const before = bookingsDb('select count(*) from bookings');
  await withStopped('payment-service', async () => {
    const r = await book(kh1);
    assert.equal(r.status, 503, r.text);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    assert.equal(bookingsDb('select count(*) from bookings'), before, 'không tạo booking khi Payment dừng');
  }, async () => {
    const t0 = Date.now();
    const seen = [];
    const r = await waitFor(async () => {
      const x = await book(kh1);
      seen.push(`${x.status} ${x.text}`);
      return x;
    }, (x) => x?.status === 201, { timeoutMs: 15_000, intervalMs: 1000 });
    // Dọn TRƯỚC khi kiểm: booking vừa tạo đang mời TX1, để lại sẽ làm lệch các AC sau.
    if (r.status === 201) await drainBooking(r.body.booking_id);
    tt.diagnostic(`A19 sau khi start payment-service (đã healthy): ${seen.join(' | ')} — ${Date.now() - t0} ms`);
    assert.equal(r.status, 201, r.text);
    assert.equal(seen.length, 1, `lần gọi đầu tiên sau khi payment-service healthy phải được 201: ${seen[0]}`);
  });
});

test('AC-DX-17 (mục 15, Q24, DX7; đổi 2026-10-21): dừng driver-service → A19 → 201 SEARCHING; trong 8 s A21 NO_DRIVER_FOUND (S2 chờ hết deadline 1 s mỗi lần do waitForReady); Kafka K3', async (tt) => {
  const snap = await kafkaSnapshot('booking.no-driver-found');
  await withStopped('driver-service', async () => {
    const t0 = Date.now();
    const r = await book(kh1);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.status, 'SEARCHING');
    // Chờ tối đa 8 s kể từ lúc gửi A19 (spec 14 AC-DX-17 đổi 2026-10-21).
    const s = await waitBookingStatus(r.body.booking_id, 'NO_DRIVER_FOUND', Math.max(0, 8000 - (Date.now() - t0)));
    tt.diagnostic(`NO_DRIVER_FOUND sau ${Date.now() - t0} ms`);
    assert.equal(s, 'NO_DRIVER_FOUND');
    const g = await call('GET', `/bookings/${r.body.booking_id}`, { token: kh1 });
    assert.equal(g.body.status, 'NO_DRIVER_FOUND');
    const k3 = await waitKafkaNew('booking.no-driver-found', snap, (m) => m.key === String(r.body.booking_id));
    assert.equal(k3.length, 1);
    assert.equal(k3[0].content.data.offers_tried, 0);
  });
});

test('AC-DX-21 (mục 16, Q35): Offer PENDING TX1; dừng trip-service → A24 → 503; TX1 ONLINE, Offer PENDING, booking SEARCHING; start → A24 → 200 có trip_id', async (tt) => {
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o, 'TX1 có Offer');
  await withStopped('trip-service', async () => {
    const r = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
    assert.equal(r.status, 503, r.text);
    assert.deepEqual(r.body, { error: 'SERVICE_UNAVAILABLE' });
    const d = await call('GET', '/drivers/11', { token: ad1 });
    assert.equal(d.body.status, 'ONLINE', 'tài xế đã được nhả');
    assert.equal(driversDb("select coalesce(current_booking_id::text, '-') from drivers where driver_id = 11"), '-');
    assert.equal(bookingsDb(`select status from driver_offers where offer_id = ${o.offer_id}`), 'PENDING');
    assert.equal(bookingsDb(`select status from bookings where booking_id = ${b.booking_id}`), 'SEARCHING');
  }, async () => {
    const t0 = Date.now();
    const seen = [];
    const r = await waitFor(async () => {
      const x = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
      seen.push(`${x.status} ${x.text}`);
      return x;
    }, (x) => x?.status === 200, { timeoutMs: 15_000, intervalMs: 1000 });
    tt.diagnostic(`A24 sau khi start trip-service (đã healthy): ${seen.join(' | ')} — ${Date.now() - t0} ms`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.trip_id >= 1000);
    assert.equal(r.body.booking_status, 'DRIVER_ASSIGNED');
    assert.equal(tripsDb(`select count(*) from trips where booking_id = ${b.booking_id}`), '1');
    assert.equal(seen.length, 1, `lần A24 đầu tiên sau khi trip-service healthy phải được 200: ${seen[0]}`);
  });
  releaseSeedDrivers();
});

test('AC-TT-13 (mục 30, NFR05): dừng booking-service → A31 payment ONLINE PENDING (khóa mới) → 200 COMPLETED; start → booking SEARCHING (K6 được xử lý khi Booking chạy lại)', async (tt) => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  assert.equal(b.status, 'PENDING_PAYMENT');
  await withStopped('booking-service', async () => {
    const r = await call('POST', `/payments/${b.payment_id}/transactions`, { token: kh1, headers: { 'Idempotency-Key': 'k13' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status, 'COMPLETED');
    const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
    assert.equal(g.status, 503, 'booking-service đang dừng');
  }, async () => {
    const t0 = Date.now();
    const s = await waitBookingStatus(b.booking_id, 'SEARCHING', 60_000);
    const ms = Date.now() - t0;
    tt.diagnostic(`booking SEARCHING sau ${ms} ms kể từ khi booking-service healthy (spec ghi ≈ 2 s)`);
    assert.equal(s, 'SEARCHING', `sau 60 s booking vẫn ${s}`);
  });
  await drainBooking(b.booking_id);
});
