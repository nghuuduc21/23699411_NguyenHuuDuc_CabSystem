// Spec 09-10 — đăng ký khách, đăng nhập, JWT, đăng xuất. Mục chấm 9, 10, 24 (mật khẩu băm), 25, 27.
// Không dừng container (ràng buộc khi chạy song song với dev-agent): AC-DN-06, AC-DN-18 nằm ở
// 90-dung-service.test.js, chỉ chạy khi được phép (`npm run test:dung-service`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEED, SEED_PASSWORD, ROOT, call, createTracker, decodeJwt, jwtSecretFromEnv, login, newEmail,
  psql, psqlTable, signJwt, tamperMiddle, tokenOf,
} from './api.js';
import { GATEWAY_URL, rawRequest, run } from './helpers.js';

const t = createTracker();
after(() => t.cleanup());

const countEmail = (email) => Number(psql('auth-db', 'auth', `select count(*) from accounts where email = '${email}'`));

// ---------- Mục 9 (ADR-021: khách đăng ký bằng email ở /api/v1/auth/register) ----------
const e9 = t.email(newEmail());
let acc9;

test('AC-DN-01 (mục 9): POST /api/v1/auth/register email mới → 201 {account_id ≥ 1000, role customer}; dòng có email, phone NULL', async () => {
  const r = await call('POST', '/auth/register', { body: { email: e9, password: SEED_PASSWORD } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['account_id', 'role']);
  assert.equal(r.body.role, 'customer');
  assert.ok(Number.isInteger(r.body.account_id) && r.body.account_id >= 1000, `account_id = ${r.body.account_id}`);
  assert.ok(!r.text.includes('password'), 'response lộ password / password_hash');
  acc9 = t.id(r.body.account_id);
  assert.equal(psql('auth-db', 'auth', `select coalesce(phone, 'NULL') || '|' || email from accounts where account_id = ${acc9}`), `NULL|${e9}`);
  // Không gọi service khác: chưa có hồ sơ khách (ADR-013).
  assert.equal(psql('customer-db', 'customer', `select count(*) from customer_profiles where customer_id = ${acc9}`), '0');
});

test('AC-DN-02 (mục 9): đăng nhập cùng body → 200 token, role customer, cùng account_id', async () => {
  const r = await call('POST', '/auth/login', { body: { email: e9, password: SEED_PASSWORD } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.role, 'customer');
  assert.equal(r.body.account_id, acc9);
  assert.equal(typeof r.body.token, 'string');
  assert.ok(!r.text.includes('password_hash'));
});

test('AC-DN-03 (mục 9, 409): đăng ký lại cùng email → 409 EMAIL_ALREADY_EXISTS, không thêm dòng', async () => {
  const r = await call('POST', '/auth/register', { body: { email: e9, password: SEED_PASSWORD } });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(r.body, { error: 'EMAIL_ALREADY_EXISTS' });
  assert.equal(countEmail(e9), 1);
});

test('AC-DN-03 (mục 9, 409): cùng email viết HOA → 409 EMAIL_ALREADY_EXISTS (so chữ thường)', async () => {
  const r = await call('POST', '/auth/register', { body: { email: e9.toUpperCase().replace('@TEST.VN', '@Test.VN'), password: SEED_PASSWORD } });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(r.body, { error: 'EMAIL_ALREADY_EXISTS' });
  assert.equal(countEmail(e9), 1);
});

test('AC-DN-03 (mục 9, 409): email seed kh1@cab.vn → 409 EMAIL_ALREADY_EXISTS', async () => {
  const r = await call('POST', '/auth/register', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(r.body, { error: 'EMAIL_ALREADY_EXISTS' });
});

test('AC-DN-25 (mục 9, 400): A04 kèm "phone" → 400 INVALID_INPUT, không tạo tài khoản; bỏ phone → 201', async () => {
  const e = t.email(newEmail());
  const a = await call('POST', '/auth/register', { body: { email: e, password: SEED_PASSWORD, phone: '0901234569' } });
  assert.equal(a.status, 400, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  assert.equal(countEmail(e), 0);
  const b = await call('POST', '/auth/register', { body: { email: e, password: SEED_PASSWORD } });
  assert.equal(b.status, 201, b.text);
  t.id(b.body.account_id);
  assert.equal(b.body.role, 'customer');
  assert.equal(countEmail(e), 1);
});

test('AC-DN-04 (mục 9, 400): thiếu password → 400 INVALID_INPUT', async () => {
  const e = t.email(newEmail());
  const r = await call('POST', '/auth/register', { body: { email: e } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_INPUT' });
  assert.equal(countEmail(e), 0);
});

test('AC-DN-04 (mục 9, 400): thiếu email → 400 INVALID_INPUT', async () => {
  const r = await call('POST', '/auth/register', { body: { password: SEED_PASSWORD } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-04 (mục 9, 400): thêm "role":"admin" → 400 INVALID_INPUT, không tạo admin', async () => {
  const e = t.email(newEmail());
  const r = await call('POST', '/auth/register', { body: { email: e, password: SEED_PASSWORD, role: 'admin' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_INPUT' });
  assert.equal(countEmail(e), 0);
});

test('AC-DN-04 (mục 9, 400): sai kiểu (email là số, password là số) → 400 INVALID_INPUT', async () => {
  const r1 = await call('POST', '/auth/register', { body: { email: 12345, password: SEED_PASSWORD } });
  assert.equal(r1.status, 400);
  assert.deepEqual(r1.body, { error: 'INVALID_INPUT' });
  const r2 = await call('POST', '/auth/register', { body: { email: newEmail(), password: 12345678 } });
  assert.equal(r2.status, 400);
  assert.deepEqual(r2.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-04 (mục 9, 400): body không phải JSON → 400 INVALID_JSON; body là mảng → 400 INVALID_INPUT', async () => {
  const r = await call('POST', '/auth/register', { body: '{"email":' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_JSON' });
  const r2 = await call('POST', '/auth/register', { body: '[1,2]' });
  assert.equal(r2.status, 400);
  assert.deepEqual(r2.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-05 (mục 9, 400): email "abc" → INVALID_EMAIL; "a b@cab.vn" → INVALID_EMAIL; password "123" → INVALID_PASSWORD', async () => {
  const a = await call('POST', '/auth/register', { body: { email: 'abc', password: SEED_PASSWORD } });
  assert.equal(a.status, 400, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_EMAIL' });
  const b = await call('POST', '/auth/register', { body: { email: 'a b@cab.vn', password: SEED_PASSWORD } });
  assert.equal(b.status, 400, b.text);
  assert.deepEqual(b.body, { error: 'INVALID_EMAIL' });
  const e = t.email(newEmail());
  const c = await call('POST', '/auth/register', { body: { email: e, password: '123' } });
  assert.equal(c.status, 400);
  assert.deepEqual(c.body, { error: 'INVALID_PASSWORD' });
  assert.equal(countEmail(e), 0);
});

test('Spec 09-10 mục 4.1 bước 7: Content-Type text/plain vẫn đọc body là JSON (Postman chọn "Text")', async () => {
  const e = t.email(newEmail());
  const r = await call('POST', '/auth/register', {
    body: JSON.stringify({ email: e, password: SEED_PASSWORD }),
    headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(r.status, 201, r.text);
  t.id(r.body.account_id);
});

test('AC-DN-33 (đường dẫn): đường cũ POST /api/v1/accounts, /otps, /driver-accounts → 404 ROUTE_NOT_FOUND', async () => {
  for (const [p, body] of [
    ['/accounts', { email: newEmail(), password: SEED_PASSWORD }],
    ['/otps', { phone: '0599000001' }],
    ['/driver-accounts', { phone: '0599000001', otp: '123456', password: SEED_PASSWORD }],
  ]) {
    const r = await call('POST', p, { body });
    assert.equal(r.status, 404, `${p}: ${r.text}`);
    assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' }, p);
  }
});

// ---------- Mục 10 ----------
test('AC-DN-07 (mục 10): KH1 đăng nhập → 200, account_id 1, expires_in 3600; payload có sub/role/jti/exp, không có email, số điện thoại', async () => {
  const r = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['account_id', 'expires_in', 'role', 'token']);
  assert.equal(r.body.account_id, 1);
  assert.equal(r.body.role, 'customer');
  assert.equal(r.body.expires_in, 3600);
  const { header, payload } = decodeJwt(r.body.token);
  assert.equal(header.alg, 'HS256');
  assert.equal(payload.sub, '1');
  assert.equal(payload.role, 'customer');
  assert.equal(typeof payload.jti, 'string');
  assert.equal(payload.exp - payload.iat, 3600);
  const raw = JSON.stringify(payload);
  assert.ok(!raw.includes('0900000001') && !raw.includes('900000001'), 'payload chứa số điện thoại');
  assert.ok(!raw.includes('@') && !raw.includes('kh1'), 'payload chứa email');
});

test('AC-DN-08 (mục 10, 401): sai mật khẩu và email chưa đăng ký → cùng 401 INVALID_CREDENTIALS, body giống hệt', async () => {
  const a = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: 'sai-mat-khau' } });
  const b = await call('POST', '/auth/login', { body: { email: 'khong@cab.vn', password: SEED_PASSWORD } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, { error: 'INVALID_CREDENTIALS' });
  assert.equal(a.text, b.text);
});

test('AC-DN-08 (mục 10, 401): tài xế số chưa đăng ký → cùng 401 INVALID_CREDENTIALS', async () => {
  const b = await call('POST', '/auth/login', { body: { phone: '0988888888', password: SEED_PASSWORD } });
  assert.equal(b.status, 401);
  assert.deepEqual(b.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-09 (mục 10, 400): thiếu password → 400 INVALID_INPUT', async () => {
  const a = await call('POST', '/auth/login', { body: { email: SEED.KH1 } });
  assert.equal(a.status, 400);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  const b = await call('POST', '/auth/login', { body: { phone: SEED.TX1 } });
  assert.equal(b.status, 400);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-26 (mục 10, 400): có cả email lẫn phone, hoặc thiếu cả hai → 400 INVALID_INPUT', async () => {
  const a = await call('POST', '/auth/login', { body: { email: 'kh1@cab.vn', phone: '0910000001', password: SEED_PASSWORD } });
  assert.equal(a.status, 400, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  assert.equal(a.body.token, undefined);
  const b = await call('POST', '/auth/login', { body: { password: SEED_PASSWORD } });
  assert.equal(b.status, 400, b.text);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-27 (mục 10, 401): khách gửi số hồ sơ 0900000001; tài xế gửi email tx1@cab.vn → 401 INVALID_CREDENTIALS cả hai', async () => {
  const a = await call('POST', '/auth/login', { body: { phone: '0900000001', password: SEED_PASSWORD } });
  assert.equal(a.status, 401, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_CREDENTIALS' });
  const b = await call('POST', '/auth/login', { body: { email: 'tx1@cab.vn', password: SEED_PASSWORD } });
  assert.equal(b.status, 401, b.text);
  assert.deepEqual(b.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-28 (mục 10, 401): admin bằng số cũ 0999999999 → 401 INVALID_CREDENTIALS (admin không còn số)', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: '0999999999', password: SEED_PASSWORD } });
  assert.equal(r.status, 401, r.text);
  assert.deepEqual(r.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-07 (mục 10): email viết hoa KH1@Cab.VN vẫn đăng nhập ra mã 1 (chuẩn hóa chữ thường)', async () => {
  const r = await call('POST', '/auth/login', { body: { email: ' KH1@Cab.VN ', password: SEED_PASSWORD } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.account_id, 1);
});

test('AC-DN-10 (mục 10, 403): KH9 LOCKED đúng mật khẩu → 403 ACCOUNT_LOCKED', async () => {
  const r = await call('POST', '/auth/login', { body: { email: SEED.KH9, password: SEED_PASSWORD } });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'ACCOUNT_LOCKED' });
});

test('AC-DN-10 (mục 10): KH9 LOCKED sai mật khẩu → 401 INVALID_CREDENTIALS (không lộ trạng thái khóa)', async () => {
  const r = await call('POST', '/auth/login', { body: { email: SEED.KH9, password: 'sai-mat-khau' } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-11 (mục 10): admin@cab.vn → 200 role admin mã 99; TX1 bằng số → 200 role driver mã 11 (một API cho ba role)', async () => {
  const ad = await call('POST', '/auth/login', { body: { email: SEED.AD1, password: SEED_PASSWORD } });
  assert.equal(ad.status, 200, ad.text);
  assert.equal(ad.body.role, 'admin');
  assert.equal(ad.body.account_id, 99);
  const tx = await call('POST', '/auth/login', { body: { phone: SEED.TX1, password: SEED_PASSWORD } });
  assert.equal(tx.status, 200);
  assert.equal(tx.body.role, 'driver');
  assert.equal(tx.body.account_id, 11);
});

test('Spec 09-10 mục 8.1: hai lần đăng nhập ra hai jti khác nhau', async () => {
  const a = decodeJwt((await login(SEED.KH2)).token).payload.jti;
  const b = decodeJwt((await login(SEED.KH2)).token).payload.jti;
  assert.notEqual(a, b);
});

test('AC-DN-29 (migration): schema_migrations có 004_email-dang-nhap.sql (một lần); email, phone cho NULL; đủ 4 ràng buộc', () => {
  const mig = psql('auth-db', 'auth', 'table schema_migrations');
  assert.match(mig, /004_email-dang-nhap\.sql/);
  assert.equal(psql('auth-db', 'auth', "select count(*) from schema_migrations where version like '004%'"), '1');
  const cols = psql('auth-db', 'auth', "select column_name || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name in ('email','phone') order by column_name").split(/\r?\n/);
  assert.deepEqual(cols, ['email:YES', 'phone:YES']);
  const cons = psql('auth-db', 'auth', "select conname from pg_constraint where conrelid = 'accounts'::regclass order by conname").split(/\r?\n/);
  for (const c of ['accounts_email_key', 'accounts_phone_key', 'accounts_email_format', 'accounts_identity_by_role']) {
    assert.ok(cons.includes(c), `thiếu ràng buộc ${c}: ${cons.join(',')}`);
  }
});

test('AC-DN-31 (ràng buộc): database từ chối driver có email, customer thiếu cả hai, email chữ hoa', () => {
  const tryInsert = (sql) => run('docker', ['exec', 'auth-db', 'psql', '-U', 'cab', '-d', 'auth', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
  const cases = [
    ["INSERT INTO accounts (phone, email, password_hash, role) VALUES ('0912345678', 'x@cab.vn', 'scrypt$a$b', 'driver')", 'accounts_identity_by_role'],
    ["INSERT INTO accounts (phone, email, password_hash, role) VALUES (NULL, NULL, 'scrypt$a$b', 'customer')", 'accounts_identity_by_role'],
    ["INSERT INTO accounts (phone, email, password_hash, role) VALUES (NULL, 'X@cab.vn', 'scrypt$a$b', 'customer')", 'accounts_email_format'],
  ];
  for (const [sql, cons] of cases) {
    const r = tryInsert(sql);
    assert.notEqual(r.status, 0, `database nhận: ${sql}`);
    assert.match(r.stderr, new RegExp(cons), r.stderr);
  }
  assert.equal(psql('auth-db', 'auth', "select count(*) from accounts where phone = '0912345678' or email in ('x@cab.vn', 'X@cab.vn')"), '0');
});

// ---------- Mục 25 ----------
test('AC-DN-12 (mục 25): password "\' OR \'1\'=\'1" → 401 INVALID_CREDENTIALS', async () => {
  const r = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: "' OR '1'='1" } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-13 (mục 25): email "\' OR 1=1 --" → 400 INVALID_EMAIL; phone "\' OR 1=1 --" → 400 INVALID_PHONE; sau đó KH1 vẫn đăng nhập được', async () => {
  const e = await call('POST', '/auth/login', { body: { email: "' OR 1=1 --", password: 'x' } });
  assert.equal(e.status, 400, e.text);
  assert.deepEqual(e.body, { error: 'INVALID_EMAIL' });
  const r = await call('POST', '/auth/login', { body: { phone: "' OR 1=1 --", password: 'x' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_PHONE' });
  const ok = await call('POST', '/auth/login', { body: { email: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.ok(Number(psql('auth-db', 'auth', 'select count(*) from accounts')) >= 13, 'bảng accounts mất dữ liệu');
  const logs = run('docker', ['logs', '--since', '2m', 'auth-service']);
  assert.ok(!`${logs.stdout}${logs.stderr}`.includes("OR 1=1"), 'log auth-service chứa chuỗi injection');
});

test('AC-DN-14 (mục 25): SQL trong auth-, customer-, driver-service chỉ dùng tham số $n; không ghép giá trị vào câu lệnh', () => {
  // Cho phép ${…} chỉ khi là HẰNG chuỗi SQL khai báo trong module (tên viết hoa: COLUMNS, NEARBY_CTE…)
  // hoặc biến `where` là hằng chuỗi cục bộ (drivers-repo.js, đã đọc tay: '($1::text IS NULL OR …)').
  const allowed = /^([A-Z_]+|where)$/;
  const offenders = [];
  for (const svc of ['auth-service', 'customer-service', 'driver-service']) {
    const dir = path.join(ROOT, 'services', svc, 'src');
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, String(f)), 'utf8');
      for (const m of src.matchAll(/`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*`/gi)) {
        for (const e of m[0].matchAll(/\$\{([^}]*)\}/g)) {
          if (!allowed.test(e[1].trim())) offenders.push(`${svc}/${f}: ${e[0]}`);
        }
      }
      for (const m of src.matchAll(/['"][^'"\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^'"\n]*['"]\s*\+/gi)) {
        offenders.push(`${svc}/${f}: ${m[0].slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------- Mục 24 (phần auth) ----------
test('AC-DN-19 (mục 24): table accounts — password_hash bắt đầu scrypt$, không thấy 12345678; email khách/admin và phone tài xế hiện rõ', () => {
  const out = psqlTable('auth-db', 'auth', 'accounts');
  assert.ok(!out.includes(SEED_PASSWORD), 'thấy mật khẩu rõ trong database');
  assert.match(out, /kh1@cab\.vn/);
  assert.match(out, /admin@cab\.vn/);
  assert.match(out, /0910000001/);
  assert.ok(!out.includes('0999999999'), 'admin còn số 0999999999');
  const hashes = psql('auth-db', 'auth', 'select password_hash from accounts').split(/\r?\n/);
  assert.ok(hashes.length > 0);
  for (const h of hashes) assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  // Salt ngẫu nhiên: cùng mật khẩu seed nhưng hash khác nhau.
  assert.equal(new Set(hashes).size, hashes.length);
});

// ---------- Mục 27 ----------
test('AC-DN-15 (mục 27): token KH1 sửa một ký tự ở giữa → GET /customers/me 401 TOKEN_INVALID', async () => {
  const tok = (await login(SEED.KH1)).token;
  const bad = tamperMiddle(tok);
  assert.notEqual(bad, tok);
  const r = await call('GET', '/customers/me', { token: bad });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'TOKEN_INVALID' });
});

test('AC-DN-15 (mục 27): đổi role trong payload thành admin, giữ chữ ký cũ → 401 TOKEN_INVALID', async () => {
  const tok = (await login(SEED.KH1)).token;
  const [h, p, s] = tok.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.role = 'admin';
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
  const r = await call('GET', '/customers/2', { token: forged });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'TOKEN_INVALID' });
});

test('AC-DN-24 (mục 27): đổi payload role admin giữ chữ ký cũ → 401; ký lại bằng khóa "abc" → 401; PATCH /drivers/17 bằng token đó → 401', async () => {
  const login1 = await login(SEED.KH1);
  const [h, p, s] = login1.token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.role = 'admin';
  const p2 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const keepSig = `${h}.${p2}.${s}`;
  const r1 = await call('GET', '/customers/me', { token: keepSig });
  assert.equal(r1.status, 401);
  assert.deepEqual(r1.body, { error: 'TOKEN_INVALID' });
  const resigned = signJwt(payload, 'abc');
  const r2 = await call('GET', '/customers/me', { token: resigned });
  assert.equal(r2.status, 401);
  assert.deepEqual(r2.body, { error: 'TOKEN_INVALID' });
  const r3 = await call('PATCH', '/drivers/17', { token: resigned, body: { status: 'APPROVED' } });
  assert.equal(r3.status, 401, r3.text);
  assert.deepEqual(r3.body, { error: 'TOKEN_INVALID' });
});

test('Spec 09-10 mục 8.1 (mục 27): token alg "none" và token ký bằng khóa lạ → 401 TOKEN_INVALID', async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: '99', role: 'admin', jti: 'x-1', iat: now, exp: now + 600 };
  const none = signJwt(claims, '', { alg: 'none', typ: 'JWT' });
  const other = signJwt(claims, 'khoa-la-khong-phai-JWT_SECRET-0123456789');
  for (const tok of [none, other]) {
    const r = await call('GET', '/customers/1', { token: tok });
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: 'TOKEN_INVALID' });
  }
});

test('Spec 09-10 mục 4.1 bước 3–4: token ký đúng JWT_SECRET nhưng hết hạn → TOKEN_EXPIRED; thiếu exp → TOKEN_INVALID', async (tt) => {
  const secret = jwtSecretFromEnv();
  if (!secret) {
    tt.diagnostic('Không đọc được JWT_SECRET từ .env — không kiểm được nhánh này');
    assert.fail('thiếu .env để ký token kiểm thử');
  }
  const now = Math.floor(Date.now() / 1000);
  const expired = signJwt({ sub: '1', role: 'customer', jti: 'qa-exp', iat: now - 7200, exp: now - 3600 }, secret);
  const r1 = await call('GET', '/customers/me', { token: expired });
  assert.equal(r1.status, 401);
  assert.deepEqual(r1.body, { error: 'TOKEN_EXPIRED' });
  const noExp = signJwt({ sub: '1', role: 'customer', jti: 'qa-noexp', iat: now }, secret);
  const r2 = await call('GET', '/customers/me', { token: noExp });
  assert.equal(r2.status, 401);
  assert.deepEqual(r2.body, { error: 'TOKEN_INVALID' });
  const badRole = signJwt({ sub: '1', role: 'superadmin', jti: 'qa-role', iat: now, exp: now + 600 }, secret);
  const r3 = await call('GET', '/customers/me', { token: badRole });
  assert.equal(r3.status, 401);
  assert.deepEqual(r3.body, { error: 'TOKEN_INVALID' });
  // Đối chứng: cùng cách ký, claim đúng → 200 (chứng minh hai nhánh trên bị từ chối vì claim, không vì cách ký).
  const good = signJwt({ sub: '1', role: 'customer', jti: `qa-ok-${now}`, iat: now, exp: now + 600 }, secret);
  const r4 = await call('GET', '/customers/me', { token: good });
  assert.equal(r4.status, 200, r4.text);
});

test('AC-DN-16 (mục 27): không header Authorization → 401 TOKEN_MISSING; "Bearer " rỗng → TOKEN_MISSING; "Basic x" → TOKEN_INVALID', async () => {
  const a = await call('GET', '/customers/me');
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, { error: 'TOKEN_MISSING' });
  const b = await call('GET', '/customers/me', { rawAuth: 'Bearer ' });
  assert.equal(b.status, 401);
  assert.deepEqual(b.body, { error: 'TOKEN_MISSING' });
  const c = await call('GET', '/customers/me', { rawAuth: 'Basic abc' });
  assert.equal(c.status, 401);
  assert.deepEqual(c.body, { error: 'TOKEN_INVALID' });
});

test('Spec 09-10 mục 4.1 bước 2: chữ "bearer" viết thường vẫn nhận', async () => {
  const tok = await tokenOf(SEED.KH1);
  const r = await call('GET', '/customers/me', { rawAuth: `bearer ${tok}` });
  assert.equal(r.status, 200, r.text);
});

test('AC-DN-17 (mục 27): đăng xuất → 200 LOGGED_OUT; dùng lại token → 401 TOKEN_REVOKED; token khác vẫn dùng được', async () => {
  const tok = (await login(SEED.KH1)).token;
  const other = (await login(SEED.KH1)).token;
  const out = await call('POST', '/auth/logout', { token: tok });
  assert.equal(out.status, 200, out.text);
  assert.deepEqual(out.body, { status: 'LOGGED_OUT' });
  const r = await call('GET', '/customers/me', { token: tok });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'TOKEN_REVOKED' });
  const again = await call('POST', '/auth/logout', { token: tok });
  assert.equal(again.status, 401);
  assert.deepEqual(again.body, { error: 'TOKEN_REVOKED' });
  const ok = await call('GET', '/customers/me', { token: other });
  assert.equal(ok.status, 200);
  // Key Redis có hạn ≈ thời gian sống còn lại của token.
  const jti = decodeJwt(tok).payload.jti;
  const ttl = Number(redisTtl(`revoked:${jti}`));
  assert.ok(ttl > 3000 && ttl <= 3600, `TTL revoked = ${ttl}`);
});

test('A06: đăng xuất không token → 401 TOKEN_MISSING', async () => {
  const r = await call('POST', '/auth/logout');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'TOKEN_MISSING' });
});

test('AC-DN-20: POST /auth/login (thiếu /api/v1) → 404 ROUTE_NOT_FOUND; /auth/register (thiếu /api/v1) → 404', async () => {
  const a = await call('POST', `${GATEWAY_URL}/auth/login`, { body: { email: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(a.status, 404);
  assert.deepEqual(a.body, { error: 'ROUTE_NOT_FOUND' });
  const b = await call('POST', `${GATEWAY_URL}/auth/register`, { body: { email: newEmail(), password: SEED_PASSWORD } });
  assert.equal(b.status, 404);
  assert.deepEqual(b.body, { error: 'ROUTE_NOT_FOUND' });
});

test('Spec 09-10 mục 4.1: header x-account-id / x-role do client gửi bị bỏ qua', async () => {
  const tok = await tokenOf(SEED.KH1);
  const r = await rawRequest(`${GATEWAY_URL}/api/v1/customers/me`, {
    headers: { Authorization: `Bearer ${tok}`, 'x-account-id': '2', 'x-role': 'admin' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.customer_id, 1);
});

// TTL của key trong Redis (đọc bằng redis-cli trong container).
function redisTtl(key) {
  const r = run('docker', ['exec', 'redis', 'redis-cli', 'TTL', key]);
  return r.stdout.trim();
}
