// Hàm dùng chung cho test nghiệp vụ (spec 09-10, 11, 12-13-21-23): gọi REST vào Gateway,
// đăng nhập tài khoản seed, đọc database bằng psql trong container, đọc Kafka qua Kafka UI, dọn dữ liệu test.
// Quy ước dữ liệu test (không trùng seed 0900…, 0910…, 0999…):
//   khách tạo mới  : 0399 + 6 số ngẫu nhiên
//   tài xế tạo mới : 0599 + 6 số ngẫu nhiên
//   biển số        : 99T- + 5 số ngẫu nhiên
// Mọi mã do API tạo lấy từ response, không viết cứng.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GATEWAY_URL, KAFKA_UI_URL, REPO_ROOT, run, waitFor } from './helpers.js';

export const API = `${GATEWAY_URL}/api/v1`;
export const SEED_PASSWORD = '12345678';

export const SEED = {
  KH1: '0900000001',
  KH2: '0900000002',
  KH3: '0900000003',
  KH9: '0900000009',
  TX1: '0910000001',
  TX2: '0910000002',
  TX5: '0910000005',
  TX6: '0910000006',
  TX7: '0910000007',
  AD1: '0999999999',
};

const rand = (n) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
export const newCustomerPhone = () => `0399${rand(6)}`;
export const newDriverPhone = () => `0599${rand(6)}`;
export const newPlate = () => `99T-${rand(5)}`;

// Gọi Gateway. body: object (gửi JSON) hoặc chuỗi (gửi nguyên văn). Không throw khi status lỗi.
// Gateway có thể đang được dev-agent dựng lại: lỗi kết nối hoặc 503 do khởi động lại thì thử lại
// tối đa ~60 giây (chỉ với lỗi mạng; 503 thật được trả cho test kiểm).
export async function call(method, url, { token, body, headers = {}, rawAuth } = {}) {
  const h = { ...headers };
  if (rawAuth !== undefined) h.Authorization = rawAuth;
  else if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
  }
  const full = url.startsWith('http') ? url : `${API}${url}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(full, { method, headers: h, body: payload, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: res.status, headers: res.headers, body: json, text };
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Đăng nhập; trả body response (token, account_id, role, expires_in). Thử lại khi gặp 503
// (service đang khởi động lại do dev-agent dựng lại container).
export async function login(phone, password = SEED_PASSWORD) {
  const r = await waitFor(
    () => call('POST', '/auth/login', { body: { phone, password } }),
    (x) => x && x.status !== 503 && !x.error,
    { timeoutMs: 90_000, intervalMs: 2000 },
  );
  if (r.status !== 200) throw new Error(`login ${phone} → ${r.status} ${r.text}`);
  return r.body;
}

const tokenCache = new Map();
export async function tokenOf(phone) {
  if (!tokenCache.has(phone)) tokenCache.set(phone, (await login(phone)).token);
  return tokenCache.get(phone);
}

// Giải phần payload của JWT (base64url) — chỉ để test đọc claim.
export function decodeJwt(token) {
  const [h, p] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  };
}

// Ký một JWT HS256 bằng khóa cho trước (test token giả: thiếu exp, hết hạn, khóa lạ).
export function signJwt(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = header.alg === 'none' ? '' : crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Đọc JWT_SECRET từ `.env` của máy demo (chỉ đọc, không in ra). Không có thì trả null.
export function jwtSecretFromEnv() {
  try {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
    const m = /^JWT_SECRET=(.*)$/m.exec(text);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Sửa MỘT ký tự ở giữa token (trong phần payload), không phải ký tự cuối (bit thừa base64url).
export function tamperMiddle(token) {
  const i = Math.floor(token.length / 2);
  const c = token[i] === 'A' ? 'B' : 'A';
  return token.slice(0, i) + c + token.slice(i + 1);
}

// Chạy SQL trong container database (user cab), trả stdout dạng không căn lề (-tA).
export function psql(container, db, sql) {
  const r = run('docker', ['exec', container, 'psql', '-U', 'cab', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
  if (r.status !== 0) throw new Error(`psql ${container}: ${r.stderr}`);
  return r.stdout.trim();
}
// Bản in đầy đủ như sinh viên gõ khi thi (`table …`), để tìm chuỗi rõ.
export function psqlTable(container, db, table) {
  const r = run('docker', ['exec', container, 'psql', '-U', 'cab', '-d', db, '-c', `table ${table}`]);
  if (r.status !== 0) throw new Error(`psql ${container}: ${r.stderr}`);
  return r.stdout;
}

// Đọc mọi message của một topic qua API của Kafka UI (chính API giao diện web dùng).
export async function kafkaMessages(topic) {
  const url = `${KAFKA_UI_URL}/api/clusters/cab/topics/${topic}/messages?seekType=BEGINNING&limit=5000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const ev = JSON.parse(line.slice(5));
    if (ev.type === 'MESSAGE') {
      let content;
      try {
        content = JSON.parse(ev.message.content);
      } catch {
        content = ev.message.content;
      }
      out.push({ key: ev.message.key, content, raw: ev.message.content });
    }
  }
  return out;
}

// Ghi nhận dữ liệu test tạo ra để dọn ở hook `after`.
export function createTracker() {
  const phones = new Set();
  const ids = new Set();
  return {
    phone(p) {
      phones.add(p);
      return p;
    },
    id(n) {
      ids.add(Number(n));
      return n;
    },
    cleanup() {
      // Lấy thêm account_id theo số điện thoại (phòng khi test dừng trước khi đọc được response).
      const ph = [...phones].filter((p) => /^0[0-9]{9}$/.test(p));
      if (ph.length) {
        const list = ph.map((p) => `'${p}'`).join(',');
        const found = psql('auth-db', 'auth', `select account_id from accounts where phone in (${list})`);
        for (const line of found.split(/\r?\n/).filter(Boolean)) ids.add(Number(line));
      }
      const idList = [...ids].filter((n) => Number.isInteger(n) && n >= 1000);
      if (idList.length) {
        const s = idList.join(',');
        psql('driver-db', 'driver', `delete from vehicles where driver_id in (${s}); delete from drivers where driver_id in (${s})`);
        psql('customer-db', 'customer', `delete from customer_profiles where customer_id in (${s})`);
        psql('auth-db', 'auth', `delete from accounts where account_id in (${s})`);
      }
      if (ph.length) {
        const list = ph.map((p) => `'${p}'`).join(',');
        psql('auth-db', 'auth', `delete from otp_verifications where phone in (${list})`);
      }
    },
  };
}

// Đăng ký khách mới qua API, trả { phone, account_id, token }.
export async function newCustomer(tracker) {
  const phone = tracker.phone(newCustomerPhone());
  const r = await call('POST', '/accounts', { body: { phone, password: SEED_PASSWORD } });
  if (r.status !== 201) throw new Error(`đăng ký ${phone} → ${r.status} ${r.text}`);
  tracker.id(r.body.account_id);
  const l = await login(phone);
  return { phone, account_id: r.body.account_id, token: l.token };
}

// Tạo tài khoản tài xế mới qua OTP (A07 → A08), trả { phone, account_id, token }.
export async function newDriverAccount(tracker) {
  const phone = tracker.phone(newDriverPhone());
  const o = await call('POST', '/otps', { body: { phone } });
  if (o.status !== 201) throw new Error(`otp ${phone} → ${o.status} ${o.text}`);
  const a = await call('POST', '/driver-accounts', { body: { phone, otp: o.body.otp, password: SEED_PASSWORD } });
  if (a.status !== 201) throw new Error(`driver-accounts ${phone} → ${a.status} ${a.text}`);
  tracker.id(a.body.account_id);
  return { phone, account_id: a.body.account_id, token: a.body.token };
}

// Tài xế mới đã nộp hồ sơ (PENDING): trả thêm plate, driver_id.
export async function newDriverWithApplication(tracker, extra = {}) {
  const acc = await newDriverAccount(tracker);
  const plate = newPlate();
  const r = await call('POST', '/drivers', {
    token: acc.token,
    body: { name: 'Tai Xe Test', license: 'GPLX-99', plate, ...extra },
  });
  if (r.status !== 201) throw new Error(`nộp hồ sơ → ${r.status} ${r.text}`);
  return { ...acc, plate, driver_id: r.body.driver_id };
}

export const ROOT = REPO_ROOT;
