// Unit test logic tài xế (spec 12-13-21-23) với kho giả, bộ mã hóa thật, bộ phát event giả:
// không cần PostgreSQL, Kafka hay gRPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriverLogic, TOPIC_APPLICATION_REVIEWED } from '../src/domain/drivers.js';
import { createFieldCipher } from '../src/domain/crypto.js';
import { boundingBox, haversineMeters, normalizePlate } from '../src/domain/rules.js';

const cipher = createFieldCipher(Buffer.alloc(32, 7));
const KH1 = { accountId: '1', role: 'customer' };
const TX1 = { accountId: '11', role: 'driver' };
const AD1 = { accountId: '99', role: 'admin' };
const NEW = { accountId: '1000', role: 'driver' };

const row = (over) => ({
  driver_id: 11, full_name: 'Tài Xế 1', license_number_enc: cipher.encrypt('GPLX-00001'), approval_status: 'APPROVED',
  reject_reason: null, availability: 'ONLINE', current_lat: 10.821, current_lng: 106.68, created_at: new Date('2026-10-04T00:00:00Z'),
  vehicle_type: 'CAR_4', license_plate: '59A-00001', brand: null, model: null, color: null, ...over,
});

// Kho giả: giữ dòng trong bộ nhớ, mô phỏng PK, UNIQUE biển số, khóa ngoại loại xe bằng mã lỗi của PostgreSQL.
function setup({ publishFails = false } = {}) {
  const rows = new Map([
    [11, row()],
    [16, row({ driver_id: 16, availability: 'BUSY', current_lat: 10.826, license_plate: '59A-00006' })],
    [17, row({ driver_id: 17, approval_status: 'PENDING', availability: 'OFFLINE', current_lat: null, current_lng: null, license_plate: '59A-00007' })],
  ]);
  const published = [];
  const logs = [];
  const log = { info: (msg, f) => logs.push({ level: 'info', msg, ...f }), warn() {}, error: (msg, f) => logs.push({ level: 'error', msg, ...f }) };
  const drivers = {
    lastNearby: null,
    async insertApplication(d) {
      if (rows.has(d.driverId)) return false;
      if (![...rows.values()].every((r) => r.license_plate !== d.plate)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'vehicles_license_plate_key' });
      if (!['MOTORBIKE', 'CAR_4', 'CAR_7'].includes(d.vehicleType)) throw Object.assign(new Error('fk'), { code: '23503', constraint: 'vehicles_vehicle_type_fkey' });
      rows.set(d.driverId, row({
        driver_id: d.driverId, full_name: d.fullName, license_number_enc: d.licenseEnc, approval_status: 'PENDING', availability: 'OFFLINE',
        current_lat: null, current_lng: null, vehicle_type: d.vehicleType, license_plate: d.plate, brand: d.brand, model: d.model, color: d.color,
      }));
      return true;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async exists(id) { return rows.has(id); },
    async vehicleTypeExists(code) { return ['MOTORBIKE', 'CAR_4', 'CAR_7'].includes(code); },
    async list({ approvalStatus, limit, offset }) {
      const all = [...rows.values()].filter((r) => approvalStatus === null || r.approval_status === approvalStatus);
      return { rows: all.slice(offset, offset + limit), total: all.length };
    },
    async findNearby(args) {
      this.lastNearby = args;
      return { rows: [{ driver_id: 11, full_name: 'Tài Xế 1', vehicle_type: 'CAR_4', license_plate: '59A-00001', distance: 111.19 }], total: 4 };
    },
    async review({ driverId, approvalStatus, reviewedBy, reason }) {
      const r = rows.get(driverId);
      if (!r || r.approval_status !== 'PENDING') return null;
      Object.assign(r, { approval_status: approvalStatus, reject_reason: reason, reviewed_by: reviewedBy });
      return { driver_id: driverId, approval_status: approvalStatus, reject_reason: reason };
    },
    async updateAvailabilityLocked(id, decide) {
      const r = rows.get(id);
      if (!r) return null;
      const next = decide({ ...r }); // ném lỗi = ROLLBACK, không đổi gì
      r.availability = next.availability;
      if (next.lat !== undefined) { r.current_lat = next.lat; r.current_lng = next.lng; }
      return { driver_id: id, availability: r.availability, current_lat: r.current_lat, current_lng: r.current_lng };
    },
    async updateLocation({ driverId, lat, lng }) {
      const r = rows.get(driverId);
      if (!r) return null;
      Object.assign(r, { current_lat: lat, current_lng: lng });
      return { driver_id: driverId, current_lat: lat, current_lng: lng };
    },
  };
  const events = {
    async publish(topic, key, data) {
      if (publishFails) throw Object.assign(new Error('down'), { name: 'KafkaJSConnectionError' });
      published.push({ topic, key, data });
    },
  };
  return { logic: createDriverLogic({ drivers, cipher, events, log }), rows, published, logs, drivers };
}

const rejectsWith = (promise, kind, code) => assert.rejects(promise, (err) => err.kind === kind && err.code === code);
const APPLY = { name: '  Tai Xe Moi ', license: 'gplx-99', plate: '59a 99999', vehicle: 'CAR_4' };

// ---------- quy tắc ----------

test('Haversine: (10.82,106.68)→(10.821,106.68) ≈ 111 m; seed TX8 ≈ 2 224 m', () => {
  assert.equal(Math.round(haversineMeters(10.82, 106.68, 10.821, 106.68)), 111);
  assert.equal(Math.round(haversineMeters(10.82, 106.68, 10.826, 106.68)), 667);
  assert.equal(Math.round(haversineMeters(10.82, 106.68, 10.84, 106.68)), 2224);
});

test('khung chữ nhật chứa trọn hình tròn 1 km: điểm ở mép đông / bắc 999 m vẫn nằm trong khung', () => {
  const { dLat, dLng } = boundingBox(10.82);
  assert.ok(haversineMeters(10.82, 106.68, 10.82 + dLat, 106.68) >= 1000 - 1);
  assert.ok(haversineMeters(10.82, 106.68, 10.82, 106.68 + dLng) >= 1000 - 1);
  assert.ok(dLng > dLat); // xa xích đạo thì một độ kinh tuyến ngắn hơn → khung theo lng rộng hơn
});

test('biển số: chữ hoa, bỏ khoảng trắng, GIỮ `-` và `.` (TX4)', () => {
  assert.equal(normalizePlate('59a-00001'), '59A-00001');
  assert.equal(normalizePlate('59a 00001'), '59A00001');
  assert.equal(normalizePlate('51F-123.45'), '51F-123.45');
  assert.throws(() => normalizePlate('59/A'), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => normalizePlate('<b>'), (e) => e.code === 'TEXT_CONTAINS_HTML');
});

// ---------- A11 ----------

test('A11: tạo PENDING / OFFLINE, mã = mã trong token, số giấy phép mã hóa, chủ thấy dạng đầy đủ (AC-TX-03, 12)', async () => {
  const { logic, rows, logs } = setup();
  const res = await logic.submitApplication(APPLY, NEW);
  assert.deepEqual(res, { driver_id: 1000, name: 'Tai Xe Moi', vehicle: 'CAR_4', plate: '59A99999', status: 'OFFLINE', approval_status: 'PENDING', license: 'GPLX-99' });
  const saved = rows.get(1000);
  assert.ok(Buffer.isBuffer(saved.license_number_enc));
  assert.ok(!saved.license_number_enc.toString('latin1').includes('GPLX'));
  assert.equal(cipher.decrypt(saved.license_number_enc), 'GPLX-99');
  assert.ok(!JSON.stringify(logs).includes('GPLX') && !JSON.stringify(logs).includes('Tai Xe Moi'));
});

test('A11: nộp lần hai → DRIVER_ALREADY_EXISTS; trùng biển số TX1 → LICENSE_PLATE_ALREADY_EXISTS (AC-TX-09)', async () => {
  const { logic } = setup();
  await logic.submitApplication(APPLY, NEW);
  await rejectsWith(logic.submitApplication({ ...APPLY, plate: '59A-88888' }, NEW), 'ALREADY_EXISTS', 'DRIVER_ALREADY_EXISTS');
  await rejectsWith(logic.submitApplication({ ...APPLY, plate: '59a-00001' }, { accountId: '1001', role: 'driver' }), 'ALREADY_EXISTS', 'LICENSE_PLATE_ALREADY_EXISTS');
});

test('A11: dữ liệu sai → 400; role khác driver → FORBIDDEN; thiếu metadata → IDENTITY_MISSING (AC-TX-10, 11)', async () => {
  const { logic, rows } = setup();
  await rejectsWith(logic.submitApplication({ ...APPLY, license: '' }, NEW), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.submitApplication({ ...APPLY, vehicle: 'BUS' }, NEW), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.submitApplication({ ...APPLY, name: '<b>x</b>' }, NEW), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.submitApplication({ ...APPLY, color: 'Do<' }, NEW), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.submitApplication({ ...APPLY, license: 'AB' }, NEW), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.submitApplication(APPLY, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.submitApplication(APPLY, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.submitApplication(APPLY, {}), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  assert.ok(!rows.has(1000));
});

// ---------- A14 ----------

test('A14: khách thấy đúng 5 field công khai; chủ và admin thấy đầy đủ, giấy phép đã giải mã (AC-TX-26, 27)', async () => {
  const { logic } = setup();
  assert.deepEqual(await logic.getDriver({ driver_id: 11 }, KH1), { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE' });
  const full = { driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', status: 'ONLINE', approval_status: 'APPROVED', license: 'GPLX-00001', lat: 10.821, lng: 106.68 };
  assert.deepEqual(await logic.getDriver({ driver_id: 11 }, TX1), full);
  assert.deepEqual(await logic.getDriver({ driver_id: 11 }, AD1), full);
  // Tài xế khác xem → phần công khai.
  assert.equal((await logic.getDriver({ driver_id: 11 }, { accountId: '12', role: 'driver' })).license, undefined);
});

test('A14: không có → 404; hồ sơ chờ duyệt: khách 404, admin 200 (TX3, AC-TX-28)', async () => {
  const { logic } = setup();
  await rejectsWith(logic.getDriver({ driver_id: 999 }, KH1), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
  await rejectsWith(logic.getDriver({ driver_id: 17 }, KH1), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
  const pending = await logic.getDriver({ driver_id: 17 }, AD1);
  assert.equal(pending.approval_status, 'PENDING');
  assert.equal(pending.lat, undefined); // chưa có vị trí → không có key
  await rejectsWith(logic.getDriver({ driver_id: 0 }, AD1), 'INVALID_ARGUMENT', 'INVALID_ID');
});

test('A14: bản mã hỏng → INTERNAL, log chỉ có mã tài xế', async () => {
  const { logic, rows, logs } = setup();
  rows.get(11).license_number_enc = Buffer.alloc(40, 1);
  await rejectsWith(logic.getDriver({ driver_id: 11 }, AD1), 'INTERNAL', 'INTERNAL');
  assert.deepEqual(logs.find((l) => l.msg === 'decrypt_failed'), { level: 'error', msg: 'decrypt_failed', driver_id: 11 });
});

// ---------- A12, A13 ----------

test('A12: tham số gửi xuống kho đúng (khung, bán kính 1 000 m, offset); không trả tọa độ (AC-TX-29)', async () => {
  const { logic, drivers } = setup();
  const res = await logic.findNearbyDrivers({ lat: 10.82, lng: 106.68, vehicle: 'car_4', page: 2, limit: 2 }, KH1);
  assert.deepEqual(res, {
    data: [{ driver_id: 11, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00001', distance_m: 111 }],
    pagination: { page: 2, limit: 2, total: 4, total_pages: 2 },
  });
  const args = drivers.lastNearby;
  assert.equal(args.vehicle, 'CAR_4');
  assert.equal(args.radiusM, 1000);
  assert.equal(args.offset, 2);
  assert.ok(Math.abs(args.dLat - 1000 / ((Math.PI * 6371000) / 180)) < 1e-12);
  await logic.findNearbyDrivers({ lat: 10.82, lng: 106.68, page: 1, limit: 10 }, AD1);
  assert.equal(drivers.lastNearby.vehicle, null);
});

test('A12: lỗi tọa độ, loại xe, phân trang, role (AC-TX-31, 32)', async () => {
  const { logic } = setup();
  const q = { lat: 10.82, lng: 106.68, page: 1, limit: 10 };
  await rejectsWith(logic.findNearbyDrivers({ ...q, lat: 91 }, KH1), 'INVALID_ARGUMENT', 'INVALID_COORDINATES');
  await rejectsWith(logic.findNearbyDrivers({ ...q, lng: Number.NaN }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.findNearbyDrivers({ ...q, vehicle: 'BUS' }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.findNearbyDrivers({ ...q, limit: 51 }, KH1), 'INVALID_ARGUMENT', 'INVALID_PAGINATION');
  await rejectsWith(logic.findNearbyDrivers({ ...q, page: 0 }, KH1), 'INVALID_ARGUMENT', 'INVALID_PAGINATION');
  await rejectsWith(logic.findNearbyDrivers(q, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('A13: chỉ admin; lọc theo trạng thái; không có license; created_at ISO (AC-TX-13)', async () => {
  const { logic } = setup();
  const res = await logic.listDrivers({ approval_status: 'PENDING', page: 1, limit: 10 }, AD1);
  assert.deepEqual(res, {
    data: [{ driver_id: 17, name: 'Tài Xế 1', vehicle: 'CAR_4', plate: '59A-00007', status: 'OFFLINE', approval_status: 'PENDING', created_at: '2026-10-04T00:00:00.000Z' }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
  });
  assert.equal((await logic.listDrivers({ page: 1, limit: 2 }, AD1)).pagination.total_pages, 2);
  await rejectsWith(logic.listDrivers({ approval_status: 'DONE', page: 1, limit: 10 }, AD1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.listDrivers({ page: 1, limit: 10 }, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

// ---------- A15, A16, K7 ----------

test('A15: duyệt → APPROVED, reviewed_by = admin, phát K7 không có họ tên (AC-TX-14)', async () => {
  const { logic, rows, published } = setup();
  assert.deepEqual(await logic.approveDriver({ driver_id: 17 }, AD1), { driver_id: 17, approval_status: 'APPROVED' });
  assert.equal(rows.get(17).reviewed_by, 99);
  assert.deepEqual(published, [{ topic: TOPIC_APPLICATION_REVIEWED, key: '17', data: { driver_id: 17, result: 'APPROVED' } }]);
  // Duyệt lại → 409; không có → 404 (AC-TX-16).
  await rejectsWith(logic.approveDriver({ driver_id: 17 }, AD1), 'FAILED_PRECONDITION', 'APPLICATION_ALREADY_REVIEWED');
  await rejectsWith(logic.approveDriver({ driver_id: 999 }, AD1), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
  assert.equal(published.length, 1);
});

test('A16: từ chối kèm lý do; K7 KHÔNG mang lý do; thiếu lý do → REASON_REQUIRED (AC-TX-15, 16)', async () => {
  const { logic, published, rows } = setup();
  await rejectsWith(logic.rejectDriver({ driver_id: 17, reason: '' }, AD1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.rejectDriver({ driver_id: 17, reason: '   ' }, AD1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.rejectDriver({ driver_id: 17, reason: '<i>' }, AD1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.rejectDriver({ driver_id: 17, reason: 'x'.repeat(256) }, AD1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  assert.equal(rows.get(17).approval_status, 'PENDING');
  assert.deepEqual(await logic.rejectDriver({ driver_id: 17, reason: ' thieu giay to ' }, AD1), { driver_id: 17, approval_status: 'REJECTED', reason: 'thieu giay to' });
  assert.deepEqual(published[0].data, { driver_id: 17, result: 'REJECTED' });
  // Bị từ chối không nộp lại (Q47) và không xét lại.
  await rejectsWith(logic.approveDriver({ driver_id: 17 }, AD1), 'FAILED_PRECONDITION', 'APPLICATION_ALREADY_REVIEWED');
  await rejectsWith(logic.rejectDriver({ driver_id: 17, reason: 'x' }, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('A15: Kafka lỗi → vẫn trả APPROVED, log EVENT_PUBLISH_FAILED kèm topic, key (AC-TX-18, ADR-017)', async () => {
  const { logic, rows, logs } = setup({ publishFails: true });
  assert.deepEqual(await logic.approveDriver({ driver_id: 17 }, AD1), { driver_id: 17, approval_status: 'APPROVED' });
  assert.equal(rows.get(17).approval_status, 'APPROVED');
  const line = logs.find((l) => l.msg === 'EVENT_PUBLISH_FAILED');
  assert.equal(line.level, 'error');
  assert.equal(line.topic, 'driver.application-reviewed');
  assert.equal(line.key, '17');
});

// ---------- A17, A39, A18 ----------

test('A39 → OFFLINE giữ vị trí; A17 không tọa độ dùng vị trí cũ (AC-TX-19, 20)', async () => {
  const { logic, rows } = setup();
  assert.deepEqual(await logic.setAvailability({ status: 'OFFLINE' }, TX1), { driver_id: 11, status: 'OFFLINE' });
  assert.equal(rows.get(11).current_lat, 10.821);
  assert.deepEqual(await logic.setAvailability({ status: 'ONLINE' }, TX1), { driver_id: 11, status: 'ONLINE', lat: 10.821, lng: 106.68 });
  // Lặp lại trạng thái đang có → vẫn thành công (TX9).
  assert.equal((await logic.setAvailability({ status: 'ONLINE' }, TX1)).status, 'ONLINE');
});

test('A17: chưa duyệt → DRIVER_NOT_APPROVED; chưa có vị trí → INVALID_INPUT; có tọa độ → ONLINE (AC-TX-21, 22)', async () => {
  const { logic, rows } = setup();
  const tx7 = { accountId: '17', role: 'driver' };
  await rejectsWith(logic.setAvailability({ status: 'ONLINE', lat: 10.82, lng: 106.68 }, tx7), 'FAILED_PRECONDITION', 'DRIVER_NOT_APPROVED');
  // Chưa duyệt vẫn tắt được (đang OFFLINE → 200).
  assert.equal((await logic.setAvailability({ status: 'OFFLINE' }, tx7)).status, 'OFFLINE');
  rows.get(17).approval_status = 'APPROVED';
  await rejectsWith(logic.setAvailability({ status: 'ONLINE' }, tx7), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  assert.deepEqual(await logic.setAvailability({ status: 'ONLINE', lat: 10.82, lng: 106.68 }, tx7), { driver_id: 17, status: 'ONLINE', lat: 10.82, lng: 106.68 });
});

test('A17 / A39: BUSY → DRIVER_NOT_AVAILABLE; status BUSY → INVALID_INPUT; chưa nộp hồ sơ → 404 (AC-TX-23, 24)', async () => {
  const { logic, rows } = setup();
  const tx6 = { accountId: '16', role: 'driver' };
  await rejectsWith(logic.setAvailability({ status: 'OFFLINE' }, tx6), 'FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
  await rejectsWith(logic.setAvailability({ status: 'ONLINE' }, tx6), 'FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
  assert.equal(rows.get(16).availability, 'BUSY');
  await rejectsWith(logic.setAvailability({ status: 'BUSY' }, TX1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.setAvailability({ status: 'ONLINE', lat: 10.82 }, TX1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.setAvailability({ status: 'OFFLINE', lat: 10.82, lng: 106.68 }, TX1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.setAvailability({ status: 'OFFLINE' }, NEW), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
  await rejectsWith(logic.setAvailability({ status: 'OFFLINE' }, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('A18: ghi vị trí ở mọi trạng thái; tọa độ sai → 400; chưa nộp → 404 (AC-TX-25)', async () => {
  const { logic, rows } = setup();
  const tx16 = { accountId: '16', role: 'driver' };
  assert.deepEqual(await logic.updateLocation({ lat: 10.8205, lng: 106.68 }, tx16), { driver_id: 16, lat: 10.8205, lng: 106.68 });
  assert.equal(rows.get(16).availability, 'BUSY');
  await rejectsWith(logic.updateLocation({ lat: 91, lng: 106.68 }, TX1), 'INVALID_ARGUMENT', 'INVALID_COORDINATES');
  await rejectsWith(logic.updateLocation({ lat: 10.82, lng: 106.68 }, NEW), 'NOT_FOUND', 'DRIVER_NOT_FOUND');
  await rejectsWith(logic.updateLocation({ lat: 10.82, lng: 106.68 }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
});
