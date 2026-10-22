// Unit test CreateTrip (spec 14-15-16-19-30 mục 5.3; T1, AC-DX-24) với kho giả và bộ phát event giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTripLogic, TOPIC_TRIP_STATUS_CHANGED } from '../src/domain/trips.js';

const SYSTEM = { role: 'system' };
const SNAPSHOT = {
  booking_id: 1000, customer_id: 1, driver_id: 11, vehicle_type: 'CAR_4', pickup_lat: 10.82, pickup_lng: 106.68,
  destination_lat: 10.83, destination_lng: 106.69, payment_method: 'CASH', fare_amount: 45000,
  driver_name: 'Tài Xế 1', driver_plate: '59A-00001',
};

function setup({ publishFails = false } = {}) {
  const rows = new Map();
  let nextId = 1000;
  const trips = {
    async insertAccepted(s) {
      if (rows.has(s.bookingId)) return null; // ON CONFLICT (booking_id) DO NOTHING
      const row = { trip_id: nextId++, booking_id: s.bookingId, customer_id: s.customerId, driver_id: s.driverId, status: 'ACCEPTED', snapshot: s };
      rows.set(s.bookingId, row);
      return row;
    },
    async findByBooking(bookingId) { return rows.get(bookingId) ?? null; },
  };
  const published = [];
  const errors = [];
  const events = {
    async publish(topic, key, data) {
      if (publishFails) throw Object.assign(new Error('down'), { name: 'KafkaJSConnectionError' });
      published.push({ topic, key, data });
    },
  };
  const log = { info() {}, warn() {}, error: (msg, f) => errors.push({ msg, ...f }) };
  return { rows, published, errors, logic: createTripLogic({ trips, events, log }) };
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

test('CreateTrip: tạo ACCEPTED, phát K5 một lần; gọi lặp cùng tài xế trả Trip cũ, không phát lại (T1)', async () => {
  const { logic, published, rows } = setup();
  assert.deepEqual(await logic.createTrip(SNAPSHOT, SYSTEM), { trip_id: 1000, status: 'ACCEPTED', created: true });
  assert.equal(rows.get(1000).snapshot.pickupAddress, null); // không gửi địa chỉ → NULL
  // Bản chụp họ tên, biển số được chuyển xuống kho đúng giá trị gửi (DX25, AC-DX-24).
  assert.equal(rows.get(1000).snapshot.driverName, 'Tài Xế 1');
  assert.equal(rows.get(1000).snapshot.driverPlate, '59A-00001');
  assert.deepEqual(published, [{
    topic: TOPIC_TRIP_STATUS_CHANGED, key: '1000',
    data: { trip_id: 1000, booking_id: 1000, customer_id: 1, driver_id: 11, status: 'ACCEPTED', previous_status: null },
  }]);
  assert.deepEqual(await logic.createTrip(SNAPSHOT, SYSTEM), { trip_id: 1000, status: 'ACCEPTED', created: false });
  assert.equal(published.length, 1);
});

test('CreateTrip: booking đã có Trip với tài xế khác → BOOKING_ALREADY_ASSIGNED', async () => {
  const { logic } = setup();
  await logic.createTrip(SNAPSHOT, SYSTEM);
  await rejectsWith(logic.createTrip({ ...SNAPSHOT, driver_id: 13 }, SYSTEM), 'FAILED_PRECONDITION', 'BOOKING_ALREADY_ASSIGNED');
});

test('CreateTrip: chỉ system; dữ liệu sai → INVALID_INPUT', async () => {
  const { logic } = setup();
  await rejectsWith(logic.createTrip(SNAPSHOT, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  await rejectsWith(logic.createTrip(SNAPSHOT, { accountId: '11', role: 'driver' }), 'PERMISSION_DENIED', 'FORBIDDEN');
  for (const bad of [{ booking_id: 0 }, { pickup_lat: 91 }, { payment_method: 'CARD' }, { fare_amount: 0 }, { vehicle_type: '' }]) {
    await rejectsWith(logic.createTrip({ ...SNAPSHOT, ...bad }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
});

test('Kafka lỗi: chuyến vẫn tạo, trả thành công, log EVENT_PUBLISH_FAILED (NFR05)', async () => {
  const { logic, errors } = setup({ publishFails: true });
  assert.equal((await logic.createTrip(SNAPSHOT, SYSTEM)).created, true);
  assert.equal(errors[0].msg, 'EVENT_PUBLISH_FAILED');
  assert.equal(errors[0].topic, TOPIC_TRIP_STATUS_CHANGED);
});

test('CreateTrip: thiếu / rỗng / sai dạng driver_name, driver_plate → INVALID_INPUT, không tạo Trip (DX25)', async () => {
  const { logic, rows } = setup();
  const bads = [
    { driver_name: undefined }, { driver_name: '' }, { driver_name: '   ' }, { driver_name: 'a'.repeat(101) },
    { driver_plate: undefined }, { driver_plate: '' }, { driver_plate: '59a 001' },
  ];
  for (const bad of bads) {
    await rejectsWith(logic.createTrip({ ...SNAPSHOT, ...bad }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
  assert.equal(rows.size, 0);
});
