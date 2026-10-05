// Unit test logic thanh toán (spec 14-15-16-19-30 mục 4.7–4.9, 5.7) với kho giả trong bộ nhớ, adapter giả lập
// thật, bộ phát event giả: không cần PostgreSQL, Kafka hay gRPC. Kho giả mô phỏng giao dịch bằng cách chụp lại
// dữ liệu trước khi chạy và trả về bản chụp khi có lỗi (ROLLBACK).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentLogic, TOPIC_PAYMENT_STATUS_CHANGED } from '../src/domain/payments.js';
import { createSimulatedProvider } from '../src/adapters/provider-sim.js';
import { requestHash, secretMatches } from '../src/domain/rules.js';

const SYSTEM = { role: 'system' };
const KH1 = { accountId: '1', role: 'customer' };
const KH2 = { accountId: '2', role: 'customer' };
const AD1 = { accountId: '99', role: 'admin' };
const RATES = {
  CAR_4: { vehicle_type: 'CAR_4', base_fare: 20000, per_km_rate: 12000, min_fare: 30000 },
  CAR_7: { vehicle_type: 'CAR_7', base_fare: 25000, per_km_rate: 15000, min_fare: 40000 },
};

function fakeRepo() {
  let db = { fares: [], payments: [], txns: [], keys: [], nextId: 1000 };
  const expired = (p) => p.expires_at !== null && p.expires_at <= Date.now();
  const view = (p) => ({ ...p, expired: expired(p) });
  const stmts = () => ({
    async findPaymentByBooking(bookingId) { const p = db.payments.find((x) => x.booking_id === bookingId); return p ? view(p) : null; },
    async findRate(v) { return RATES[v] ?? null; },
    async insertFare(f) { const fareId = db.nextId++; db.fares.push({ fare_id: fareId, ...f }); return fareId; },
    async insertPayment({ bookingId, fareId, customerId, method, amount, timeoutSeconds }) {
      const p = {
        payment_id: db.nextId++, booking_id: bookingId, fare_id: fareId, customer_id: customerId, method, amount, status: 'PENDING',
        status_reason: null, expires_at: timeoutSeconds === null ? null : Date.now() + timeoutSeconds * 1000, paid_at: null, refunded_at: null,
      };
      db.payments.push(p);
      return view(p);
    },
    async lockPayment(id) { const p = db.payments.find((x) => x.payment_id === id); return p ? view(p) : null; },
    async lockPaymentByBooking(bookingId) { const p = db.payments.find((x) => x.booking_id === bookingId); return p ? view(p) : null; },
    async findIdempotencyKey(id, key) { return db.keys.find((k) => k.payment_id === id && k.key === key) ?? null; },
    async insertIdempotencyKey(id, key, hash) { db.keys.push({ payment_id: id, key, request_hash: hash, response: null }); },
    async saveIdempotencyResponse(id, key, response) { db.keys.find((k) => k.payment_id === id && k.key === key).response = structuredClone(response); },
    async chargeSummary(id) {
      const charges = db.txns.filter((t) => t.payment_id === id && t.type === 'CHARGE');
      return { count: charges.length, pending: charges.some((t) => t.status === 'PENDING') };
    },
    async insertCharge({ paymentId, attemptNo, txnId, amount }) {
      const t = { transaction_id: db.nextId++, payment_id: paymentId, type: 'CHARGE', attempt_no: attemptNo, provider_transaction_id: txnId, amount, status: 'PENDING', callback_response: null };
      db.txns.push(t);
      return { ...t };
    },
    async lockTransaction(txnId) { const t = db.txns.find((x) => x.provider_transaction_id === txnId); return t ? { ...t } : null; },
    async finishTransaction(id, status, response) { Object.assign(db.txns.find((t) => t.transaction_id === id), { status, callback_response: response }); },
    async insertRefund({ paymentId, txnId, amount, status, callbackResponse }) {
      db.txns.push({ transaction_id: db.nextId++, payment_id: paymentId, type: 'REFUND', attempt_no: null, provider_transaction_id: txnId, amount, status, callback_response: callbackResponse });
    },
    async updatePayment(id, { status, reason = null, paid = false, refunded = false }) {
      const p = db.payments.find((x) => x.payment_id === id);
      Object.assign(p, { status, status_reason: reason ?? p.status_reason, paid_at: paid ? Date.now() : p.paid_at, refunded_at: refunded ? Date.now() : p.refunded_at });
    },
  });
  return {
    get db() { return db; },
    ...stmts(),
    async transaction(fn) {
      const snapshot = structuredClone(db);
      try {
        return await fn(stmts());
      } catch (err) {
        db = snapshot;
        throw err;
      }
    },
    async findPaymentView(id) {
      const p = db.payments.find((x) => x.payment_id === id);
      if (!p) return null;
      const f = db.fares.find((x) => x.fare_id === p.fare_id);
      return {
        ...p, distance_m: f.distanceM, base_fare: f.rate.base_fare, per_km_rate: f.rate.per_km_rate, min_fare: f.rate.min_fare,
        transactions: db.txns.filter((t) => t.payment_id === id),
      };
    },
    async expireOverdue() {
      const out = [];
      for (const p of db.payments) {
        if (p.method === 'ONLINE' && ['PENDING', 'FAILED'].includes(p.status) && p.expires_at <= Date.now()) {
          out.push({ ...p, previous_status: p.status });
          Object.assign(p, { status: 'CANCELED', status_reason: 'PAYMENT_EXPIRED' });
        }
      }
      return out;
    },
  };
}

function setup({ simulationMode = true, timeout = 600 } = {}) {
  const repo = fakeRepo();
  const published = [];
  const events = { async publish(topic, key, data) { published.push({ topic, key, data }); } };
  const log = { info() {}, warn() {}, error() {} };
  const logic = createPaymentLogic({
    payments: repo, provider: createSimulatedProvider({ simulationMode }), events, log,
    config: { paymentTimeoutSeconds: timeout, callbackSecret: 'cab-secret' },
  });
  return { repo, published, logic };
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

const onlineCar7 = { booking_id: 7, customer_id: 1, vehicle_type: 'CAR_7', distance_m: 2026, method: 'ONLINE' };
const pay = (logic, id, body, key, who = KH1) => logic.payPayment({ payment_id: id, ...body }, { ...who, idempotencyKey: key });
const callback = (logic, body, secret = 'cab-secret') => logic.handleProviderCallback(body, { callbackSecret: secret });

test('CreatePayment: chỉ system; tính cước; ONLINE có hạn; gọi lặp trả Payment cũ (M1)', async () => {
  const { logic, repo } = setup();
  const created = await logic.createPayment(onlineCar7, SYSTEM);
  assert.equal(created.amount, 56000);
  assert.equal(created.status, 'PENDING');
  assert.ok(created.expires_at);
  const again = await logic.createPayment(onlineCar7, SYSTEM);
  assert.equal(again.payment_id, created.payment_id);
  assert.equal(repo.db.payments.length, 1);
  const cash = await logic.createPayment({ ...onlineCar7, booking_id: 8, vehicle_type: 'car_4', method: 'CASH' }, SYSTEM);
  assert.equal(cash.amount, 45000);
  assert.equal(cash.expires_at, undefined);
  await rejectsWith(logic.createPayment({ ...onlineCar7, booking_id: 9, vehicle_type: 'BUS' }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.createPayment({ ...onlineCar7, distance_m: 0 }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.createPayment(onlineCar7, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  await rejectsWith(logic.createPayment(onlineCar7, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('mục 19: MANUAL → PENDING, không event → callback → COMPLETED, một K6', async () => {
  const { logic, published } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  const first = await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  assert.deepEqual({ ...first, expires_at: undefined }, {
    payment_id: id, status: 'PENDING', txn_id: `SIM-${id}-1`, txn_status: 'PENDING', attempt_no: 1, attempts_left: 2, expires_at: undefined, replayed: false,
  });
  assert.equal(published.length, 0);
  const cb = await callback(logic, { txn_id: `SIM-${id}-1` });
  assert.deepEqual(cb, { txn_id: `SIM-${id}-1`, txn_status: 'SUCCEEDED', payment_id: id, status: 'COMPLETED', replayed: false });
  assert.equal(published.length, 1);
  assert.equal(published[0].topic, TOPIC_PAYMENT_STATUS_CHANGED);
  assert.equal(published[0].key, '7'); // key = booking_id
  assert.deepEqual(published[0].data, { payment_id: id, booking_id: 7, customer_id: 1, method: 'ONLINE', amount: 56000, status: 'COMPLETED', previous_status: 'PENDING' });

  // Mục 30: gửi lại y hệt → response cũ, replayed, không giao dịch / event mới.
  const replay = await pay(logic, id, { simulate_result: 'manual' }, 'k1');
  assert.deepEqual({ ...replay, replayed: undefined }, { ...first, replayed: undefined });
  assert.equal(replay.replayed, true);
  const cbReplay = await callback(logic, { txn_id: `SIM-${id}-1` });
  assert.equal(cbReplay.replayed, true);
  assert.equal(cbReplay.status, 'COMPLETED');
  assert.equal(published.length, 1);

  // AC-TT-06
  await rejectsWith(pay(logic, id, { simulate_result: 'FAILED' }, 'k1'), 'FAILED_PRECONDITION', 'IDEMPOTENCY_KEY_REUSED');
  await rejectsWith(pay(logic, id, {}, 'k2'), 'FAILED_PRECONDITION', 'PAYMENT_ALREADY_COMPLETED');
  await rejectsWith(pay(logic, id, {}, undefined), 'INVALID_ARGUMENT', 'IDEMPOTENCY_KEY_REQUIRED');
  const view = await logic.getPayment({ payment_id: id }, KH1);
  assert.equal(view.status, 'COMPLETED');
  assert.deepEqual(view.fare, { distance_m: 2026, base_fare: 25000, per_km_rate: 15000, min_fare: 40000 });
  assert.deepEqual(view.transactions, [{ txn_id: `SIM-${id}-1`, type: 'CHARGE', attempt_no: 1, status: 'SUCCEEDED', amount: 56000 }]);
  assert.ok(view.paid_at);
});

test('mặc định thành công ngay; SIMULATION_MODE=false bỏ qua simulate_result', async () => {
  const { logic } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  const res = await pay(logic, id, {}, 'k1');
  assert.equal(res.status, 'COMPLETED');
  assert.equal(res.txn_status, 'SUCCEEDED');

  const off = setup({ simulationMode: false });
  const p = await off.logic.createPayment(onlineCar7, SYSTEM);
  assert.equal((await pay(off.logic, p.payment_id, { simulate_result: 'FAILED' }, 'k1')).status, 'COMPLETED');
});

test('AC-TT-08: ba lần FAILED → CANCELED (ATTEMPTS_EXHAUSTED), K6 FAILED, FAILED, CANCELED', async () => {
  const { logic, published } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  const r1 = await pay(logic, id, { simulate_result: 'FAILED' }, 'k1');
  const r2 = await pay(logic, id, { simulate_result: 'FAILED' }, 'k2');
  const r3 = await pay(logic, id, { simulate_result: 'FAILED' }, 'k3');
  assert.deepEqual([r1.status, r1.attempts_left, r2.status, r2.attempts_left, r3.status, r3.attempts_left], ['FAILED', 2, 'FAILED', 1, 'CANCELED', 0]);
  assert.deepEqual(published.map((e) => e.data.status), ['FAILED', 'FAILED', 'CANCELED']);
  assert.equal(published[2].data.reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(published[1].data.previous_status, 'PENDING'); // lần 2 đưa FAILED về PENDING trước khi thử
  await rejectsWith(pay(logic, id, {}, 'k4'), 'FAILED_PRECONDITION', 'PAYMENT_ATTEMPTS_EXHAUSTED');
});

test('AC-TT-09: MANUAL đang chờ → 409 PAYMENT_IN_PROGRESS, khóa bị từ chối KHÔNG được lưu (DX9)', async () => {
  const { logic, repo } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  await rejectsWith(pay(logic, id, {}, 'k2'), 'FAILED_PRECONDITION', 'PAYMENT_IN_PROGRESS');
  assert.equal(repo.db.keys.length, 1);
  const cb = await callback(logic, { txn_id: `SIM-${id}-1`, result: 'failed' });
  assert.equal(cb.status, 'FAILED');
  const again = await pay(logic, id, {}, 'k2');
  assert.equal(again.status, 'COMPLETED');
  assert.equal(again.attempt_no, 2);
});

test('AC-TT-10 / M11: hết hạn → CANCELED + K6; thanh toán bị từ chối; callback muộn → REFUNDED', async () => {
  const { logic, repo, published } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  repo.db.payments[0].expires_at = Date.now() - 1;
  assert.equal(await logic.expireOverdue(), 1);
  assert.deepEqual(published.at(-1).data, { payment_id: id, booking_id: 7, customer_id: 1, method: 'ONLINE', amount: 56000, status: 'CANCELED', previous_status: 'PENDING', reason: 'PAYMENT_EXPIRED' });
  await rejectsWith(pay(logic, id, {}, 'k2'), 'FAILED_PRECONDITION', 'PAYMENT_EXPIRED');
  const cb = await callback(logic, { txn_id: `SIM-${id}-1` });
  assert.deepEqual([cb.txn_status, cb.status], ['SUCCEEDED', 'REFUNDED']);
  assert.equal(published.at(-1).data.status, 'REFUNDED');
  const view = await logic.getPayment({ payment_id: id }, AD1);
  assert.equal(view.status_reason, 'PAYMENT_EXPIRED');
  assert.deepEqual(view.transactions.map((t) => [t.txn_id, t.type, t.status]), [[`SIM-${id}-1`, 'CHARGE', 'SUCCEEDED'], [`SIM-R-${id}`, 'REFUND', 'SUCCEEDED']]);
});

test('quá hạn mà tiến trình nền chưa chạy → PAYMENT_EXPIRED; CASH → PAYMENT_NOT_ONLINE; hủy lý do khác → PAYMENT_CANCELED', async () => {
  const { logic, repo } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  repo.db.payments[0].expires_at = Date.now() - 1;
  await rejectsWith(pay(logic, id, {}, 'k1'), 'FAILED_PRECONDITION', 'PAYMENT_EXPIRED');
  const cash = await logic.createPayment({ ...onlineCar7, booking_id: 8, method: 'CASH' }, SYSTEM);
  await rejectsWith(pay(logic, cash.payment_id, {}, 'k1'), 'FAILED_PRECONDITION', 'PAYMENT_NOT_ONLINE');
  const other = await logic.createPayment({ ...onlineCar7, booking_id: 9 }, SYSTEM);
  Object.assign(repo.db.payments[2], { status: 'CANCELED', status_reason: 'BOOKING_CANCELED' });
  await rejectsWith(pay(logic, other.payment_id, {}, 'k1'), 'FAILED_PRECONDITION', 'PAYMENT_CANCELED');
});

test('quyền: chủ trước khóa (DX8); A30 khách khác 403, admin xem được; không có → 404', async () => {
  const { logic } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  await rejectsWith(pay(logic, id, { simulate_result: 'MANUAL' }, 'k1', KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getPayment({ payment_id: id }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  assert.equal((await logic.getPayment({ payment_id: id }, AD1)).payment_id, id);
  await rejectsWith(logic.getPayment({ payment_id: 999 }, KH1), 'NOT_FOUND', 'PAYMENT_NOT_FOUND');
  await rejectsWith(pay(logic, 999, {}, 'k1'), 'NOT_FOUND', 'PAYMENT_NOT_FOUND');
  await rejectsWith(logic.getPayment({ payment_id: id }, { accountId: '11', role: 'driver' }), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(pay(logic, id, { simulate_result: 'X' }, 'k3'), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('A32: khóa sai / thiếu → 401; mã lạ → 404; số tiền lệch → 400', async () => {
  const { logic } = setup();
  const { payment_id: id } = await logic.createPayment(onlineCar7, SYSTEM);
  await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  await rejectsWith(callback(logic, { txn_id: `SIM-${id}-1` }, 'sai'), 'UNAUTHENTICATED', 'INVALID_CALLBACK_SECRET');
  await rejectsWith(logic.handleProviderCallback({ txn_id: `SIM-${id}-1` }, {}), 'UNAUTHENTICATED', 'INVALID_CALLBACK_SECRET');
  await rejectsWith(callback(logic, { txn_id: 'SIM-999-1' }), 'NOT_FOUND', 'TRANSACTION_NOT_FOUND');
  await rejectsWith(callback(logic, { txn_id: `SIM-${id}-1`, amount: 1 }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(callback(logic, { txn_id: `SIM-${id}-1`, result: 'OK' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  assert.equal((await callback(logic, { txn_id: `SIM-${id}-1`, amount: 56000 })).status, 'COMPLETED');
});

test('rules: hash chuẩn hóa; so khóa bí mật', () => {
  assert.equal(requestHash(undefined), requestHash(undefined));
  assert.notEqual(requestHash(undefined), requestHash('MANUAL'));
  assert.equal(secretMatches('cab-secret', 'cab-secret'), true);
  assert.equal(secretMatches('cab-secreT', 'cab-secret'), false);
  assert.equal(secretMatches('cab', 'cab-secret'), false);
  assert.equal(secretMatches(undefined, 'cab-secret'), false);
});

// ---- Spec 17-18 mục 2.5: nghe K3, K4, K5 — hủy bỏ, hoàn tiền, ghi nhận tiền mặt ----

const env = (data) => ({ event_id: 'e1', occurred_at: '2026-10-05T01:00:00.000Z', data });
const K3 = 'booking.no-driver-found';
const K4 = 'booking.canceled';
const K5 = 'trip.status-changed';
const refunds = (repo, id) => repo.db.txns.filter((t) => t.payment_id === id && t.type === 'REFUND');

async function paidOnline(logic, bookingId = 7) {
  const { payment_id: id } = await logic.createPayment({ ...onlineCar7, booking_id: bookingId }, SYSTEM);
  await pay(logic, id, {}, 'k1');
  return id;
}

test('K5 CANCELED trên thanh toán ONLINE đã thu → REFUNDED (TRIP_CANCELED), SIM-R-<id>, K6 REFUNDED; event lặp không hoàn lần hai', async () => {
  const { logic, repo, published } = setup();
  const id = await paidOnline(logic);
  const before = published.length;
  const event = env({ trip_id: 5, booking_id: 7, customer_id: 1, driver_id: 16, status: 'CANCELED', previous_status: 'ACCEPTED', canceled_by: 'customer' });
  assert.equal(await logic.onBookingEvent(K5, event), 'REFUNDED');
  const p = repo.db.payments.find((x) => x.payment_id === id);
  assert.deepEqual([p.status, p.status_reason, Boolean(p.refunded_at), Boolean(p.paid_at)], ['REFUNDED', 'TRIP_CANCELED', true, true]);
  assert.deepEqual(refunds(repo, id).map((t) => [t.provider_transaction_id, t.status, t.amount]), [[`SIM-R-${id}`, 'SUCCEEDED', 56000]]);
  assert.deepEqual(published.slice(before), [{
    topic: TOPIC_PAYMENT_STATUS_CHANGED, key: '7',
    data: { payment_id: id, booking_id: 7, customer_id: 1, method: 'ONLINE', amount: 56000, status: 'REFUNDED', previous_status: 'COMPLETED' },
  }]);
  assert.equal(await logic.onBookingEvent(K5, event), null);
  assert.equal(refunds(repo, id).length, 1);
  assert.equal(published.length, before + 1);
  const view = await logic.getPayment({ payment_id: id }, KH1);
  assert.deepEqual(view.transactions.map((t) => t.type), ['CHARGE', 'REFUND']);
});

test('K5 CANCELED tiền mặt → CANCELED (TRIP_CANCELED), không giao dịch hoàn, không K6', async () => {
  const { logic, repo, published } = setup();
  const { payment_id: id } = await logic.createPayment({ ...onlineCar7, booking_id: 9, method: 'CASH' }, SYSTEM);
  assert.equal(await logic.onBookingEvent(K5, env({ booking_id: 9, status: 'CANCELED', canceled_by: 'customer' })), 'CANCELED');
  const p = repo.db.payments.find((x) => x.payment_id === id);
  assert.deepEqual([p.status, p.status_reason], ['CANCELED', 'TRIP_CANCELED']);
  assert.equal(refunds(repo, id).length, 0);
  assert.equal(published.length, 0);
});

test('K5 COMPLETED: tiền mặt PENDING → COMPLETED + paid_at + K6 COMPLETED CASH (FR17); ONLINE đã thu giữ nguyên, không hoàn (BRULE15)', async () => {
  const { logic, repo, published } = setup();
  const { payment_id: cash } = await logic.createPayment({ ...onlineCar7, booking_id: 1000, vehicle_type: 'CAR_4', method: 'CASH' }, SYSTEM);
  assert.equal(await logic.onBookingEvent(K5, env({ trip_id: 1000, booking_id: 1000, status: 'COMPLETED' })), 'COMPLETED');
  const p = repo.db.payments.find((x) => x.payment_id === cash);
  assert.equal(p.status, 'COMPLETED');
  assert.ok(p.paid_at);
  assert.deepEqual(published.at(-1).data, { payment_id: cash, booking_id: 1000, customer_id: 1, method: 'CASH', amount: 45000, status: 'COMPLETED', previous_status: 'PENDING' });
  assert.equal(repo.db.txns.filter((t) => t.payment_id === cash).length, 0, 'tiền mặt không có giao dịch cổng');
  assert.equal(await logic.onBookingEvent(K5, env({ booking_id: 1000, status: 'COMPLETED' })), null);

  const online = await paidOnline(logic, 4);
  const count = published.length;
  assert.equal(await logic.onBookingEvent(K5, env({ booking_id: 4, status: 'COMPLETED' })), null);
  assert.equal(repo.db.payments.find((x) => x.payment_id === online).status, 'COMPLETED');
  assert.equal(refunds(repo, online).length, 0);
  assert.equal(published.length, count);
  for (const status of ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS']) assert.equal(await logic.onBookingEvent(K5, env({ booking_id: 1000, status })), null);
});

test('K3: ONLINE đã thu → REFUNDED (NO_DRIVER_FOUND); tiền mặt → CANCELED (NO_DRIVER_FOUND)', async () => {
  const { logic, repo } = setup();
  const online = await paidOnline(logic, 20);
  assert.equal(await logic.onBookingEvent(K3, env({ booking_id: 20, customer_id: 1, offers_tried: 0 })), 'REFUNDED');
  assert.equal(repo.db.payments.find((x) => x.payment_id === online).status_reason, 'NO_DRIVER_FOUND');
  const { payment_id: cash } = await logic.createPayment({ ...onlineCar7, booking_id: 21, method: 'CASH' }, SYSTEM);
  assert.equal(await logic.onBookingEvent(K3, env({ booking_id: 21, customer_id: 1, offers_tried: 0 })), 'CANCELED');
  assert.equal(repo.db.payments.find((x) => x.payment_id === cash).status_reason, 'NO_DRIVER_FOUND');
});

test('K4: khách hủy → chưa thu CANCELED (BOOKING_CANCELED) rồi A31 → PAYMENT_CANCELED; đã thu → REFUNDED; system → bỏ qua', async () => {
  const { logic, repo, published } = setup();
  const { payment_id: pending } = await logic.createPayment({ ...onlineCar7, booking_id: 30 }, SYSTEM);
  assert.equal(await logic.onBookingEvent(K4, env({ booking_id: 30, customer_id: 1, canceled_by: 'customer', previous_status: 'PENDING_PAYMENT', pending_offer_driver_id: null })), 'CANCELED');
  assert.equal(repo.db.payments.find((x) => x.payment_id === pending).status_reason, 'BOOKING_CANCELED');
  assert.equal(published.length, 0);
  await rejectsWith(pay(logic, pending, {}, 'k1'), 'FAILED_PRECONDITION', 'PAYMENT_CANCELED');

  const paid = await paidOnline(logic, 31);
  assert.equal(await logic.onBookingEvent(K4, env({ booking_id: 31, canceled_by: 'customer' })), 'REFUNDED');
  assert.equal(repo.db.payments.find((x) => x.payment_id === paid).status_reason, 'BOOKING_CANCELED');

  const { payment_id: sys } = await logic.createPayment({ ...onlineCar7, booking_id: 32 }, SYSTEM);
  assert.equal(await logic.onBookingEvent(K4, env({ booking_id: 32, canceled_by: 'system', reason: 'PAYMENT_EXPIRED' })), null);
  assert.equal(repo.db.payments.find((x) => x.payment_id === sys).status, 'PENDING');
});

test('K4 rồi callback MANUAL đến muộn (M11) → ghi nhận rồi hoàn ngay, giữ lý do BOOKING_CANCELED', async () => {
  const { logic, repo, published } = setup();
  const { payment_id: id } = await logic.createPayment({ ...onlineCar7, booking_id: 40 }, SYSTEM);
  await pay(logic, id, { simulate_result: 'MANUAL' }, 'k1');
  assert.equal(await logic.onBookingEvent(K4, env({ booking_id: 40, canceled_by: 'customer' })), 'CANCELED');
  const res = await callback(logic, { txn_id: `SIM-${id}-1` });
  assert.deepEqual([res.txn_status, res.status], ['SUCCEEDED', 'REFUNDED']);
  const p = repo.db.payments.find((x) => x.payment_id === id);
  assert.deepEqual([p.status, p.status_reason, Boolean(p.paid_at), Boolean(p.refunded_at)], ['REFUNDED', 'BOOKING_CANCELED', true, true]);
  assert.equal(published.at(-1).data.status, 'REFUNDED');
  assert.equal(published.at(-1).data.previous_status, 'CANCELED');
});

test('event sai dạng / không có thanh toán → bỏ qua, không lỗi', async () => {
  const { logic } = setup();
  assert.equal(await logic.onBookingEvent(K5, {}), null);
  assert.equal(await logic.onBookingEvent(K5, env({ booking_id: '7', status: 'CANCELED' })), null);
  assert.equal(await logic.onBookingEvent(K5, env({ booking_id: 999, status: 'CANCELED' })), null);
});
