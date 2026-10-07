// Spec 12-13-21-23 — phần đăng ký tài xế bằng OTP, nộp hồ sơ, admin duyệt / từ chối.
// Mục chấm 21, 22, bổ trợ 23 (bật khi chưa duyệt), 24 (số giấy phép mã hóa), 26, 28.
// Không đổi seed: AC-TX-15 (từ chối) làm trên hồ sơ tạo mới thay cho TX7 (cùng nhánh code RejectDriver); chuỗi trên TX7
// của spec (AC-TX-15 → 34 → 35 → 36, nộp lại FR43) nằm ở 13-tai-xe-nop-lai.test.js.
// TX7 chỉ được đọc. Dữ liệu tạo ra (tài khoản 0599…, OTP, hồ sơ, xe) được xóa ở hook `after`.
// AC-TX-18 (dừng Kafka) nằm ở 90-dung-service.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED, SEED_PASSWORD, call, createTracker, kafkaMessages, newDriverAccount, newDriverPhone,
  newDriverWithApplication, newPlate, psql, psqlTable, tokenOf,
} from './api.js';
import { sleep } from './helpers.js';

const t = createTracker();
after(() => t.cleanup());

const countAcc = (phone) => Number(psql('auth-db', 'auth', `select count(*) from accounts where phone = '${phone}'`));
const latestOtp = (phone) => {
  const [attempt, used] = psql('auth-db', 'auth',
    `select attempt_count, consumed_at is not null from otp_verifications where phone = '${phone}' order by created_at desc, otp_id desc limit 1`,
  ).split('|');
  return { attempt: Number(attempt), used: used === 't' };
};

// ---------- Mục 21 ----------
const phoneD = t.phone(newDriverPhone());
const plateD = newPlate();
let otpD;
let D; // { account_id, token }

test('AC-TX-01 (mục 21): POST /otps → 201 {phone, expires_in 300, otp 6 chữ số}; database lưu băm scrypt, không thấy mã rõ', async () => {
  const r = await call('POST', '/otps', { body: { phone: phoneD } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['expires_in', 'otp', 'phone']);
  assert.equal(r.body.phone, phoneD);
  assert.equal(r.body.expires_in, 300);
  assert.match(r.body.otp, /^[0-9]{6}$/);
  otpD = r.body.otp;
  const hash = psql('auth-db', 'auth', `select otp_hash from otp_verifications where phone = '${phoneD}'`);
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes(otpD), 'mã OTP rõ trong database');
  assert.match(psqlTable('auth-db', 'auth', 'otp_verifications'), /otp_hash/);
});

test('AC-TX-04 (mục 21, 400): A08 otp "000000" sai → 400 OTP_INVALID, attempt_count tăng 1', async () => {
  const wrong = otpD === '000000' ? '111111' : '000000';
  const before = latestOtp(phoneD).attempt;
  const r = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: wrong, password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'OTP_INVALID' });
  assert.equal(latestOtp(phoneD).attempt, before + 1);
  assert.equal(countAcc(phoneD), 0);
});

test('TX2: otp sai định dạng ("12ab") → 400 OTP_INVALID, KHÔNG tăng lượt sai', async () => {
  const before = latestOtp(phoneD).attempt;
  const r = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: '12ab', password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'OTP_INVALID' });
  assert.equal(latestOtp(phoneD).attempt, before);
});

test('AC-TX-08 (mục 21, 400): A08 password "123" → INVALID_PASSWORD; thêm "role":"admin" → INVALID_INPUT; A07 phone "123" → INVALID_PHONE', async () => {
  const a = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: otpD, password: '123' } });
  assert.equal(a.status, 400);
  assert.deepEqual(a.body, { error: 'INVALID_PASSWORD' });
  const b = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: otpD, password: SEED_PASSWORD, role: 'admin' } });
  assert.equal(b.status, 400);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
  const c = await call('POST', '/otps', { body: { phone: '123' } });
  assert.equal(c.status, 400);
  assert.deepEqual(c.body, { error: 'INVALID_PHONE' });
  const d = await call('POST', '/otps', { body: {} });
  assert.equal(d.status, 400);
  assert.deepEqual(d.body, { error: 'INVALID_INPUT' });
  const e = await call('POST', '/otps', { body: '{x' });
  assert.equal(e.status, 400);
  assert.deepEqual(e.body, { error: 'INVALID_JSON' });
  const f = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: 123456, password: SEED_PASSWORD } });
  assert.equal(f.status, 400);
  assert.deepEqual(f.body, { error: 'INVALID_INPUT' });
  assert.equal(countAcc(phoneD), 0);
});

test('AC-TX-02 (mục 21): A08 đúng OTP → 201 {account_id ≥ 1000, role driver, token, expires_in}; đăng nhập lại → 200 role driver', async () => {
  const r = await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: otpD, password: SEED_PASSWORD } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['account_id', 'expires_in', 'role', 'token']);
  assert.equal(r.body.role, 'driver');
  assert.ok(r.body.account_id >= 1000);
  assert.equal(r.body.expires_in, 3600);
  D = { account_id: t.id(r.body.account_id), token: r.body.token };
  const payload = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.sub, String(r.body.account_id));
  assert.equal(payload.role, 'driver');
  assert.ok(latestOtp(phoneD).used, 'OTP chưa được đánh dấu đã dùng');
  const l = await call('POST', '/auth/login', { body: { phone: phoneD, password: SEED_PASSWORD } });
  assert.equal(l.status, 200);
  assert.equal(l.body.role, 'driver');
  assert.equal(l.body.account_id, D.account_id);
});

test('AC-TX-07 (mục 21, 409): A07 lại số vừa đăng ký; A08 lại cùng body; A07 số TX1 → 409 PHONE_ALREADY_EXISTS cả ba', async () => {
  const list = [
    await call('POST', '/otps', { body: { phone: phoneD } }),
    await call('POST', '/driver-accounts', { body: { phone: phoneD, otp: otpD, password: SEED_PASSWORD } }),
    await call('POST', '/otps', { body: { phone: SEED.TX1 } }),
    await call('POST', '/otps', { body: { phone: SEED.KH1 } }),
  ];
  for (const r of list) {
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.body, { error: 'PHONE_ALREADY_EXISTS' });
  }
  assert.equal(countAcc(phoneD), 1);
});

test('AC-TX-05 (mục 21, 400): OTP mới, sai đủ 5 lần, rồi gửi mã ĐÚNG → 400 OTP_EXPIRED, không tạo tài khoản', async () => {
  const p = t.phone(newDriverPhone());
  const o = await call('POST', '/otps', { body: { phone: p } });
  assert.equal(o.status, 201);
  const wrong = o.body.otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', '/driver-accounts', { body: { phone: p, otp: wrong, password: SEED_PASSWORD } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'OTP_INVALID' }, `lần sai thứ ${i + 1}`);
  }
  assert.equal(latestOtp(p).attempt, 5);
  const r = await call('POST', '/driver-accounts', { body: { phone: p, otp: o.body.otp, password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'OTP_EXPIRED' });
  assert.equal(countAcc(p), 0);
  // Xin mã mới thì dùng được (dòng mới nhất).
  const o2 = await call('POST', '/otps', { body: { phone: p } });
  const ok = await call('POST', '/driver-accounts', { body: { phone: p, otp: o2.body.otp, password: SEED_PASSWORD } });
  assert.equal(ok.status, 201, ok.text);
  t.id(ok.body.account_id);
});

test('AC-TX-06 (mục 21, 400): chưa xin OTP → A08 otp "123456" → 400 OTP_INVALID', async () => {
  const p = t.phone(newDriverPhone());
  const r = await call('POST', '/driver-accounts', { body: { phone: p, otp: '123456', password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'OTP_INVALID' });
  assert.equal(countAcc(p), 0);
});

test('Spec 12-13-21-23 mục 8.1: xin OTP hai lần, dùng mã CŨ → 400 OTP_INVALID', async () => {
  const p = t.phone(newDriverPhone());
  const o1 = await call('POST', '/otps', { body: { phone: p } });
  let o2 = await call('POST', '/otps', { body: { phone: p } });
  // Hiếm khi hai mã trùng nhau; xin thêm để có mã khác.
  while (o2.body.otp === o1.body.otp) o2 = await call('POST', '/otps', { body: { phone: p } });
  const r = await call('POST', '/driver-accounts', { body: { phone: p, otp: o1.body.otp, password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'OTP_INVALID' });
  assert.equal(countAcc(p), 0);
});

test('AC-TX-11 (mục 21, 28): A11 không token → 401 TOKEN_MISSING; token KH1, AD1 → 403 FORBIDDEN', async () => {
  const body = { name: 'X', license: 'GPLX-11', plate: newPlate() };
  const a = await call('POST', '/drivers', { body });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, { error: 'TOKEN_MISSING' });
  for (const who of [SEED.KH1, SEED.AD1]) {
    const r = await call('POST', '/drivers', { token: await tokenOf(who), body });
    assert.equal(r.status, 403, who);
    assert.deepEqual(r.body, { error: 'FORBIDDEN' });
  }
});

test('AC-TX-10 (mục 21, 400): A11 thiếu license; vehicle "BUS"; name "<b>x</b>"; thêm approval_status; license sai dạng; plate quá ngắn → 400', async () => {
  const cases = [
    [{ name: 'Tai Xe', plate: newPlate() }, 'INVALID_INPUT'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: newPlate(), vehicle: 'BUS' }, 'INVALID_INPUT'],
    [{ name: '<b>x</b>', license: 'GPLX-99', plate: newPlate() }, 'TEXT_CONTAINS_HTML'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: newPlate(), approval_status: 'APPROVED' }, 'INVALID_INPUT'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: newPlate(), status: 'ONLINE' }, 'INVALID_INPUT'],
    [{ name: 'Tai Xe', license: 'G!', plate: newPlate() }, 'INVALID_INPUT'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: 'AB' }, 'INVALID_INPUT'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: newPlate(), color: '<i>' }, 'TEXT_CONTAINS_HTML'],
    [{ name: 'Tai Xe', license: 'GPLX-99', plate: newPlate(), brand: 'x'.repeat(51) }, 'INVALID_INPUT'],
  ];
  for (const [body, code] of cases) {
    const r = await call('POST', '/drivers', { token: D.token, body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, JSON.stringify(body));
  }
  assert.equal(psql('driver-db', 'driver', `select count(*) from drivers where driver_id = ${D.account_id}`), '0');
});

test('AC-TX-03 (mục 21): A11 {name, license, plate} → 201 driver_id = account_id, CAR_4, OFFLINE, PENDING, license rõ cho chủ', async () => {
  const r = await call('POST', '/drivers', { token: D.token, body: { name: 'Tai Xe Moi', license: 'gplx-99', plate: plateD.toLowerCase() } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body, {
    driver_id: D.account_id,
    name: 'Tai Xe Moi',
    vehicle: 'CAR_4',
    plate: plateD,
    status: 'OFFLINE',
    approval_status: 'PENDING',
    license: 'GPLX-99',
  });
});

test('AC-TX-09 (mục 21, 409): nộp lần hai → 409 DRIVER_ALREADY_EXISTS; tài xế khác nộp "59a-00001" → 409 LICENSE_PLATE_ALREADY_EXISTS', async () => {
  const a = await call('POST', '/drivers', { token: D.token, body: { name: 'Lan Hai', license: 'GPLX-98', plate: newPlate() } });
  assert.equal(a.status, 409);
  assert.deepEqual(a.body, { error: 'DRIVER_ALREADY_EXISTS' });
  const other = await newDriverAccount(t);
  const b = await call('POST', '/drivers', { token: other.token, body: { name: 'Khac', license: 'GPLX-97', plate: '59a-00001' } });
  assert.equal(b.status, 409);
  assert.deepEqual(b.body, { error: 'LICENSE_PLATE_ALREADY_EXISTS' });
  // Biển số khác (khoảng trắng bị bỏ, "-" giữ): "59a 00001" → 59A00001 ≠ 59A-00001 → 201 (ghi chú AC-TX-09).
  const c = await call('POST', '/drivers', { token: other.token, body: { name: 'Khac', license: 'GPLX-97', plate: '59a 00001' } });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.body.plate, '59A00001');
  assert.equal(psql('driver-db', 'driver', `select count(*) from drivers where driver_id = ${other.account_id}`), '1');
});

test('AC-TX-12 (mục 24): table drivers — license_number_enc dạng \\x…, không thấy "GPLX-"; chủ hồ sơ xem A14 thấy license rõ', async () => {
  const out = psqlTable('driver-db', 'driver', 'drivers');
  assert.match(out, /license_number_enc/);
  assert.ok(!out.toUpperCase().includes('GPLX'), 'thấy số giấy phép rõ trong database');
  assert.match(out, /\\x[0-9a-f]{40,}/);
  const r = await call('GET', `/drivers/${D.account_id}`, { token: D.token });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.license, 'GPLX-99');
});

test('TX3 (mục 12): hồ sơ PENDING — KH1 xem → 404 DRIVER_NOT_FOUND; AD1 xem → 200 đầy đủ', async () => {
  const k = await call('GET', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.KH1) });
  assert.equal(k.status, 404);
  assert.deepEqual(k.body, { error: 'DRIVER_NOT_FOUND' });
  const tx = await call('GET', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.TX1) });
  assert.equal(tx.status, 404);
  const a = await call('GET', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.AD1) });
  assert.equal(a.status, 200);
  assert.equal(a.body.approval_status, 'PENDING');
  assert.equal(a.body.license, 'GPLX-99');
});

// ---------- Mục 23 phần lỗi trước khi duyệt ----------
test('AC-TX-21 (mục 23, 409): tài xế chưa duyệt bật ONLINE kèm tọa độ → 409 DRIVER_NOT_APPROVED', async () => {
  const r = await call('PATCH', '/drivers/me', { token: D.token, body: { status: 'ONLINE', lat: 21.03, lng: 105.85 } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'DRIVER_NOT_APPROVED' });
  // OFFLINE khi đang OFFLINE (kể cả chưa duyệt) → 200 (TX9).
  const o = await call('PATCH', '/drivers/me', { token: D.token, body: { status: 'OFFLINE' } });
  assert.equal(o.status, 200, o.text);
  assert.deepEqual(o.body, { driver_id: D.account_id, status: 'OFFLINE' });
});

test('AC-TX-24 (mục 23, 404/403): tài khoản driver chưa nộp hồ sơ A39 → 404 DRIVER_NOT_FOUND; KH1, AD1 → 403 FORBIDDEN', async () => {
  const acc = await newDriverAccount(t);
  const a = await call('PATCH', '/drivers/me', { token: acc.token, body: { status: 'OFFLINE' } });
  assert.equal(a.status, 404);
  assert.deepEqual(a.body, { error: 'DRIVER_NOT_FOUND' });
  const l = await call('PATCH', '/drivers/me', { token: acc.token, body: { lat: 10.82, lng: 106.68 } });
  assert.equal(l.status, 404);
  assert.deepEqual(l.body, { error: 'DRIVER_NOT_FOUND' });
  for (const who of [SEED.KH1, SEED.AD1]) {
    const r = await call('PATCH', '/drivers/me', { token: await tokenOf(who), body: { status: 'OFFLINE' } });
    assert.equal(r.status, 403, who);
    assert.deepEqual(r.body, { error: 'FORBIDDEN' });
  }
});

// ---------- Mục 22 ----------
test('AC-TX-13 (mục 22): A13 ?approval_status=PENDING bằng AD1 → 200, TX7 (17) đứng trước hồ sơ mới, không có license, total đúng', async () => {
  const r = await call('GET', '/drivers?approval_status=PENDING&limit=50', { token: await tokenOf(SEED.AD1) });
  assert.equal(r.status, 200, r.text);
  const ids = r.body.data.map((d) => d.driver_id);
  assert.ok(ids.includes(17), 'thiếu TX7');
  assert.ok(ids.includes(D.account_id), 'thiếu hồ sơ vừa nộp');
  assert.ok(ids.indexOf(17) < ids.indexOf(D.account_id), 'TX7 phải đứng trước (cũ nhất trước)');
  for (const d of r.body.data) {
    assert.equal(d.approval_status, 'PENDING');
    assert.equal(d.license, undefined, 'A13 không được trả license');
    assert.ok(d.created_at);
  }
  const dbCount = Number(psql('driver-db', 'driver', "select count(*) from drivers where approval_status = 'PENDING'"));
  assert.equal(r.body.pagination.total, dbCount);
  const tx7 = r.body.data.find((d) => d.driver_id === 17);
  assert.deepEqual(
    { ...tx7, created_at: undefined },
    { driver_id: 17, name: 'Tài Xế 7', vehicle: 'CAR_4', plate: '59A-00007', status: 'OFFLINE', approval_status: 'PENDING', created_at: undefined },
  );
  // Biến thể A13: query lạ / approval_status lạ / phân trang sai.
  const ad = await tokenOf(SEED.AD1);
  const bad1 = await call('GET', '/drivers?approval_status=DONE', { token: ad });
  assert.equal(bad1.status, 400);
  assert.deepEqual(bad1.body, { error: 'INVALID_INPUT' });
  const bad2 = await call('GET', '/drivers?approval_status=PENDING&limit=0', { token: ad });
  assert.equal(bad2.status, 400);
  assert.deepEqual(bad2.body, { error: 'INVALID_PAGINATION' });
  const bad3 = await call('GET', '/drivers?foo=1', { token: ad });
  assert.equal(bad3.status, 400);
  assert.deepEqual(bad3.body, { error: 'INVALID_INPUT' });
  const lower = await call('GET', '/drivers?approval_status=pending&limit=1', { token: ad });
  assert.equal(lower.status, 200);
  assert.equal(lower.body.pagination.total, dbCount);
});

test('AC-TX-17 (mục 22, 28): PATCH /drivers/17 KHÔNG body bằng token KH1, TX1 → 403 FORBIDDEN (role kiểm trước body)', async () => {
  for (const who of [SEED.KH1, SEED.TX1]) {
    const r = await call('PATCH', '/drivers/17', { token: await tokenOf(who) });
    assert.equal(r.status, 403, who);
    assert.deepEqual(r.body, { error: 'FORBIDDEN' });
    const r2 = await call('PATCH', '/drivers/17', { token: await tokenOf(who), body: '{hong' });
    assert.equal(r2.status, 403, `${who} body hỏng`);
  }
  const n = await call('PATCH', '/drivers/17', { body: { approval_status: 'APPROVED' } });
  assert.equal(n.status, 401);
  assert.deepEqual(n.body, { error: 'TOKEN_MISSING' });
  assert.equal(psql('driver-db', 'driver', 'select approval_status from drivers where driver_id = 17'), 'PENDING');
});

test('AC-TX-32 / mục 28: GET /drivers (không lat) bằng KH1 → 403; GET /drivers bằng TX1 → 403', async () => {
  const a = await call('GET', '/drivers?approval_status=PENDING', { token: await tokenOf(SEED.KH1) });
  assert.equal(a.status, 403);
  assert.deepEqual(a.body, { error: 'FORBIDDEN' });
  const b = await call('GET', '/drivers', { token: await tokenOf(SEED.TX1) });
  assert.equal(b.status, 403);
  assert.deepEqual(b.body, { error: 'FORBIDDEN' });
});

test('AC-TX-16 (mục 22, 400): thiếu reason → REASON_REQUIRED; reason khoảng trắng → REASON_REQUIRED; PENDING → INVALID_INPUT; A15 kèm reason → INVALID_INPUT; reason có "<" → TEXT_CONTAINS_HTML; /abc → INVALID_ID; body hỏng → INVALID_JSON', async () => {
  const ad = await tokenOf(SEED.AD1);
  const id = D.account_id;
  const cases = [
    [`/drivers/${id}`, { approval_status: 'REJECTED' }, 'REASON_REQUIRED'],
    [`/drivers/${id}`, { approval_status: 'REJECTED', reason: '   ' }, 'REASON_REQUIRED'],
    [`/drivers/${id}`, { approval_status: 'PENDING' }, 'INVALID_INPUT'],
    [`/drivers/${id}`, { approval_status: 'APPROVED', reason: 'ok' }, 'INVALID_INPUT'],
    [`/drivers/${id}`, {}, 'INVALID_INPUT'],
    [`/drivers/${id}`, { approval_status: 'REJECTED', reason: 'x'.repeat(256) }, 'INVALID_INPUT'],
    [`/drivers/${id}`, { approval_status: 'REJECTED', reason: '<script>' }, 'TEXT_CONTAINS_HTML'],
    ['/drivers/abc', { approval_status: 'APPROVED' }, 'INVALID_ID'],
    [`/drivers/${id}`, '{hong', 'INVALID_JSON'],
  ];
  for (const [p, body, code] of cases) {
    const r = await call('PATCH', p, { token: ad, body });
    assert.equal(r.status, 400, `${p} ${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: code }, `${p} ${JSON.stringify(body)}`);
  }
  assert.equal(psql('driver-db', 'driver', `select approval_status from drivers where driver_id = ${id}`), 'PENDING');
});

test('AC-TX-16 (mục 22, 404): A15 /drivers/999999 → 404 DRIVER_NOT_FOUND', async () => {
  const r = await call('PATCH', '/drivers/999999', { token: await tokenOf(SEED.AD1), body: { approval_status: 'APPROVED' } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'DRIVER_NOT_FOUND' });
});

test('AC-TX-14 (mục 22): A15 duyệt bằng AD1 → 200 {driver_id, APPROVED}; A14 thấy APPROVED + OFFLINE; reviewed_by 99; Kafka có message key D, result APPROVED, không có họ tên', async () => {
  const r = await call('PATCH', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.AD1), body: { approval_status: 'approved' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: D.account_id, approval_status: 'APPROVED' });
  const g = await call('GET', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.AD1) });
  assert.equal(g.body.approval_status, 'APPROVED');
  assert.equal(g.body.status, 'OFFLINE');
  const row = psql('driver-db', 'driver', `select reviewed_by, reviewed_at is not null, availability from drivers where driver_id = ${D.account_id}`);
  assert.equal(row, '99|t|OFFLINE');
  let msg;
  for (let i = 0; i < 10 && !msg; i += 1) {
    msg = (await kafkaMessages('driver.application-reviewed')).find((m) => m.key === String(D.account_id));
    if (!msg) await sleep(500);
  }
  assert.ok(msg, 'không thấy message trên topic driver.application-reviewed');
  assert.equal(msg.content.event_type, 'driver.application-reviewed');
  assert.ok(msg.content.event_id);
  assert.ok(msg.content.occurred_at);
  assert.equal(msg.content.data.driver_id, D.account_id);
  assert.equal(msg.content.data.result, 'APPROVED');
  assert.ok(!msg.raw.includes('Tai Xe Moi'), 'event chứa họ tên');
  assert.ok(!msg.raw.toUpperCase().includes('GPLX'), 'event chứa số giấy phép');
});

test('AC-TX-16 (mục 22, 409): duyệt lại hồ sơ đã duyệt; từ chối hồ sơ đã duyệt → 409 APPLICATION_ALREADY_REVIEWED', async () => {
  const ad = await tokenOf(SEED.AD1);
  const a = await call('PATCH', `/drivers/${D.account_id}`, { token: ad, body: { approval_status: 'APPROVED' } });
  assert.equal(a.status, 409);
  assert.deepEqual(a.body, { error: 'APPLICATION_ALREADY_REVIEWED' });
  const b = await call('PATCH', `/drivers/${D.account_id}`, { token: ad, body: { approval_status: 'REJECTED', reason: 'x' } });
  assert.equal(b.status, 409);
  assert.deepEqual(b.body, { error: 'APPLICATION_ALREADY_REVIEWED' });
});

test('AC-TX-15 (mục 22): A16 từ chối hồ sơ PENDING kèm reason → 200 REJECTED + reason; Kafka result REJECTED, không có lý do; KH1 xem → 404, AD1 và chủ thấy reason; nộp lại → 200 resubmitted (FR43)', async () => {
  const E = await newDriverWithApplication(t);
  const reason = 'thieu giay to';
  const ad = await tokenOf(SEED.AD1);
  const r = await call('PATCH', `/drivers/${E.driver_id}`, { token: ad, body: { approval_status: 'REJECTED', reason } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { driver_id: E.driver_id, approval_status: 'REJECTED', reason });
  let msg;
  for (let i = 0; i < 10 && !msg; i += 1) {
    msg = (await kafkaMessages('driver.application-reviewed')).find((m) => m.key === String(E.driver_id));
    if (!msg) await sleep(500);
  }
  assert.ok(msg, 'không thấy message REJECTED');
  assert.equal(msg.content.data.result, 'REJECTED');
  assert.ok(!msg.raw.includes(reason), 'event chứa lý do từ chối');
  const k = await call('GET', `/drivers/${E.driver_id}`, { token: await tokenOf(SEED.KH1) });
  assert.equal(k.status, 404);
  const a = await call('GET', `/drivers/${E.driver_id}`, { token: ad });
  assert.equal(a.body.approval_status, 'REJECTED');
  assert.equal(a.body.reason, reason);
  // Hồ sơ REJECTED chưa được bật ONLINE.
  const on = await call('PATCH', '/drivers/me', { token: E.token, body: { status: 'ONLINE', lat: 21.03, lng: 105.85 } });
  assert.equal(on.status, 409);
  assert.deepEqual(on.body, { error: 'DRIVER_NOT_APPROVED' });
  // FR43 (đổi 2026-10-05): tài xế bị từ chối xem lý do ở A14 của chính mình và NỘP LẠI được bằng A11 → 200.
  const own = await call('GET', `/drivers/${E.driver_id}`, { token: E.token });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.approval_status, 'REJECTED');
  assert.equal(own.body.reason, reason);
  const resubmit = await call('POST', '/drivers', { token: E.token, body: { name: 'Lai', license: 'GPLX-55', plate: newPlate() } });
  assert.equal(resubmit.status, 200, resubmit.text);
  assert.equal(resubmit.body.resubmitted, true);
  assert.equal(resubmit.body.approval_status, 'PENDING');
});

// ---------- Mục 23 sau khi duyệt ----------
test('AC-TX-22 (mục 23, 400): D đã duyệt, chưa có vị trí — ONLINE không tọa độ → 400 INVALID_INPUT; kèm lat/lng → 200 ONLINE có tọa độ', async () => {
  const a = await call('PATCH', '/drivers/me', { token: D.token, body: { status: 'ONLINE' } });
  assert.equal(a.status, 400);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  // Tọa độ ở Hà Nội để không lọt vào kết quả tìm quanh P0 (10.82, 106.68) mà mục 13 dùng.
  const b = await call('PATCH', '/drivers/me', { token: D.token, body: { status: 'ONLINE', lat: 21.03, lng: 105.85 } });
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(b.body, { driver_id: D.account_id, status: 'ONLINE', lat: 21.03, lng: 105.85 });
  // Tài xế đã duyệt và ONLINE: khách tìm quanh vị trí đó thấy D.
  const s = await call('GET', '/drivers?lat=21.03&lng=105.85', { token: await tokenOf(SEED.KH1) });
  assert.equal(s.status, 200);
  assert.ok(s.body.data.some((x) => x.driver_id === D.account_id));
  const off = await call('PATCH', '/drivers/me', { token: D.token, body: { status: 'OFFLINE' } });
  assert.equal(off.status, 200);
  const s2 = await call('GET', '/drivers?lat=21.03&lng=105.85', { token: await tokenOf(SEED.KH1) });
  assert.ok(!s2.body.data.some((x) => x.driver_id === D.account_id));
});

test('Mục 12: tài xế đã duyệt — KH1 xem phần công khai đúng 5 key', async () => {
  const r = await call('GET', `/drivers/${D.account_id}`, { token: await tokenOf(SEED.KH1) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { driver_id: D.account_id, name: 'Tai Xe Moi', vehicle: 'CAR_4', plate: plateD, status: 'OFFLINE' });
});

test('Mục 21: password_hash, otp_hash không bao giờ xuất hiện trong response', async () => {
  const p = t.phone(newDriverPhone());
  const o = await call('POST', '/otps', { body: { phone: p } });
  const a = await call('POST', '/driver-accounts', { body: { phone: p, otp: o.body.otp, password: SEED_PASSWORD } });
  t.id(a.body.account_id);
  for (const r of [o, a]) assert.ok(!/hash|scrypt/i.test(r.text), r.text);
});
