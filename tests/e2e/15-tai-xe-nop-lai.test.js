// Spec 12-13-21-23 (sửa 2026-10-05, FR43) — tài xế bị từ chối nộp lại hồ sơ bằng chính A11 → 200 `resubmitted: true`;
// kèm vế thông báo duyệt / từ chối của spec 17-18 (AC-TB-03, AC-TB-09). AC-TX-15 (trên TX7), AC-TX-34…39.
//
// Chuỗi trên TX7 (17) đúng như spec: từ chối "thieu giay to" → TX7 xem lý do → nộp lại → 409 khi nộp lần nữa →
// từ chối lần hai "anh mo" (AC-TB-09 / AC-TX-39) → nộp lại lần hai → admin duyệt (AC-TX-36).
// Hook `after` trả TX7 về seed (PENDING, "Tài Xế 7", không lý do, chưa xét, xe 59A-00007 CAR_4) bằng SQL.
// AC-TX-37, AC-TX-38 làm trên tài xế tạo mới (0599…), được xóa ở `after`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, createTracker, kafkaMessages, newDriverWithApplication, newPlate, psql, tokenOf } from './api.js';
import { kafkaNew, kafkaSnapshot, waitKafkaNew } from './dat-xe.js';
import { kafkaProduce, mongoEval, notes, waitNote } from './chuyen-di.js';
import { sleep } from './helpers.js';

const t = createTracker();
let ad1, tx1, tx7;
const S = {};
const REJECT_BODY = 'Hồ sơ của bạn bị từ chối. Xem lý do tại hồ sơ tài xế và nộp lại.';
const TX7_FORM = { name: 'Tai Xe 7', license: 'GPLX-00007', plate: '59A-00007' };
const driversDb = (sql) => psql('driver-db', 'driver', sql);
const review = (id, body) => call('PATCH', `/drivers/${id}`, { token: ad1, body });
const rejectedNotes = (id) => mongoEval(
  `db.notifications.find({ recipient_id: NumberLong("${id}"), type: 'APPLICATION_REJECTED' }).toArray().map((d) => d.event_id).join(',')`,
).split(',').filter(Boolean);

before(async () => {
  [ad1, tx1, tx7] = await Promise.all([SEED.AD1, SEED.TX1, '0910000007'].map((p) => tokenOf(p)));
  assert.equal(driversDb("select approval_status || '|' || coalesce(reject_reason, '-') from drivers where driver_id = 17"), 'PENDING|-',
    'Tiền điều kiện: TX7 PENDING như seed');
  S.snapK7 = await kafkaSnapshot('driver.application-reviewed');
});

after(() => {
  t.cleanup();
  // Trả TX7 về seed (spec 12-13-21-23 mục 7: "Tài Xế 7", PENDING, OFFLINE, xe 59A-00007 CAR_4). Số giấy phép đã được
  // nộp lại đúng "GPLX-00007" (cùng giá trị seed, mã hóa lại với IV mới).
  driversDb("update drivers set full_name = 'Tài Xế 7', approval_status = 'PENDING', availability = 'OFFLINE', current_booking_id = null, "
    + "reject_reason = null, reviewed_by = null, reviewed_at = null, updated_at = now() where driver_id = 17; "
    + "update vehicles set vehicle_type = 'CAR_4', license_plate = '59A-00007', brand = null, model = null, color = null, updated_at = now() where driver_id = 17");
});

test('AC-TX-15 (mục 22, TX7): A16 PATCH /drivers/17 {REJECTED, "thieu giay to"} [AD1] → 200; Kafka K7 result REJECTED, không có lý do', async () => {
  const r = await review(17, { approval_status: 'REJECTED', reason: 'thieu giay to' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 17, approval_status: 'REJECTED', reason: 'thieu giay to' });
  const k7 = await waitKafkaNew('driver.application-reviewed', S.snapK7, (m) => m.key === '17', 3000);
  assert.equal(k7.length, 1);
  assert.equal(k7[0].content.data.result, 'REJECTED');
  assert.ok(!k7[0].raw.includes('thieu giay to'), 'K7 chứa lý do');
  S.k7First = k7[0];
});

test('AC-TB-03 (mục 22, AC20 — vế từ chối): ≈ 1 s A33 [TX7] có APPLICATION_REJECTED với body mới đúng từng chữ, không chứa lý do', async () => {
  const list = await waitNote(tx7, (n) => n.type === 'APPLICATION_REJECTED');
  const n = list.find((x) => x.type === 'APPLICATION_REJECTED');
  assert.ok(n, 'TX7 có APPLICATION_REJECTED');
  assert.equal(n.title, 'Hồ sơ tài xế bị từ chối');
  assert.equal(n.body, REJECT_BODY);
  assert.ok(!JSON.stringify(n).includes('thieu giay to'));
  assert.deepEqual(n.data, { driver_id: 17, status: 'REJECTED' });
});

test('AC-TX-34 (mục 21, 22, FR43, AC30): TX7 A14 thấy REJECTED + reason → A11 nộp lại → 200 PENDING, OFFLINE, resubmitted, không reason → A14 PENDING; DB lý do / người xét NULL; không K7 mới, không thông báo mới', async () => {
  const a = await call('GET', '/drivers/17', { token: tx7 });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.approval_status, 'REJECTED');
  assert.equal(a.body.reason, 'thieu giay to');
  const notesBefore = (await notes(tx7)).pagination.total;
  const snap = await kafkaSnapshot('driver.application-reviewed');
  const r = await call('POST', '/drivers', { token: tx7, body: TX7_FORM });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, {
    driver_id: 17, name: 'Tai Xe 7', vehicle: 'CAR_4', plate: '59A-00007', status: 'OFFLINE', approval_status: 'PENDING',
    license: 'GPLX-00007', resubmitted: true,
  });
  const b = await call('GET', '/drivers/17', { token: tx7 });
  assert.equal(b.body.approval_status, 'PENDING');
  assert.equal(b.body.reason, undefined);
  assert.equal(driversDb("select coalesce(reject_reason, 'NULL') || '|' || coalesce(reviewed_by::text, 'NULL') || '|' || coalesce(reviewed_at::text, 'NULL') from drivers where driver_id = 17"), 'NULL|NULL|NULL');
  await sleep(1500);
  assert.equal((await kafkaNew('driver.application-reviewed', snap)).filter((m) => m.key === '17').length, 0, 'nộp lại không phát K7');
  assert.equal((await notes(tx7)).pagination.total, notesBefore, 'nộp lại không tạo thông báo');
});

test('AC-TX-35 (mục 21, 409): TX7 đang PENDING nộp lại → 409 DRIVER_ALREADY_EXISTS; TX1 APPROVED nộp → 409 DRIVER_ALREADY_EXISTS; hồ sơ không đổi', async () => {
  const a = await call('POST', '/drivers', { token: tx7, body: { ...TX7_FORM, name: 'Doi Ten' } });
  assert.equal(a.status, 409, a.text);
  assert.deepEqual(a.body, { error: 'DRIVER_ALREADY_EXISTS' });
  const b = await call('POST', '/drivers', { token: tx1, body: { name: 'Tai Xe 1', license: 'GPLX-00001', plate: '59A-00001' } });
  assert.equal(b.status, 409, b.text);
  assert.deepEqual(b.body, { error: 'DRIVER_ALREADY_EXISTS' });
  const g = await call('GET', '/drivers/17', { token: tx7 });
  assert.equal(g.body.name, 'Tai Xe 7');
  assert.equal(g.body.approval_status, 'PENDING');
  const g1 = await call('GET', '/drivers/11', { token: ad1 });
  assert.equal(g1.body.approval_status, 'APPROVED');
});

test('AC-TB-09 + AC-TX-39 (mục 22, FR43, N4): từ chối lần hai "anh mo" → TX7 A14 reason "anh mo", hai APPLICATION_REJECTED (hai event_id); gửi lại y hệt K7 lần hai → vẫn hai; nộp lại lần hai → 200 resubmitted', async () => {
  const snap = await kafkaSnapshot('driver.application-reviewed');
  const r = await review(17, { approval_status: 'REJECTED', reason: 'anh mo' });
  assert.equal(r.status, 200, r.text);
  const k7 = await waitKafkaNew('driver.application-reviewed', snap, (m) => m.key === '17', 3000);
  assert.equal(k7.length, 1);
  assert.notEqual(k7[0].content.event_id, S.k7First.content.event_id);
  const own = await call('GET', '/drivers/17', { token: tx7 });
  assert.equal(own.body.approval_status, 'REJECTED');
  assert.equal(own.body.reason, 'anh mo');
  await waitNote(tx7, () => rejectedNotes(17).length >= 2, 3000);
  const ids = rejectedNotes(17);
  assert.equal(ids.length, 2, `có ${ids.length} APPLICATION_REJECTED`);
  assert.equal(new Set(ids).size, 2);
  const list = (await notes(tx7)).data.filter((n) => n.type === 'APPLICATION_REJECTED');
  assert.equal(list.length, 2);
  for (const n of list) assert.equal(n.body, REJECT_BODY);
  // Gửi lại y hệt message K7 lần hai (cùng event_id) — Kafka UI chỉ đọc nên dùng console producer (xem chuyen-di.js).
  await kafkaProduce('driver.application-reviewed', { key: k7[0].key, content: k7[0].raw });
  const dup = await waitKafkaNew('driver.application-reviewed', snap, (m) => m.key === '17' && m.content.event_id === k7[0].content.event_id
    && !(m.partition === k7[0].partition && m.offset === k7[0].offset), 5000);
  assert.equal(dup.length, 1, 'message lặp đã vào topic');
  await sleep(2500);
  assert.equal(rejectedNotes(17).length, 2, 'event lặp không tạo thêm thông báo');
  const re = await call('POST', '/drivers', { token: tx7, body: TX7_FORM });
  assert.equal(re.status, 200, re.text);
  assert.equal(re.body.resubmitted, true);
  assert.equal(re.body.approval_status, 'PENDING');
});

test('AC-TX-36 (mục 22): A13 ?approval_status=PENDING có TX7 → A15 duyệt → 200 APPROVED (không 409); K7 APPROVED; TX7 có APPLICATION_APPROVED và các APPLICATION_REJECTED cũ', async () => {
  const l = await call('GET', '/drivers?approval_status=PENDING&limit=50', { token: ad1 });
  assert.equal(l.status, 200);
  assert.ok(l.body.data.some((d) => d.driver_id === 17));
  const snap = await kafkaSnapshot('driver.application-reviewed');
  const r = await review(17, { approval_status: 'APPROVED' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: 17, approval_status: 'APPROVED' });
  const k7 = await waitKafkaNew('driver.application-reviewed', snap, (m) => m.key === '17', 3000);
  assert.equal(k7[0]?.content.data.result, 'APPROVED');
  const list = await waitNote(tx7, (n) => n.type === 'APPLICATION_APPROVED');
  const ap = list.find((n) => n.type === 'APPLICATION_APPROVED');
  assert.ok(ap);
  assert.deepEqual(ap.data, { driver_id: 17, status: 'APPROVED' });
  assert.equal(list.filter((n) => n.type === 'APPLICATION_REJECTED').length, 2);
});

test('AC-TB-03 (mục 21, 22 — vế duyệt): tài xế mới (đăng ký OTP, nộp hồ sơ) được A15 duyệt → A33 của tài xế đó có APPLICATION_APPROVED', async () => {
  const d = await newDriverWithApplication(t);
  const r = await review(d.driver_id, { approval_status: 'APPROVED' });
  assert.equal(r.status, 200, r.text);
  const list = await waitNote(d.token, (n) => n.type === 'APPLICATION_APPROVED');
  const n = list.find((x) => x.type === 'APPLICATION_APPROVED');
  assert.ok(n, 'có APPLICATION_APPROVED');
  assert.equal(n.body, `Hồ sơ tài xế ${d.driver_id}`);
});

test('AC-TX-37 (mục 21, nộp lại lỗi): hồ sơ REJECTED nộp lại biển 59A-00001 → 409 LICENSE_PLATE_ALREADY_EXISTS; thiếu license → 400 INVALID_INPUT; name <b> → 400 TEXT_CONTAINS_HTML; sau cả ba vẫn REJECTED, reason cũ, biển cũ', async () => {
  const d = await newDriverWithApplication(t);
  const rj = await review(d.driver_id, { approval_status: 'REJECTED', reason: 'sai bien' });
  assert.equal(rj.status, 200);
  const cases = [
    [{ name: 'Tai Xe', license: 'GPLX-77', plate: '59A-00001' }, 409, 'LICENSE_PLATE_ALREADY_EXISTS'],
    [{ name: 'Tai Xe', plate: newPlate() }, 400, 'INVALID_INPUT'],
    [{ name: '<b>x</b>', license: 'GPLX-77', plate: newPlate() }, 400, 'TEXT_CONTAINS_HTML'],
  ];
  for (const [body, status, code] of cases) {
    const r = await call('POST', '/drivers', { token: d.token, body });
    assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code });
  }
  const g = await call('GET', `/drivers/${d.driver_id}`, { token: d.token });
  assert.equal(g.body.approval_status, 'REJECTED');
  assert.equal(g.body.reason, 'sai bien');
  assert.equal(g.body.plate, d.plate);
  assert.equal(g.body.name, 'Tai Xe Test');
});

test('AC-TX-38 (mục 21): hồ sơ REJECTED nộp lại giữ nguyên biển của mình, đổi vehicle MOTORBIKE, không gửi brand → 200 PENDING, MOTORBIKE; brand về NULL', async () => {
  const d = await newDriverWithApplication(t, { brand: 'Toyota', model: 'Vios', color: 'Trang' });
  assert.equal(driversDb(`select brand from vehicles where driver_id = ${d.driver_id}`), 'Toyota');
  const rj = await review(d.driver_id, { approval_status: 'REJECTED', reason: 'x' });
  assert.equal(rj.status, 200);
  const r = await call('POST', '/drivers', { token: d.token, body: { name: 'Tai Xe Test', license: 'GPLX-99', plate: d.plate, vehicle: 'MOTORBIKE' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resubmitted, true);
  assert.equal(r.body.approval_status, 'PENDING');
  assert.equal(r.body.vehicle, 'MOTORBIKE');
  assert.equal(r.body.plate, d.plate);
  assert.equal(r.body.brand, undefined);
  assert.equal(driversDb(`select coalesce(brand, 'NULL') || '|' || coalesce(model, 'NULL') || '|' || vehicle_type from vehicles where driver_id = ${d.driver_id}`), 'NULL|NULL|MOTORBIKE');
});

test('Mục 22 (kiểm tra phụ): tin nhắn K7 của các lần xét không chứa lý do "thieu giay to", "anh mo", "sai bien"', async () => {
  for (const m of await kafkaNew('driver.application-reviewed', S.snapK7)) {
    for (const bad of ['thieu giay to', 'anh mo', 'sai bien']) assert.ok(!m.raw.includes(bad), `K7 ${m.key} chứa "${bad}"`);
  }
  assert.ok((await kafkaMessages('driver.application-reviewed')).length > 0);
});
