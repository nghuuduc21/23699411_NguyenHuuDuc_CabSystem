// Spec 11 — hồ sơ khách hàng. Mục chấm 11, bổ trợ 24 (mã hóa), 25 (mã trong đường dẫn), 26 (XSS), 28 (role).
// Không đổi dữ liệu seed: việc tạo / sửa hồ sơ (AC-HS-04, 05, 10, 11) làm trên tài khoản khách TẠO MỚI
// (cùng nhánh code với KH3 / KH1); KH1, KH2, KH3 chỉ được đọc hoặc nhận request bị từ chối.
// AC-HS-12 (dừng customer-service) nằm ở 90-dung-service.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, call, createTracker, newCustomer, psql, psqlTable, tokenOf, ROOT } from './api.js';
import { GATEWAY_URL, run } from './helpers.js';

const t = createTracker();
const KH1_PROFILE = { customer_id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01' };

after(async () => {
  t.cleanup();
  // Phòng khi một test XSS lọt: trả hồ sơ KH1 về như seed.
  const tok = await tokenOf(SEED.KH1);
  const r = await call('GET', '/customers/me', { token: tok });
  if (r.status === 200 && (r.body.name !== KH1_PROFILE.name || r.body.dob !== KH1_PROFILE.dob)) {
    await call('PATCH', '/customers/me', { token: tok, body: { name: KH1_PROFILE.name, dob: KH1_PROFILE.dob } });
  }
});

test('AC-HS-01 (mục 11): KH1 GET /customers/1 → 200 hồ sơ seed', async () => {
  const r = await call('GET', '/customers/1', { token: await tokenOf(SEED.KH1) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, KH1_PROFILE);
});

test('AC-HS-02 (mục 11, 403): KH1 GET /customers/2 → 403 NOT_OWNER', async () => {
  const r = await call('GET', '/customers/2', { token: await tokenOf(SEED.KH1) });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'NOT_OWNER' });
});

test('AC-HS-02 / HS1: KH1 xem mã chưa có hồ sơ (3) và mã không tồn tại → vẫn 403 NOT_OWNER (không lộ mã nào có hồ sơ)', async () => {
  const tok = await tokenOf(SEED.KH1);
  for (const id of [3, 999999]) {
    const r = await call('GET', `/customers/${id}`, { token: tok });
    assert.equal(r.status, 403, `mã ${id}`);
    assert.deepEqual(r.body, { error: 'NOT_OWNER' });
  }
});

test('AC-HS-03 (mục 11, 404): KH3 (chưa có hồ sơ) — GET /customers/3, GET /me, PATCH /me → 404 CUSTOMER_NOT_FOUND', async (tt) => {
  if (psql('customer-db', 'customer', 'select count(*) from customer_profiles where customer_id = 3') !== '0') {
    tt.diagnostic('KH3 đã có hồ sơ (seed bị đổi bởi lần chạy khác) — test này cần KH3 chưa có hồ sơ');
  }
  const tok = await tokenOf(SEED.KH3);
  const a = await call('GET', '/customers/3', { token: tok });
  const b = await call('GET', '/customers/me', { token: tok });
  const c = await call('PATCH', '/customers/me', { token: tok, body: { name: 'X' } });
  for (const r of [a, b, c]) {
    assert.equal(r.status, 404, r.text);
    assert.deepEqual(r.body, { error: 'CUSTOMER_NOT_FOUND' });
  }
});

// Tài khoản mới đóng vai KH3 cho chuỗi tạo hồ sơ.
let fresh;
test('AC-HS-03 (mục 11, 404): tài khoản vừa đăng ký chưa có hồ sơ → GET /customers/{mã mình} 404', async () => {
  fresh = await newCustomer(t);
  const r = await call('GET', `/customers/${fresh.account_id}`, { token: fresh.token });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'CUSTOMER_NOT_FOUND' });
});

test('AC-HS-10 (mục 11, 400): thiếu name; dob "15/01/2000"; thêm customer_id; name rỗng; name > 100 ký tự; dob tương lai; dob 2001-02-30 → 400 INVALID_INPUT', async () => {
  const bodies = [
    {},
    { name: 'Pham Duc', dob: '15/01/2000' },
    { name: 'Pham Duc', customer_id: 5 },
    { name: '   ' },
    { name: 'a'.repeat(101) },
    { name: 'Pham Duc', dob: '2999-01-01' },
    { name: 'Pham Duc', dob: '2001-02-30' },
    { name: 'Pham Duc', dob: '1899-12-31' },
    { name: 123 },
  ];
  for (const body of bodies) {
    const r = await call('POST', '/customers', { token: fresh.token, body });
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${r.status} ${r.text}`);
    assert.deepEqual(r.body, { error: 'INVALID_INPUT' }, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(psql('customer-db', 'customer', `select count(*) from customer_profiles where customer_id = ${fresh.account_id}`), '0');
});

test('AC-HS-10: body không phải JSON → 400 INVALID_JSON', async () => {
  const r = await call('POST', '/customers', { token: fresh.token, body: '{"name":' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'INVALID_JSON' });
});

test('AC-HS-04 (mục 11): POST /customers {"name":"Pham Duc"} → 201 customer_id = mã tài khoản, dob null; GET theo mã → 200 cùng nội dung', async () => {
  const r = await call('POST', '/customers', { token: fresh.token, body: { name: 'Pham Duc' } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body, { customer_id: fresh.account_id, name: 'Pham Duc', dob: null });
  const g = await call('GET', `/customers/${fresh.account_id}`, { token: fresh.token });
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, r.body);
  const me = await call('GET', '/customers/me', { token: fresh.token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, r.body);
});

test('AC-HS-05 (mục 11, 409): tạo hồ sơ lần hai → 409 CUSTOMER_ALREADY_EXISTS', async () => {
  const r = await call('POST', '/customers', { token: fresh.token, body: { name: 'Lan Hai' } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'CUSTOMER_ALREADY_EXISTS' });
  const g = await call('GET', '/customers/me', { token: fresh.token });
  assert.equal(g.body.name, 'Pham Duc');
});

test('AC-HS-11 (mục 11): PATCH /me {"dob":"1999-12-31"} → 200, họ tên giữ nguyên, ngày sinh mới', async () => {
  const r = await call('PATCH', '/customers/me', { token: fresh.token, body: { dob: '1999-12-31' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { customer_id: fresh.account_id, name: 'Pham Duc', dob: '1999-12-31' });
  const n = await call('PATCH', '/customers/me', { token: fresh.token, body: { name: 'Nguyễn Thị Hoa' } });
  assert.equal(n.status, 200);
  assert.deepEqual(n.body, { customer_id: fresh.account_id, name: 'Nguyễn Thị Hoa', dob: '1999-12-31' });
});

test('HS2 (spec 11 mục 4.5): PATCH {"dob":null} xóa ngày sinh; {} / name null / field lạ → 400 INVALID_INPUT', async () => {
  const r = await call('PATCH', '/customers/me', { token: fresh.token, body: { dob: null } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.dob, null);
  for (const body of [{}, { name: null }, { name: 'A', role: 'admin' }, { dob: '2000-13-01' }]) {
    const x = await call('PATCH', '/customers/me', { token: fresh.token, body });
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.deepEqual(x.body, { error: 'INVALID_INPUT' }, JSON.stringify(body));
  }
});

test('Spec 11 mục 8.1: họ tên 100 ký tự tiếng Việt có dấu → 200 (đếm ký tự, không đếm byte)', async () => {
  const name = 'Đ'.repeat(100);
  const r = await call('PATCH', '/customers/me', { token: fresh.token, body: { name } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.name, name);
});

test('AC-HS-06 (mục 11): AD1 GET /customers/1 → 200; /customers/999999 → 404 CUSTOMER_NOT_FOUND', async () => {
  const tok = await tokenOf(SEED.AD1);
  const a = await call('GET', '/customers/1', { token: tok });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, KH1_PROFILE);
  const b = await call('GET', '/customers/999999', { token: tok });
  assert.equal(b.status, 404);
  assert.deepEqual(b.body, { error: 'CUSTOMER_NOT_FOUND' });
});

test('AC-HS-07 (mục 11, 28): TX1 GET /customers/1 → 403; AD1 POST /customers → 403; TX1 /me, AD1 PATCH /me → 403 FORBIDDEN', async () => {
  const tx = await tokenOf(SEED.TX1);
  const ad = await call('POST', '/customers', { token: await tokenOf(SEED.AD1), body: { name: 'Admin' } });
  const list = [
    await call('GET', '/customers/1', { token: tx }),
    ad,
    await call('GET', '/customers/me', { token: tx }),
    await call('GET', '/customers/me', { token: await tokenOf(SEED.AD1) }),
    await call('PATCH', '/customers/me', { token: await tokenOf(SEED.AD1), body: { name: 'x' } }),
    await call('POST', '/customers', { token: tx }), // không body: role kiểm trước body
  ];
  for (const r of list) {
    assert.equal(r.status, 403, r.text);
    assert.deepEqual(r.body, { error: 'FORBIDDEN' });
  }
  assert.equal(psql('customer-db', 'customer', 'select count(*) from customer_profiles where customer_id in (11, 99)'), '0');
});

test('AC-HS-08 (mục 11, 401): GET /customers/1 không token → 401 TOKEN_MISSING', async () => {
  const r = await call('GET', '/customers/1');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'TOKEN_MISSING' });
});

test('AC-HS-09 (mục 11, 400): GET /customers/abc, /0, /-1, /1.5 → 400 INVALID_ID', async () => {
  const tok = await tokenOf(SEED.KH1);
  for (const id of ['abc', '0', '-1', '1.5', '12345678901234567']) {
    const r = await call('GET', `/customers/${id}`, { token: tok });
    assert.equal(r.status, 400, `${id} → ${r.status}`);
    assert.deepEqual(r.body, { error: 'INVALID_ID' });
  }
});

test('AC-HS-17 (mục 25): GET /customers/1 OR 1=1 và /1%27%20OR%20%271%27=%271 → 400 INVALID_ID, không 200, không 5xx', async () => {
  const tok = await tokenOf(SEED.KH1);
  for (const p of ['/customers/1%20OR%201=1', "/customers/1'%20OR%20'1'='1", '/customers/1;DROP%20TABLE%20customer_profiles']) {
    const r = await call('GET', p, { token: tok });
    assert.equal(r.status, 400, `${p} → ${r.status}`);
    assert.deepEqual(r.body, { error: 'INVALID_ID' });
  }
  const ok = await call('GET', '/customers/1', { token: tok });
  assert.equal(ok.status, 200);
});

test('AC-HS-16 (mục 26): PATCH /me name "<script>alert(1)</script>" → 400 TEXT_CONTAINS_HTML; GET /me (body giữ nguyên) → 200 tên không đổi, có nosniff và CSP', async () => {
  const tok = await tokenOf(SEED.KH1);
  const body = { name: '<script>alert(1)</script>' };
  const r = await call('PATCH', '/customers/me', { token: tok, body });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'TEXT_CONTAINS_HTML' });
  // Sửa tab sang GET, không xóa body: Gateway bỏ qua body của GET.
  const { rawRequest } = await import('./helpers.js');
  const g = await rawRequest(`${GATEWAY_URL}/api/v1/customers/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(g.status, 200, g.text);
  assert.deepEqual(g.body, KH1_PROFILE);
  assert.equal(g.headers['x-content-type-options'], 'nosniff');
  assert.equal(g.headers['content-security-policy'], "default-src 'none'");
  assert.match(g.headers['content-type'], /^application\/json/);
});

test('AC-HS-16 (mục 26): tạo hồ sơ với "<b>" hoặc ">" → 400 TEXT_CONTAINS_HTML, không lưu; ký tự & \' " được phép', async () => {
  const c = await newCustomer(t);
  for (const name of ['<b>An</b>', 'An > Binh', 'An <']) {
    const r = await call('POST', '/customers', { token: c.token, body: { name } });
    assert.equal(r.status, 400, name);
    assert.deepEqual(r.body, { error: 'TEXT_CONTAINS_HTML' });
  }
  assert.equal(psql('customer-db', 'customer', `select count(*) from customer_profiles where customer_id = ${c.account_id}`), '0');
  const ok = await call('POST', '/customers', { token: c.token, body: { name: `O'Neil & "Tom"` } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.name, `O'Neil & "Tom"`);
});

test('AC-HS-13 + AC-HS-14 (mục 24): API trả họ tên rõ cho chủ; table customer_profiles chỉ có \\x…, không thấy họ tên, ngày sinh; không có cột số điện thoại', async () => {
  const r = await call('GET', '/customers/1', { token: await tokenOf(SEED.KH1) });
  assert.equal(r.body.name, 'Nguyễn Văn An');
  const out = psqlTable('customer-db', 'customer', 'customer_profiles');
  assert.match(out, /full_name_enc/);
  assert.match(out, /date_of_birth_enc/);
  assert.match(out, /\\x[0-9a-f]{40,}/);
  for (const plain of ['Nguy', 'Văn An', 'Van An', 'Trần', 'Bình', '2000-01-01', '2000-02-02']) {
    assert.ok(!out.includes(plain), `thấy "${plain}" rõ trong database`);
  }
  const cols = psql('customer-db', 'customer', "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'customer_profiles'");
  assert.equal(cols, 'customer_id,full_name_enc,date_of_birth_enc,created_at,updated_at');
  // AES-GCM, IV ngẫu nhiên mỗi giá trị: hai hồ sơ không có bản mã trùng nhau.
  const enc = psql('customer-db', 'customer', 'select encode(full_name_enc, \'hex\') from customer_profiles').split(/\r?\n/);
  assert.equal(new Set(enc).size, enc.length);
  // Độ dài bản mã = 12 (IV) + độ dài UTF-8 + 16 (tag).
  const len = Number(psql('customer-db', 'customer', 'select length(full_name_enc) from customer_profiles where customer_id = 1'));
  assert.equal(len, 12 + Buffer.byteLength('Nguyễn Văn An') + 16);
});

test('AC-HS-15 (mục 24): .env không nằm trên Git', () => {
  const r = run('git', ['ls-files', '.env']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.ok(ROOT);
});

test('AC-HS-18: PUT /customers/me, POST /customers/me, GET /customers/1 (thiếu /api/v1) → 404 ROUTE_NOT_FOUND', async () => {
  const tok = await tokenOf(SEED.KH1);
  const list = [
    await call('PUT', '/customers/me', { token: tok, body: { name: 'x' } }),
    await call('POST', '/customers/me', { token: tok, body: { name: 'x' } }),
    await call('GET', `${GATEWAY_URL}/customers/1`, { token: tok }),
  ];
  for (const r of list) {
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'ROUTE_NOT_FOUND' });
  }
});
