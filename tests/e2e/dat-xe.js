// Hàm dùng chung cho test đặt xe và thanh toán (spec 14-15-16-19-30): tuyến mẫu, đợi lời mời, dọn lời mời
// còn chờ, gọi thẳng gRPC nội bộ trong mạng Compose, chụp / so message Kafka.
// Quy ước dữ liệu test: booking, payment, offer, trip do API tạo có mã ≥ 1000 (seed 1…7). Cuối đợt test
// trả về seed bằng DROP SCHEMA ở booking-db, payment-db, trip-db rồi restart ba service (xem báo cáo).
import { spawnSync } from 'node:child_process';
import { call, kafkaMessages, psql, tokenOf } from './api.js';
import { REPO_ROOT, sleep, waitFor } from './helpers.js';

export const P0 = [10.82, 106.68];
export const D0 = [10.83, 106.69];
// Xa mọi tài xế seed (> 1 km tới TX8 ở 10.84): bộ ghép không có ai → NO_DRIVER_FOUND ngay.
export const FAR_FROM = [10.9, 106.68];
export const FAR_TO = [10.91, 106.69];

// Tài xế seed 11…18 ↔ số điện thoại 0910000001…0910000008.
export const driverPhone = (id) => `09100000${String(id - 10).padStart(2, '0')}`;

export const bookingsDb = (sql) => psql('booking-db', 'booking', sql);
export const paymentsDb = (sql) => psql('payment-db', 'payment', sql);
export const tripsDb = (sql) => psql('trip-db', 'trip', sql);
export const driversDb = (sql) => psql('driver-db', 'driver', sql);

// Đặt xe bằng token khách; trả response.
export function book(token, body = {}) {
  return call('POST', '/bookings', { token, body: { from: P0, to: D0, ...body } });
}

// Đặt xe, bắt buộc 201; trả body.
export async function book201(token, body = {}) {
  const r = await book(token, body);
  if (r.status !== 201) throw new Error(`đặt xe → ${r.status} ${r.text}`);
  return r.body;
}

// Đợi tài xế (token) thấy Offer PENDING cho booking; trả Offer hoặc undefined. "≈ 1 s" = tối đa 2 giây.
export async function waitOffer(driverToken, bookingId, timeoutMs = 2000) {
  const r = await waitFor(
    () => call('GET', '/offers', { token: driverToken }),
    (x) => x?.status === 200 && x.body.data.some((o) => o.booking_id === bookingId),
    { timeoutMs, intervalMs: 200 },
  );
  return r?.body?.data?.find((o) => o.booking_id === bookingId);
}

// Đợi booking đạt trạng thái (đọc database booking); trả trạng thái cuối cùng đọc được.
export async function waitBookingStatus(bookingId, status, timeoutMs = 2000) {
  return waitFor(
    async () => bookingsDb(`select status from bookings where booking_id = ${Number(bookingId)}`),
    (s) => s === status,
    { timeoutMs, intervalMs: 200 },
  );
}

// Dọn một booking test: tài xế đang được mời TỪ CHỐI qua API (đường nghiệp vụ thật) cho đến khi booking
// không còn Offer chờ và không còn SEARCHING. Từ chối không hoàn tiền, không hủy booking (BRULE15).
export async function drainBooking(bookingId) {
  const id = Number(bookingId);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const pending = bookingsDb(`select offer_id || ',' || driver_id from driver_offers where booking_id = ${id} and status = 'PENDING'`);
    if (pending) {
      const [offerId, driverId] = pending.split(',').map(Number);
      if (driverId >= 11 && driverId <= 18) {
        await call('PATCH', `/offers/${offerId}`, { token: await tokenOf(driverPhone(driverId)), body: { status: 'REJECTED' } });
      } else {
        // Tài xế không phải seed (không có mật khẩu chung): hết hạn Offer để tiến trình nền tự xử lý.
        bookingsDb(`update driver_offers set expires_at = now() where offer_id = ${offerId}`);
      }
      await sleep(300);
      continue;
    }
    const status = bookingsDb(`select status from bookings where booking_id = ${id}`);
    if (status !== 'SEARCHING') return status;
    await sleep(300); // bộ ghép đang chạy (setImmediate) — đợi Offer kế tiếp hoặc NO_DRIVER_FOUND
  }
  return bookingsDb(`select status from bookings where booking_id = ${id}`);
}

// Dọn mọi booking test (mã ≥ 1000) còn Offer chờ hoặc còn SEARCHING; trả tài xế seed đang bị giữ cho booking
// test về ONLINE (thay cho bước "chuyến hoàn thành" của spec 17 chưa có).
export async function drainAllTestBookings() {
  const ids = bookingsDb(
    "select distinct b.booking_id from bookings b left join driver_offers o on o.booking_id = b.booking_id and o.status = 'PENDING' "
    + "where b.booking_id >= 1000 and (b.status = 'SEARCHING' or o.offer_id is not null) order by 1",
  ).split(/\r?\n/).filter(Boolean);
  for (const id of ids) await drainBooking(id);
  releaseSeedDrivers();
}

export function releaseSeedDrivers() {
  driversDb("update drivers set availability = 'ONLINE', current_booking_id = null, updated_at = now() "
    + 'where driver_id in (11, 12, 13, 14, 18) and current_booking_id >= 1000');
}

// Gọi thẳng một rpc trong mạng Compose: chạy Node trong container booking-service (có sẵn @grpc/grpc-js,
// @grpc/proto-loader và thư mục /app/proto). Script đưa qua stdin để khỏi lo dấu ngoặc trên dòng lệnh Windows.
// metadata: object { 'x-role': 'system' }; không truyền key nào = không có metadata.
export function grpcInternal({ target, proto, pkg, service, method, request, metadata = {} }) {
  const args = JSON.stringify({ target, proto, pkg, service, method, request, metadata });
  const script = `
import grpc from '@grpc/grpc-js';
import loader from '@grpc/proto-loader';
const a = ${args};
const def = loader.loadSync('/app/proto/' + a.proto, { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
let ns = grpc.loadPackageDefinition(def);
for (const p of a.pkg.split('.')) ns = ns[p];
const client = new ns[a.service](a.target, grpc.credentials.createInsecure());
const md = new grpc.Metadata();
for (const [k, v] of Object.entries(a.metadata)) md.set(k, v);
client[a.method](a.request, md, { deadline: Date.now() + 5000 }, (err, res) => {
  const out = err
    ? { error: { code: err.code, status: Object.keys(grpc.status).find((n) => grpc.status[n] === err.code), details: err.details } }
    : { response: res };
  client.close();
  // Thoát ngay khi đã ghi xong: kênh gRPC đã đóng vẫn giữ tiến trình sống thêm vài giây.
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
});
`;
  const r = spawnSync('docker', ['exec', '-i', 'booking-service', 'node', '--input-type=module', '-'], {
    cwd: REPO_ROOT, input: script, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`grpcInternal ${method}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Chụp các message đang có của topic (partition:offset) để sau đó lấy riêng message MỚI.
// Kafka giữ message của những lần chạy trước (mã booking bắt đầu lại từ 1000 sau khi đặt lại database),
// nên không lọc theo key mà so với ảnh chụp.
export async function kafkaSnapshot(topic) {
  const msgs = await kafkaMessages(topic);
  return new Set(msgs.map((m) => `${m.partition}:${m.offset}`));
}

export async function kafkaNew(topic, snapshot) {
  const msgs = await kafkaMessages(topic);
  return msgs.filter((m) => !snapshot.has(`${m.partition}:${m.offset}`));
}

// Đợi tới khi có message mới thỏa điều kiện (tối đa timeoutMs); trả mảng message mới thỏa điều kiện.
export async function waitKafkaNew(topic, snapshot, match = () => true, timeoutMs = 5000) {
  const r = await waitFor(
    async () => (await kafkaNew(topic, snapshot)).filter(match),
    (list) => Array.isArray(list) && list.length > 0,
    { timeoutMs, intervalMs: 500 },
  );
  return Array.isArray(r) ? r : [];
}

// "Dữ liệu vừa đặt lại": chưa có booking / payment nào do API tạo → mã cấp đầu tiên đúng là 1000.
export function isFreshData() {
  return bookingsDb('select count(*) from bookings where booking_id >= 1000') === '0'
    && paymentsDb('select count(*) from payments where payment_id >= 1000') === '0';
}

// So hai thời điểm ISO: |a − (now + giây)| ≤ sai số (giây).
export function approxFromNow(iso, seconds, toleranceSec = 20) {
  const diff = (Date.parse(iso) - Date.now()) / 1000 - seconds;
  return Math.abs(diff) <= toleranceSec;
}
