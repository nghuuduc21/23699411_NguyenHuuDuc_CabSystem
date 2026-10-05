// Unit test logic đánh giá (spec 20-29 mục 4.1, 4.2, 5.3; AC-DG-01 … AC-DG-10) với kho giả trong bộ nhớ và Trip giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRatingLogic } from '../src/domain/ratings.js';
import { average } from '../src/domain/rules.js';

const KH1 = { accountId: '1', role: 'customer' };
const KH2 = { accountId: '2', role: 'customer' };
const TX1 = { accountId: '11', role: 'driver' };
const TX3 = { accountId: '13', role: 'driver' };
const AD1 = { accountId: '99', role: 'admin' };

// Trip giả theo seed: T3 (KH1, TX1) và T4 (KH1, TX3) COMPLETED, T5 ACCEPTED, T6 CANCELED, T1000 (KH1, TX1) COMPLETED.
const TRIPS = new Map([
  [3, { trip_id: 3, status: 'COMPLETED', customer_id: 1, driver_id: 11 }],
  [4, { trip_id: 4, status: 'COMPLETED', customer_id: 1, driver_id: 13 }],
  [5, { trip_id: 5, status: 'ACCEPTED', customer_id: 1, driver_id: 16 }],
  [6, { trip_id: 6, status: 'CANCELED', customer_id: 1, driver_id: 16 }],
  [1000, { trip_id: 1000, status: 'COMPLETED', customer_id: 1, driver_id: 11 }],
]);

function setup({ tripError } = {}) {
  // Seed: đánh giá 3 cho T3, tài xế 11 có 1 đánh giá tổng 5.
  const db = {
    ratings: new Map([[3, { rating_id: 3, trip_id: 3, customer_id: 1, driver_id: 11, score: 5, comment: null, created_at: new Date('2026-10-05T01:00:00Z') }]]),
    totals: new Map([[11, { rating_count: 1, rating_sum: 5 }]]),
    nextId: 1000,
  };
  const tripCalls = [];
  const logs = [];
  const ratings = {
    async insertWithDriverTotal({ tripId, customerId, driverId, score, comment }) {
      if (db.ratings.has(tripId)) return null; // UNIQUE trip_id
      const rating = { rating_id: db.nextId++, trip_id: tripId, customer_id: customerId, driver_id: driverId, score, comment, created_at: new Date() };
      db.ratings.set(tripId, rating);
      const t = db.totals.get(driverId) ?? { rating_count: 0, rating_sum: 0 };
      const next = { rating_count: t.rating_count + 1, rating_sum: t.rating_sum + score };
      db.totals.set(driverId, next);
      return { rating_id: rating.rating_id, ...next };
    },
    async findByTrip(id) { return db.ratings.get(id) ?? null; },
    async findDriverTotal(id) { return db.totals.get(id) ?? null; },
  };
  const trips = {
    async getTripForRating(id, requestId) {
      tripCalls.push({ id, requestId });
      if (tripError) throw Object.assign(new Error('x'), { statusName: tripError });
      const t = TRIPS.get(id);
      if (!t) throw Object.assign(new Error('nf'), { statusName: 'NOT_FOUND' });
      return t;
    },
  };
  const log = { info: (msg, f) => logs.push({ msg, ...f }), warn: (msg, f) => logs.push({ msg, ...f }), error() {} };
  return { db, tripCalls, logs, logic: createRatingLogic({ ratings, trips, log }) };
}

const rejectsWith = (promise, kind, code) => assert.rejects(promise, (err) => {
  assert.equal(err.kind, kind);
  assert.equal(err.code, code);
  return true;
});

test('AC-DG-01: KH1 đánh giá T4 → 201 dữ liệu đúng, driver_id lấy từ Trip, không có key comment; cộng điểm TX3', async () => {
  const { db, logic, tripCalls } = setup();
  const r = await logic.createRating({ trip_id: 4, score: 5 }, KH1, 'req-1');
  assert.deepEqual(r, { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1 });
  assert.deepEqual(db.totals.get(13), { rating_count: 1, rating_sum: 5 });
  assert.equal(db.ratings.get(4).customer_id, 1);
  assert.deepEqual(tripCalls, [{ id: 4, requestId: 'req-1' }]);
});

test('AC-DG-02: gửi lại → RATING_ALREADY_EXISTS; T3 (seed đã có) → RATING_ALREADY_EXISTS; tổng không đổi', async () => {
  const { db, logic } = setup();
  await logic.createRating({ trip_id: 4, score: 5 }, KH1);
  await rejectsWith(logic.createRating({ trip_id: 4, score: 5 }, KH1), 'ALREADY_EXISTS', 'RATING_ALREADY_EXISTS');
  await rejectsWith(logic.createRating({ trip_id: 3, score: 4 }, KH1), 'ALREADY_EXISTS', 'RATING_ALREADY_EXISTS');
  assert.deepEqual(db.totals.get(13), { rating_count: 1, rating_sum: 5 });
  assert.deepEqual(db.totals.get(11), { rating_count: 1, rating_sum: 5 });
});

test('AC-DG-03: chuyến ACCEPTED hoặc CANCELED → TRIP_NOT_COMPLETED, không lưu', async () => {
  const { db, logic } = setup();
  await rejectsWith(logic.createRating({ trip_id: 5, score: 5 }, KH1), 'FAILED_PRECONDITION', 'TRIP_NOT_COMPLETED');
  await rejectsWith(logic.createRating({ trip_id: 6, score: 5 }, KH1), 'FAILED_PRECONDITION', 'TRIP_NOT_COMPLETED');
  assert.equal(db.ratings.size, 1);
});

test('AC-DG-04: KH2 đánh giá T3 → NOT_OWNER (không lộ "đã có đánh giá" — DG2); chuyến 999 → TRIP_NOT_FOUND', async () => {
  const { logic } = setup();
  await rejectsWith(logic.createRating({ trip_id: 3, score: 1 }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.createRating({ trip_id: 999, score: 5 }, KH1), 'NOT_FOUND', 'TRIP_NOT_FOUND');
});

test('AC-DG-05 (service kiểm lại): score / trip_id sai, comment rỗng, quá 500 ký tự → INVALID_INPUT; có < > → TEXT_CONTAINS_HTML; không gọi Trip', async () => {
  const { logic, tripCalls } = setup();
  for (const req of [{ trip_id: 4 }, { trip_id: 4, score: 0 }, { trip_id: 4, score: 6 }, { trip_id: 4, score: 4.5 }, { trip_id: 0, score: 5 },
    { trip_id: -1, score: 5 }, { trip_id: 4, score: 5, comment: '   ' }, { trip_id: 4, score: 5, comment: 'a'.repeat(501) }]) {
    await rejectsWith(logic.createRating(req, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
  await rejectsWith(logic.createRating({ trip_id: 4, score: 5, comment: '<b>x</b>' }, KH1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  assert.equal(tripCalls.length, 0);
});

test('AC-DG-06 (service kiểm lại): tài xế, admin → FORBIDDEN; không danh tính → IDENTITY_MISSING', async () => {
  const { logic } = setup();
  await rejectsWith(logic.createRating({ trip_id: 4, score: 5 }, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.createRating({ trip_id: 4, score: 5 }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.createRating({ trip_id: 4, score: 5 }, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
});

test('AC-DG-07: Trip dừng / quá deadline → UNAVAILABLE, không lưu gì', async () => {
  for (const statusName of ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL']) {
    const { db, logic } = setup({ tripError: statusName });
    await rejectsWith(logic.createRating({ trip_id: 4, score: 5 }, KH1), 'UNAVAILABLE', 'TRIP_UNAVAILABLE');
    assert.equal(db.ratings.size, 1);
    assert.equal(db.totals.has(13), false);
  }
});

test('AC-DG-08: trip 1000 của TX1 kèm comment → driver_avg 4.5, driver_count 2; comment cắt khoảng trắng; log không có comment', async () => {
  const { db, logic, logs } = setup();
  const r = await logic.createRating({ trip_id: 1000, score: 4, comment: '  Tai xe vui ve ' }, KH1);
  assert.deepEqual(r, { rating_id: 1000, trip_id: 1000, driver_id: 11, score: 4, comment: 'Tai xe vui ve', driver_avg: 4.5, driver_count: 2 });
  assert.deepEqual(db.totals.get(11), { rating_count: 2, rating_sum: 9 });
  assert.ok(logs.some((l) => l.msg === 'rating_created' && l.rating_id === 1000));
  assert.ok(!JSON.stringify(logs).includes('vui ve'));
});

test('AC-DG-09: xem đánh giá theo chuyến — khách / tài xế của chuyến, admin 200; người khác NOT_OWNER; chưa có → RATING_NOT_FOUND', async () => {
  const { logic } = setup();
  await logic.createRating({ trip_id: 4, score: 5 }, KH1);
  for (const who of [KH1, TX3, AD1]) {
    const r = await logic.getRatingByTrip({ trip_id: 4 }, who);
    assert.equal(r.rating_id, 1000);
    assert.equal(r.score, 5);
    assert.match(r.created_at, /Z$/);
    assert.equal('comment' in r, false);
  }
  await rejectsWith(logic.getRatingByTrip({ trip_id: 4 }, TX1), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getRatingByTrip({ trip_id: 4 }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getRatingByTrip({ trip_id: 5 }, KH1), 'NOT_FOUND', 'RATING_NOT_FOUND');
});

test('AC-DG-10: điểm tài xế — có đánh giá → avg + count; chưa có (kể cả mã không tồn tại) → count 0, không avg', async () => {
  const { logic } = setup();
  for (const who of [KH1, TX1, AD1]) assert.deepEqual(await logic.getDriverRating({ driver_id: 11 }, who), { driver_id: 11, avg: 5, count: 1 });
  assert.deepEqual(await logic.getDriverRating({ driver_id: 999 }, KH1), { driver_id: 999, count: 0 });
  await rejectsWith(logic.getDriverRating({ driver_id: 0 }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('DG4: trung bình làm tròn 1 chữ số (9/2 = 4.5; 14/3 = 4.7; 13/3 = 4.3)', () => {
  assert.equal(average(9, 2), 4.5);
  assert.equal(average(14, 3), 4.7);
  assert.equal(average(13, 3), 4.3);
  assert.equal(average(5, 1), 5);
});
