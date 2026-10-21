// Unit test cho logic đăng ký / đăng nhập (spec 09-10) với kho tài khoản giả: không cần PostgreSQL.
// Sửa 2026-10-14 (ADR-021): khách / admin đăng ký, đăng nhập bằng email; tài xế đăng nhập bằng số.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAuthLogic } from '../src/domain/auth.js';
import { hashPassword, verifyPassword } from '../src/domain/password.js';
import { createTokenSigner } from '../src/domain/token.js';
import { normalizeEmail, normalizePhone } from '../src/domain/rules.js';

const SECRET = 'x'.repeat(32);
const logs = [];
const log = { info: (msg, f) => logs.push({ msg, ...f }), warn() {}, error() {} };

// Kho giả mô phỏng UNIQUE của database bằng lỗi 23505 kèm tên ràng buộc.
function fakeAccounts(seed = []) {
  const rows = [...seed];
  let next = 1000;
  return {
    rows,
    async insert(fields) {
      const { email, phone, passwordHash, role } = fields;
      if (email && rows.some((r) => r.email === email)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'accounts_email_key' });
      if (phone && rows.some((r) => r.phone === phone)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'accounts_phone_key' });
      const row = { account_id: next++, ...fields, password_hash: passwordHash, role, status: 'ACTIVE' };
      delete row.passwordHash;
      rows.push(row);
      return { account_id: row.account_id, role };
    },
    async findByEmail(email) { return rows.find((r) => r.email === email) ?? null; },
    async findByPhone(phone) { return rows.find((r) => r.phone === phone) ?? null; },
  };
}

// Seed theo ADR-021: khách / admin có email, không số; tài xế có số, không email.
async function setup() {
  const hash = await hashPassword('12345678');
  const accounts = fakeAccounts([
    { account_id: 1, email: 'kh1@cab.vn', phone: null, password_hash: hash, role: 'customer', status: 'ACTIVE' },
    { account_id: 9, email: 'kh9@cab.vn', phone: null, password_hash: hash, role: 'customer', status: 'LOCKED' },
    { account_id: 11, email: null, phone: '0910000001', password_hash: hash, role: 'driver', status: 'ACTIVE' },
    { account_id: 99, email: 'admin@cab.vn', phone: null, password_hash: hash, role: 'admin', status: 'ACTIVE' },
  ]);
  const auth = createAuthLogic({
    accounts,
    passwords: { hash: hashPassword, verify: verifyPassword },
    tokens: createTokenSigner({ secret: SECRET, ttlSeconds: 3600 }),
    log,
  });
  return { auth, accounts };
}

const rejectsWith = (promise, kind, code) => assert.rejects(promise, (err) => err.kind === kind && err.code === code);

test('băm scrypt: dạng scrypt$salt$hash, salt khác nhau, so đúng/sai', async () => {
  const a = await hashPassword('12345678');
  const b = await hashPassword('12345678');
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes('12345678'));
  assert.equal(await verifyPassword('12345678', a), true);
  assert.equal(await verifyPassword('12345679', a), false);
  assert.equal(await verifyPassword('x', 'khong-hop-le'), false);
});

test('chuẩn hóa số điện thoại', () => {
  assert.equal(normalizePhone('+84 912.345-678'), '0912345678');
  assert.equal(normalizePhone('84912345678'), '0912345678');
  assert.equal(normalizePhone('0900000001'), '0900000001');
  for (const bad of ['12345', "' OR 1=1 --", '0123456789', '09123456789']) {
    assert.throws(() => normalizePhone(bad), (e) => e.code === 'INVALID_PHONE');
  }
});

test('chuẩn hóa email: cắt khoảng trắng, chữ thường; sai dạng → INVALID_EMAIL (DN8)', () => {
  assert.equal(normalizeEmail('  KH1@Cab.VN '), 'kh1@cab.vn');
  const tooLong = `${'a'.repeat(250)}@cab.vn`;
  for (const bad of ['abc', 'a b@cab.vn', "' OR 1=1 --", '<x>@cab.vn', 'a@b', '', tooLong]) {
    assert.throws(() => normalizeEmail(bad), (e) => e.code === 'INVALID_EMAIL');
  }
});

test('đăng ký: 201, role customer, mã từ 1000, email chữ thường, phone NULL, lưu băm (ADR-021)', async () => {
  const { auth, accounts } = await setup();
  const res = await auth.registerCustomer({ email: 'New1@Cab.VN', password: '12345678' });
  assert.deepEqual(res, { account_id: 1000, role: 'customer' });
  const row = accounts.rows.at(-1);
  assert.equal(row.email, 'new1@cab.vn');
  assert.equal(row.phone, null);
  assert.match(row.password_hash, /^scrypt\$/);
});

test('đăng ký: lỗi định dạng, thiếu field, trùng email (so chữ thường)', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.registerCustomer({ email: 'new1@cab.vn', password: '' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.registerCustomer({ email: '', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.registerCustomer({ email: 'abc', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  await rejectsWith(auth.registerCustomer({ email: 'a b@cab.vn', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  await rejectsWith(auth.registerCustomer({ email: 'new1@cab.vn', password: '123' }), 'INVALID_ARGUMENT', 'INVALID_PASSWORD');
  await rejectsWith(auth.registerCustomer({ email: 'KH1@Cab.VN', password: '12345678' }), 'ALREADY_EXISTS', 'EMAIL_ALREADY_EXISTS');
});

test('đăng nhập khách bằng email: token HS256 có sub chuỗi, role, jti, exp; không có email', async () => {
  const { auth } = await setup();
  const res = await auth.login({ email: 'KH1@cab.vn', password: '12345678' });
  assert.equal(res.account_id, 1);
  assert.equal(res.role, 'customer');
  assert.equal(res.expires_in, 3600);
  const payload = jwt.verify(res.token, SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, '1');
  assert.equal(payload.role, 'customer');
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(!JSON.stringify(payload).includes('kh1@cab.vn'));
  const again = await auth.login({ email: 'kh1@cab.vn', password: '12345678' });
  assert.notEqual(jwt.decode(again.token).jti, payload.jti);
});

test('đăng nhập ba role: admin bằng email, tài xế bằng số (BRULE19)', async () => {
  const { auth } = await setup();
  const admin = await auth.login({ email: 'admin@cab.vn', password: '12345678' });
  assert.deepEqual([admin.account_id, admin.role], [99, 'admin']);
  const driver = await auth.login({ phone: '0910000001', password: '12345678' });
  assert.deepEqual([driver.account_id, driver.role], [11, 'driver']);
});

test('đăng nhập: sai mật khẩu, chưa có, sai loại định danh cùng INVALID_CREDENTIALS; khóa → ACCOUNT_LOCKED', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.login({ email: 'kh1@cab.vn', password: 'sai-mat-khau' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ email: 'kh1@cab.vn', password: "' OR '1'='1" }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ email: 'khong@cab.vn', password: '12345678' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  // Khách gửi số (số hồ sơ không ở tài khoản), admin gửi số cũ, tài xế gửi email → không có dòng → 401.
  await rejectsWith(auth.login({ phone: '0900000001', password: '12345678' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ phone: '0999999999', password: '12345678' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ email: 'tx1@cab.vn', password: '12345678' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  // Khóa chỉ lộ ra khi mật khẩu đúng.
  await rejectsWith(auth.login({ email: 'kh9@cab.vn', password: 'sai' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ email: 'kh9@cab.vn', password: '12345678' }), 'PERMISSION_DENIED', 'ACCOUNT_LOCKED');
});

test('đăng nhập: đúng một định danh; injection trên email → INVALID_EMAIL, trên số → INVALID_PHONE', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.login({ email: "' OR 1=1 --", password: 'x' }), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  await rejectsWith(auth.login({ phone: "' OR 1=1 --", password: 'x' }), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(auth.login({ email: 'kh1@cab.vn', password: '' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.login({ password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.login({ email: 'kh1@cab.vn', phone: '0910000001', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  // Gửi cả hai mà một cái rỗng vẫn là "có cả hai".
  await rejectsWith(auth.login({ email: '', phone: '0910000001', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('log không chứa email, số điện thoại, mật khẩu, token', async () => {
  logs.length = 0;
  const { auth } = await setup();
  const { token } = await auth.login({ email: 'kh1@cab.vn', password: '12345678' });
  await auth.login({ email: 'kh1@cab.vn', password: 'sai-mat-khau' }).catch(() => {});
  await auth.login({ phone: '0910000001', password: '12345678' });
  await auth.registerCustomer({ email: 'new9@cab.vn', password: '12345678' });
  const text = JSON.stringify(logs);
  for (const secret of ['kh1@cab.vn', 'new9@cab.vn', '0910000001', '12345678', 'sai-mat-khau', token]) assert.ok(!text.includes(secret));
  assert.ok(logs.some((l) => l.msg === 'login_ok' && l.account_id === 1));
});
