// Spec 14-15-16-19-30 — thanh toán online + callback → COMPLETED (mục 19), replay → response cũ (mục 30),
// phong bì event K1–K6 (mục 7). AC-TT-01…12, 14. AC-TT-13 (dừng booking-service) ở 91-dung-service-dat-xe.test.js.
//
// Tiền điều kiện: seed B7 = payment 7 (KH1, CAR_7, ONLINE, PENDING, chưa có giao dịch); TX4 rảnh, không có
// Offer chờ. AC-TT-01…06 nối tiếp nhau trên payment 7 (giống chuỗi gõ tay mục 19 → 30). Các AC khác tạo
// booking ONLINE mới của KH1. Hết hạn thanh toán (AC-TT-10): không đổi `.env`, dùng
// `UPDATE payments SET expires_at = now()` để tiến trình nền (mỗi 1 giây) tự xử lý.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CALLBACK_SECRET, SEED, call, kafkaMessages, tokenOf } from './api.js';
import {
  FAR_FROM, FAR_TO, book201, bookingsDb, drainAllTestBookings, drainBooking, kafkaNew, kafkaSnapshot, paymentsDb,
  waitBookingStatus, waitKafkaNew, waitOffer,
} from './dat-xe.js';
import { sleep, waitFor } from './helpers.js';

const SECRET = CALLBACK_SECRET;
let kh1, kh2, tx1, tx4, ad1;
const S = {};

// key / secret = null → không gửi header đó.
const pay = (id, { key = 'k1', body, token = kh1, headers = {} } = {}) => call('POST', `/payments/${id}/transactions`, {
  token, body, headers: key === null ? headers : { 'Idempotency-Key': key, ...headers },
});
const callback = (body, { secret = SECRET, headers = {} } = {}) => call('POST', '/payment-callbacks', {
  body, headers: secret === null ? headers : { 'X-Callback-Secret': secret, ...headers },
});
const k6Of = (bookingId) => (m) => m.key === String(bookingId);

before(async () => {
  [kh1, kh2, tx1, tx4, ad1] = await Promise.all([SEED.KH1, SEED.KH2, SEED.TX1, '0910000004', SEED.AD1].map((p) => tokenOf(p)));
  assert.equal(paymentsDb('select status from payments where payment_id = 7'), 'PENDING',
    'Tiền điều kiện: payment 7 PENDING (seed). Đặt lại payment-db / booking-db về seed rồi chạy lại.');
  assert.equal(paymentsDb('select count(*) from payment_transactions where payment_id = 7'), '0');
  assert.equal(bookingsDb('select status from bookings where booking_id = 7'), 'PENDING_PAYMENT');
  assert.equal(bookingsDb("select count(*) from driver_offers where driver_id = 14 and status = 'PENDING'"), '0', 'TX4 không có Offer chờ');
});

after(async () => {
  await drainAllTestBookings();
  // Booking 7 sau AC-TT-02 đang mời TX4 → TX4 từ chối để rảnh (drainAllTestBookings chỉ dọn mã ≥ 1000).
  await drainBooking(7);
});

// ---------- Mục 19 → 30 trên payment 7 ----------
test('AC-TT-01 (mục 19): A31 payments/7/transactions [KH1] k1 MANUAL → 200 PENDING, SIM-7-1, attempt 1, attempts_left 2; không có K6 mới; booking 7 PENDING_PAYMENT', async (tt) => {
  S.snapK6 = await kafkaSnapshot('payment.status-changed');
  const r = await pay(7, { body: { simulate_result: 'MANUAL' } });
  assert.equal(r.status, 200, r.text);
  tt.diagnostic(`response: ${r.text}`);
  assert.equal(r.headers.get('idempotency-replayed'), null);
  assert.deepEqual(Object.keys(r.body).sort(), ['attempt_no', 'attempts_left', 'expires_at', 'payment_id', 'status', 'txn_id', 'txn_status']);
  assert.deepEqual({ ...r.body, expires_at: undefined }, {
    payment_id: 7, status: 'PENDING', txn_id: 'SIM-7-1', txn_status: 'PENDING', attempt_no: 1, attempts_left: 2, expires_at: undefined,
  });
  assert.ok(Date.parse(r.body.expires_at) > Date.now(), 'expires_at còn hạn');
  S.first = r;
  await sleep(1500);
  const k6 = (await kafkaNew('payment.status-changed', S.snapK6)).filter(k6Of(7));
  assert.equal(k6.length, 0, 'MANUAL: chưa có kết quả → không phát K6');
  const b = await call('GET', '/bookings/7', { token: kh1 });
  assert.equal(b.body.status, 'PENDING_PAYMENT');
  assert.equal(paymentsDb("select status || '|' || provider_transaction_id || '|' || type from payment_transactions where payment_id = 7"), 'PENDING|SIM-7-1|CHARGE');
});

test('AC-TT-02 (mục 19, AC12, AC21): A32 không token, X-Callback-Secret, {"txn_id":"SIM-7-1"} → 200 SUCCEEDED / COMPLETED; K6 key 7 COMPLETED (previous PENDING); booking 7 SEARCHING; TX4 có Offer 445 m', async (tt) => {
  const r = await callback({ txn_id: 'SIM-7-1' });
  assert.equal(r.status, 200, r.text);
  tt.diagnostic(`response: ${r.text}`);
  assert.equal(r.headers.get('idempotency-replayed'), null);
  assert.deepEqual(r.body, { txn_id: 'SIM-7-1', txn_status: 'SUCCEEDED', payment_id: 7, status: 'COMPLETED' });
  S.cb = r;
  const k6 = await waitKafkaNew('payment.status-changed', S.snapK6, k6Of(7));
  assert.equal(k6.length, 1, 'đúng một K6 mới cho booking 7');
  assert.equal(k6[0].content.data.status, 'COMPLETED');
  assert.equal(k6[0].content.data.previous_status, 'PENDING');
  assert.equal(k6[0].content.data.payment_id, 7);
  assert.equal(k6[0].content.data.amount, 56000);
  assert.equal(await waitBookingStatus(7, 'SEARCHING'), 'SEARCHING');
  const g = await call('GET', '/bookings/7', { token: kh1 });
  assert.equal(g.body.status, 'SEARCHING');
  const o = await waitOffer(tx4, 7);
  assert.ok(o, 'TX4 có Offer cho booking 7 trong 2 giây');
  assert.equal(o.distance_m, 445);
  assert.equal(o.pay, 'ONLINE');
  assert.equal(o.fare, 56000);
});

test('AC-TT-03 (mục 30): gửi lại y hệt AC-TT-01 → 200 body y hệt (PENDING) + Idempotency-Replayed: true; payment 7 vẫn 1 giao dịch', async () => {
  const r = await pay(7, { body: { simulate_result: 'MANUAL' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('idempotency-replayed'), 'true');
  assert.equal(r.text, S.first.text, 'body y hệt lần đầu');
  assert.equal(r.body.replayed, undefined);
  assert.equal(paymentsDb('select count(*) from payment_transactions where payment_id = 7'), '1');
});

test('AC-TT-04 (mục 30): gửi lại y hệt AC-TT-02 → 200 body y hệt + Idempotency-Replayed: true; số K6 không tăng', async () => {
  const before = await kafkaSnapshot('payment.status-changed');
  const r = await callback({ txn_id: 'SIM-7-1' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('idempotency-replayed'), 'true');
  assert.equal(r.text, S.cb.text);
  await sleep(1500);
  assert.equal((await kafkaNew('payment.status-changed', before)).length, 0, 'replay callback không phát lại K6');
  assert.equal(paymentsDb("select status from payment_transactions where provider_transaction_id = 'SIM-7-1'"), 'SUCCEEDED');
});

test('AC-TT-05 (mục 30): A30 payments/7 [KH1] → COMPLETED 56000, fare {2026, 25000, 15000, 40000}, paid_at; đúng một giao dịch; không field thẻ', async (tt) => {
  const r = await call('GET', '/payments/7', { token: kh1 });
  assert.equal(r.status, 200, r.text);
  tt.diagnostic(r.text);
  assert.equal(r.body.payment_id, 7);
  assert.equal(r.body.booking_id, 7);
  assert.equal(r.body.method, 'ONLINE');
  assert.equal(r.body.status, 'COMPLETED');
  assert.equal(r.body.amount, 56000);
  assert.equal(r.body.fare.base_fare, 25000);
  assert.equal(r.body.fare.per_km_rate, 15000);
  assert.equal(r.body.fare.min_fare, 40000);
  assert.ok(Math.abs(r.body.fare.distance_m - 2026) <= 3, `distance_m ${r.body.fare.distance_m}`);
  assert.ok(r.body.paid_at);
  assert.ok(r.body.expires_at);
  assert.deepEqual(r.body.transactions, [{ txn_id: 'SIM-7-1', type: 'CHARGE', attempt_no: 1, status: 'SUCCEEDED', amount: 56000 }]);
  const allowed = ['payment_id', 'booking_id', 'method', 'status', 'amount', 'fare', 'status_reason', 'expires_at', 'paid_at', 'refunded_at', 'transactions'];
  for (const k of Object.keys(r.body)) assert.ok(allowed.includes(k), `field lạ ${k}`);
  assert.doesNotMatch(r.text, /card|account_number|callback_response|customer_id/i);
});

test('AC-TT-06 (mục 30, 409/400): k1 + FAILED → 409 IDEMPOTENCY_KEY_REUSED; k1 + manual → 200 replay; k2 → 409 PAYMENT_ALREADY_COMPLETED; thiếu / rỗng / quá dài header → 400', async () => {
  const a = await pay(7, { body: { simulate_result: 'FAILED' } });
  assert.equal(a.status, 409, a.text);
  assert.deepEqual(a.body, { error: 'IDEMPOTENCY_KEY_REUSED' });
  const b = await pay(7, { body: { simulate_result: 'manual' } });
  assert.equal(b.status, 200, b.text);
  assert.equal(b.headers.get('idempotency-replayed'), 'true');
  assert.equal(b.text, S.first.text);
  const k1empty = await pay(7, {});
  assert.equal(k1empty.status, 409, `k1 body rỗng (khác body lần đầu): ${k1empty.text}`);
  assert.deepEqual(k1empty.body, { error: 'IDEMPOTENCY_KEY_REUSED' });
  const c = await pay(7, { key: 'k2' });
  assert.equal(c.status, 409, c.text);
  assert.deepEqual(c.body, { error: 'PAYMENT_ALREADY_COMPLETED' });
  const d = await pay(7, { key: null });
  assert.equal(d.status, 400, d.text);
  assert.deepEqual(d.body, { error: 'IDEMPOTENCY_KEY_REQUIRED' });
  for (const key of ['   ', 'x'.repeat(101)]) {
    const e = await pay(7, { key });
    assert.equal(e.status, 400, `khóa "${key.slice(0, 5)}…" → ${e.status}`);
    assert.deepEqual(e.body, { error: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  assert.equal(paymentsDb('select count(*) from payment_transactions where payment_id = 7'), '1');
});

// ---------- Mục 19: các nhánh khác ----------
test('AC-TT-07 (mục 19, mặc định): booking ONLINE CAR_4 mới [KH1]; A31 k1 body rỗng → 200 COMPLETED, SIM-P-1, SUCCEEDED; ≈ 1 s sau booking SEARCHING và có Offer', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  assert.equal(b.status, 'PENDING_PAYMENT');
  const r = await pay(b.payment_id, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'COMPLETED');
  assert.equal(r.body.txn_id, `SIM-${b.payment_id}-1`);
  assert.equal(r.body.txn_status, 'SUCCEEDED');
  assert.equal(r.body.attempt_no, 1);
  assert.equal(await waitBookingStatus(b.booking_id, 'SEARCHING'), 'SEARCHING');
  const o = await waitOffer(tx1, b.booking_id);
  assert.ok(o, 'TX1 có Offer sau khi thanh toán');
  assert.equal(await drainBooking(b.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-TT-08 (mục 19, AC13, AC25, BRULE17): k1, k2, k3 FAILED → FAILED (2), FAILED (1), CANCELED (0); K6 FAILED, FAILED, CANCELED ATTEMPTS_EXHAUSTED; booking.canceled system; booking CANCELED; k4 → 409 PAYMENT_ATTEMPTS_EXHAUSTED', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const snapK4 = await kafkaSnapshot('booking.canceled');
  const r1 = await pay(b.payment_id, { key: 'k1', body: { simulate_result: 'FAILED' } });
  assert.equal(r1.status, 200, r1.text);
  assert.deepEqual([r1.body.status, r1.body.txn_status, r1.body.attempt_no, r1.body.attempts_left], ['FAILED', 'FAILED', 1, 2]);
  await sleep(1000);
  assert.equal(bookingsDb(`select status from bookings where booking_id = ${b.booking_id}`), 'PENDING_PAYMENT', 'B16: thất bại chưa hết lượt → booking vẫn chờ');
  const r2 = await pay(b.payment_id, { key: 'k2', body: { simulate_result: 'FAILED' } });
  assert.equal(r2.status, 200, r2.text);
  assert.deepEqual([r2.body.status, r2.body.attempt_no, r2.body.attempts_left], ['FAILED', 2, 1]);
  const r3 = await pay(b.payment_id, { key: 'k3', body: { simulate_result: 'FAILED' } });
  assert.equal(r3.status, 200, r3.text);
  assert.deepEqual([r3.body.status, r3.body.txn_status, r3.body.attempt_no, r3.body.attempts_left], ['CANCELED', 'FAILED', 3, 0]);
  assert.equal(await waitBookingStatus(b.booking_id, 'CANCELED'), 'CANCELED');
  const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
  assert.equal(g.body.status, 'CANCELED');
  assert.equal(g.body.canceled_by, 'system');
  assert.equal(g.body.cancel_reason, 'ATTEMPTS_EXHAUSTED');
  const k6 = await waitFor(
    async () => (await kafkaNew('payment.status-changed', snapK6)).filter(k6Of(b.booking_id)),
    (l) => l.length >= 3, { timeoutMs: 5000, intervalMs: 500 },
  );
  assert.deepEqual(k6.map((m) => m.content.data.status), ['FAILED', 'FAILED', 'CANCELED']);
  assert.equal(k6[2].content.data.reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(k6[0].content.data.reason, undefined);
  const k4 = await waitKafkaNew('booking.canceled', snapK4, k6Of(b.booking_id));
  assert.equal(k4.length, 1);
  assert.deepEqual(k4[0].content.data, {
    booking_id: b.booking_id, customer_id: 1, canceled_by: 'system', previous_status: 'PENDING_PAYMENT',
    pending_offer_driver_id: null, reason: 'ATTEMPTS_EXHAUSTED',
  });
  const r4 = await pay(b.payment_id, { key: 'k4' });
  assert.equal(r4.status, 409, r4.text);
  assert.deepEqual(r4.body, { error: 'PAYMENT_ATTEMPTS_EXHAUSTED' });
  const p = await call('GET', `/payments/${b.payment_id}`, { token: kh1 });
  assert.equal(p.body.status, 'CANCELED');
  assert.equal(p.body.status_reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(p.body.transactions.length, 3);
});

test('AC-TT-09 (mục 19, DX9): k1 MANUAL → PENDING; k2 → 409 PAYMENT_IN_PROGRESS; A32 SIM-R-1 FAILED → FAILED; k2 lại → 200 COMPLETED attempt 2', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  const R = b.payment_id;
  const r1 = await pay(R, { key: 'k1', body: { simulate_result: 'MANUAL' } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.status, 'PENDING');
  const r2 = await pay(R, { key: 'k2' });
  assert.equal(r2.status, 409, r2.text);
  assert.deepEqual(r2.body, { error: 'PAYMENT_IN_PROGRESS' });
  const cb = await callback({ txn_id: `SIM-${R}-1`, result: 'FAILED' });
  assert.equal(cb.status, 200, cb.text);
  assert.deepEqual(cb.body, { txn_id: `SIM-${R}-1`, txn_status: 'FAILED', payment_id: R, status: 'FAILED' });
  const r3 = await pay(R, { key: 'k2' });
  assert.equal(r3.status, 200, r3.text);
  assert.equal(r3.headers.get('idempotency-replayed'), null, 'khóa k2 bị từ chối trước đó không được lưu');
  assert.equal(r3.body.status, 'COMPLETED');
  assert.equal(r3.body.attempt_no, 2);
  assert.equal(r3.body.txn_id, `SIM-${R}-2`);
  assert.equal(await waitBookingStatus(b.booking_id, 'SEARCHING'), 'SEARCHING');
  await sleep(500);
  assert.equal(await drainBooking(b.booking_id), 'NO_DRIVER_FOUND');
});

test('AC-TT-10 (mục 19, AC25, M11): k1 MANUAL; hết hạn (UPDATE expires_at = now()) → CANCELED PAYMENT_EXPIRED; booking CANCELED system; k2 → 409 PAYMENT_EXPIRED; callback muộn → SUCCEEDED, REFUNDED; có giao dịch REFUND', async () => {
  const b = await book201(kh1, { pay: 'ONLINE' });
  const P = b.payment_id;
  const snapK6 = await kafkaSnapshot('payment.status-changed');
  const r1 = await pay(P, { key: 'k1', body: { simulate_result: 'MANUAL' } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.status, 'PENDING');
  paymentsDb(`update payments set expires_at = now() where payment_id = ${P}`);
  const p = await waitFor(
    () => call('GET', `/payments/${P}`, { token: kh1 }),
    (x) => x?.body?.status === 'CANCELED', { timeoutMs: 3000, intervalMs: 300 },
  );
  assert.equal(p.body.status, 'CANCELED', p.text);
  assert.equal(p.body.status_reason, 'PAYMENT_EXPIRED');
  assert.equal(await waitBookingStatus(b.booking_id, 'CANCELED'), 'CANCELED');
  const g = await call('GET', `/bookings/${b.booking_id}`, { token: kh1 });
  assert.equal(g.body.canceled_by, 'system');
  assert.equal(g.body.cancel_reason, 'PAYMENT_EXPIRED');
  const r2 = await pay(P, { key: 'k2' });
  assert.equal(r2.status, 409, r2.text);
  assert.deepEqual(r2.body, { error: 'PAYMENT_EXPIRED' });
  const cb = await callback({ txn_id: `SIM-${P}-1` });
  assert.equal(cb.status, 200, cb.text);
  assert.deepEqual(cb.body, { txn_id: `SIM-${P}-1`, txn_status: 'SUCCEEDED', payment_id: P, status: 'REFUNDED' });
  const after = await call('GET', `/payments/${P}`, { token: kh1 });
  assert.equal(after.body.status, 'REFUNDED');
  assert.ok(after.body.refunded_at);
  assert.ok(after.body.paid_at);
  assert.equal(after.body.status_reason, 'PAYMENT_EXPIRED');
  assert.deepEqual(after.body.transactions.map((t) => [t.txn_id, t.type, t.status]), [
    [`SIM-${P}-1`, 'CHARGE', 'SUCCEEDED'], [`SIM-R-${P}`, 'REFUND', 'SUCCEEDED'],
  ]);
  const k6 = await waitFor(
    async () => (await kafkaNew('payment.status-changed', snapK6)).filter(k6Of(b.booking_id)),
    (l) => l.length >= 2, { timeoutMs: 5000, intervalMs: 500 },
  );
  assert.deepEqual(k6.map((m) => m.content.data.status), ['CANCELED', 'REFUNDED']);
  assert.equal(k6[0].content.data.reason, 'PAYMENT_EXPIRED');
  // Booking đã hủy: không bị đưa lại SEARCHING bởi K6 REFUNDED.
  assert.equal(bookingsDb(`select status from bookings where booking_id = ${b.booking_id}`), 'CANCELED');
});

test('AC-TT-11 (mục 19, 401/404/400): callback sai khóa / thiếu khóa → 401; SIM-999-1 → 404; {} / result OK / amount lệch / không phải JSON → 400', async () => {
  const wrong = await callback({ txn_id: 'SIM-7-1' }, { secret: 'sai' });
  assert.equal(wrong.status, 401, wrong.text);
  assert.deepEqual(wrong.body, { error: 'INVALID_CALLBACK_SECRET' });
  const none = await callback({ txn_id: 'SIM-7-1' }, { secret: null });
  assert.equal(none.status, 401, `không header: ${none.text}`);
  assert.deepEqual(none.body, { error: 'INVALID_CALLBACK_SECRET' });
  const longer = await callback({ txn_id: 'SIM-7-1' }, { secret: `${SECRET}x` });
  assert.equal(longer.status, 401, `khóa dài hơn: ${longer.text}`);
  const empty = await callback({ txn_id: 'SIM-7-1' }, { secret: '' });
  assert.equal(empty.status, 401, `khóa rỗng: ${empty.text}`);
  const nf = await callback({ txn_id: 'SIM-999-1' });
  assert.equal(nf.status, 404, nf.text);
  assert.deepEqual(nf.body, { error: 'TRANSACTION_NOT_FOUND' });
  for (const body of [{}, { txn_id: 'SIM-7-1', result: 'OK' }, { txn_id: 'SIM-7-1', amount: 1 }, { txn_id: 7 },
    { txn_id: 'SIM-7-1', amount: -5 }, { txn_id: 'SIM-7-1', foo: 1 }]) {
    const r = await callback(body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: 'INVALID_INPUT' }, JSON.stringify(body));
  }
  const nj = await callback('{hong');
  assert.equal(nj.status, 400);
  assert.deepEqual(nj.body, { error: 'INVALID_JSON' });
  // Kèm token Bearer không ảnh hưởng; amount đúng → replay 200.
  const withTok = await call('POST', '/payment-callbacks', {
    token: kh1, body: { txn_id: 'SIM-7-1', amount: 56000 }, headers: { 'X-Callback-Secret': SECRET },
  });
  assert.equal(withTok.status, 200, withTok.text);
  assert.equal(withTok.headers.get('idempotency-replayed'), 'true');
});

test('AC-TT-12 (mục 19, 30, 403/404/409/400): payments/7 [KH2] A30, A31 → 403 NOT_OWNER; 999 → 404; abc → 400; [TX1] → 403; [AD1] A30 200, A31 403; CASH → 409 PAYMENT_NOT_ONLINE; simulate_result X → 400', async () => {
  const a = await call('GET', '/payments/7', { token: kh2 });
  assert.equal(a.status, 403);
  assert.deepEqual(a.body, { error: 'NOT_OWNER' });
  const b = await pay(7, { token: kh2, key: 'k9' });
  assert.equal(b.status, 403, b.text);
  assert.deepEqual(b.body, { error: 'NOT_OWNER' });
  const nf = await call('GET', '/payments/999', { token: kh1 });
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: 'PAYMENT_NOT_FOUND' });
  const nf2 = await pay(999, { key: 'k9' });
  assert.equal(nf2.status, 404);
  assert.deepEqual(nf2.body, { error: 'PAYMENT_NOT_FOUND' });
  const bad = await call('GET', '/payments/abc', { token: kh1 });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'INVALID_ID' });
  const bad2 = await pay('abc', { key: 'k9' });
  assert.equal(bad2.status, 400);
  assert.deepEqual(bad2.body, { error: 'INVALID_ID' });
  const t = await call('GET', '/payments/7', { token: tx1 });
  assert.equal(t.status, 403);
  assert.deepEqual(t.body, { error: 'FORBIDDEN' });
  const ad = await call('GET', '/payments/7', { token: ad1 });
  assert.equal(ad.status, 200);
  assert.equal(ad.body.payment_id, 7);
  const adPay = await pay(7, { token: ad1, key: 'k9' });
  assert.equal(adPay.status, 403);
  assert.deepEqual(adPay.body, { error: 'FORBIDDEN' });
  const txPay = await pay(7, { token: tx1, key: 'k9' });
  assert.equal(txPay.status, 403);
  const noTok = await call('GET', '/payments/7');
  assert.equal(noTok.status, 401);
  assert.deepEqual(noTok.body, { error: 'TOKEN_MISSING' });
  // Thanh toán tiền mặt: booking xa (không có tài xế) để không giữ tài xế nào.
  const cash = await book201(kh1, { from: FAR_FROM, to: FAR_TO });
  const c = await pay(cash.payment_id, { key: 'k1' });
  assert.equal(c.status, 409, c.text);
  assert.deepEqual(c.body, { error: 'PAYMENT_NOT_ONLINE' });
  for (const body of [{ simulate_result: 'X' }, { simulate_result: 1 }, { foo: 1 }]) {
    const x = await pay(7, { key: 'k8', body });
    assert.equal(x.status, 400, `${JSON.stringify(body)} → ${x.text}`);
    assert.deepEqual(x.body, { error: 'INVALID_INPUT' });
  }
  const nj = await pay(7, { key: 'k8', body: '{hong' });
  assert.equal(nj.status, 400);
  assert.deepEqual(nj.body, { error: 'INVALID_JSON' });
});

// ---------- Mục 7: phong bì event ----------
test('AC-TT-14 (mục 7): message mới nhất mỗi topic K1–K6 đúng phong bì {event_id, event_type, occurred_at, data}; data đúng field; không họ tên, số điện thoại, tọa độ, địa chỉ', async () => {
  const expected = {
    'booking.created': ['booking_id', 'customer_id', 'payment_method', 'status', 'vehicle_type'],
    'booking.offer-created': ['booking_id', 'driver_id', 'expires_at', 'offer_id'],
    'booking.no-driver-found': ['booking_id', 'customer_id', 'offers_tried'],
    'booking.canceled': ['booking_id', 'canceled_by', 'customer_id', 'pending_offer_driver_id', 'previous_status', 'reason'],
    'trip.status-changed': ['booking_id', 'customer_id', 'driver_id', 'previous_status', 'status', 'trip_id'],
    'payment.status-changed': ['amount', 'booking_id', 'customer_id', 'method', 'payment_id', 'previous_status', 'status'],
  };
  for (const [topic, keys] of Object.entries(expected)) {
    const msgs = await kafkaMessages(topic);
    assert.ok(msgs.length > 0, `${topic} có message`);
    const m = msgs.at(-1);
    const e = m.content;
    assert.deepEqual(Object.keys(e).sort(), ['data', 'event_id', 'event_type', 'occurred_at'], topic);
    assert.match(e.event_id, /^[0-9a-f-]{36}$/, topic);
    assert.equal(e.event_type, topic);
    assert.ok(!Number.isNaN(Date.parse(e.occurred_at)) && e.occurred_at.endsWith('Z'), `${topic} occurred_at`);
    const dataKeys = Object.keys(e.data).filter((k) => !(topic === 'payment.status-changed' && k === 'reason')).sort();
    assert.deepEqual(dataKeys, keys, topic);
    if (topic === 'payment.status-changed') assert.equal('reason' in e.data, e.data.status === 'CANCELED', 'reason chỉ khi CANCELED');
    assert.equal(m.key, String(topic.startsWith('trip') ? e.data.trip_id : e.data.booking_id), `${topic} key`);
    assert.doesNotMatch(m.raw, /(?<![0-9a-f])0[0-9]{9}(?![0-9a-f])|10\.8|106\.6|"(lat|lng|name|full_name|phone|address|from|to)"/i, `${topic}: không dữ liệu cá nhân / tọa độ`);
  }
});
