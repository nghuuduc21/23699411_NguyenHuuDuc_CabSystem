// Hàm dùng chung cho test end-to-end. Test chạy trên MÁY (không trong container), với hệ thống
// đã dựng bằng `docker compose up -d --build` ở thư mục gốc repo.
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
export const KAFKA_UI_URL = process.env.KAFKA_UI_URL || 'http://localhost:8080';

export const BACKEND_SERVICES = [
  'auth-service',
  'customer-service',
  'driver-service',
  'booking-service',
  'trip-service',
  'payment-service',
  'notification-service',
  'rating-service',
];

export const DATABASES = [
  'auth-db',
  'customer-db',
  'driver-db',
  'booking-db',
  'trip-db',
  'payment-db',
  'rating-db',
  'notification-db',
];

// 21 container của spec 00 mục 3.2.
export const ALL_CONTAINERS = [
  'gateway',
  ...BACKEND_SERVICES,
  ...DATABASES,
  'redis',
  'kafka',
  'kafka-init',
  'kafka-ui',
];

export const TOPICS = [
  'booking.created',
  'booking.offer-created',
  'booking.no-driver-found',
  'booking.canceled',
  'trip.status-changed',
  'payment.status-changed',
  'driver.application-reviewed',
];

// Chạy một lệnh ở thư mục gốc repo; trả { status, stdout, stderr }.
export function run(cmd, args, { timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout, windowsHide: true });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function compose(...args) {
  return run('docker', ['compose', ...args]);
}

// `docker compose ps -a --format json` in mỗi container một dòng JSON (Compose v2.21+);
// bản cũ in một mảng. Xử lý cả hai.
export function composePs() {
  const r = compose('ps', '-a', '--format', 'json');
  if (r.status !== 0) throw new Error(`docker compose ps lỗi: ${r.stderr}`);
  const text = r.stdout.trim();
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Gọi HTTP, trả { status, headers, body (đã parse JSON nếu được), text }.
export async function getJson(url, { timeoutMs = 5000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, body, text };
}

// Gửi request thô (cho phép GET có body, Content-Type tùy ý) — fetch không cho GET kèm body.
// Gửi Content-Length như Postman (không dùng Transfer-Encoding: chunked) và không dùng lại kết nối
// keep-alive giữa các test: GET kèm body dạng chunked làm Node của Gateway đóng kết nối sau response
// (hành vi của bộ phân tích HTTP, không phải của ứng dụng; xem báo cáo).
export function rawRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const allHeaders = { ...headers };
    if (body !== undefined) allHeaders['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(url, { method, headers: allHeaders, timeout: 5000, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Thử mở kết nối TCP; trả 'CONNECTED' hoặc mã lỗi (ECONNREFUSED, TIMEOUT…).
export function tcpProbe(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('CONNECTED'));
    socket.once('timeout', () => done('TIMEOUT'));
    socket.once('error', (err) => done(err.code || err.message));
  });
}

// Chờ đến khi điều kiện đúng hoặc hết giờ; trả giá trị cuối cùng của `probe`.
export async function waitFor(probe, isDone, { timeoutMs = 90_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await probe();
    } catch (err) {
      last = { error: err.message };
    }
    if (isDone(last)) return last;
    if (Date.now() > deadline) return last;
    await sleep(intervalMs);
  }
}

export function containerHealth(name) {
  const r = run('docker', ['inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', name]);
  return r.stdout.trim();
}

// Chờ container quay lại `running healthy` (dùng khi trả hệ thống về trạng thái ban đầu).
export function waitHealthy(name, timeoutMs = 120_000) {
  return waitFor(
    async () => containerHealth(name),
    (s) => s === 'running healthy',
    { timeoutMs, intervalMs: 2000 },
  );
}
