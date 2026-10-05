// Unit test S7 GetTripForRating (spec 20-29 mục 5.2; AC-DG-12) với kho giả trong bộ nhớ.
// Trip chỉ báo sự thật cho rating-service: chỉ nhận `x-role: system`, không kiểm chủ, không phát event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTripLogic } from '../src/domain/trips.js';

const SYSTEM = { role: 'system' };

function setup() {
  const rows = new Map([[4, { trip_id: 4, status: 'COMPLETED', customer_id: 1, driver_id: 13 }]]);
  const published = [];
  const logic = createTripLogic({
    trips: { async findForRating(id) { return rows.get(id) ?? null; } },
    events: { async publish(...args) { published.push(args); } },
    log: { info() {}, warn() {}, error() {} },
  });
  return { logic, published };
}

const rejectsWith = (promise, kind, code) => assert.rejects(promise, (err) => {
  assert.equal(err.kind, kind);
  assert.equal(err.code, code);
  return true;
});

test('S7: chuyến có → trả đúng trạng thái, khách, tài xế; không phát event', async () => {
  const { logic, published } = setup();
  assert.deepEqual(await logic.getTripForRating({ trip_id: 4 }, SYSTEM), { trip_id: 4, status: 'COMPLETED', customer_id: 1, driver_id: 13 });
  assert.equal(published.length, 0);
});

test('S7: chuyến không có → NOT_FOUND TRIP_NOT_FOUND; trip_id 0 → INVALID_INPUT', async () => {
  const { logic } = setup();
  await rejectsWith(logic.getTripForRating({ trip_id: 999 }, SYSTEM), 'NOT_FOUND', 'TRIP_NOT_FOUND');
  await rejectsWith(logic.getTripForRating({ trip_id: 0 }, SYSTEM), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('S7: không có x-role → IDENTITY_MISSING; role người dùng → FORBIDDEN (chỉ service nội bộ được hỏi)', async () => {
  const { logic } = setup();
  await rejectsWith(logic.getTripForRating({ trip_id: 4 }, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  await rejectsWith(logic.getTripForRating({ trip_id: 4 }, { accountId: '1', role: 'customer' }), 'PERMISSION_DENIED', 'FORBIDDEN');
});
