// Spec 17-18 — chuyến đi (mục 17), hủy chuyến / hủy booking (mục 18), hoàn tiền, tài xế rảnh lại, thông báo
// (vế thông báo của mục 16). AC-CD, AC-HT, AC-TB trừ phần phải dừng / restart container (AC-CD-08, AC-CD-19,
// AC-HT-06, AC-TB-05, AC-TB-06 — ở 92-dung-service-chuyen-di.test.js) và phần trên TX7 (AC-TB-03 vế duyệt / từ chối,
// AC-TB-09 — ở 15-tai-xe-nop-lai.test.js).
//
// Tiền điều kiện: seed T5 (KH1, TX6, ACCEPTED, payment 5 ONLINE COMPLETED) chưa bị hủy; TX1 rảnh. Dữ liệu
// booking / payment / trip vừa đặt lại về seed (chạy sau file 11, 12 cũng được: mã chuyến do API tạo không gõ cứng).
// "Chuyến 1000" của spec (tạo ở AC-DX-19) ở đây là chuyến C1 do chính file này tạo (KH1 đặt CASH, TX1 nhận) —
// cùng đường code, mã đọc từ response. "≈ 1 s" = kiểm sau tối đa 2 giây.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CALLBACK_SECRET, SEED, call, kafkaMessages, psql, tokenOf } from './api.js';
import {
  FAR_FROM, FAR_TO, book201, bookingsDb, drainAllTestBookings, drainBooking, driversDb, kafkaNew, kafkaSnapshot,
  paymentsDb, releaseSeedDrivers, tripsDb, waitKafkaNew, waitOffer,
} from './dat-xe.js';
import {
  advance, consumerGroups, kafkaProduce, kafkaUiProduceStatus, newTrip, notes, payNow, waitDriverFree, waitNote,
} from './chuyen-di.js';
import { compose, sleep, waitFor } from './helpers.js';

let kh1, kh2, tx1, tx3, tx6, ad1;
const S = {};
const TOPICS = ['booking.canceled', 'trip.status-changed', 'payment.status-changed', 'booking.no-driver-found'];

const payment = async (id, token = kh1) => (await call('GET', `/payments/${id}`, { token })).body;
const waitPayment = (id, status, timeoutMs = 2000) => waitFor(
  () => payment(id), (p) => p?.status === status, { timeoutMs, intervalMs: 200 },
);
const trip = async (id, token = kh1) => call('GET', `/trips/${id}`, { token });

before(async () => {
  [kh1, kh2, tx1, tx3, tx6, ad1] = await Promise.all(
    [SEED.KH1, SEED.KH2, SEED.TX1, '0910000003', '0910000006', SEED.AD1].map((p) => tokenOf(p)),
  );
  assert.equal(tripsDb('select status from trips where trip_id = 5'), 'ACCEPTED',
    'Tiền điều kiện: chuyến seed 5 ACCEPTED (chỉ hủy được một lần). Đặt lại trip-db / payment-db / booking-db về seed.');
  assert.equal(paymentsDb('select status from payments where payment_id = 5'), 'COMPLETED');
  assert.equal(driversDb('select availability from drivers where driver_id = 16'), 'BUSY');
  await drainAllTestBookings();
  releaseSeedDrivers();
  S.snap = Object.fromEntries(await Promise.all(TOPICS.map(async (t) => [t, await kafkaSnapshot(t)])));
});

after(async () => {
  await drainAllTestBookings();
  releaseSeedDrivers();
});

// ---------- Mục 16 (vế thông báo) → 17 trên chuyến C1 ----------
test('AC-TB-01 (mục 16): KH1 đặt CASH, TX1 nhận → A33 [KH1] data[0] TRIP_ACCEPTED {trip, booking, driver 11, ACCEPTED}, data[1] BOOKING_CREATED; A33 [TX1] OFFER_CREATED', async () => {
  S.c1 = await newTrip(kh1, tx1);
  const { booking_id: B, trip_id: T, offer_id: O } = S.c1;
  const list = await waitNote(kh1, (n) => n.type === 'TRIP_ACCEPTED' && n.data.trip_id === T);
  assert.equal(list[0].type, 'TRIP_ACCEPTED', JSON.stringify(list.slice(0, 2)));
  assert.deepEqual(list[0].data, { booking_id: B, trip_id: T, driver_id: 11, status: 'ACCEPTED' });
  assert.equal(list[0].title, 'Tài xế đã nhận chuyến');
  assert.equal(list[0].body, `Tài xế 11 đã nhận chuyến ${T}`);
  assert.equal(list[1].type, 'BOOKING_CREATED');
  assert.equal(list[1].data.booking_id, B);
  for (const n of list) assert.deepEqual(Object.keys(n).sort(), ['body', 'created_at', 'data', 'title', 'type'], 'A33 không trả _id, event_id, recipient_id');
  const t1 = await waitNote(tx1, (n) => n.type === 'OFFER_CREATED' && n.data.offer_id === O);
  const off = t1.find((n) => n.type === 'OFFER_CREATED' && n.data.offer_id === O);
  assert.ok(off, 'TX1 có OFFER_CREATED');
  assert.deepEqual(off.data, { booking_id: B, offer_id: O });
});

test('AC-CD-01 (mục 17, 409): A28 COMPLETED khi đang ACCEPTED → 409 INVALID_STATUS_TRANSITION; A27 vẫn ACCEPTED; không có K5 mới', async () => {
  const T = S.c1.trip_id;
  const snap = await kafkaSnapshot('trip.status-changed');
  const r = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'COMPLETED' } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'INVALID_STATUS_TRANSITION' });
  const g = await trip(T);
  assert.equal(g.body.status, 'ACCEPTED');
  await sleep(1500);
  const k5 = (await kafkaNew('trip.status-changed', snap)).filter((m) => m.key === String(T));
  assert.equal(k5.length, 0);
});

test('AC-CD-02 (mục 17): ARRIVED → 200 history [ACCEPTED, ARRIVED]; K5 ARRIVED previous ACCEPTED; ≈ 1 s KH1 có TRIP_ARRIVED', async () => {
  const T = S.c1.trip_id;
  const snap = await kafkaSnapshot('trip.status-changed');
  const r = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'arrived' } }); // enum không phân biệt hoa thường
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.trip_id, T);
  assert.equal(r.body.status, 'ARRIVED');
  assert.deepEqual(r.body.history.map((h) => h.status), ['ACCEPTED', 'ARRIVED']);
  for (const h of r.body.history) assert.match(h.at, /Z$/);
  const k5 = await waitKafkaNew('trip.status-changed', snap, (m) => m.key === String(T), 3000);
  assert.equal(k5.length, 1);
  assert.deepEqual(k5[0].content.data, {
    trip_id: T, booking_id: S.c1.booking_id, customer_id: 1, driver_id: 11, status: 'ARRIVED', previous_status: 'ACCEPTED',
  });
  const list = await waitNote(kh1, (n) => n.type === 'TRIP_ARRIVED' && n.data.trip_id === T);
  assert.ok(list.some((n) => n.type === 'TRIP_ARRIVED' && n.data.trip_id === T), 'KH1 có TRIP_ARRIVED trong 2 s');
});

test('AC-CD-03 (mục 17, CD8): PICKED_UP, IN_PROGRESS → 200 ×2; A27 có started_at, history 4 mục; KH1 không có thông báo mới', async () => {
  const T = S.c1.trip_id;
  const before = (await notes(kh1)).pagination.total;
  for (const s of ['PICKED_UP', 'IN_PROGRESS']) {
    const r = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: s } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status, s);
  }
  const g = await trip(T);
  assert.equal(g.status, 200);
  assert.match(g.body.started_at, /Z$/);
  assert.deepEqual(g.body.history.map((h) => h.status), ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS']);
  await sleep(1500);
  assert.equal((await notes(kh1)).pagination.total, before, 'PICKED_UP / IN_PROGRESS không tạo thông báo');
});

test('AC-CD-04 (mục 17, AC11, FR17): COMPLETED → 200 history 5 mục; ≈ 1 s TX1 ONLINE; payment CASH COMPLETED có paid_at, không giao dịch; K6 COMPLETED CASH; A33 PAYMENT_COMPLETED rồi TRIP_COMPLETED', async () => {
  const { trip_id: T, payment_id: P, booking_id: B } = S.c1;
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const r = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'COMPLETED' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'COMPLETED');
  assert.deepEqual(r.body.history.map((h) => h.status), ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED']);
  const times = r.body.history.map((h) => Date.parse(h.at));
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'history theo thứ tự thời gian');
  assert.equal(await waitDriverFree(11, 2000), 'ONLINE:-', 'TX1 về ONLINE trong 2 s');
  const d = await call('GET', '/drivers/11', { token: ad1 });
  assert.equal(d.body.status, 'ONLINE');
  const p = await waitPayment(P, 'COMPLETED');
  assert.equal(p.status, 'COMPLETED', JSON.stringify(p));
  assert.equal(p.method, 'CASH');
  assert.match(p.paid_at, /Z$/);
  assert.deepEqual(p.transactions, []);
  const k6 = await waitKafkaNew('payment.status-changed', snapK6, (m) => m.key === String(B), 3000);
  assert.equal(k6.length, 1);
  assert.equal(k6[0].content.data.status, 'COMPLETED');
  assert.equal(k6[0].content.data.method, 'CASH');
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_COMPLETED' && n.data.payment_id === P);
  assert.deepEqual(list.slice(0, 2).map((n) => n.type), ['PAYMENT_COMPLETED', 'TRIP_COMPLETED']);
  assert.equal(list[1].data.trip_id, T);
  assert.equal(list[0].data.amount, 45000);
});

test('AC-CD-05 (mục 17, 409): chuyến COMPLETED — COMPLETED lại, ARRIVED → 409 INVALID_STATUS_TRANSITION; A29 [TX1] → 409 TRIP_NOT_CANCELABLE', async () => {
  const T = S.c1.trip_id;
  for (const s of ['COMPLETED', 'ARRIVED']) {
    const r = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: s } });
    assert.equal(r.status, 409, s);
    assert.deepEqual(r.body, { error: 'INVALID_STATUS_TRANSITION' });
  }
  const c = await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'CANCELED', reason: 'x' } });
  assert.equal(c.status, 409);
  assert.deepEqual(c.body, { error: 'TRIP_NOT_CANCELABLE' });
});

test('AC-CD-06 (mục 17, 400/401/403/404): TX3 → NOT_OWNER; 999 → 404; abc → INVALID_ID; ACCEPTED / BUSY / không body / có reason → INVALID_INPUT; KH1, AD1 → FORBIDDEN; không token → 401', async () => {
  const T = S.c1.trip_id;
  const cases = [
    [await call('PATCH', `/trips/${T}`, { token: tx3, body: { status: 'ARRIVED' } }), 403, 'NOT_OWNER'],
    [await call('PATCH', '/trips/999', { token: tx1, body: { status: 'ARRIVED' } }), 404, 'TRIP_NOT_FOUND'],
    [await call('PATCH', '/trips/abc', { token: tx1, body: { status: 'ARRIVED' } }), 400, 'INVALID_ID'],
    [await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'ACCEPTED' } }), 400, 'INVALID_INPUT'],
    [await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'BUSY' } }), 400, 'INVALID_INPUT'],
    [await call('PATCH', `/trips/${T}`, { token: tx1 }), 400, 'INVALID_INPUT'],
    [await call('PATCH', `/trips/${T}`, { token: tx1, body: { status: 'ARRIVED', reason: 'x' } }), 400, 'INVALID_INPUT'],
    [await call('PATCH', `/trips/${T}`, { token: kh1, body: { status: 'ARRIVED' } }), 403, 'FORBIDDEN'],
    [await call('PATCH', `/trips/${T}`, { token: ad1 }), 403, 'FORBIDDEN'],
    [await call('PATCH', `/trips/${T}`, { body: { status: 'ARRIVED' } }), 401, 'TOKEN_MISSING'],
    [await call('PATCH', `/trips/${T}`, { token: tx1, body: '{"status":' }), 400, 'INVALID_JSON'],
  ];
  cases.forEach(([r, status, error], i) => {
    assert.equal(r.status, status, `#${i} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error }, `#${i}`);
  });
});

test('AC-CD-07 (mục 17, A27): KH1, TX1, AD1 → 200 (CASH, 45000, history, driver {11, "Tài Xế 1", "59A-00001"}); KH2, TX3 → 403 NOT_OWNER; trips/999 → 404', async () => {
  const T = S.c1.trip_id;
  for (const tok of [kh1, tx1, ad1]) {
    const r = await trip(T, tok);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.trip_id, T);
    assert.equal(r.body.booking_id, S.c1.booking_id);
    assert.equal(r.body.pay, 'CASH');
    assert.equal(r.body.fare, 45000);
    assert.equal(r.body.customer_id, 1);
    assert.equal(r.body.driver_id, 11);
    // Thêm 2026-10-21 (CD10): khối driver chụp lúc nhận chuyến.
    assert.deepEqual(r.body.driver, { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001' });
    assert.deepEqual(r.body.from, [10.82, 106.68]);
    assert.equal(r.body.history.length, 5);
    assert.match(r.body.ended_at, /Z$/);
  }
  for (const tok of [kh2, tx3]) {
    const r = await trip(T, tok);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'NOT_OWNER' });
  }
  const n = await trip(999);
  assert.equal(n.status, 404);
  assert.deepEqual(n.body, { error: 'TRIP_NOT_FOUND' });
  const l = await call('GET', '/trips', { token: kh1 });
  assert.equal(l.status, 404, 'A26 chưa đăng ký');
  assert.deepEqual(l.body, { error: 'ROUTE_NOT_FOUND' });
});

// ---------- A27 khối driver (CD10, thêm 2026-10-21) ----------
test('AC-CD-20 (mục 12, FR14, A27): trips/5 [KH1], [TX6], [AD1] → 200 cùng driver {16, "Tài Xế 6", "59A-00006"} (không lat/lng/license); [KH2], [TX1] → 403 chỉ {"error":"NOT_OWNER"}; A14 drivers/16 [KH1] → 403 FORBIDDEN', async () => {
  for (const tok of [kh1, tx6, ad1]) {
    const r = await trip(5, tok);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.driver, { driver_id: 16, name: 'Tài Xế 6', plate: '59A-00006' }, r.text);
    for (const k of ['lat', 'lng', 'license']) assert.ok(!(k in r.body.driver), `driver có key ${k}`);
  }
  for (const tok of [kh2, tx1]) {
    const r = await trip(5, tok);
    assert.equal(r.status, 403, r.text);
    assert.deepEqual(r.body, { error: 'NOT_OWNER' });
    assert.ok(!/Tài Xế 6|59A-00006/.test(r.text), 'body 403 lộ tên / biển số');
  }
  const d = await call('GET', '/drivers/16', { token: kh1 });
  assert.equal(d.status, 403, d.text);
  assert.deepEqual(d.body, { error: 'FORBIDDEN' });
});

test('AC-CD-21 (mục 16 → A27, CD10): driver của chuyến C1 là bản chụp lúc nhận — đổi biển số TX1 ở driver-db, A27 vẫn 59A-00001; trips có driver_name, driver_plate; trip-service không gọi driver-service', async () => {
  const T = S.c1.trip_id;
  const since = new Date(Date.now() - 1000).toISOString();
  const r1 = await trip(T, kh1);
  assert.equal(r1.status, 200, r1.text);
  assert.deepEqual(r1.body.driver, { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001' });
  try {
    driversDb("update vehicles set license_plate = '59A-11111' where driver_id = 11");
    const r2 = await trip(T, kh1);
    assert.equal(r2.status, 200, r2.text);
    assert.deepEqual(r2.body.driver, { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001' }, 'phải là bản chụp, không đọc lại Driver');
  } finally {
    driversDb("update vehicles set license_plate = '59A-00001' where driver_id = 11");
  }
  assert.equal(tripsDb(`select driver_name || '|' || driver_plate from trips where trip_id = ${T}`), 'Tài Xế 1|59A-00001');
  const logs = compose('logs', '--no-log-prefix', '--since', since, 'trip-service').stdout;
  assert.ok(!/driver-service|:50053/.test(logs), `log trip-service có lời gọi tới driver-service: ${logs.slice(-1000)}`);
});

// ---------- Mục 18 trên seed T5 ----------
test('AC-CD-09 (mục 18): A29 trips/5 [KH1] {"status":"CANCELED","reason":"ban viec"} → 200; lịch sử ACCEPTED → CANCELED có reason, role customer; K5 CANCELED canceled_by customer, không có lý do', async () => {
  S.snapT5 = await kafkaSnapshot('trip.status-changed');
  S.snapK6T5 = await kafkaSnapshot('payment.status-changed');
  S.kh1Before = (await notes(kh1)).pagination.total;
  S.tx6Before = (await notes(tx6)).pagination.total;
  const r = await call('PATCH', '/trips/5', { token: kh1, body: { status: 'CANCELED', reason: 'ban viec' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { trip_id: 5, status: 'CANCELED', canceled_by: 'customer', reason: 'ban viec' });
  assert.equal(
    tripsDb("select coalesce(from_status,'-') || '|' || to_status || '|' || changed_by || '|' || changed_by_role || '|' || reason from trip_status_history where trip_id = 5 order by changed_at desc, history_id desc limit 1"),
    'ACCEPTED|CANCELED|1|customer|ban viec',
  );
  assert.equal(tripsDb('select canceled_by || \'|\' || cancel_reason || \'|\' || (ended_at is not null) from trips where trip_id = 5'), 'customer|ban viec|true');
  const k5 = await waitKafkaNew('trip.status-changed', S.snapT5, (m) => m.key === '5', 3000);
  assert.equal(k5.length, 1);
  S.k5Cancel = k5[0];
  assert.deepEqual(k5[0].content.data, {
    trip_id: 5, booking_id: 5, customer_id: 1, driver_id: 16, status: 'CANCELED', previous_status: 'ACCEPTED', canceled_by: 'customer',
  });
  assert.ok(!k5[0].raw.includes('ban viec'), 'K5 chứa lý do hủy');
});

test('AC-HT-01 (mục 18, AC22): ≈ 1 s payment 5 REFUNDED (TRIP_CANCELED, refunded_at), giao dịch SIM-5-1 CHARGE + SIM-R-5 REFUND 45000; K6 REFUNDED; TX6 ONLINE', async () => {
  const p = await waitPayment(5, 'REFUNDED');
  assert.equal(p.status, 'REFUNDED', JSON.stringify(p));
  assert.equal(p.status_reason, 'TRIP_CANCELED');
  assert.match(p.refunded_at, /Z$/);
  assert.deepEqual(p.transactions.map((x) => [x.txn_id, x.type, x.status, x.amount]), [
    ['SIM-5-1', 'CHARGE', 'SUCCEEDED', 45000], ['SIM-R-5', 'REFUND', 'SUCCEEDED', 45000],
  ]);
  const k6 = await waitKafkaNew('payment.status-changed', S.snapK6T5, (m) => m.key === '5', 3000);
  assert.equal(k6.length, 1);
  assert.equal(k6[0].content.data.status, 'REFUNDED');
  assert.equal(k6[0].content.data.previous_status, 'COMPLETED');
  assert.equal(await waitDriverFree(16, 2000), 'ONLINE:-');
  const d = await call('GET', '/drivers/16', { token: ad1 });
  assert.equal(d.body.status, 'ONLINE');
});

test('AC-TB-02 (mục 18, AC16, N5): A33 [KH1] data[0] PAYMENT_REFUNDED (payment 5, 45000), data[1] TRIP_CANCELED (trip 5); A33 [TX6] TRIP_CANCELED trip 5', async () => {
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === 5);
  assert.equal(list[0].type, 'PAYMENT_REFUNDED', JSON.stringify(list.slice(0, 2)));
  assert.equal(list[0].data.payment_id, 5);
  assert.equal(list[0].data.amount, 45000);
  assert.equal(list[0].body, 'Đã hoàn 45000 đ cho thanh toán 5');
  assert.equal(list[1].type, 'TRIP_CANCELED');
  assert.equal(list[1].data.trip_id, 5);
  assert.equal(list[1].body, 'Chuyến 5 đã bị khách hàng hủy');
  const t6 = await waitNote(tx6, (n) => n.type === 'TRIP_CANCELED' && n.data.trip_id === 5);
  assert.ok(t6.some((n) => n.type === 'TRIP_CANCELED' && n.data.trip_id === 5), 'TX6 có TRIP_CANCELED');
});

test('AC-CD-10 (mục 18, 400/403/409): hủy lại trips/5 → 409 (vẫn một REFUND); thiếu / khoảng trắng reason → REASON_REQUIRED; <b> → TEXT_CONTAINS_HTML; 256 ký tự, số → INVALID_INPUT; trips/4 → 409; KH2 → NOT_OWNER; AD1 → FORBIDDEN', async () => {
  const c = (token, body, id = 5) => call('PATCH', `/trips/${id}`, { token, body });
  const cases = [
    [await c(kh1, { status: 'CANCELED', reason: 'ban viec' }), 409, 'TRIP_NOT_CANCELABLE'],
    [await c(kh1, { status: 'CANCELED' }), 400, 'REASON_REQUIRED'],
    [await c(kh1, { status: 'CANCELED', reason: '  ' }), 400, 'REASON_REQUIRED'],
    [await c(kh1, { status: 'CANCELED', reason: null }), 400, 'REASON_REQUIRED'],
    [await c(kh1, { status: 'CANCELED', reason: '<b>x</b>' }), 400, 'TEXT_CONTAINS_HTML'],
    [await c(kh1, { status: 'CANCELED', reason: 'a'.repeat(256) }), 400, 'INVALID_INPUT'],
    [await c(kh1, { status: 'CANCELED', reason: 5 }), 400, 'INVALID_INPUT'],
    [await c(kh1, { status: 'CANCELED', reason: 'x' }, 4), 409, 'TRIP_NOT_CANCELABLE'],
    [await c(kh2, { status: 'CANCELED', reason: 'x' }), 403, 'NOT_OWNER'],
    [await c(ad1, { status: 'CANCELED', reason: 'x' }), 403, 'FORBIDDEN'],
  ];
  cases.forEach(([r, status, error], i) => {
    assert.equal(r.status, status, `#${i} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error }, `#${i}`);
  });
  assert.equal(paymentsDb("select count(*) from payment_transactions where payment_id = 5 and type = 'REFUND'"), '1');
  // reason đúng 255 ký tự là hợp lệ về hình thức: trên chuyến đã hủy vẫn chỉ là 409, không phải 400.
  const ok255 = await c(kh1, { status: 'CANCELED', reason: 'a'.repeat(255) });
  assert.equal(ok255.status, 409);
});

test('AC-HT-04 (NFR14): Produce lại y hệt message K5 CANCELED của trip 5 (cùng event_id) → payment 5 vẫn một REFUND; TX6 không đổi; KH1, TX6 không thêm thông báo', async (tt) => {
  assert.ok(S.k5Cancel, 'cần message K5 CANCELED từ AC-CD-09');
  // Spec ghi "Kafka UI → Produce"; Kafka UI chạy chỉ đọc (spec 00 H4) → ghi nhận mã trả về, gửi bằng console producer.
  tt.diagnostic(`Kafka UI Produce → HTTP ${await kafkaUiProduceStatus('trip.status-changed', { key: 'qa-probe', content: '{}' })}`);
  const kh1Total = (await notes(kh1)).pagination.total;
  const tx6Total = (await notes(tx6)).pagination.total;
  const k6Snap = await kafkaSnapshot('payment.status-changed');
  await kafkaProduce('trip.status-changed', { key: S.k5Cancel.key, content: S.k5Cancel.raw });
  const again = await waitKafkaNew('trip.status-changed', S.snapT5, (m) => m.key === '5' && !(m.partition === S.k5Cancel.partition && m.offset === S.k5Cancel.offset), 5000);
  assert.ok(again.length >= 1, 'message lặp đã vào topic');
  await sleep(2500);
  assert.equal(paymentsDb("select count(*) from payment_transactions where payment_id = 5 and type = 'REFUND'"), '1');
  assert.equal(paymentsDb('select status from payments where payment_id = 5'), 'REFUNDED');
  assert.equal(driversDb("select availability || ':' || coalesce(current_booking_id::text, '-') from drivers where driver_id = 16"), 'ONLINE:-');
  assert.equal((await notes(kh1)).pagination.total, kh1Total);
  assert.equal((await notes(tx6)).pagination.total, tx6Total);
  const k6 = (await kafkaNew('payment.status-changed', k6Snap)).filter((m) => m.key === '5');
  assert.equal(k6.length, 0, 'không phát K6 lần hai');
});

// ---------- Mục 18: các nhánh hủy chuyến mới ----------
test('AC-CD-11 (mục 18, BRULE16): chuyến CASH mới đã PICKED_UP → A29 [KH1] và [TX1] → 409 TRIP_NOT_CANCELABLE; chuyến vẫn PICKED_UP', async () => {
  const c = await newTrip(kh1, tx1);
  await advance(c.trip_id, tx1, 'ACCEPTED', 'PICKED_UP');
  for (const tok of [kh1, tx1]) {
    const r = await call('PATCH', `/trips/${c.trip_id}`, { token: tok, body: { status: 'CANCELED', reason: 'x' } });
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.body, { error: 'TRIP_NOT_CANCELABLE' });
  }
  assert.equal((await trip(c.trip_id)).body.status, 'PICKED_UP');
  await advance(c.trip_id, tx1, 'PICKED_UP', 'COMPLETED'); // trả TX1 về rảnh cho AC sau
  assert.equal(await waitDriverFree(11, 3000), 'ONLINE:-');
});

test('AC-CD-12 (mục 18, FR41, AC24): chuyến ONLINE đã trả, TX1 hủy "xe hong" → 200 canceled_by driver; ≈ 1 s REFUNDED (TRIP_CANCELED), TX1 ONLINE, KH1 có TRIP_CANCELED + PAYMENT_REFUNDED; booking vẫn DRIVER_ASSIGNED; không có Offer mới', async () => {
  const c = await newTrip(kh1, tx1, { online: true });
  const r = await call('PATCH', `/trips/${c.trip_id}`, { token: tx1, body: { status: 'CANCELED', reason: 'xe hong' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { trip_id: c.trip_id, status: 'CANCELED', canceled_by: 'driver', reason: 'xe hong' });
  const p = await waitPayment(c.payment_id, 'REFUNDED');
  assert.equal(p.status, 'REFUNDED');
  assert.equal(p.status_reason, 'TRIP_CANCELED');
  assert.equal(await waitDriverFree(11, 2000), 'ONLINE:-');
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === c.payment_id);
  assert.ok(list.some((n) => n.type === 'TRIP_CANCELED' && n.data.trip_id === c.trip_id));
  assert.ok(list.some((n) => n.type === 'TRIP_CANCELED' && n.body === `Chuyến ${c.trip_id} đã bị tài xế hủy`));
  const b = await call('GET', `/bookings/${c.booking_id}`, { token: kh1 });
  assert.equal(b.body.status, 'DRIVER_ASSIGNED');
  assert.equal(b.body.trip_id, c.trip_id);
  await sleep(1000);
  assert.equal(bookingsDb(`select count(*) from driver_offers where booking_id = ${c.booking_id}`), '1', 'T6: không tìm tài xế khác');
  for (const tok of [tx1, tx3]) {
    const o = await call('GET', '/offers', { token: tok });
    assert.ok(!o.body.data.some((x) => x.booking_id === c.booking_id));
  }
});

test('AC-CD-13 (mục 18, tiền mặt): chuyến CASH ARRIVED, KH1 hủy → 200; ≈ 1 s payment CANCELED (TRIP_CANCELED), không giao dịch hoàn, không K6 mới', async () => {
  const c = await newTrip(kh1, tx1);
  await advance(c.trip_id, tx1, 'ACCEPTED', 'ARRIVED');
  const snap = await kafkaSnapshot('payment.status-changed');
  const r = await call('PATCH', `/trips/${c.trip_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'doi y' } });
  assert.equal(r.status, 200, r.text);
  const p = await waitPayment(c.payment_id, 'CANCELED');
  assert.equal(p.status, 'CANCELED', JSON.stringify(p));
  assert.equal(p.status_reason, 'TRIP_CANCELED');
  assert.deepEqual(p.transactions, []);
  await sleep(1500);
  const k6 = (await kafkaNew('payment.status-changed', snap)).filter((m) => m.key === String(c.booking_id));
  assert.equal(k6.length, 0);
  assert.equal(await waitDriverFree(11, 2000), 'ONLINE:-');
});

// ---------- Mục 18 phụ: khách hủy booking chưa có tài xế (A22) ----------
test('AC-CD-14 (mục 18 phụ): booking ONLINE PENDING_PAYMENT → A22 "doi y" → 200; K4 đúng 5 field, không reason; A21 cancel_reason; payment CANCELED (BOOKING_CANCELED), không K6; A31 → 409 PAYMENT_CANCELED; KH1 có BOOKING_CANCELED', async () => {
  const snapK4 = await kafkaSnapshot('booking.canceled');
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const b = await book201(kh1, { pay: 'ONLINE' });
  assert.equal(b.status, 'PENDING_PAYMENT');
  const r = await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'doi y' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { booking_id: b.booking_id, status: 'CANCELED', canceled_by: 'customer' });
  const k4 = await waitKafkaNew('booking.canceled', snapK4, (m) => m.key === String(b.booking_id), 3000);
  assert.equal(k4.length, 1);
  assert.deepEqual(k4[0].content.data, {
    booking_id: b.booking_id, customer_id: 1, canceled_by: 'customer', previous_status: 'PENDING_PAYMENT', pending_offer_driver_id: null,
  });
  assert.ok(!('reason' in k4[0].content.data));
  const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'CANCELED');
  assert.equal(g.body.canceled_by, 'customer');
  assert.equal(g.body.cancel_reason, 'doi y');
  const p = await waitPayment(b.payment_id, 'CANCELED');
  assert.equal(p.status, 'CANCELED');
  assert.equal(p.status_reason, 'BOOKING_CANCELED');
  const pay = await payNow(kh1, b.payment_id);
  assert.equal(pay.status, 409);
  assert.deepEqual(pay.body, { error: 'PAYMENT_CANCELED' });
  await sleep(1000);
  assert.equal((await kafkaNew('payment.status-changed', snapK6)).filter((m) => m.key === String(b.booking_id)).length, 0);
  const list = await waitNote(kh1, (n) => n.type === 'BOOKING_CANCELED' && n.data.booking_id === b.booking_id);
  assert.ok(list.some((n) => n.type === 'BOOKING_CANCELED' && n.data.booking_id === b.booking_id));
});

test('AC-CD-15 (mục 18 phụ, VOIDED): booking CASH có Offer PENDING cho TX1 → A22 → 200; A23 [TX1] []; ?status=VOIDED có Offer; A24 → 409; TX1 ONLINE; payment CANCELED; TX1 có OFFER_VOIDED; K4 pending_offer_driver_id 11', async () => {
  await drainAllTestBookings();
  const snapK4 = await kafkaSnapshot('booking.canceled');
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o, 'TX1 có Offer');
  const r = await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'canceled', reason: 'doi y' } });
  assert.equal(r.status, 200, r.text);
  const l = await call('GET', '/offers', { token: tx1 });
  assert.deepEqual(l.body.data, []);
  const v = await call('GET', '/offers?status=VOIDED', { token: tx1 });
  assert.equal(v.status, 200, v.text);
  assert.ok(v.body.data.some((x) => x.offer_id === o.offer_id && x.status === 'VOIDED'));
  const a = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'ACCEPTED' } });
  assert.equal(a.status, 409);
  assert.deepEqual(a.body, { error: 'INVALID_STATUS_TRANSITION' });
  const d = await call('GET', '/drivers/11', { token: ad1 });
  assert.equal(d.body.status, 'ONLINE');
  const p = await waitPayment(b.payment_id, 'CANCELED');
  assert.equal(p.status, 'CANCELED');
  const k4 = await waitKafkaNew('booking.canceled', snapK4, (m) => m.key === String(b.booking_id), 3000);
  assert.equal(k4[0]?.content.data.pending_offer_driver_id, 11);
  assert.equal(k4[0].content.data.previous_status, 'SEARCHING');
  const t1 = await waitNote(tx1, (n) => n.type === 'OFFER_VOIDED' && n.data.booking_id === b.booking_id);
  assert.ok(t1.some((n) => n.type === 'OFFER_VOIDED' && n.data.booking_id === b.booking_id));
});

test('AC-CD-16 (mục 18 phụ, đã trả): booking ONLINE đã trả, đang SEARCHING có Offer → A22 → 200; ≈ 1 s REFUNDED (BOOKING_CANCELED), SIM-R-<id>; K6 REFUNDED; KH1 có PAYMENT_REFUNDED', async () => {
  await drainAllTestBookings();
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const b = await book201(kh1, { pay: 'ONLINE' });
  const pay = await payNow(kh1, b.payment_id);
  assert.equal(pay.body.status, 'COMPLETED');
  assert.ok(await waitOffer(tx1, b.booking_id, 3000), 'SEARCHING có Offer');
  const r = await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'doi y' } });
  assert.equal(r.status, 200, r.text);
  const p = await waitPayment(b.payment_id, 'REFUNDED');
  assert.equal(p.status, 'REFUNDED');
  assert.equal(p.status_reason, 'BOOKING_CANCELED');
  assert.ok(p.transactions.some((x) => x.txn_id === `SIM-R-${b.payment_id}` && x.type === 'REFUND' && x.status === 'SUCCEEDED'));
  const k6 = await waitKafkaNew('payment.status-changed', snapK6, (m) => m.key === String(b.booking_id) && m.content.data.status === 'REFUNDED', 3000);
  assert.equal(k6.length, 1);
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === b.payment_id);
  assert.ok(list.some((n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === b.payment_id));
});

test('AC-CD-17 (mục 18 phụ, M11): A31 MANUAL → PENDING; A22 → 200; payment CANCELED; callback muộn → 200 SUCCEEDED / REFUNDED; booking vẫn CANCELED', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  const m = await payNow(kh1, b.payment_id, 'k1', { simulate_result: 'MANUAL' });
  assert.equal(m.status, 200, m.text);
  assert.equal(m.body.status, 'PENDING');
  const r = await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'doi y' } });
  assert.equal(r.status, 200, r.text);
  const p = await waitPayment(b.payment_id, 'CANCELED');
  assert.equal(p.status, 'CANCELED');
  const cb = await call('POST', '/payment-callbacks', { body: { txn_id: `SIM-${b.payment_id}-1` }, headers: { 'X-Callback-Secret': CALLBACK_SECRET } });
  assert.equal(cb.status, 200, cb.text);
  assert.equal(cb.body.txn_status, 'SUCCEEDED');
  assert.equal(cb.body.status, 'REFUNDED');
  await sleep(1500);
  const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'CANCELED');
});

test('AC-CD-18 (mục 18 phụ, lỗi): bookings/3 → BOOKING_ALREADY_ASSIGNED; /1, /2 → BOOKING_NOT_CANCELABLE; thiếu reason → REASON_REQUIRED; status SEARCHING → INVALID_INPUT; KH2 → NOT_OWNER; 999 → 404; abc → INVALID_ID; TX1, AD1 → FORBIDDEN; không token → 401', async () => {
  const c = (id, { token = kh1, body = { status: 'CANCELED', reason: 'x' } } = {}) => call('PATCH', `/bookings/${id}`, { token, body });
  const cases = [
    [await c(3), 409, 'BOOKING_ALREADY_ASSIGNED'],
    [await c(1), 409, 'BOOKING_NOT_CANCELABLE'],
    [await c(2), 409, 'BOOKING_NOT_CANCELABLE'],
    [await c(7, { body: { status: 'CANCELED' } }), 400, 'REASON_REQUIRED'],
    [await c(7, { body: { status: 'SEARCHING', reason: 'x' } }), 400, 'INVALID_INPUT'],
    [await c(7, { body: { status: 'CANCELED', reason: 'x', customer_id: 1 } }), 400, 'INVALID_INPUT'],
    [await c(7, { token: kh2 }), 403, 'NOT_OWNER'],
    [await c(999), 404, 'BOOKING_NOT_FOUND'],
    [await c('abc'), 400, 'INVALID_ID'],
    [await c(7, { token: tx1, body: undefined }), 403, 'FORBIDDEN'],
    [await c(7, { token: ad1 }), 403, 'FORBIDDEN'],
    [await call('PATCH', '/bookings/7', { body: { status: 'CANCELED', reason: 'x' } }), 401, 'TOKEN_MISSING'],
  ];
  cases.forEach(([r, status, error], i) => {
    assert.equal(r.status, status, `#${i} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error }, `#${i}`);
  });
});

// ---------- Hoàn tiền khi không có tài xế; không hoàn khi từ chối / đã hoàn thành ----------
test('AC-HT-02 (mục 15, AC09, AC22): ONLINE ở (10.90, 106.68) đã trả → NO_DRIVER_FOUND → payment REFUNDED (NO_DRIVER_FOUND); KH1 có NO_DRIVER_FOUND + PAYMENT_REFUNDED. CASH → payment CANCELED (NO_DRIVER_FOUND)', async () => {
  const b = await book201(kh1, { from: FAR_FROM, to: FAR_TO, pay: 'ONLINE' });
  const pay = await payNow(kh1, b.payment_id);
  assert.equal(pay.body.status, 'COMPLETED');
  const p = await waitPayment(b.payment_id, 'REFUNDED', 3000);
  assert.equal(p.status, 'REFUNDED', JSON.stringify(p));
  assert.equal(p.status_reason, 'NO_DRIVER_FOUND');
  assert.equal((await call('GET', `/bookings/${b.booking_id}`, { token: kh1 })).body.status, 'NO_DRIVER_FOUND');
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === b.payment_id);
  assert.ok(list.some((n) => n.type === 'NO_DRIVER_FOUND' && n.data.booking_id === b.booking_id));
  assert.ok(list.some((n) => n.type === 'PAYMENT_REFUNDED' && n.data.payment_id === b.payment_id));
  const c = await book201(kh1, { from: FAR_FROM, to: FAR_TO });
  const pc = await waitPayment(c.payment_id, 'CANCELED', 3000);
  assert.equal(pc.status, 'CANCELED', JSON.stringify(pc));
  assert.equal(pc.status_reason, 'NO_DRIVER_FOUND');
});

test('AC-HT-03 (BRULE15, AC23): chuyến ONLINE đã trả → COMPLETED: payment giữ COMPLETED, không REFUND, không K6 REFUNDED; booking CASH bị TX1 từ chối: payment giữ PENDING', async () => {
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const c = await newTrip(kh1, tx1, { online: true });
  await advance(c.trip_id, tx1, 'ACCEPTED', 'COMPLETED');
  assert.equal(await waitDriverFree(11, 3000), 'ONLINE:-');
  await sleep(1500);
  const p = await payment(c.payment_id);
  assert.equal(p.status, 'COMPLETED');
  assert.ok(!p.transactions.some((x) => x.type === 'REFUND'));
  const k6 = (await kafkaNew('payment.status-changed', snapK6)).filter((m) => m.key === String(c.booking_id) && m.content.data.status === 'REFUNDED');
  assert.equal(k6.length, 0);
  await drainAllTestBookings();
  const b = await book201(kh1);
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o);
  const rj = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1, body: { status: 'REJECTED' } });
  assert.equal(rj.status, 200);
  await sleep(1000);
  const pb = await payment(b.payment_id);
  assert.equal(pb.status, 'PENDING');
  assert.deepEqual(pb.transactions, []);
  await drainBooking(b.booking_id);
});

test('AC-HT-05 (D9): TX1 BUSY cho booking X; Produce K5 COMPLETED driver_id 11, booking_id ≠ X → TX1 vẫn BUSY với X', async () => {
  const c = await newTrip(kh1, tx1);
  assert.equal(driversDb('select availability || \':\' || current_booking_id from drivers where driver_id = 11'), `BUSY:${c.booking_id}`);
  const fake = {
    event_id: `qa-${Date.now()}-d9`, event_type: 'trip.status-changed', occurred_at: new Date().toISOString(),
    data: { trip_id: 990001, booking_id: 990001, customer_id: 990001, driver_id: 11, status: 'COMPLETED', previous_status: 'IN_PROGRESS' },
  };
  await kafkaProduce('trip.status-changed', { key: '990001', content: JSON.stringify(fake) });
  await sleep(2500);
  assert.equal(driversDb('select availability || \':\' || current_booking_id from drivers where driver_id = 11'), `BUSY:${c.booking_id}`);
  await advance(c.trip_id, tx1, 'ACCEPTED', 'COMPLETED');
  assert.equal(await waitDriverFree(11, 3000), 'ONLINE:-');
});

test('AC-TB-03 (mục 19, AC13 — vế thanh toán): A31 FAILED trên payment ONLINE mới → KH1 có PAYMENT_FAILED', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  const f = await payNow(kh1, b.payment_id, 'k1', { simulate_result: 'FAILED' });
  assert.equal(f.status, 200, f.text);
  assert.equal(f.body.status, 'FAILED');
  const list = await waitNote(kh1, (n) => n.type === 'PAYMENT_FAILED' && n.data.payment_id === b.payment_id);
  const n = list.find((x) => x.type === 'PAYMENT_FAILED' && x.data.payment_id === b.payment_id);
  assert.ok(n, 'KH1 có PAYMENT_FAILED');
  assert.equal(n.body, `Thanh toán ${b.payment_id} thất bại, bạn có thể thử lại`);
  // Dọn: hủy booking chờ thanh toán.
  await call('PATCH', `/bookings/${b.booking_id}`, { token: kh1, body: { status: 'CANCELED', reason: 'don' } });
});

// ---------- A33: phân trang, quyền ----------
test('AC-TB-04 (mục 16, 18, N2): ?limit=1 → 1 mục, total > 1; &page=2 → mục kế tiếp; limit=abc, page=0 → INVALID_PAGINATION; foo=1 → INVALID_INPUT; AD1 → []; KH2 chỉ thấy thông báo của mình; không token → 401', async () => {
  const all = await notes(kh1, '?limit=2');
  const a = await notes(kh1, '?limit=1');
  assert.equal(a.data.length, 1);
  assert.ok(a.pagination.total > 1);
  assert.deepEqual(a.pagination, { page: 1, limit: 1, total: a.pagination.total, total_pages: a.pagination.total });
  assert.deepEqual(a.data[0], all.data[0]);
  const b = await notes(kh1, '?limit=1&page=2');
  assert.deepEqual(b.data[0], all.data[1]);
  for (const [q, code] of [['?limit=abc', 'INVALID_PAGINATION'], ['?page=0', 'INVALID_PAGINATION'], ['?limit=51', 'INVALID_PAGINATION'], ['?foo=1', 'INVALID_INPUT']]) {
    const r = await call('GET', `/notifications${q}`, { token: kh1 });
    assert.equal(r.status, 400, q);
    assert.deepEqual(r.body, { error: code }, q);
  }
  const ad = await notes(ad1);
  assert.deepEqual(ad.data, []);
  assert.equal(ad.pagination.total, 0);
  const k2 = await notes(kh2);
  const kh2Bookings = new Set(bookingsDb('select booking_id from bookings where customer_id = 2').split(/\r?\n/).filter(Boolean).map(Number));
  for (const n of k2.data) {
    if (n.data.booking_id !== undefined) assert.ok(kh2Bookings.has(n.data.booking_id), `KH2 thấy thông báo booking ${n.data.booking_id}`);
  }
  const no = await call('GET', '/notifications');
  assert.equal(no.status, 401);
  assert.deepEqual(no.body, { error: 'TOKEN_MISSING' });
});

test('AC-TB-07 (mục 7): consumer group booking-, driver-, payment-, notification-service có trên Kafka UI, lag 0; K5 có ARRIVED…CANCELED; message mới không chứa lý do hủy, tọa độ, họ tên', async () => {
  const groups = await waitFor(consumerGroups, (gs) => Array.isArray(gs)
    && ['booking-service', 'driver-service', 'payment-service', 'notification-service'].every((g) => gs.some((x) => x.groupId === g && x.consumerLag === 0)),
  { timeoutMs: 10_000, intervalMs: 1000 });
  for (const g of ['booking-service', 'driver-service', 'payment-service', 'notification-service']) {
    const x = groups.find((y) => y.groupId === g);
    assert.ok(x, `thiếu group ${g}`);
    assert.equal(x.consumerLag, 0, `${g} lag ${x.consumerLag}`);
  }
  assert.equal(groups.find((y) => y.groupId === 'notification-service').topics, 7);
  assert.equal(groups.find((y) => y.groupId === 'payment-service').topics, 3);
  const k5 = await kafkaNew('trip.status-changed', S.snap['trip.status-changed']);
  const statuses = new Set(k5.map((m) => m.content?.data?.status));
  for (const s of ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']) assert.ok(statuses.has(s), `K5 thiếu ${s}`);
  for (const t of TOPICS) {
    for (const m of await kafkaNew(t, S.snap[t])) {
      for (const bad of ['ban viec', 'xe hong', 'doi y', '10.82', '106.68', 'Nguyễn', '"from"', '"to"']) {
        assert.ok(!m.raw.includes(bad), `${t} ${m.key} chứa "${bad}"`);
      }
    }
  }
});

test('AC-TB-08 (NFR08, NFR10): log notification-service có notification_created; trip-service có trip_status_changed, trip_canceled; không có title, body, reason', () => {
  const n = compose('logs', '--no-log-prefix', 'notification-service');
  const t = compose('logs', '--no-log-prefix', 'trip-service');
  assert.match(n.stdout, /notification_created/);
  assert.match(t.stdout, /trip_status_changed/);
  assert.match(t.stdout, /trip_canceled/);
  for (const line of [...n.stdout.split(/\r?\n/), ...t.stdout.split(/\r?\n/)]) {
    if (!line.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    for (const k of ['title', 'body', 'reason', 'cancel_reason']) assert.ok(!(k in o), `log có key ${k}: ${line.slice(0, 160)}`);
    for (const bad of ['ban viec', 'xe hong', 'doi y', 'Đã hoàn']) assert.ok(!line.includes(bad), `log chứa "${bad}"`);
  }
  // Mã nhận được ở psql để chắc log không phải rỗng do container mới khởi động.
  assert.ok(psql('trip-db', 'trip', 'select count(*) from trips') !== '0');
});

// Ghi nhận (không phải AC): message Kafka giữ qua các lần đặt lại database — chỉ đọc message mới so với ảnh chụp.
test('Kiểm tra phụ: kafkaMessages đọc được topic trip.status-changed', async () => {
  assert.ok((await kafkaMessages('trip.status-changed')).length > 0);
});
