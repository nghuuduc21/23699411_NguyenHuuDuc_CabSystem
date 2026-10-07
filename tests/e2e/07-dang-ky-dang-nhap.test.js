// Spec 09-10 — đăng ký khách, đăng nhập, JWT, đăng xuất. Mục chấm 9, 10, 24 (mật khẩu băm), 25, 27.
// Không dừng container (ràng buộc khi chạy song song với dev-agent): AC-DN-06, AC-DN-18 nằm ở
// 90-dung-service.test.js, chỉ chạy khi được phép (`npm run test:dung-service`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEED, SEED_PASSWORD, ROOT, call, createTracker, decodeJwt, jwtSecretFromEnv, login, newCustomerPhone,
  psql, psqlTable, signJwt, tamperMiddle, tokenOf,
} from './api.js';
import { GATEWAY_URL, rawRequest, run } from './helpers.js';

const t = createTracker();
after(() => t.cleanup());

const countPhone = (phone) => Number(psql('auth-db', 'auth', `select count(*) from accounts where phone = '${phone}'`));

// ---------- Mục 9 ----------
const p9 = t.phone(newCustomerPhone());
let acc9;

test('AC-DN-01 (mục 9): POST /api/v1/accounts số mới → 201 {account_id ≥ 1000, role customer}', async () => {
  const r = await call('POST', '/accounts', { body: { phone: p9, password: SEED_PASSWORD } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ['account_id', 'role']);
  assert.equal(r.body.role, 'customer');
  assert.ok(Number.isInteger(r.body.account_id) && r.body.account_id >= 1000, `account_id = ${r.body.account_id}`);
  assert.ok(!r.text.includes('password'), 'response lộ password / password_hash');
  acc9 = t.id(r.body.account_id);
  // Không gọi service khác: chưa có hồ sơ khách (ADR-013).
  assert.equal(psql('customer-db', 'customer', `select count(*) from customer_profiles where customer_id = ${acc9}`), '0');
});

test('AC-DN-02 (mục 9): đăng nhập cùng body → 200 token, role customer, cùng account_id', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: p9, password: SEED_PASSWORD } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.role, 'customer');
  assert.equal(r.body.account_id, acc9);
  assert.equal(typeof r.body.token, 'string');
  assert.ok(!r.text.includes('password_hash'));
});

test('AC-DN-03 (mục 9, 409): đăng ký lại cùng số → 409 PHONE_ALREADY_EXISTS, không thêm dòng', async () => {
  const r = await call('POST', '/accounts', { body: { phone: p9, password: SEED_PASSWORD } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'PHONE_ALREADY_EXISTS' });
  assert.equal(countPhone(p9), 1);
});

test('AC-DN-03 (mục 9, 409): số viết dạng +84 trùng số đã có → 409 (chuẩn hóa trước khi so)', async () => {
  const r = await call('POST', '/accounts', { body: { phone: `+84${p9.slice(1)}`, password: SEED_PASSWORD } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'PHONE_ALREADY_EXISTS' });
});

test('AC-DN-21 (mục 9, 400): A04 kèm "email" → 400 INVALID_INPUT, không tạo tài khoản; bỏ email → 201 (ADR-019)', async () => {
  const p = t.phone(newCustomerPhone());
  const a = await call('POST', '/accounts', { body: { phone: p, password: SEED_PASSWORD, email: 'a@b.vn' } });
  assert.equal(a.status, 400, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  assert.equal(countPhone(p), 0);
  const b = await call('POST', '/accounts', { body: { phone: p, password: SEED_PASSWORD } });
  assert.equal(b.status, 201, b.text);
  t.id(b.body.account_id);
  assert.equal(b.body.role, 'customer');
  assert.equal(countPhone(p), 1);
});

test('AC-DN-04 (mục 9, 400): thiếu password → 400 INVALID_INPUT', async () => {
  const p = t.phone(newCustomerPhone());
  const r = await call('POST', '/accounts', { body: { phone: p } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_INPUT' });
  assert.equal(countPhone(p), 0);
});

test('AC-DN-04 (mục 9, 400): thêm "role":"admin" → 400 INVALID_INPUT, không tạo admin', async () => {
  const p = t.phone(newCustomerPhone());
  const r = await call('POST', '/accounts', { body: { phone: p, password: SEED_PASSWORD, role: 'admin' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_INPUT' });
  assert.equal(countPhone(p), 0);
});

test('AC-DN-04 (mục 9, 400): sai kiểu (phone là số, password là số) → 400 INVALID_INPUT', async () => {
  const r1 = await call('POST', '/accounts', { body: { phone: 912345678, password: SEED_PASSWORD } });
  assert.equal(r1.status, 400);
  assert.deepEqual(r1.body, { error: 'INVALID_INPUT' });
  const r2 = await call('POST', '/accounts', { body: { phone: newCustomerPhone(), password: 12345678 } });
  assert.equal(r2.status, 400);
  assert.deepEqual(r2.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-04 (mục 9, 400): body không phải JSON → 400 INVALID_JSON; body là mảng → 400 INVALID_INPUT', async () => {
  const r = await call('POST', '/accounts', { body: '{"phone":' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_JSON' });
  const r2 = await call('POST', '/accounts', { body: '[1,2]' });
  assert.equal(r2.status, 400);
  assert.deepEqual(r2.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-05 (mục 9, 400): phone "12345" → INVALID_PHONE; password "123" → INVALID_PASSWORD', async () => {
  const a = await call('POST', '/accounts', { body: { phone: '12345', password: SEED_PASSWORD } });
  assert.equal(a.status, 400);
  assert.deepEqual(a.body, { error: 'INVALID_PHONE' });
  const p = t.phone(newCustomerPhone());
  const c = await call('POST', '/accounts', { body: { phone: p, password: '123' } });
  assert.equal(c.status, 400);
  assert.deepEqual(c.body, { error: 'INVALID_PASSWORD' });
  assert.equal(countPhone(p), 0);
});

test('Spec 09-10 mục 4.1 bước 7: Content-Type text/plain vẫn đọc body là JSON (Postman chọn "Text")', async () => {
  const p = t.phone(newCustomerPhone());
  const r = await call('POST', '/accounts', {
    body: JSON.stringify({ phone: p, password: SEED_PASSWORD }),
    headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(r.status, 201, r.text);
  t.id(r.body.account_id);
});

// ---------- Mục 10 ----------
test('AC-DN-07 (mục 10): KH1 đăng nhập → 200, account_id 1, expires_in 3600; payload có sub/role/jti/exp, không có số điện thoại', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: SEED.KH1, password: SEED_PASSWORD } });
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
});

test('AC-DN-08 (mục 10, 401): sai mật khẩu và số chưa đăng ký → cùng 401 INVALID_CREDENTIALS, body giống hệt', async () => {
  const a = await call('POST', '/auth/login', { body: { phone: SEED.KH1, password: 'sai-mat-khau' } });
  const b = await call('POST', '/auth/login', { body: { phone: '0988888888', password: SEED_PASSWORD } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, { error: 'INVALID_CREDENTIALS' });
  assert.equal(a.text, b.text);
});

test('AC-DN-09 (mục 10, 400): thiếu password → 400 INVALID_INPUT; thiếu phone → 400 INVALID_INPUT', async () => {
  const a = await call('POST', '/auth/login', { body: { phone: SEED.KH1 } });
  assert.equal(a.status, 400);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  const b = await call('POST', '/auth/login', { body: { phone: SEED.KH1, email: 'a@b.vn', password: SEED_PASSWORD } });
  assert.equal(b.status, 400);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
  const c = await call('POST', '/auth/login', { body: { password: SEED_PASSWORD } });
  assert.equal(c.status, 400);
  assert.deepEqual(c.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-10 (mục 10, 403): KH9 LOCKED đúng mật khẩu → 403 ACCOUNT_LOCKED', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: SEED.KH9, password: SEED_PASSWORD } });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'ACCOUNT_LOCKED' });
});

test('AC-DN-10 (mục 10): KH9 LOCKED sai mật khẩu → 401 INVALID_CREDENTIALS (không lộ trạng thái khóa)', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: SEED.KH9, password: 'sai-mat-khau' } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-11 (mục 10): AD1 → 200 role admin; TX1 → 200 role driver (một API cho ba role)', async () => {
  const ad = await call('POST', '/auth/login', { body: { phone: SEED.AD1, password: SEED_PASSWORD } });
  assert.equal(ad.status, 200);
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

test('AC-DN-22 (mục 10, 400): đăng nhập bằng email, hoặc phone kèm email → 400 INVALID_INPUT cả hai', async () => {
  const a = await call('POST', '/auth/login', { body: { email: 'kh1@cab.vn', password: SEED_PASSWORD } });
  assert.equal(a.status, 400, a.text);
  assert.deepEqual(a.body, { error: 'INVALID_INPUT' });
  assert.equal(a.body.token, undefined);
  const b = await call('POST', '/auth/login', { body: { phone: SEED.KH1, email: 'kh1@cab.vn', password: SEED_PASSWORD } });
  assert.equal(b.status, 400, b.text);
  assert.deepEqual(b.body, { error: 'INVALID_INPUT' });
});

test('AC-DN-23 (migration): schema_migrations có 003_bo-email-accounts.sql; accounts không còn cột email', () => {
  const mig = psql('auth-db', 'auth', 'table schema_migrations');
  assert.match(mig, /003_bo-email-accounts\.sql/);
  const cols = psql('auth-db', 'auth', "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'accounts' order by ordinal_position").split(/\r?\n/);
  assert.ok(!cols.includes('email'), `accounts còn cột email: ${cols.join(',')}`);
  assert.ok(cols.includes('phone') && cols.includes('password_hash'));
  // version là khóa chính: khởi động lại không chạy lại migration (nếu chạy lại sẽ lỗi trùng khóa → service không lên).
  assert.equal(psql('auth-db', 'auth', "select count(*) from schema_migrations where version like '003%'"), '1');
});

// ---------- Mục 25 ----------
test('AC-DN-12 (mục 25): password "\' OR \'1\'=\'1" → 401 INVALID_CREDENTIALS', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: SEED.KH1, password: "' OR '1'='1" } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'INVALID_CREDENTIALS' });
});

test('AC-DN-13 (mục 25): phone "\' OR 1=1 --" → 400 INVALID_PHONE; sau đó KH1 vẫn đăng nhập được', async () => {
  const r = await call('POST', '/auth/login', { body: { phone: "' OR 1=1 --", password: 'x' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_PHONE' });
  // ADR-019: A05 không còn field email → field lạ là INVALID_INPUT (không còn INVALID_EMAIL).
  const e = await call('POST', '/auth/login', { body: { email: "' OR 1=1 --", password: 'x' } });
  assert.equal(e.status, 400);
  assert.deepEqual(e.body, { error: 'INVALID_INPUT' });
  const ok = await call('POST', '/auth/login', { body: { phone: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.ok(Number(psql('auth-db', 'auth', 'select count(*) from accounts')) >= 13, 'bảng accounts mất dữ liệu');
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
test('AC-DN-19 (mục 24): table accounts — password_hash bắt đầu scrypt$, không thấy 12345678; phone hiện rõ', () => {
  const out = psqlTable('auth-db', 'auth', 'accounts');
  assert.ok(!out.includes(SEED_PASSWORD), 'thấy mật khẩu rõ trong database');
  assert.match(out, /0900000001/);
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

test('AC-DN-20: POST /auth/login (thiếu /api/v1) → 404 ROUTE_NOT_FOUND; /api/v1/auth/register cũ → 404', async () => {
  const a = await call('POST', `${GATEWAY_URL}/auth/login`, { body: { phone: SEED.KH1, password: SEED_PASSWORD } });
  assert.equal(a.status, 404);
  assert.deepEqual(a.body, { error: 'ROUTE_NOT_FOUND' });
  const b = await call('POST', '/auth/register', { body: { phone: newCustomerPhone(), password: SEED_PASSWORD } });
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
