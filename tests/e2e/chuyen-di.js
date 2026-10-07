// Hàm dùng chung cho test chuyến đi, hủy, hoàn tiền, thông báo (spec 17-18) và đánh giá (spec 20-29):
// tạo chuyến mới (đặt xe → TX1 nhận), đưa chuyến tới một trạng thái, đọc thông báo, gửi lại message Kafka
// qua API "Produce" của Kafka UI (đúng thao tác AC-HT-04 làm bằng tay trên giao diện).
// Quy ước: tài xế nhận chuyến luôn là TX1 (11) — gần P0 nhất (111 m). Trước khi tạo chuyến, mọi booking test còn
// Offer chờ được dọn (drainAllTestBookings) để Offer mới chắc chắn tới TX1.
import { call } from './api.js';
import { book201, drainAllTestBookings, driversDb, waitOffer } from './dat-xe.js';
import { spawnSync } from 'node:child_process';
import { KAFKA_UI_URL, REPO_ROOT, waitFor } from './helpers.js';

export const NEXT = ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED'];

// Đợi TX1 rảnh (ONLINE, không current_booking_id) — sau K5 COMPLETED / CANCELED ≈ 1 s.
export async function waitDriverFree(driverId = 11, timeoutMs = 3000) {
  return waitFor(
    async () => driversDb(`select availability || ':' || coalesce(current_booking_id::text, '-') from drivers where driver_id = ${driverId}`),
    (s) => s === 'ONLINE:-',
    { timeoutMs, intervalMs: 200 },
  );
}

// Thanh toán online ngay (A31 body rỗng → adapter giả lập thành công) — dùng cho booking `pay: ONLINE`.
export async function payNow(token, paymentId, key = 'k1', body = undefined) {
  return call('POST', `/payments/${paymentId}/transactions`, { token, body, headers: { 'Idempotency-Key': key } });
}

// Đặt xe (khách `custToken`) → TX1 nhận → trả { booking_id, payment_id, offer_id, trip_id }.
// online = true: đặt `pay: ONLINE`, thanh toán ngay rồi mới có Offer (BRULE13).
export async function newTrip(custToken, tx1Token, { online = false } = {}) {
  await drainAllTestBookings();
  const free = await waitDriverFree(11, 5000);
  if (free !== 'ONLINE:-') throw new Error(`TX1 không rảnh trước khi tạo chuyến: ${free}`);
  const b = await book201(custToken, online ? { pay: 'ONLINE' } : {});
  if (online) {
    const p = await payNow(custToken, b.payment_id);
    if (p.status !== 200 || p.body.status !== 'COMPLETED') throw new Error(`thanh toán → ${p.status} ${p.text}`);
  }
  const o = await waitOffer(tx1Token, b.booking_id, 3000);
  if (!o) throw new Error(`TX1 không có Offer cho booking ${b.booking_id}`);
  const a = await call('PATCH', `/offers/${o.offer_id}`, { token: tx1Token, body: { status: 'ACCEPTED' } });
  if (a.status !== 200) throw new Error(`nhận chuyến → ${a.status} ${a.text}`);
  return { booking_id: b.booking_id, payment_id: b.payment_id, offer_id: o.offer_id, trip_id: a.body.trip_id };
}

// Tiến chuyến từ trạng thái hiện tại tới `target` theo đúng trình tự (A28 bằng token tài xế).
export async function advance(tripId, driverToken, from, target) {
  const i = NEXT.indexOf(from);
  const j = NEXT.indexOf(target);
  let last;
  for (let k = i + 1; k <= j; k += 1) {
    last = await call('PATCH', `/trips/${tripId}`, { token: driverToken, body: { status: NEXT[k] } });
    if (last.status !== 200) throw new Error(`trips/${tripId} → ${NEXT[k]}: ${last.status} ${last.text}`);
  }
  return last;
}

// Danh sách thông báo của người trong token (A33), mặc định limit 50 (tối đa của API).
export async function notes(token, query = '?limit=50') {
  const r = await call('GET', `/notifications${query}`, { token });
  if (r.status !== 200) throw new Error(`notifications → ${r.status} ${r.text}`);
  return r.body;
}

// Đợi tới khi người trong token có thông báo thỏa điều kiện; trả danh sách cuối cùng đọc được.
export async function waitNote(token, match, timeoutMs = 2000) {
  return waitFor(
    async () => (await notes(token)).data,
    (list) => Array.isArray(list) && list.some(match),
    { timeoutMs, intervalMs: 200 },
  );
}

// Gửi lại một message vào topic. Spec 17-18 (AC-HT-04, AC-HT-05, AC-TB-09) ghi "Kafka UI → Produce", nhưng
// Kafka UI của Compose chạy KAFKA_CLUSTERS_0_READONLY=true (spec 00 H4) nên API Produce trả 405 "read-only mode".
// Test gửi cùng message bằng kafka-console-producer.sh trong container kafka (cùng key, cùng nội dung, cùng event_id):
// với bên nghe thì không phân biệt được hai cách gửi. Xem báo cáo, ghi chú về mâu thuẫn spec 00 / spec 17-18.
export async function kafkaProduce(topic, { key, content }) {
  const line = `${key}\t${content}\n`;
  const r = spawnSync('docker', [
    'exec', '-i', 'kafka', '/opt/kafka/bin/kafka-console-producer.sh', '--bootstrap-server', 'kafka:9092', '--topic', topic,
    '--property', 'parse.key=true', '--property', 'key.separator=\t',
  ], { cwd: REPO_ROOT, input: line, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (r.status !== 0) throw new Error(`kafka-console-producer ${topic}: ${r.stderr}`);
}

// Thử Produce qua Kafka UI (đúng thao tác của spec); trả status HTTP để test ghi nhận chế độ chỉ đọc.
export async function kafkaUiProduceStatus(topic, { key, content, partition = 0 }) {
  const res = await fetch(`${KAFKA_UI_URL}/api/clusters/cab/topics/${topic}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partition, key, content, keySerde: 'String', valueSerde: 'String' }),
    signal: AbortSignal.timeout(10_000),
  });
  await res.text();
  return res.status;
}

// Chạy một biểu thức mongosh trong notification-db (đọc trực tiếp collection, như sinh viên gõ khi thi); trả stdout.
export function mongoEval(expr) {
  const r = spawnSync('docker', [
    'exec', 'notification-db', 'mongosh', '-u', 'cab', '-p', 'cab123', '--authenticationDatabase', 'admin', 'notification',
    '--quiet', '--eval', expr,
  ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (r.status !== 0) throw new Error(`mongosh: ${r.stderr}`);
  return r.stdout.trim();
}

// Consumer group của Kafka UI: { groupId, state, consumerLag, topics }.
export async function consumerGroups() {
  const res = await fetch(`${KAFKA_UI_URL}/api/clusters/cab/consumer-groups/paged?page=1&perPage=50`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json();
  return body.consumerGroups;
}
