// Unit test ReserveDriver, ReleaseDriver và quyền `system` của FindNearbyDrivers
// (spec 14-15-16-19-30 mục 5.4, 5.5; D8, D9; AC-DX-23) với kho giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriverLogic } from '../src/domain/drivers.js';
import { createFieldCipher } from '../src/domain/crypto.js';

const SYSTEM = { role: 'system' };

function setup() {
  const state = new Map([
    [11, { availability: 'ONLINE', current_booking_id: null }],
    [15, { availability: 'OFFLINE', current_booking_id: null }],
  ]);
  const drivers = {
    async reserve(id, bookingId) {
      const d = state.get(id);
      if (!d || d.availability !== 'ONLINE') return false; // UPDATE … WHERE availability = 'ONLINE'
      Object.assign(d, { availability: 'BUSY', current_booking_id: bookingId });
      return true;
    },
    async findAvailability(id) { return state.get(id) ? { ...state.get(id) } : null; },
    async release(id, bookingId) {
      const d = state.get(id);
      if (!d || d.current_booking_id !== bookingId) return false;
      Object.assign(d, { availability: 'ONLINE', current_booking_id: null });
      return true;
    },
    async vehicleTypeExists() { return true; },
    async findNearby() { return { rows: [], total: 0 }; },
  };
  const log = { info() {}, warn() {}, error() {} };
  const logic = createDriverLogic({ drivers, cipher: createFieldCipher(Buffer.alloc(32, 1)), events: {}, log });
  return { state, logic };
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

test('ReserveDriver: giữ; gọi lặp cùng booking trả như lần đầu; booking khác → DRIVER_NOT_AVAILABLE', async () => {
  const { logic, state } = setup();
  assert.deepEqual(await logic.reserveDriver({ driver_id: 11, booking_id: 1000 }, SYSTEM), { driver_id: 11, booking_id: 1000, status: 'BUSY' });
  assert.deepEqual(state.get(11), { availability: 'BUSY', current_booking_id: 1000 });
  assert.equal((await logic.reserveDriver({ driver_id: 11, booking_id: 1000 }, SYSTEM)).status, 'BUSY');
  await rejectsWith(logic.reserveDriver({ driver_id: 11, booking_id: 1001 }, SYSTEM), 'FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
  await rejectsWith(logic.reserveDriver({ driver_id: 15, booking_id: 1001 }, SYSTEM), 'FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
  await rejectsWith(logic.reserveDriver({ driver_id: 99, booking_id: 1001 }, SYSTEM), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
});

test('ReleaseDriver: không khớp booking → released false, không lỗi; khớp → ONLINE', async () => {
  const { logic, state } = setup();
  await logic.reserveDriver({ driver_id: 11, booking_id: 1000 }, SYSTEM);
  assert.deepEqual(await logic.releaseDriver({ driver_id: 11, booking_id: 1001 }, SYSTEM), { driver_id: 11, released: false });
  assert.deepEqual(await logic.releaseDriver({ driver_id: 11, booking_id: 1000 }, SYSTEM), { driver_id: 11, released: true });
  assert.deepEqual(state.get(11), { availability: 'ONLINE', current_booking_id: null });
  assert.deepEqual(await logic.releaseDriver({ driver_id: 11, booking_id: 1000 }, SYSTEM), { driver_id: 11, released: false });
});

test('Reserve / Release chỉ nhận system: không x-role → IDENTITY_MISSING, role khác → FORBIDDEN; mã sai → INVALID_INPUT', async () => {
  const { logic } = setup();
  await rejectsWith(logic.reserveDriver({ driver_id: 11, booking_id: 1 }, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  await rejectsWith(logic.reserveDriver({ driver_id: 11, booking_id: 1 }, { role: 'customer' }), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.releaseDriver({ driver_id: 11, booking_id: 1 }, { accountId: '99', role: 'admin' }), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.reserveDriver({ driver_id: 0, booking_id: 1 }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('FindNearbyDrivers nhận system (DX-M1); rpc khác vẫn từ chối system', async () => {
  const { logic } = setup();
  const res = await logic.findNearbyDrivers({ lat: 10.82, lng: 106.68, vehicle: 'CAR_4', page: 1, limit: 50 }, SYSTEM);
  assert.deepEqual(res.data, []);
  await rejectsWith(logic.getDriver({ driver_id: 11 }, SYSTEM), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
});
