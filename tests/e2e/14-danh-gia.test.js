// Spec 20-29 — phần đánh giá chuyến đi (mục 20; bổ trợ 26 văn bản tự do, 28 sai role). AC-DG-01…06, 08…12, 14.
// AC-DG-07 (dừng trip-service) và AC-DG-13 (restart rating-service) ở 92-dung-service-chuyen-di.test.js.
// Rate limit (AC-GH) ở 95-rate-limit.test.js — chạy riêng với ngưỡng mẫu 5 / 30.
//
// Tiền điều kiện: rating-db vừa đặt lại về seed (ratings chỉ có dòng 3; driver_ratings chỉ có 11 = 1 | 5);
// seed T4 (KH1, TX3, COMPLETED, chưa đánh giá), T5 chưa COMPLETED. AC-DG-08 cần một chuyến KH1 – TX1 đã
// COMPLETED: file tự tạo (đặt xe → TX1 nhận → tiến tới COMPLETED) thay cho "chuyến 1000" của spec 17.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, psql, psqlTable, tokenOf } from './api.js';
import { drainAllTestBookings, grpcInternal, kafkaNew, kafkaSnapshot, releaseSeedDrivers } from './dat-xe.js';
import { advance, newTrip, waitDriverFree } from './chuyen-di.js';
import { TOPICS, KAFKA_UI_URL } from './helpers.js';

let kh1, kh2, tx1, tx3, ad1;
const S = {};
const ratingDb = (sql) => psql('rating-db', 'rating', sql);
const rate = (body, token = kh1) => call('POST', '/ratings', { token, body });
const driverRow = (id) => ratingDb(`select rating_count || '|' || rating_sum from driver_ratings where driver_id = ${id}`);

before(async () => {
  [kh1, kh2, tx1, tx3, ad1] = await Promise.all([SEED.KH1, SEED.KH2, SEED.TX1, '0910000003', SEED.AD1].map((p) => tokenOf(p)));
  assert.equal(ratingDb('select string_agg(trip_id::text, \',\') from ratings'), '3',
    'Tiền điều kiện: rating-db vừa đặt lại (chỉ có đánh giá seed của chuyến 3).');
  assert.equal(driverRow(11), '1|5');
  S.fresh = ratingDb('select count(*) from ratings where rating_id >= 1000') === '0';
  S.snap = Object.fromEntries(await Promise.all(TOPICS.map(async (t) => [t, await kafkaSnapshot(t)])));
});

after(async () => {
  await drainAllTestBookings();
  releaseSeedDrivers();
});

test('AC-DG-01 (mục 20, AC14): A34 {"trip_id":4,"score":5} [KH1] → 201 {rating_id, 4, driver 13, 5, avg 5, count 1}, không key comment; ratings có (4, 1, 13); driver_ratings 13 = 1 | 5', async () => {
  const r = await rate({ trip_id: 4, score: 5 });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['driver_avg', 'driver_count', 'driver_id', 'rating_id', 'score', 'trip_id']);
  assert.deepEqual({ ...r.body, rating_id: 0 }, { rating_id: 0, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1 });
  if (S.fresh) assert.equal(r.body.rating_id, 1000);
  else assert.ok(r.body.rating_id >= 1000);
  assert.match(r.text, /"driver_avg":5[,}]/, 'JSON in 5 chứ không 5.0');
  S.r4 = r.body;
  assert.equal(ratingDb('select trip_id || \'|\' || customer_id || \'|\' || driver_id || \'|\' || score || \'|\' || coalesce(comment, \'-\') from ratings where trip_id = 4'), '4|1|13|5|-');
  assert.equal(driverRow(13), '1|5');
  const out = psqlTable('rating-db', 'rating', 'ratings');
  assert.match(out, /trip_id/);
});

test('AC-DG-02 (mục 20, V3): gửi lại y hệt; trip 3 (đã có đánh giá seed) → 409 RATING_ALREADY_EXISTS cả hai; driver_ratings 13, 11 không đổi', async () => {
  for (const body of [{ trip_id: 4, score: 5 }, { trip_id: 3, score: 4 }]) {
    const r = await rate(body);
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.body, { error: 'RATING_ALREADY_EXISTS' });
  }
  assert.equal(driverRow(13), '1|5');
  assert.equal(driverRow(11), '1|5');
  assert.equal(ratingDb('select count(*) from ratings'), '2');
});

test('AC-DG-03 (mục 20, V1): trip 5 (chưa COMPLETED: ACCEPTED, hoặc CANCELED nếu mục 18 đã chạy) → 409 TRIP_NOT_COMPLETED; không thêm dòng', async (tt) => {
  tt.diagnostic(`trip 5 hiện ${psql('trip-db', 'trip', 'select status from trips where trip_id = 5')}`);
  const r = await rate({ trip_id: 5, score: 5 });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(r.body, { error: 'TRIP_NOT_COMPLETED' });
  assert.equal(ratingDb('select count(*) from ratings where trip_id = 5'), '0');
});

test('AC-DG-04 (mục 20, V2, 404): KH2 trip 3 → 403 NOT_OWNER (không 409 dù đã có đánh giá); trip 999 → 404 TRIP_NOT_FOUND', async () => {
  const a = await rate({ trip_id: 3, score: 1 }, kh2);
  assert.equal(a.status, 403, a.text);
  assert.deepEqual(a.body, { error: 'NOT_OWNER' });
  const b = await rate({ trip_id: 999, score: 5 });
  assert.equal(b.status, 404, b.text);
  assert.deepEqual(b.body, { error: 'TRIP_NOT_FOUND' });
});

test('AC-DG-05 (mục 20, 26, 400): 9 × INVALID_INPUT; comment <b> → TEXT_CONTAINS_HTML; comment 501 ký tự, "   " → INVALID_INPUT; body hỏng → INVALID_JSON; không thêm dòng', async () => {
  const before = ratingDb('select count(*) from ratings');
  const cases = [
    [{ trip_id: 4 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 0 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 6 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 4.5 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: '5' }, 'INVALID_INPUT'],
    [{ trip_id: '4', score: 5 }, 'INVALID_INPUT'],
    [{ trip_id: 0, score: 5 }, 'INVALID_INPUT'],
    [{ trip_id: -1, score: 5 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 5, driver_id: 13 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 5, comment: '<b>x</b>' }, 'TEXT_CONTAINS_HTML'],
    [{ trip_id: 4, score: 5, comment: 'a'.repeat(501) }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 5, comment: '   ' }, 'INVALID_INPUT'],
    [{ trip_id: 4.5, score: 5 }, 'INVALID_INPUT'],
    [{ trip_id: 4, score: 5, customer_id: 2 }, 'INVALID_INPUT'],
  ];
  for (const [body, code] of cases) {
    const r = await rate(body);
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, JSON.stringify(body).slice(0, 60));
  }
  const j = await rate('{abc');
  assert.equal(j.status, 400);
  assert.deepEqual(j.body, { error: 'INVALID_JSON' });
  assert.equal(ratingDb('select count(*) from ratings'), before);
});

test('AC-DG-06 (mục 20, 28): không token → 401 TOKEN_MISSING; TX1 không body → 403 FORBIDDEN (role trước body); AD1 → 403 FORBIDDEN', async () => {
  const a = await call('POST', '/ratings', { body: { trip_id: 4, score: 5 } });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, { error: 'TOKEN_MISSING' });
  const b = await call('POST', '/ratings', { token: tx1 });
  assert.equal(b.status, 403, b.text);
  assert.deepEqual(b.body, { error: 'FORBIDDEN' });
  const c = await rate({ trip_id: 4, score: 5 }, ad1);
  assert.equal(c.status, 403);
  assert.deepEqual(c.body, { error: 'FORBIDDEN' });
});

test('AC-DG-09 (mục 20, A35): ?trip_id=4 bằng KH1, TX3, AD1 → 200 (rating, score 5, created_at); TX1, KH2 → 403 NOT_OWNER; ?trip_id=5 → 404 RATING_NOT_FOUND', async () => {
  for (const tok of [kh1, tx3, ad1]) {
    const r = await call('GET', '/ratings?trip_id=4', { token: tok });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ ...r.body, created_at: undefined }, {
      rating_id: S.r4.rating_id, trip_id: 4, driver_id: 13, score: 5, created_at: undefined,
    });
    assert.match(r.body.created_at, /Z$/);
  }
  for (const tok of [tx1, kh2]) {
    const r = await call('GET', '/ratings?trip_id=4', { token: tok });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'NOT_OWNER' });
  }
  const n = await call('GET', '/ratings?trip_id=5', { token: kh1 });
  assert.equal(n.status, 404);
  assert.deepEqual(n.body, { error: 'RATING_NOT_FOUND' });
});

test('AC-DG-10 (mục 20, A36): ?driver_id=11 bằng KH1, TX1, AD1 → {11, avg 5, count 1}; ?driver_id=999 → {999, count 0} không avg', async () => {
  for (const tok of [kh1, tx1, ad1]) {
    const r = await call('GET', '/ratings?driver_id=11', { token: tok });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { driver_id: 11, avg: 5, count: 1 });
  }
  const z = await call('GET', '/ratings?driver_id=999', { token: kh1 });
  assert.equal(z.status, 200);
  assert.deepEqual(z.body, { driver_id: 999, count: 0 });
});

test('AC-DG-11 (mục 20, 25): thiếu query, có cả hai, page lạ → INVALID_INPUT; trip_id=abc, "4 OR 1=1" → INVALID_ID; không token → 401', async () => {
  const cases = [
    ['', 400, 'INVALID_INPUT'],
    ['?trip_id=4&driver_id=11', 400, 'INVALID_INPUT'],
    ['?trip_id=abc', 400, 'INVALID_ID'],
    ['?trip_id=4%20OR%201=1', 400, 'INVALID_ID'],
    ['?trip_id=4&page=1', 400, 'INVALID_INPUT'],
  ];
  for (const [q, status, code] of cases) {
    const r = await call('GET', `/ratings${q}`, { token: kh1 });
    assert.equal(r.status, status, `${q} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, q);
  }
  const n = await call('GET', '/ratings?trip_id=4');
  assert.equal(n.status, 401);
  assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
});

test('AC-DG-12 (mục 20, S7): gọi thẳng trip-service:50055 GetTripForRating — system → {4, COMPLETED, 1, 13}; 999 → NOT_FOUND; 0 → INVALID_ARGUMENT; không x-role → IDENTITY_MISSING; customer → FORBIDDEN', () => {
  const call7 = (trip_id, metadata) => grpcInternal({
    target: 'trip-service:50055', proto: 'trip.proto', pkg: 'cab.trip.v1', service: 'TripService', method: 'GetTripForRating',
    request: { trip_id }, metadata,
  });
  const ok = call7(4, { 'x-role': 'system' });
  assert.deepEqual(ok.response, { trip_id: 4, status: 'COMPLETED', customer_id: 1, driver_id: 13 });
  const cases = [
    [call7(999, { 'x-role': 'system' }), 'NOT_FOUND', 'TRIP_NOT_FOUND'],
    [call7(0, { 'x-role': 'system' }), 'INVALID_ARGUMENT', 'INVALID_INPUT'],
    [call7(4, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING'],
    [call7(4, { 'x-role': 'customer', 'x-account-id': '1' }), 'PERMISSION_DENIED', 'FORBIDDEN'],
  ];
  cases.forEach(([r, status, details], i) => assert.deepEqual(r.error && [r.error.status, r.error.details], [status, details], `#${i} ${JSON.stringify(r)}`));
});

test('AC-DG-14 (mục 7, 4): không có topic nào của rating-service; tạo đánh giá không sinh message mới ở 7 topic', async () => {
  const res = await fetch(`${KAFKA_UI_URL}/api/clusters/cab/topics?showInternal=false&perPage=100`, { signal: AbortSignal.timeout(10_000) });
  const names = (await res.json()).topics.map((t) => t.name);
  assert.ok(!names.some((n) => /rating/i.test(n)), `có topic rating: ${names.join(',')}`);
  // Chỉ AC-DG-01 tạo đánh giá trong khoảng từ ảnh chụp tới đây; các AC khác chỉ đọc hoặc bị từ chối.
  for (const t of TOPICS) {
    const fresh = await kafkaNew(t, S.snap[t]);
    assert.equal(fresh.length, 0, `${t} có ${fresh.length} message mới`);
  }
});

test('AC-DG-08 (mục 20, V5): chuyến KH1 – TX1 vừa COMPLETED, A34 score 4 + comment "Tai xe vui ve" → 201 driver 11, comment, avg 4.5, count 2; driver_ratings 11 = 2 | 9', async () => {
  const c = await newTrip(kh1, tx1);
  await advance(c.trip_id, tx1, 'ACCEPTED', 'COMPLETED');
  await waitDriverFree(11, 3000);
  const r = await rate({ trip_id: c.trip_id, score: 4, comment: '  Tai xe vui ve ' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual({ ...r.body, rating_id: 0 }, {
    rating_id: 0, trip_id: c.trip_id, driver_id: 11, score: 4, comment: 'Tai xe vui ve', driver_avg: 4.5, driver_count: 2,
  });
  assert.equal(driverRow(11), '2|9');
  const g = await call('GET', '/ratings?driver_id=11', { token: kh2 });
  assert.deepEqual(g.body, { driver_id: 11, avg: 4.5, count: 2 });
  const v = await call('GET', `/ratings?trip_id=${c.trip_id}`, { token: tx1 });
  assert.equal(v.status, 200);
  assert.equal(v.body.comment, 'Tai xe vui ve');
});
