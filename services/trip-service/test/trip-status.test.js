// Unit test xem chuyến (A27), tiến trạng thái (A28, mục 17), hủy chuyến (A29, mục 18) — spec 17-18 mục 2.1–2.3,
// 2.8, 5.4 — với kho giả trong bộ nhớ (giao dịch mô phỏng bằng bản chụp) và bộ phát event giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTripLogic, TOPIC_TRIP_STATUS_CHANGED } from '../src/domain/trips.js';
import { NEXT } from '../src/domain/rules.js';

const KH1 = { accountId: '1', role: 'customer' };
const KH2 = { accountId: '2', role: 'customer' };
const TX1 = { accountId: '11', role: 'driver' };
const TX3 = { accountId: '13', role: 'driver' };
const TX6 = { accountId: '16', role: 'driver' };
const AD1 = { accountId: '99', role: 'admin' };

function setup() {
  const base = (id, driverId, pay, status) => ({
    trip_id: id, booking_id: id, customer_id: 1, driver_id: driverId, status, vehicle_type: 'CAR_4', pickup_lat: 10.82,
    pickup_lng: 106.68, destination_lat: 10.83, destination_lng: 106.69, pickup_address: null, destination_address: null,
    payment_method: pay, fare_amount: 45000, started_at: null, ended_at: null, canceled_by: null, cancel_reason: null,
    created_at: new Date('2026-10-05T01:00:00Z'),
    driver_name: `Tài Xế ${driverId - 10}`, driver_plate: `59A-0000${driverId - 10}`,
  });
  let db = {
    trips: new Map([[1000, base(1000, 11, 'CASH', 'ACCEPTED')], [4, base(4, 13, 'ONLINE', 'COMPLETED')], [5, base(5, 16, 'ONLINE', 'ACCEPTED')]]),
    history: [
      { trip_id: 1000, from: null, to: 'ACCEPTED', role: 'driver', reason: null, at: 1 },
      { trip_id: 5, from: null, to: 'ACCEPTED', role: 'driver', reason: null, at: 1 },
    ],
    clock: 2,
  };
  const hist = (id) => db.history.filter((h) => h.trip_id === id).map((h) => ({ to_status: h.to, changed_at: new Date(Date.UTC(2026, 9, 5, 1, h.at)) }));
  const tx = () => ({
    async lockTrip(id) { const t = db.trips.get(id); return t ? { ...t } : null; },
    async setStatus(id, status) {
      const t = db.trips.get(id);
      t.status = status;
      if (status === 'PICKED_UP') t.started_at = new Date();
      if (status === 'COMPLETED') t.ended_at = new Date();
    },
    async cancel(id, by, reason) { Object.assign(db.trips.get(id), { status: 'CANCELED', canceled_by: by, cancel_reason: reason, ended_at: new Date() }); },
    async insertHistory(h) { db.history.push({ trip_id: h.tripId, from: h.from, to: h.to, by: h.changedBy, role: h.role, reason: h.reason, at: db.clock++ }); },
    async listHistory(id) { return hist(id); },
  });
  const trips = {
    async transaction(fn) {
      const snapshot = structuredClone(db);
      try {
        return await fn(tx());
      } catch (err) {
        db = snapshot;
        throw err;
      }
    },
    async findTripView(id) { const t = db.trips.get(id); return t ? { ...t, history: hist(id) } : null; },
  };
  const published = [];
  const logs = [];
  const events = { async publish(topic, key, data) { published.push({ topic, key, data }); } };
  const log = { info: (msg, f) => logs.push({ msg, ...f }), warn() {}, error() {} };
  return { get db() { return db; }, published, logs, logic: createTripLogic({ trips, events, log }) };
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

test('bảng NEXT đúng trình tự ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED (T2)', () => {
  assert.deepEqual(NEXT, { ACCEPTED: 'ARRIVED', ARRIVED: 'PICKED_UP', PICKED_UP: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' });
});

test('A28 mục 17: nhảy cóc → 409 không K5; đúng trình tự → 200 ×4, history 5 mục, started_at / ended_at; K5 có previous_status', async () => {
  const s = setup();
  await rejectsWith(s.logic.updateTripStatus({ trip_id: 1000, status: 'COMPLETED' }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
  assert.equal(s.published.length, 0);
  assert.equal(s.db.trips.get(1000).status, 'ACCEPTED');

  const arrived = await s.logic.updateTripStatus({ trip_id: 1000, status: 'arrived' }, TX1);
  assert.equal(arrived.status, 'ARRIVED');
  assert.deepEqual(arrived.history.map((h) => h.status), ['ACCEPTED', 'ARRIVED']);
  assert.match(arrived.history[1].at, /Z$/);
  assert.deepEqual(s.published[0], {
    topic: TOPIC_TRIP_STATUS_CHANGED, key: '1000',
    data: { trip_id: 1000, booking_id: 1000, customer_id: 1, driver_id: 11, status: 'ARRIVED', previous_status: 'ACCEPTED' },
  });
  await s.logic.updateTripStatus({ trip_id: 1000, status: 'PICKED_UP' }, TX1);
  assert.ok(s.db.trips.get(1000).started_at);
  await s.logic.updateTripStatus({ trip_id: 1000, status: 'IN_PROGRESS' }, TX1);
  const done = await s.logic.updateTripStatus({ trip_id: 1000, status: 'COMPLETED' }, TX1);
  assert.deepEqual(done.history.map((h) => h.status), ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED']);
  assert.ok(s.db.trips.get(1000).ended_at);
  assert.equal(s.published.length, 4);
  assert.equal(s.published[3].data.previous_status, 'IN_PROGRESS');
  assert.ok(!('canceled_by' in s.published[3].data));
  // Lịch sử ghi người đổi = tài xế, role driver.
  assert.deepEqual(s.db.history.filter((h) => h.trip_id === 1000 && h.by).map((h) => [h.by, h.role]).at(-1), [11, 'driver']);
  assert.deepEqual(s.logs.filter((l) => l.msg === 'trip_status_changed').at(-1), { msg: 'trip_status_changed', trip_id: 1000, from: 'IN_PROGRESS', to: 'COMPLETED' });

  // Đã COMPLETED: gửi lại / lùi / hủy → 409.
  await rejectsWith(s.logic.updateTripStatus({ trip_id: 1000, status: 'COMPLETED' }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
  await rejectsWith(s.logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
  await rejectsWith(s.logic.cancelTrip({ trip_id: 1000, reason: 'x' }, TX1), 'FAILED_PRECONDITION', 'TRIP_NOT_CANCELABLE');
  assert.equal(s.published.length, 4);
});

test('A28 lỗi: tài xế khác 403 NOT_OWNER; 999 → 404; mã sai 400 INVALID_ID; status lạ 400; khách / admin 403 FORBIDDEN; thiếu danh tính 401', async () => {
  const { logic } = setup();
  await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, TX3), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.updateTripStatus({ trip_id: 999, status: 'ARRIVED' }, TX1), 'NOT_FOUND', 'TRIP_NOT_FOUND');
  await rejectsWith(logic.updateTripStatus({ trip_id: 0, status: 'ARRIVED' }, TX1), 'INVALID_ARGUMENT', 'INVALID_ID');
  for (const status of ['ACCEPTED', 'BUSY', 'CANCELED', '', undefined]) {
    await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status }, TX1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
  await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  await rejectsWith(logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, { role: 'system' }), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
});

test('A29 mục 18: KH1 hủy trip 5 → CANCELED, lịch sử có reason + role customer, K5 canceled_by KHÔNG có lý do', async () => {
  const s = setup();
  const res = await s.logic.cancelTrip({ trip_id: 5, reason: '  ban viec ' }, KH1);
  assert.deepEqual(res, { trip_id: 5, status: 'CANCELED', canceled_by: 'customer', reason: 'ban viec' });
  const t = s.db.trips.get(5);
  assert.deepEqual([t.status, t.canceled_by, t.cancel_reason], ['CANCELED', 'customer', 'ban viec']);
  assert.ok(t.ended_at);
  const h = s.db.history.at(-1);
  assert.deepEqual([h.from, h.to, h.by, h.role, h.reason], ['ACCEPTED', 'CANCELED', 1, 'customer', 'ban viec']);
  assert.deepEqual(s.published, [{
    topic: TOPIC_TRIP_STATUS_CHANGED, key: '5',
    data: { trip_id: 5, booking_id: 5, customer_id: 1, driver_id: 16, status: 'CANCELED', previous_status: 'ACCEPTED', canceled_by: 'customer' },
  }]);
  assert.ok(!JSON.stringify(s.logs).includes('ban viec'), 'không ghi lý do vào log');
  // Gửi lại → 409, không K5 mới.
  await rejectsWith(s.logic.cancelTrip({ trip_id: 5, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'TRIP_NOT_CANCELABLE');
  assert.equal(s.published.length, 1);
});

test('A29 tài xế hủy (FR41) → canceled_by driver; từ PICKED_UP trở đi → 409 (BRULE16)', async () => {
  const s = setup();
  assert.equal((await s.logic.cancelTrip({ trip_id: 5, reason: 'xe hong' }, TX6)).canceled_by, 'driver');
  assert.equal(s.published[0].data.canceled_by, 'driver');

  const p = setup();
  await p.logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, TX1);
  await p.logic.updateTripStatus({ trip_id: 1000, status: 'PICKED_UP' }, TX1);
  await rejectsWith(p.logic.cancelTrip({ trip_id: 1000, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'TRIP_NOT_CANCELABLE');
  await rejectsWith(p.logic.cancelTrip({ trip_id: 1000, reason: 'x' }, TX1), 'FAILED_PRECONDITION', 'TRIP_NOT_CANCELABLE');
  assert.equal(p.db.trips.get(1000).status, 'PICKED_UP');

  // ARRIVED vẫn hủy được.
  const a = setup();
  await a.logic.updateTripStatus({ trip_id: 1000, status: 'ARRIVED' }, TX1);
  assert.equal((await a.logic.cancelTrip({ trip_id: 1000, reason: 'x' }, KH1)).status, 'CANCELED');
});

test('A29 lỗi: reason thiếu / rỗng / HTML / quá dài / sai kiểu; COMPLETED 409; không phải chủ 403; admin 403 FORBIDDEN', async () => {
  const { logic } = setup();
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: '' }, KH1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: '   ' }, KH1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.cancelTrip({ trip_id: 5 }, KH1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: '<b>x</b>' }, KH1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: 'a'.repeat(256) }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: 5 }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.cancelTrip({ trip_id: 4, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'TRIP_NOT_CANCELABLE');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: 'x' }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: 'x' }, TX1), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.cancelTrip({ trip_id: 5, reason: 'x' }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.cancelTrip({ trip_id: 999, reason: 'x' }, KH1), 'NOT_FOUND', 'TRIP_NOT_FOUND');
  assert.equal((await logic.cancelTrip({ trip_id: 5, reason: 'a'.repeat(255) }, KH1)).status, 'CANCELED');
});

test('A27: khách, tài xế của chuyến, admin xem được (có history); người khác 403; 999 → 404; field rỗng vắng hẳn', async () => {
  const { logic } = setup();
  const view = await logic.getTrip({ trip_id: 1000 }, KH1);
  assert.deepEqual(view, {
    trip_id: 1000, booking_id: 1000, status: 'ACCEPTED', vehicle: 'CAR_4', pay: 'CASH', fare: 45000, customer_id: 1, driver_id: 11,
    from: [10.82, 106.68], to: [10.83, 106.69], created_at: '2026-10-05T01:00:00.000Z',
    history: [{ status: 'ACCEPTED', at: '2026-10-05T01:01:00.000Z' }],
    driver: { driver_id: 11, name: 'Tài Xế 1', plate: '59A-00001' },
  });
  assert.equal((await logic.getTrip({ trip_id: 1000 }, TX1)).trip_id, 1000);
  assert.equal((await logic.getTrip({ trip_id: 1000 }, AD1)).trip_id, 1000);
  await rejectsWith(logic.getTrip({ trip_id: 1000 }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getTrip({ trip_id: 1000 }, TX3), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getTrip({ trip_id: 999 }, KH1), 'NOT_FOUND', 'TRIP_NOT_FOUND');
  await rejectsWith(logic.getTrip({ trip_id: -1 }, KH1), 'INVALID_ARGUMENT', 'INVALID_ID');
  await logic.cancelTrip({ trip_id: 5, reason: 'ban viec' }, KH1);
  const canceled = await logic.getTrip({ trip_id: 5 }, KH1);
  assert.equal(canceled.canceled_by, 'customer');
  assert.equal(canceled.cancel_reason, 'ban viec');
  assert.match(canceled.ended_at, /Z$/);
  // Chuyến đã hủy vẫn giữ tài xế của chuyến (AC-CD-20).
  assert.deepEqual(canceled.driver, { driver_id: 16, name: 'Tài Xế 6', plate: '59A-00006' });
});

test('A27: chuyến tạo trước migration 002 (không có tên, biển số) → driver chỉ có driver_id (AC-CD-22)', async () => {
  const s = setup();
  Object.assign(s.db.trips.get(1000), { driver_name: null, driver_plate: null });
  assert.deepEqual((await s.logic.getTrip({ trip_id: 1000 }, AD1)).driver, { driver_id: 11 });
});

test('Kafka lỗi: A28 / A29 vẫn thành công, log EVENT_PUBLISH_FAILED (NFR05)', async () => {
  const s = setup();
  const errors = [];
  const logic = createTripLogic({
    trips: { transaction: (fn) => fn({ lockTrip: async () => ({ ...s.db.trips.get(5) }), cancel: async () => {}, insertHistory: async () => {} }) },
    events: { async publish() { throw Object.assign(new Error('down'), { name: 'KafkaJSConnectionError' }); } },
    log: { info() {}, warn() {}, error: (msg, f) => errors.push({ msg, ...f }) },
  });
  assert.equal((await logic.cancelTrip({ trip_id: 5, reason: 'x' }, KH1)).status, 'CANCELED');
  assert.equal(errors[0].msg, 'EVENT_PUBLISH_FAILED');
});
