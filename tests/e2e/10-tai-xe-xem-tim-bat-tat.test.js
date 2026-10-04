// Spec 12-13-21-23 — xem tài xế theo mã (mục 12), tìm quanh tọa độ 1 km (mục 13), bật / tắt và vị trí (mục 23).
// Dùng seed TX1–TX8 quanh P0 = (10.82, 106.68). Test có đổi TX1 (OFFLINE → ONLINE) và vị trí TX5; hook `after`
// luôn trả TX1 về ONLINE tại (10.821, 106.68) và TX5 về (10.825, 106.68) OFFLINE như seed.
// AC-TX-33 (dừng driver-service) nằm ở 90-dung-service.test.js.
//
// Tiền điều kiện mục 13: TX1–TX4 ONLINE như seed (chưa có booking nào giữ tài xế). Nếu dev-agent đang chạy
// thử ghép tài xế làm một tài xế BUSY thì AC-TX-29/30 sẽ lệch — test in trạng thái thực tế để phân biệt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, psql, tokenOf } from './api.js';

const P0 = 'lat=10.82&lng=106.68';
const seedState = () => psql('driver-db', 'driver',
  'select driver_id, approval_status, availability, current_lat, current_lng from drivers where driver_id between 11 and 18 order by driver_id');

let kh1;
before(async () => {
  kh1 = await tokenOf(SEED.KH1);
});

after(async () => {
  const tx1 = await tokenOf(SEED.TX1);
  await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'ONLINE', lat: 10.821, lng: 106.68 } });
  const tx5 = await tokenOf(SEED.TX5);
  await call('PATCH', '/drivers/me', { token: tx5, body: { lat: 10.825, lng: 106.68 } });
  await call('PATCH', '/drivers/me', { token: tx5, body: { status: 'OFFLINE' } });
});

// ---------- Mục 12 ----------
test('AC-TX-26 (mục 12): KH1 GET /drivers/11 → 200 đúng 5 key công khai, không có license, lat, lng', async () => {
  const r = await call('GET', '/drivers/11', { token: kh1 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE' });
});

test('AC-TX-27 (mục 12): TX1 và AD1 GET /drivers/11 → 200 đầy đủ: approval_status, license GPLX-00001, lat, lng', async () => {
  for (const who of [SEED.TX1, SEED.AD1]) {
    const r = await call('GET', '/drivers/11', { token: await tokenOf(who) });
    assert.equal(r.status, 200, `${who} ${r.text}`);
    assert.equal(r.body.driver_id, 11);
    assert.equal(r.body.approval_status, 'APPROVED');
    assert.equal(r.body.license, 'GPLX-00001');
    assert.equal(r.body.lat, 10.821);
    assert.equal(r.body.lng, 106.68);
    assert.equal(r.body.reason, undefined);
  }
});

test('Spec mục 8.1: tài xế xem tài xế KHÁC chỉ thấy phần công khai', async () => {
  const r = await call('GET', '/drivers/12', { token: await tokenOf(SEED.TX1) });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['driver_id', 'name', 'plate', 'status', 'vehicle']);
  assert.equal(r.body.vehicle, 'MOTORBIKE');
});

test('AC-TX-28 (mục 12, 404/400/401): /drivers/999 → 404; /drivers/17 (chờ duyệt) bằng KH1 → 404, AD1 → 200; /drivers/abc → 400 INVALID_ID; không token → 401', async () => {
  const a = await call('GET', '/drivers/999', { token: kh1 });
  assert.equal(a.status, 404);
  assert.deepEqual(a.body, { error: 'DRIVER_NOT_FOUND' });
  const b = await call('GET', '/drivers/17', { token: kh1 });
  assert.equal(b.status, 404);
  assert.deepEqual(b.body, { error: 'DRIVER_NOT_FOUND' });
  const c = await call('GET', '/drivers/17', { token: await tokenOf(SEED.AD1) });
  assert.equal(c.status, 200);
  assert.equal(c.body.approval_status, 'PENDING');
  for (const id of ['abc', '0', '11%20OR%201=1']) {
    const d = await call('GET', `/drivers/${id}`, { token: kh1 });
    assert.equal(d.status, 400, id);
    assert.deepEqual(d.body, { error: 'INVALID_ID' });
  }
  const e = await call('GET', '/drivers/11');
  assert.equal(e.status, 401);
  assert.deepEqual(e.body, { error: 'TOKEN_MISSING' });
});

// ---------- Mục 13 ----------
test('AC-TX-29 (mục 13): GET /drivers?lat=10.82&lng=106.68&limit=2 → TX1 (111 m), TX2 (222 m); pagination {1, 2, total 4, total_pages 2}', async (tt) => {
  const r = await call('GET', `/drivers?${P0}&limit=2`, { token: kh1 });
  assert.equal(r.status, 200, r.text);
  if (r.body.pagination.total !== 4) tt.diagnostic(`Trạng thái seed lúc chạy:\n${seedState()}`);
  assert.deepEqual(r.body, {
    data: [
      { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', distance_m: 111 },
      { driver_id: 12, name: 'Tài Xế 2', vehicle: 'MOTORBIKE', plate: '59A-00002', distance_m: 222 },
    ],
    pagination: { page: 1, limit: 2, total: 4, total_pages: 2 },
  });
});

test('AC-TX-30 (mục 13): &page=2 → TX3 (334), TX4 (445); &vehicle=car_4 → TX1, TX3 total 2; &page=3 → data [] total 4', async () => {
  const p2 = await call('GET', `/drivers?${P0}&limit=2&page=2`, { token: kh1 });
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.body.data.map((d) => [d.driver_id, d.distance_m]), [[13, 334], [14, 445]]);
  assert.deepEqual(p2.body.pagination, { page: 2, limit: 2, total: 4, total_pages: 2 });
  const v = await call('GET', `/drivers?${P0}&limit=2&vehicle=car_4`, { token: kh1 });
  assert.equal(v.status, 200);
  assert.deepEqual(v.body.data.map((d) => d.driver_id), [11, 13]);
  assert.equal(v.body.pagination.total, 2);
  const p3 = await call('GET', `/drivers?${P0}&limit=2&page=3`, { token: kh1 });
  assert.equal(p3.status, 200);
  assert.deepEqual(p3.body.data, []);
  assert.equal(p3.body.pagination.total, 4);
});

test('Mục 13: mặc định page 1, limit 10; không trả tọa độ tài xế; chỉ ONLINE + APPROVED + trong 1 km (không có TX5, TX6, TX7, TX8)', async () => {
  const r = await call('GET', `/drivers?${P0}`, { token: kh1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pagination, { page: 1, limit: 10, total: 4, total_pages: 1 });
  assert.deepEqual(r.body.data.map((d) => d.driver_id), [11, 12, 13, 14]);
  for (const d of r.body.data) {
    assert.deepEqual(Object.keys(d).sort(), ['distance_m', 'driver_id', 'name', 'plate', 'vehicle']);
    assert.ok(d.distance_m <= 1000);
  }
  // Admin cũng tìm được (role của biến thể A12).
  const a = await call('GET', `/drivers?${P0}`, { token: await tokenOf(SEED.AD1) });
  assert.equal(a.status, 200);
  assert.equal(a.body.pagination.total, 4);
  // Ở xa mọi tài xế → 200 data [] (không phải 404).
  const far = await call('GET', '/drivers?lat=10.9&lng=106.9', { token: kh1 });
  assert.equal(far.status, 200);
  assert.deepEqual(far.body, { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } });
});

test('Mục 13 (BRULE01): đứng tại TX8 (10.84) thấy TX8; tại điểm cách TX8 > 1 km thì không', async () => {
  const at = await call('GET', '/drivers?lat=10.84&lng=106.68', { token: kh1 });
  assert.equal(at.status, 200);
  assert.ok(at.body.data.some((d) => d.driver_id === 18 && d.distance_m === 0));
  const out = await call('GET', '/drivers?lat=10.8305&lng=106.68', { token: kh1 }); // ≈ 1 056 m tới TX8
  assert.ok(!out.body.data.some((d) => d.driver_id === 18));
});

test('AC-TX-31 (mục 13, 400): chỉ lat; lat 91; lat abc; limit 0; limit 51; vehicle BUS; &radius=2000; page 0; page abc', async () => {
  const cases = [
    ['lat=10.82', 'INVALID_INPUT'],
    ['lng=106.68', 'INVALID_INPUT'],
    ['lat=91&lng=106.68', 'INVALID_COORDINATES'],
    ['lat=10.82&lng=181', 'INVALID_COORDINATES'],
    ['lat=abc&lng=1', 'INVALID_INPUT'],
    [`${P0}&limit=0`, 'INVALID_PAGINATION'],
    [`${P0}&limit=51`, 'INVALID_PAGINATION'],
    [`${P0}&page=0`, 'INVALID_PAGINATION'],
    [`${P0}&page=abc`, 'INVALID_PAGINATION'],
    [`${P0}&vehicle=BUS`, 'INVALID_INPUT'],
    [`${P0}&radius=2000`, 'INVALID_INPUT'],
    [`${P0}&approval_status=PENDING`, 'INVALID_INPUT'],
    ["lat=10.82'%20OR%201=1--&lng=106.68", 'INVALID_INPUT'],
  ];
  for (const [q, code] of cases) {
    const r = await call('GET', `/drivers?${q}`, { token: kh1 });
    assert.equal(r.status, 400, `${q} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, q);
  }
  const ok = await call('GET', `/drivers?${P0}&limit=50`, { token: kh1 });
  assert.equal(ok.status, 200);
});

test('AC-TX-32 (mục 13, 403): A12 bằng token TX1 → 403 FORBIDDEN; không token → 401', async () => {
  const r = await call('GET', `/drivers?${P0}`, { token: await tokenOf(SEED.TX1) });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'FORBIDDEN' });
  const n = await call('GET', `/drivers?${P0}`);
  assert.equal(n.status, 401);
  assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
});

// ---------- Mục 23 ----------
test('AC-TX-19 (mục 23): TX1 PATCH /drivers/me {"status":"OFFLINE"} → 200 {11, OFFLINE}; A12 tại P0 không còn TX1, total 3', async () => {
  const tx1 = await tokenOf(SEED.TX1);
  const r = await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'OFFLINE' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 11, status: 'OFFLINE' });
  const s = await call('GET', `/drivers?${P0}`, { token: kh1 });
  assert.ok(!s.body.data.some((d) => d.driver_id === 11));
  assert.equal(s.body.pagination.total, 3);
  // Khách xem theo mã thấy OFFLINE.
  const g = await call('GET', '/drivers/11', { token: kh1 });
  assert.equal(g.body.status, 'OFFLINE');
});

test('AC-TX-20 (mục 23): A17 {"status":"ONLINE"} không tọa độ → 200 ONLINE, lat 10.821, lng 106.68 (vị trí cũ); A12 lại có TX1', async () => {
  const tx1 = await tokenOf(SEED.TX1);
  const r = await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'ONLINE' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 11, status: 'ONLINE', lat: 10.821, lng: 106.68 });
  const s = await call('GET', `/drivers?${P0}&limit=1`, { token: kh1 });
  assert.equal(s.body.data[0].driver_id, 11);
  assert.equal(s.body.pagination.total, 4);
  // Bật lại khi đang ONLINE → 200 (TX9); chữ thường được chấp nhận.
  const again = await call('PATCH', '/drivers/me', { token: tx1, body: { status: 'online' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'ONLINE');
});

test('AC-TX-23 (mục 23, 409/400): TX6 BUSY tắt → 409 DRIVER_NOT_AVAILABLE; bật → 409; TX1 {"status":"BUSY"} → 400 INVALID_INPUT', async () => {
  const tx6 = await tokenOf(SEED.TX6);
  for (const status of ['OFFLINE', 'ONLINE']) {
    const r = await call('PATCH', '/drivers/me', { token: tx6, body: { status } });
    assert.equal(r.status, 409, status);
    assert.deepEqual(r.body, { error: 'DRIVER_NOT_AVAILABLE' });
  }
  assert.equal(psql('driver-db', 'driver', 'select availability from drivers where driver_id = 16'), 'BUSY');
  const b = await call('PATCH', '/drivers/me', { token: await tokenOf(SEED.TX1), body: { status: 'BUSY' } });
  assert.equal(b.status, 400);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
});

test('Mục 23 (400): body rỗng; field lạ; OFFLINE kèm lat; ONLINE thiếu nửa cặp tọa độ; body không phải JSON', async () => {
  const tx1 = await tokenOf(SEED.TX1);
  const cases = [
    [{}, 'INVALID_INPUT'],
    [{ status: 'ONLINE', foo: 1 }, 'INVALID_INPUT'],
    [{ status: 'OFFLINE', lat: 10.82, lng: 106.68 }, 'INVALID_INPUT'],
    [{ status: 'ONLINE', lat: 10.82 }, 'INVALID_INPUT'],
    [{ status: 'ONLINE', lat: 95, lng: 106.68 }, 'INVALID_COORDINATES'],
    ['{hong', 'INVALID_JSON'],
  ];
  for (const [body, code] of cases) {
    const r = await call('PATCH', '/drivers/me', { token: tx1, body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, JSON.stringify(body));
  }
  assert.equal(psql('driver-db', 'driver', 'select availability from drivers where driver_id = 11'), 'ONLINE');
});

test('AC-TX-25 (mục 23, 13 — A18): TX5 cập nhật vị trí → 200; lat 91 → INVALID_COORDINATES; thiếu lng, lat là chuỗi → INVALID_INPUT; TX5 vẫn OFFLINE, không có trong A12', async () => {
  const tx5 = await tokenOf(SEED.TX5);
  const r = await call('PATCH', '/drivers/me', { token: tx5, body: { lat: 10.8205, lng: 106.68 } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 15, lat: 10.8205, lng: 106.68 });
  const cases = [
    [{ lat: 91, lng: 106.68 }, 'INVALID_COORDINATES'],
    [{ lat: 10.82 }, 'INVALID_INPUT'],
    [{ lat: '10.82', lng: 106.68 }, 'INVALID_INPUT'],
  ];
  for (const [body, code] of cases) {
    const x = await call('PATCH', '/drivers/me', { token: tx5, body });
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.deepEqual(x.body, { error: code }, JSON.stringify(body));
  }
  assert.equal(psql('driver-db', 'driver', 'select availability || \'|\' || current_lat from drivers where driver_id = 15'), 'OFFLINE|10.8205');
  const s = await call('GET', `/drivers?${P0}`, { token: kh1 });
  assert.ok(!s.body.data.some((d) => d.driver_id === 15));
});
