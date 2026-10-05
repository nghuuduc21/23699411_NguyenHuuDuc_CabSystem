// Unit test D9 (spec 17-18 mục 2.6): driver-service nghe K5 trip.status-changed → tài xế rảnh lại.
// Kho giả mô phỏng đúng câu lệnh `release` (chỉ nhả khi đang giữ đúng booking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriverLogic } from '../src/domain/drivers.js';
import { createFieldCipher } from '../src/domain/crypto.js';

function setup() {
  const state = new Map([
    [11, { availability: 'BUSY', current_booking_id: 1000 }],
    [16, { availability: 'BUSY', current_booking_id: 5 }],
  ]);
  const drivers = {
    async release(id, bookingId) {
      const d = state.get(id);
      if (!d || d.current_booking_id !== bookingId) return false;
      Object.assign(d, { availability: 'ONLINE', current_booking_id: null });
      return true;
    },
  };
  const logs = [];
  const log = { info: (msg, f) => logs.push({ msg, ...f }), warn: (msg, f) => logs.push({ msg, ...f }), error() {} };
  return { state, logs, logic: createDriverLogic({ drivers, cipher: createFieldCipher(Buffer.alloc(32, 1)), events: {}, log }) };
}

const k5 = (data) => ({ event_id: 'e1', event_type: 'trip.status-changed', occurred_at: '2026-10-05T01:00:00.000Z', data });

test('K5 COMPLETED / CANCELED khớp booking → ONLINE, log driver_released kèm trip_status', async () => {
  const { logic, state, logs } = setup();
  assert.equal(await logic.onTripStatusChanged(k5({ trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'COMPLETED' })), true);
  assert.deepEqual(state.get(11), { availability: 'ONLINE', current_booking_id: null });
  assert.deepEqual(logs.at(-1), { msg: 'driver_released', driver_id: 11, booking_id: 1000, trip_status: 'COMPLETED' });
  assert.equal(await logic.onTripStatusChanged(k5({ trip_id: 5, booking_id: 5, driver_id: 16, status: 'CANCELED', canceled_by: 'customer' })), true);
  assert.equal(state.get(16).availability, 'ONLINE');
});

test('event lặp, booking không khớp (AC-HT-05), trạng thái khác, sai dạng → không đổi gì', async () => {
  const { logic, state } = setup();
  const done = k5({ trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'COMPLETED' });
  await logic.onTripStatusChanged(done);
  state.get(11).availability = 'BUSY';
  state.get(11).current_booking_id = 2000; // đang chở booking khác
  assert.equal(await logic.onTripStatusChanged(done), false);
  assert.deepEqual(state.get(11), { availability: 'BUSY', current_booking_id: 2000 });
  for (const status of ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS']) {
    assert.equal(await logic.onTripStatusChanged(k5({ trip_id: 5, booking_id: 5, driver_id: 16, status })), false);
  }
  assert.equal(state.get(16).availability, 'BUSY');
  assert.equal(await logic.onTripStatusChanged({}), false);
  assert.equal(await logic.onTripStatusChanged(k5({ booking_id: '5', driver_id: 16, status: 'COMPLETED' })), false);
});
