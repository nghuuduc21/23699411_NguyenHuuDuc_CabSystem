// Unit test A07 xin OTP, A08 tạo tài khoản tài xế (spec 12-13-21-23 mục 4.2, 4.3) với kho giả:
// không cần PostgreSQL. Kho OTP giả mô phỏng giao dịch: lỗi ném ra thì bỏ mọi thay đổi (ROLLBACK).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAuthLogic, OTP_MAX_ATTEMPTS, randomOtp } from '../src/domain/auth.js';
import { hashPassword, verifyPassword } from '../src/domain/password.js';
import { createTokenSigner } from '../src/domain/token.js';

const SECRET = 'x'.repeat(32);

function setup({ simulationMode = true, newOtp = () => '482915' } = {}) {
  const logs = [];
  const log = { info: (msg, f) => logs.push({ msg, ...f }), warn() {}, error() {} };
  const accounts = [{ account_id: 11, phone: '0910000001', role: 'driver', status: 'ACTIVE' }];
  let nextAccount = 1000;
  let nextOtp = 1000;
  let otpRows = [];
  // `hidePhoneOnce`: giả request song song — bước 2 chưa thấy tài khoản, nhưng lúc INSERT thì đã có.
  let hidePhoneOnce = null;
  const accountsRepo = {
    async findByPhone(phone) {
      if (hidePhoneOnce === phone) { hidePhoneOnce = null; return null; }
      return accounts.find((a) => a.phone === phone) ?? null;
    },
  };
  const otps = {
    async insert({ phone, otpHash, ttlSeconds }) {
      const row = { otp_id: nextOtp++, phone, otp_hash: otpHash, attempt_count: 0, consumed_at: null, expired: ttlSeconds <= 0 };
      otpRows.push(row);
      return { otp_id: row.otp_id };
    },
    async transaction(work) {
      const snapshotOtps = structuredClone(otpRows);
      const snapshotAccounts = accounts.length;
      try {
        return await work({
          async latestForUpdate(phone) { return [...otpRows].reverse().find((r) => r.phone === phone) ?? null; },
          async addAttempt(id) { otpRows.find((r) => r.otp_id === id).attempt_count += 1; },
          async consume(id) { otpRows.find((r) => r.otp_id === id).consumed_at = new Date(); },
          async insertAccount({ phone, role }) {
            if (accounts.some((a) => a.phone === phone)) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'accounts_phone_key' });
            const row = { account_id: nextAccount++, phone, role, status: 'ACTIVE' };
            accounts.push(row);
            return { account_id: row.account_id, role };
          },
        });
      } catch (err) {
        otpRows = snapshotOtps;
        accounts.length = snapshotAccounts;
        throw err;
      }
    },
  };
  const auth = createAuthLogic({
    accounts: accountsRepo,
    passwords: { hash: hashPassword, verify: verifyPassword },
    tokens: createTokenSigner({ secret: SECRET, ttlSeconds: 3600 }),
    log,
    otps,
    otpTtlSeconds: 300,
    simulationMode,
    newOtp,
  });
  return { auth, accounts, logs, rows: () => otpRows, hideOnce: (phone) => { hidePhoneOnce = phone; } };
}

const rejectsWith = (promise, kind, code) => assert.rejects(promise, (err) => err.kind === kind && err.code === code);

test('randomOtp: luôn đủ 6 chữ số, đệm số 0 ở đầu', () => {
  assert.equal(randomOtp(() => 7), '000007');
  assert.equal(randomOtp(() => 999999), '999999');
  assert.equal(randomOtp((min, max) => { assert.deepEqual([min, max], [0, 1_000_000]); return 482915; }), '482915');
});

test('A07: 201 dữ liệu; lưu bản băm scrypt, không lưu mã rõ; log có mã, không có số điện thoại (AC-TX-01)', async () => {
  const { auth, rows, logs } = setup();
  const res = await auth.requestDriverOtp({ phone: '+84 911 111 111' });
  assert.deepEqual(res, { phone: '0911111111', expires_in: 300, otp: '482915' });
  assert.match(rows()[0].otp_hash, /^scrypt\$/);
  assert.ok(!rows()[0].otp_hash.includes('482915'));
  const line = logs.find((l) => l.msg === 'otp_sms_simulated');
  assert.equal(line.otp, '482915');
  assert.ok(!JSON.stringify(logs).includes('0911111111'));
});

test('A07: SIMULATION_MODE=false thì không trả otp', async () => {
  const { auth } = setup({ simulationMode: false });
  assert.deepEqual(await auth.requestDriverOtp({ phone: '0911111111' }), { phone: '0911111111', expires_in: 300 });
});

test('A07: số sai → INVALID_PHONE; số đã có tài khoản → PHONE_ALREADY_EXISTS; thiếu → INVALID_INPUT', async () => {
  const { auth, rows } = setup();
  await rejectsWith(auth.requestDriverOtp({ phone: '123' }), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(auth.requestDriverOtp({ phone: '0910000001' }), 'ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
  await rejectsWith(auth.requestDriverOtp({ phone: '' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  assert.equal(rows().length, 0);
});

test('A08: OTP đúng → tài khoản driver ≥ 1000, token đúng role; OTP bị đánh dấu đã dùng (AC-TX-02)', async () => {
  const { auth, rows, accounts } = setup();
  await auth.requestDriverOtp({ phone: '0911111111' });
  const res = await auth.registerDriver({ phone: '0911111111', otp: '482915', password: '12345678' });
  assert.equal(res.account_id, 1000);
  assert.equal(res.role, 'driver');
  assert.equal(res.expires_in, 3600);
  const payload = jwt.verify(res.token, SECRET);
  assert.equal(payload.sub, '1000');
  assert.equal(payload.role, 'driver');
  assert.ok(rows()[0].consumed_at);
  assert.equal(accounts.at(-1).phone, '0911111111');
  // Dùng lại cùng mã: số đã có tài khoản → 409 (AC-TX-07).
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '482915', password: '12345678' }), 'ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
});

test('A08: OTP sai → OTP_INVALID và tăng lượt sai; sai đủ 5 lần thì mã đúng cũng OTP_EXPIRED (AC-TX-04, 05)', async () => {
  const { auth, rows, accounts } = setup();
  await auth.requestDriverOtp({ phone: '0911111112' });
  for (let i = 1; i <= OTP_MAX_ATTEMPTS; i += 1) {
    await rejectsWith(auth.registerDriver({ phone: '0911111112', otp: '000000', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_INVALID');
    assert.equal(rows()[0].attempt_count, i);
  }
  await rejectsWith(auth.registerDriver({ phone: '0911111112', otp: '482915', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_EXPIRED');
  assert.equal(accounts.length, 1);
});

test('A08: chưa xin OTP → OTP_INVALID; OTP hết hạn → OTP_EXPIRED (AC-TX-06)', async () => {
  const { auth, rows } = setup();
  await rejectsWith(auth.registerDriver({ phone: '0911111113', otp: '123456', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_INVALID');
  await auth.requestDriverOtp({ phone: '0911111113' });
  rows()[0].expired = true; // database tính expires_at <= now()
  await rejectsWith(auth.registerDriver({ phone: '0911111113', otp: '482915', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_EXPIRED');
});

test('A08: OTP sai định dạng → OTP_INVALID, KHÔNG tính lượt; số, mật khẩu sai; thiếu field (AC-TX-08)', async () => {
  const { auth, rows } = setup();
  await auth.requestDriverOtp({ phone: '0911111111' });
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '12ab', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_INVALID');
  assert.equal(rows()[0].attempt_count, 0);
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '482915', password: '123' }), 'INVALID_ARGUMENT', 'INVALID_PASSWORD');
  await rejectsWith(auth.registerDriver({ phone: 'abc', otp: '482915', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_PHONE');
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '', password: '12345678' }), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('A08: mã cũ mất hiệu lực khi đã xin mã mới (chỉ xét dòng mới nhất)', async () => {
  let value = '111111';
  const { auth } = setup({ newOtp: () => value });
  await auth.requestDriverOtp({ phone: '0911111111' });
  value = '222222';
  await auth.requestDriverOtp({ phone: '0911111111' });
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '111111', password: '12345678' }), 'INVALID_ARGUMENT', 'OTP_INVALID');
  assert.equal((await auth.registerDriver({ phone: '0911111111', otp: '222222', password: '12345678' })).role, 'driver');
});

test('A08: trùng số lúc INSERT (request song song) → PHONE_ALREADY_EXISTS, OTP không bị đánh dấu đã dùng', async () => {
  const { auth, rows, accounts, hideOnce } = setup();
  await auth.requestDriverOtp({ phone: '0911111111' });
  accounts.push({ account_id: 1001, phone: '0911111111', role: 'driver', status: 'ACTIVE' });
  hideOnce('0911111111');
  await rejectsWith(auth.registerDriver({ phone: '0911111111', otp: '482915', password: '12345678' }), 'ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
  assert.equal(rows()[0].consumed_at, null);
});
