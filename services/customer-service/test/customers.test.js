// Unit test cho logic hồ sơ khách (spec 11) với kho hồ sơ giả trong bộ nhớ: không cần PostgreSQL.
// Sửa 2026-10-14 (ADR-021): hồ sơ bỏ email, có số điện thoại bắt buộc.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerLogic } from '../src/domain/customers.js';
import { createFieldCipher } from '../src/domain/crypto.js';
import { checkDob, normalizeName, normalizePhone, todayInVietnam } from '../src/domain/rules.js';

const cipher = createFieldCipher(Buffer.alloc(32, 7));
const logs = [];
const log = {
  info: (msg, f) => logs.push({ level: 'info', msg, ...f }),
  warn() {},
  error: (msg, f) => logs.push({ level: 'error', msg, ...f }),
};
// 2026-10-04 10:00 giờ Việt Nam.
const NOW = Date.parse('2026-10-04T03:00:00Z');

// Kho giả: Map customer_id → dòng (byte đã mã hóa), đếm số lần đọc database.
let table;
let reads;
const profiles = {
  async insert({ customerId, nameEnc, dobEnc, phone }) {
    if (table.has(customerId)) return false;
    table.set(customerId, { customer_id: customerId, full_name_enc: nameEnc, date_of_birth_enc: dobEnc, phone });
    return true;
  },
  async findById(id) {
    reads += 1;
    return table.get(id) ?? null;
  },
  async updateLocked(id, change) {
    reads += 1;
    const row = table.get(id);
    if (!row) return null;
    const next = await change(row);
    table.set(id, { customer_id: id, full_name_enc: next.nameEnc, date_of_birth_enc: next.dobEnc, phone: next.phone });
    return next;
  },
};
const logic = createCustomerLogic({ profiles, cipher, log, now: () => NOW });

const KH1 = { accountId: '1', role: 'customer' };
const KH2 = { accountId: '2', role: 'customer' };
const KH3 = { accountId: '3', role: 'customer' };
const AD1 = { accountId: '99', role: 'admin' };
const TX1 = { accountId: '11', role: 'driver' };

function seed(id, name, dob, phone) {
  table.set(id, { customer_id: id, full_name_enc: cipher.encrypt(name), date_of_birth_enc: dob ? cipher.encrypt(dob) : null, phone });
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

beforeEach(() => {
  table = new Map();
  reads = 0;
  logs.length = 0;
  seed(1, 'Nguyễn Văn An', '2000-01-01', '0900000001');
  seed(2, 'Trần Thị Bình', '2000-02-02', '0900000002');
});

test('Get: khách xem mã của mình → hồ sơ đã giải mã, có phone, không có email (AC-HS-01)', async () => {
  assert.deepEqual(await logic.getCustomer({ customer_id: 1 }, KH1), { customer_id: 1, name: 'Nguyễn Văn An', phone: '0900000001', dob: '2000-01-01' });
});

test('Get: khách xem mã khác → NOT_OWNER, KHÔNG đọc database (AC-HS-02, HS1)', async () => {
  await rejectsWith(logic.getCustomer({ customer_id: 2 }, KH1), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.getCustomer({ customer_id: 3000 }, KH1), 'PERMISSION_DENIED', 'NOT_OWNER');
  assert.equal(reads, 0);
});

test('Get: chưa có hồ sơ → CUSTOMER_NOT_FOUND (AC-HS-03)', async () => {
  await rejectsWith(logic.getCustomer({ customer_id: 3 }, KH3), 'NOT_FOUND', 'CUSTOMER_NOT_FOUND');
});

test('Get: admin xem mọi mã; tài xế bị FORBIDDEN (AC-HS-06, 07)', async () => {
  assert.equal((await logic.getCustomer({ customer_id: 1 }, AD1)).name, 'Nguyễn Văn An');
  await rejectsWith(logic.getCustomer({ customer_id: 3000 }, AD1), 'NOT_FOUND', 'CUSTOMER_NOT_FOUND');
  await rejectsWith(logic.getCustomer({ customer_id: 1 }, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.getCustomer({ customer_id: 0 }, AD1), 'INVALID_ARGUMENT', 'INVALID_ID');
});

test('Thiếu hoặc sai metadata danh tính → IDENTITY_MISSING (HS4)', async () => {
  const identities = [{}, { accountId: '1' }, { role: 'customer' }, { accountId: 'abc', role: 'customer' }, { accountId: '1', role: 'root' }];
  for (const identity of identities) {
    await rejectsWith(logic.getCustomer({ customer_id: 1 }, identity), 'UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
});

test('Create: customer_id = mã trong token, dob vắng → không có dob; tạo lần hai → 409 (AC-HS-04, 05)', async () => {
  const expected = { customer_id: 3, name: 'Pham Duc', phone: '0901234567' };
  assert.deepEqual(await logic.createCustomer({ name: '  Pham Duc ', phone: '0901234567' }, KH3), expected);
  assert.deepEqual(await logic.getCustomer({ customer_id: 3 }, KH3), expected);
  await rejectsWith(logic.createCustomer({ name: 'Lan hai', phone: '0901234567' }, KH3), 'ALREADY_EXISTS', 'CUSTOMER_ALREADY_EXISTS');
  // Log chỉ có mã, không có họ tên, số điện thoại.
  assert.deepEqual(logs.filter((l) => l.msg === 'customer_created'), [{ level: 'info', msg: 'customer_created', customer_id: 3 }]);
  assert.ok(!JSON.stringify(logs).includes('Pham'));
  assert.ok(!JSON.stringify(logs).includes('0901234567'));
});

test('Create: họ tên, ngày sinh lưu bản mã; số điện thoại lưu rõ, đã chuẩn hóa (AC-HS-25, AC-HS-29)', async () => {
  const created = await logic.createCustomer({ name: 'Pham Duc', dob: '2001-03-10', phone: ' +84 901-234-567 ' }, KH3);
  assert.equal(created.phone, '0901234567');
  const row = table.get(3);
  assert.ok(Buffer.isBuffer(row.full_name_enc) && Buffer.isBuffer(row.date_of_birth_enc));
  assert.equal(cipher.decrypt(row.date_of_birth_enc), '2001-03-10');
  assert.equal(row.phone, '0901234567');
});

test('Create: admin, tài xế → FORBIDDEN (AC-HS-07)', async () => {
  await rejectsWith(logic.createCustomer({ name: 'X', phone: '0901234567' }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.createCustomer({ name: 'X', phone: '0901234567' }, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('Create: dữ liệu sai → 400, có < > → TEXT_CONTAINS_HTML, không ghi gì (AC-HS-10)', async () => {
  const bodies = [{ name: '', phone: '0901234567' }, { name: '   ', phone: '0901234567' }, { name: 'X', dob: '15/01/2000', phone: '0901234567' },
    { name: 'X'.repeat(101), phone: '0901234567' }, { name: 'X' }, { name: 'X', phone: null }, { name: 'X', phone: 901234567 }];
  for (const body of bodies) {
    await rejectsWith(logic.createCustomer(body, KH3), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
  await rejectsWith(logic.createCustomer({ name: '<b>An</b>', phone: '0901234567' }, KH3), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  assert.equal(table.has(3), false);
});

test('Create: số sai định dạng / rỗng → INVALID_PHONE, không tạo hồ sơ (AC-HS-26)', async () => {
  for (const phone of ['123', '', '09abc', '0123456789']) {
    await rejectsWith(logic.createCustomer({ name: 'X', phone }, KH3), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  }
  assert.equal(table.has(3), false);
});

test('Update: sửa từng phần, field vắng giữ nguyên (AC-HS-11)', async () => {
  assert.deepEqual(await logic.updateCustomer({ dob: '1999-12-31', clear_dob: false }, KH1), { customer_id: 1, name: 'Nguyễn Văn An', phone: '0900000001', dob: '1999-12-31' });
  assert.deepEqual(await logic.updateCustomer({ name: 'An Nguyen', clear_dob: false }, KH1), { customer_id: 1, name: 'An Nguyen', phone: '0900000001', dob: '1999-12-31' });
  assert.deepEqual(await logic.updateCustomer({ clear_dob: true }, KH1), { customer_id: 1, name: 'An Nguyen', phone: '0900000001' });
  assert.equal(table.get(1).date_of_birth_enc, null);
});

test('Update phone: trùng số hồ sơ khác vẫn được; họ tên, ngày sinh giữ nguyên bản mã (AC-HS-27)', async () => {
  const nameEncBefore = table.get(2).full_name_enc;
  assert.deepEqual(await logic.updateCustomer({ phone: '0900000001', clear_dob: false }, KH2),
    { customer_id: 2, name: 'Trần Thị Bình', phone: '0900000001', dob: '2000-02-02' });
  assert.equal(table.get(2).full_name_enc, nameEncBefore);
});

test('Update phone sai → INVALID_PHONE, hồ sơ không đổi (AC-HS-28)', async () => {
  await rejectsWith(logic.updateCustomer({ phone: 'sai', clear_dob: false }, KH1), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(logic.updateCustomer({ phone: '', clear_dob: false }, KH1), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  assert.equal(table.get(1).phone, '0900000001');
});

test('Update: <script> → TEXT_CONTAINS_HTML, hồ sơ không đổi (AC-HS-16)', async () => {
  await rejectsWith(logic.updateCustomer({ name: '<script>alert(1)</script>', clear_dob: false }, KH1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  assert.equal((await logic.getCustomer({ customer_id: 1 }, KH1)).name, 'Nguyễn Văn An');
});

test('Update: không đổi gì hoặc vừa đặt vừa xóa dob → INVALID_INPUT; chưa có hồ sơ → 404; admin → 403', async () => {
  await rejectsWith(logic.updateCustomer({ clear_dob: false }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.updateCustomer({ dob: '2000-01-01', clear_dob: true }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.updateCustomer({ name: 'X', clear_dob: false }, KH3), 'NOT_FOUND', 'CUSTOMER_NOT_FOUND');
  await rejectsWith(logic.updateCustomer({ name: 'X', clear_dob: false }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('Dữ liệu trong database bị sửa → INTERNAL, log có mã khách, không có dữ liệu', async () => {
  table.get(1).full_name_enc[13] ^= 1;
  await rejectsWith(logic.getCustomer({ customer_id: 1 }, KH1), 'INTERNAL', 'INTERNAL');
  assert.deepEqual(logs.at(-1), { level: 'error', msg: 'decrypt_failed', customer_id: 1 });
});

test('Họ tên đếm theo ký tự: 100 ký tự tiếng Việt có dấu hợp lệ', () => {
  assert.equal([...normalizeName('ễ'.repeat(100))].length, 100);
  assert.throws(() => normalizeName('ễ'.repeat(101)));
});

test('Ngày sinh: ngày có thật, từ 1900-01-01 đến hôm nay giờ Việt Nam', () => {
  assert.equal(todayInVietnam(Date.parse('2026-10-03T18:30:00Z')), '2026-10-04');
  assert.equal(checkDob('1900-01-01', NOW), '1900-01-01');
  assert.equal(checkDob('2026-10-04', NOW), '2026-10-04');
  assert.equal(checkDob('2000-02-29', NOW), '2000-02-29');
  for (const bad of ['1899-12-31', '2026-10-05', '2000-02-30', '2001-02-29', '2000-1-1', 20000101, '2000-01-01T00:00']) {
    assert.throws(() => checkDob(bad, NOW), String(bad));
  }
});

test('normalizePhone: cùng quy tắc với số tài xế; sai dạng / rỗng → INVALID_PHONE; sai kiểu → INVALID_INPUT (HS8)', () => {
  assert.equal(normalizePhone(' +84 901-234-567 '), '0901234567');
  assert.equal(normalizePhone('84901234567'), '0901234567');
  assert.equal(normalizePhone('0900.000.001'), '0900000001');
  for (const bad of ['123', '', '09abc', '0123456789', '<b>0901234567</b>', "' OR 1=1 --"]) {
    assert.throws(() => normalizePhone(bad), (e) => e.code === 'INVALID_PHONE', bad);
  }
  for (const bad of [901234567, null, {}]) assert.throws(() => normalizePhone(bad), (e) => e.code === 'INVALID_INPUT');
});
