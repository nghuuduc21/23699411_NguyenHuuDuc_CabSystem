// Unit test cho logic đăng ký / đăng nhập (spec 09-10) với kho tài khoản giả: không cần PostgreSQL.
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
    async insert({ phone, email, passwordHash, role }) {
      if (rows.some((r) => r.phone === phone)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'accounts_phone_key' });
      if (email && rows.some((r) => r.email === email)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'accounts_email_key' });
      const row = { account_id: next++, phone, email, password_hash: passwordHash, role, status: 'ACTIVE' };
      rows.push(row);
      return { account_id: row.account_id, role };
    },
    async findByPhone(phone) { return rows.find((r) => r.phone === phone) ?? null; },
    async findByEmail(email) { return rows.find((r) => r.email === email) ?? null; },
  };
}

async function setup() {
  const accounts = fakeAccounts([
    { account_id: 1, phone: '0900000001', email: null, password_hash: await hashPassword('12345678'), role: 'customer', status: 'ACTIVE' },
    { account_id: 9, phone: '0900000009', email: null, password_hash: await hashPassword('12345678'), role: 'customer', status: 'LOCKED' },
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

test('chuẩn hóa số điện thoại và email', () => {
  assert.equal(normalizePhone('+84 912.345-678'), '0912345678');
  assert.equal(normalizePhone('84912345678'), '0912345678');
  assert.equal(normalizePhone('0900000001'), '0900000001');
  for (const bad of ['12345', "' OR 1=1 --", '0123456789', '09123456789']) {
    assert.throws(() => normalizePhone(bad), (e) => e.code === 'INVALID_PHONE');
  }
  assert.equal(normalizeEmail('  An@Example.COM '), 'an@example.com');
  assert.throws(() => normalizeEmail('abc'), (e) => e.code === 'INVALID_EMAIL');
});

test('đăng ký: 201 dữ liệu, role customer, mã từ 1000, lưu băm, email chữ thường', async () => {
  const { auth, accounts } = await setup();
  const res = await auth.registerCustomer({ phone: '0901234567', email: 'A@B.VN', password: '12345678' });
  assert.deepEqual(res, { account_id: 1000, role: 'customer' });
  const row = accounts.rows.at(-1);
  assert.equal(row.email, 'a@b.vn');
  assert.match(row.password_hash, /^scrypt\$/);
});

test('đăng ký: lỗi định dạng, thiếu field, trùng số, trùng email', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.registerCustomer({ phone: '0901234567', password: '' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.registerCustomer({ phone: '12345', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(auth.registerCustomer({ phone: '0901234567', email: 'abc', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  await rejectsWith(auth.registerCustomer({ phone: '0901234567', password: '123' }), 'INVALID_ARGUMENT', 'INVALID_PASSWORD');
  await rejectsWith(auth.registerCustomer({ phone: '+84900000001', password: '12345678' }), 'ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
  await auth.registerCustomer({ phone: '0901111111', email: 'x@y.vn', password: '12345678' });
  await rejectsWith(auth.registerCustomer({ phone: '0902222222', email: 'X@y.vn', password: '12345678' }), 'ALREADY_EXISTS', 'EMAIL_ALREADY_EXISTS');
});

test('đăng nhập đúng: token HS256 có sub chuỗi, role, jti, exp; không có số điện thoại', async () => {
  const { auth } = await setup();
  const res = await auth.login({ phone: '0900000001', password: '12345678' });
  assert.equal(res.account_id, 1);
  assert.equal(res.role, 'customer');
  assert.equal(res.expires_in, 3600);
  const payload = jwt.verify(res.token, SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, '1');
  assert.equal(payload.role, 'customer');
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(!res.token.includes('0900000001') && !JSON.stringify(payload).includes('0900000001'));
  const again = await auth.login({ phone: '0900000001', password: '12345678' });
  assert.notEqual(jwt.decode(again.token).jti, payload.jti);
});

test('đăng nhập: sai mật khẩu và số chưa có cùng INVALID_CREDENTIALS; khóa → ACCOUNT_LOCKED', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.login({ phone: '0900000001', password: 'sai-mat-khau' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ phone: '0900000001', password: "' OR '1'='1" }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ phone: '0988888888', password: '12345678' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  // Khóa chỉ lộ ra khi mật khẩu đúng.
  await rejectsWith(auth.login({ phone: '0900000009', password: 'sai' }), 'UNAUTHENTICATED', 'INVALID_CREDENTIALS');
  await rejectsWith(auth.login({ phone: '0900000009', password: '12345678' }), 'PERMISSION_DENIED', 'ACCOUNT_LOCKED');
});

test('đăng nhập: định danh sai dạng, thiếu, gửi cả hai', async () => {
  const { auth } = await setup();
  await rejectsWith(auth.login({ phone: "' OR 1=1 --", password: 'x' }), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(auth.login({ email: 'abc', password: 'x' }), 'INVALID_ARGUMENT', 'INVALID_EMAIL');
  await rejectsWith(auth.login({ phone: '0900000001', password: '' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.login({ password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(auth.login({ phone: '0900000001', email: 'a@b.vn', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('log không chứa số điện thoại, mật khẩu, token', async () => {
  logs.length = 0;
  const { auth } = await setup();
  const { token } = await auth.login({ phone: '0900000001', password: '12345678' });
  await auth.login({ phone: '0900000001', password: 'sai-mat-khau' }).catch(() => {});
  const text = JSON.stringify(logs);
  for (const secret of ['0900000001', '12345678', 'sai-mat-khau', token]) assert.ok(!text.includes(secret));
  assert.ok(logs.some((l) => l.msg === 'login_ok' && l.account_id === 1));
});
