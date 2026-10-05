// Unit test cho logic hồ sơ khách (spec 11) với kho hồ sơ giả trong bộ nhớ: không cần PostgreSQL.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerLogic } from '../src/domain/customers.js';
import { createFieldCipher } from '../src/domain/crypto.js';
import { checkDob, normalizeEmail, normalizeName, todayInVietnam } from '../src/domain/rules.js';

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
  async insert({ customerId, nameEnc, dobEnc, email = null }) {
    if (table.has(customerId)) return false;
    table.set(customerId, { customer_id: customerId, full_name_enc: nameEnc, date_of_birth_enc: dobEnc, email });
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
    table.set(id, { customer_id: id, full_name_enc: next.nameEnc, date_of_birth_enc: next.dobEnc, email: next.email });
    return next;
  },
};
const logic = createCustomerLogic({ profiles, cipher, log, now: () => NOW });

const KH1 = { accountId: '1', role: 'customer' };
const KH3 = { accountId: '3', role: 'customer' };
const AD1 = { accountId: '99', role: 'admin' };
const TX1 = { accountId: '11', role: 'driver' };

function seed(id, name, dob) {
  table.set(id, { customer_id: id, full_name_enc: cipher.encrypt(name), date_of_birth_enc: dob ? cipher.encrypt(dob) : null });
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
  seed(1, 'Nguyễn Văn An', '2000-01-01');
  seed(2, 'Trần Thị Bình', '2000-02-02');
});

test('Get: khách xem mã của mình → hồ sơ đã giải mã (AC-HS-01)', async () => {
  assert.deepEqual(await logic.getCustomer({ customer_id: 1 }, KH1), { customer_id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01' });
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
  assert.deepEqual(await logic.createCustomer({ name: '  Pham Duc ' }, KH3), { customer_id: 3, name: 'Pham Duc' });
  assert.deepEqual(await logic.getCustomer({ customer_id: 3 }, KH3), { customer_id: 3, name: 'Pham Duc' });
  await rejectsWith(logic.createCustomer({ name: 'Lan hai' }, KH3), 'ALREADY_EXISTS', 'CUSTOMER_ALREADY_EXISTS');
  // Log chỉ có mã, không có họ tên.
  assert.deepEqual(logs.filter((l) => l.msg === 'customer_created'), [{ level: 'info', msg: 'customer_created', customer_id: 3 }]);
  assert.ok(!JSON.stringify(logs).includes('Pham'));
});

test('Create: lưu bản mã, không lưu chữ rõ', async () => {
  await logic.createCustomer({ name: 'Pham Duc', dob: '2001-03-10' }, KH3);
  const row = table.get(3);
  assert.ok(Buffer.isBuffer(row.full_name_enc) && Buffer.isBuffer(row.date_of_birth_enc));
  assert.equal(cipher.decrypt(row.date_of_birth_enc), '2001-03-10');
});

test('Create: admin, tài xế → FORBIDDEN (AC-HS-07)', async () => {
  await rejectsWith(logic.createCustomer({ name: 'X' }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.createCustomer({ name: 'X' }, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('Create: dữ liệu sai → 400, có < > → TEXT_CONTAINS_HTML, không ghi gì (AC-HS-10)', async () => {
  for (const body of [{ name: '' }, { name: '   ' }, { name: 'X', dob: '15/01/2000' }, { name: 'X'.repeat(101) }]) {
    await rejectsWith(logic.createCustomer(body, KH3), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  }
  await rejectsWith(logic.createCustomer({ name: '<b>An</b>' }, KH3), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  assert.equal(table.has(3), false);
});

test('Update: sửa từng phần, field vắng giữ nguyên (AC-HS-11)', async () => {
  assert.deepEqual(await logic.updateCustomer({ dob: '1999-12-31', clear_dob: false }, KH1), { customer_id: 1, name: 'Nguyễn Văn An', dob: '1999-12-31' });
  assert.deepEqual(await logic.updateCustomer({ name: 'An Nguyen', clear_dob: false }, KH1), { customer_id: 1, name: 'An Nguyen', dob: '1999-12-31' });
  assert.deepEqual(await logic.updateCustomer({ clear_dob: true }, KH1), { customer_id: 1, name: 'An Nguyen' });
  assert.equal(table.get(1).date_of_birth_enc, null);
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

// ---------- Email trong hồ sơ (ADR-019; spec 11 AC-HS-19 … AC-HS-22) ----------

test('normalizeEmail: cắt khoảng trắng, chữ thường; sai dạng / rỗng / > 254 → INVALID_EMAIL; sai kiểu → INVALID_INPUT', () => {
  assert.equal(normalizeEmail('  Duc@Cab.VN '), 'duc@cab.vn');
  const long = `${'a'.repeat(245)}@cab.vn.vn`; // 255 ký tự
  assert.equal(long.length, 255);
  for (const bad of ['abc', '', '   ', '<a>@x.vn', long]) {
    assert.throws(() => normalizeEmail(bad), (e) => e.code === 'INVALID_EMAIL', bad);
  }
  for (const bad of [123, null, {}]) assert.throws(() => normalizeEmail(bad), (e) => e.code === 'INVALID_INPUT');
});

test('Create có email: lưu chữ thường dạng rõ, trả về; không email → không có field (AC-HS-19, AC-HS-04)', async () => {
  const created = await logic.createCustomer({ name: 'Pham Duc', email: '  Duc@Cab.VN ' }, KH3);
  assert.deepEqual(created, { customer_id: 3, name: 'Pham Duc', email: 'duc@cab.vn' });
  // Email lưu rõ, họ tên vẫn là bản mã.
  assert.equal(table.get(3).email, 'duc@cab.vn');
  assert.ok(Buffer.isBuffer(table.get(3).full_name_enc));
  assert.deepEqual(await logic.getCustomer({ customer_id: 3 }, KH3), { customer_id: 3, name: 'Pham Duc', email: 'duc@cab.vn' });
  // Log không chứa email.
  assert.ok(!JSON.stringify(logs).includes('duc@cab.vn'));
});

test('Create email sai → INVALID_EMAIL, không tạo hồ sơ (AC-HS-20)', async () => {
  for (const email of ['abc', '', '<a>@x.vn']) {
    await rejectsWith(logic.createCustomer({ name: 'X', email }, KH3), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  }
  assert.equal(table.has(3), false);
});

test('Update email: đặt, trùng email người khác vẫn được, xóa bằng clear_email, sai giữ nguyên (AC-HS-21, 22)', async () => {
  // KH2 đặt trùng email của KH1: không UNIQUE.
  table.get(1).email = 'kh1@cab.vn';
  assert.deepEqual(await logic.updateCustomer({ email: 'KH1@cab.vn', clear_dob: false, clear_email: false }, { accountId: '2', role: 'customer' }),
    { customer_id: 2, name: 'Trần Thị Bình', dob: '2000-02-02', email: 'kh1@cab.vn' });
  // Xóa email: họ tên, ngày sinh giữ nguyên bản mã cũ.
  const nameEncBefore = table.get(1).full_name_enc;
  assert.deepEqual(await logic.updateCustomer({ clear_dob: false, clear_email: true }, KH1), { customer_id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01' });
  assert.equal(table.get(1).email, null);
  assert.equal(table.get(1).full_name_enc, nameEncBefore);
  // Đặt lại; sửa field khác thì email giữ nguyên.
  await logic.updateCustomer({ email: 'kh1@cab.vn', clear_dob: false, clear_email: false }, KH1);
  assert.equal((await logic.updateCustomer({ name: 'An', clear_dob: false, clear_email: false }, KH1)).email, 'kh1@cab.vn');
  // Email sai → 400, hồ sơ không đổi.
  await rejectsWith(logic.updateCustomer({ email: 'sai', clear_dob: false, clear_email: false }, KH1), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  assert.equal(table.get(1).email, 'kh1@cab.vn');
  // Vừa đặt vừa xóa email → mâu thuẫn.
  await rejectsWith(logic.updateCustomer({ email: 'a@b.vn', clear_dob: false, clear_email: true }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});
