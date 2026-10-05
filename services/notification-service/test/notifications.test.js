// Unit test Notification (spec 17-18 mục 2.7, 4.4, 5.4): bảng event → thông báo (hàm thuần toNotifications) cho cả
// 15 loại, chống trùng khi event lặp (kho giả mô phỏng UNIQUE (event_id, recipient_id)), A33 chỉ của mình, phân trang;
// và gọi thật ListNotifications qua gRPC (cổng ngẫu nhiên) để kiểm tầng gRPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createNotificationLogic, toNotifications } from '../src/domain/notifications.js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';

const AT = '2026-10-05T01:02:03.000Z';
const env = (topic, data, eventId = 'e-1') => ({ event_id: eventId, event_type: topic, occurred_at: AT, data });
const brief = (docs) => docs.map((d) => [d.type, d.recipient_id, d.body]);

test('K1, K2, K3: BOOKING_CREATED → khách, OFFER_CREATED → tài xế, NO_DRIVER_FOUND → khách; created_at = occurred_at', () => {
  const k1 = toNotifications(env('booking.created', { booking_id: 1000, customer_id: 1, vehicle_type: 'CAR_4', payment_method: 'CASH', status: 'SEARCHING' }));
  assert.deepEqual(k1, [{
    event_id: 'e-1', recipient_id: 1, type: 'BOOKING_CREATED', title: 'Đã nhận yêu cầu đặt xe', body: 'Booking 1000 đã được tiếp nhận',
    data: { booking_id: 1000, status: 'SEARCHING' }, created_at: new Date(AT),
  }]);
  const k2 = toNotifications(env('booking.offer-created', { offer_id: 1000, booking_id: 1000, driver_id: 11, expires_at: AT }));
  assert.deepEqual(brief(k2), [['OFFER_CREATED', 11, 'Lời mời 1000 cho booking 1000']]);
  assert.deepEqual(k2[0].data, { offer_id: 1000, booking_id: 1000 });
  const k3 = toNotifications(env('booking.no-driver-found', { booking_id: 1001, customer_id: 1, offers_tried: 0 }));
  assert.deepEqual(brief(k3), [['NO_DRIVER_FOUND', 1, 'Booking 1001 không có tài xế phù hợp. Nếu đã thanh toán, bạn được hoàn đủ']]);
});

test('K4: BOOKING_CANCELED cho khách; có Offer chờ thì thêm OFFER_VOIDED cho tài xế (CD13)', () => {
  const sys = toNotifications(env('booking.canceled', { booking_id: 7, customer_id: 1, canceled_by: 'system', previous_status: 'PENDING_PAYMENT', pending_offer_driver_id: null, reason: 'PAYMENT_EXPIRED' }));
  assert.deepEqual(brief(sys), [['BOOKING_CANCELED', 1, 'Booking 7 đã hủy']]);
  assert.deepEqual(sys[0].data, { booking_id: 7, status: 'CANCELED' });
  const withOffer = toNotifications(env('booking.canceled', { booking_id: 1001, customer_id: 1, canceled_by: 'customer', previous_status: 'SEARCHING', pending_offer_driver_id: 11 }));
  assert.deepEqual(brief(withOffer), [['BOOKING_CANCELED', 1, 'Booking 1001 đã hủy'], ['OFFER_VOIDED', 11, 'Booking 1001 đã bị khách hủy']]);
});

test('K5: ACCEPTED / ARRIVED / COMPLETED → khách; CANCELED → khách VÀ tài xế (CD9); PICKED_UP, IN_PROGRESS → không có (CD8)', () => {
  const trip = (status, extra = {}) => env('trip.status-changed', { trip_id: 1000, booking_id: 1000, customer_id: 1, driver_id: 11, status, previous_status: null, ...extra });
  const accepted = toNotifications(trip('ACCEPTED'));
  assert.deepEqual(brief(accepted), [['TRIP_ACCEPTED', 1, 'Tài xế 11 đã nhận chuyến 1000']]);
  assert.equal(accepted[0].title, 'Tài xế đã nhận chuyến');
  assert.deepEqual(accepted[0].data, { trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'ACCEPTED' });
  assert.deepEqual(brief(toNotifications(trip('ARRIVED'))), [['TRIP_ARRIVED', 1, 'Chuyến 1000']]);
  assert.deepEqual(brief(toNotifications(trip('COMPLETED'))), [['TRIP_COMPLETED', 1, 'Chuyến 1000 đã hoàn thành']]);
  assert.deepEqual(brief(toNotifications(trip('CANCELED', { canceled_by: 'customer' }))), [
    ['TRIP_CANCELED', 1, 'Chuyến 1000 đã bị khách hàng hủy'], ['TRIP_CANCELED', 11, 'Chuyến 1000 đã bị khách hàng hủy'],
  ]);
  assert.deepEqual(brief(toNotifications(trip('CANCELED', { canceled_by: 'driver' })))[0], ['TRIP_CANCELED', 1, 'Chuyến 1000 đã bị tài xế hủy']);
  assert.deepEqual(toNotifications(trip('PICKED_UP')), []);
  assert.deepEqual(toNotifications(trip('IN_PROGRESS')), []);
});

test('K6: COMPLETED / FAILED / CANCELED (theo reason) / REFUNDED → khách, data có payment_id, amount', () => {
  const pay = (status, extra = {}) => env('payment.status-changed', { payment_id: 5, booking_id: 5, customer_id: 1, method: 'ONLINE', amount: 45000, status, previous_status: 'COMPLETED', ...extra });
  assert.deepEqual(brief(toNotifications(pay('COMPLETED'))), [['PAYMENT_COMPLETED', 1, 'Thanh toán 5: 45000 đ']]);
  assert.deepEqual(brief(toNotifications(pay('FAILED'))), [['PAYMENT_FAILED', 1, 'Thanh toán 5 thất bại, bạn có thể thử lại']]);
  assert.deepEqual(brief(toNotifications(pay('CANCELED', { reason: 'PAYMENT_EXPIRED' }))), [['PAYMENT_CANCELED', 1, 'Thanh toán 5 quá hạn']]);
  assert.deepEqual(brief(toNotifications(pay('CANCELED', { reason: 'ATTEMPTS_EXHAUSTED' }))), [['PAYMENT_CANCELED', 1, 'Thanh toán 5 hết lượt thử']]);
  const refunded = toNotifications(pay('REFUNDED'));
  assert.deepEqual(brief(refunded), [['PAYMENT_REFUNDED', 1, 'Đã hoàn 45000 đ cho thanh toán 5']]);
  assert.equal(refunded[0].title, 'Đã hoàn tiền');
  assert.deepEqual(refunded[0].data, { payment_id: 5, booking_id: 5, amount: 45000, status: 'REFUNDED' });
});

test('K7: APPLICATION_APPROVED / APPLICATION_REJECTED → tài xế (AC20)', () => {
  assert.deepEqual(brief(toNotifications(env('driver.application-reviewed', { driver_id: 17, result: 'APPROVED' }))), [['APPLICATION_APPROVED', 17, 'Hồ sơ tài xế 17']]);
  const rejected = toNotifications(env('driver.application-reviewed', { driver_id: 17, result: 'REJECTED' }));
  assert.deepEqual([rejected[0].type, rejected[0].title, rejected[0].data], ['APPLICATION_REJECTED', 'Hồ sơ tài xế bị từ chối', { driver_id: 17, status: 'REJECTED' }]);
});

test('event sai dạng / topic lạ / thiếu mã → null; occurred_at sai dạng → giờ hiện tại', () => {
  assert.equal(toNotifications(null), null);
  assert.equal(toNotifications({ event_type: 'booking.created', data: { booking_id: 1, customer_id: 1 } }), null); // thiếu event_id
  assert.equal(toNotifications(env('booking.created', { booking_id: '1', customer_id: 1 })), null);
  assert.equal(toNotifications(env('topic.la', { booking_id: 1 })), null);
  assert.equal(toNotifications(env('trip.status-changed', { trip_id: 1, booking_id: 1, customer_id: 1, driver_id: 11, status: 'XYZ' })), null);
  const now = new Date('2030-01-01T00:00:00Z');
  const docs = toNotifications({ ...env('booking.created', { booking_id: 1, customer_id: 1 }), occurred_at: 'hôm qua' }, { now: () => now });
  assert.equal(docs[0].created_at, now);
  assert.deepEqual(docs[0].data, { booking_id: 1 }); // status không có → không có key
});

// Kho giả: mô phỏng UNIQUE (event_id, recipient_id) và sắp xếp mới nhất trước.
function setup() {
  const docs = [];
  const logs = [];
  const notifications = {
    async insertOnce(doc) {
      if (docs.some((d) => d.event_id === doc.event_id && d.recipient_id === doc.recipient_id)) return false;
      docs.push({ ...doc, _id: docs.length });
      return true;
    },
    async listByRecipient(id, { skip, limit }) {
      const mine = docs.filter((d) => d.recipient_id === id).sort((a, b) => b.created_at - a.created_at || b._id - a._id);
      return { rows: mine.slice(skip, skip + limit), total: mine.length };
    },
  };
  const log = { info: (msg, f) => logs.push({ msg, ...f }), warn: (msg, f) => logs.push({ msg, ...f }), error() {} };
  return { docs, logs, logic: createNotificationLogic({ notifications, log }) };
}

test('onEvent: lưu, log notification_created KHÔNG có title/body; event lặp không tạo thêm (N4); sai dạng → 0', async () => {
  const { logic, docs, logs } = setup();
  const k5 = env('trip.status-changed', { trip_id: 5, booking_id: 5, customer_id: 1, driver_id: 16, status: 'CANCELED', canceled_by: 'customer' }, 'e-cancel');
  assert.equal(await logic.onEvent('trip.status-changed', k5), 2);
  assert.equal(await logic.onEvent('trip.status-changed', k5), 0);
  assert.equal(docs.length, 2);
  assert.deepEqual(logs.filter((l) => l.msg === 'notification_created')[0], { msg: 'notification_created', type: 'TRIP_CANCELED', recipient_id: 1, event_id: 'e-cancel' });
  assert.ok(!JSON.stringify(logs).includes('Chuyến 5'), 'không ghi body vào log');
  assert.equal(await logic.onEvent('x', { nope: 1 }), 0);
  assert.equal(logs.at(-1).msg, 'bỏ qua event sai dạng');
});

test('onEvent: kho lỗi → ném lỗi để Kafka giao lại (N1)', async () => {
  const logic = createNotificationLogic({
    notifications: { async insertOnce() { throw Object.assign(new Error('down'), { name: 'MongoServerSelectionError' }); } },
    log: { info() {}, warn() {}, error() {} },
  });
  await assert.rejects(logic.onEvent('booking.created', env('booking.created', { booking_id: 1, customer_id: 1 })), /down/);
});

const ids = (res) => res.data.map((n) => n.type);

test('A33: chỉ của người trong token, mới nhất trước; phân trang; sai phân trang 400; thiếu danh tính 401', async () => {
  const { logic } = setup();
  const at = (s) => `2026-10-05T01:00:0${s}.000Z`;
  await logic.onEvent('', { ...env('booking.created', { booking_id: 1000, customer_id: 1, status: 'SEARCHING' }, 'a'), occurred_at: at(1) });
  await logic.onEvent('', { ...env('booking.offer-created', { offer_id: 1000, booking_id: 1000, driver_id: 11 }, 'b'), occurred_at: at(2) });
  await logic.onEvent('', { ...env('trip.status-changed', { trip_id: 1000, booking_id: 1000, customer_id: 1, driver_id: 11, status: 'ACCEPTED' }, 'c'), occurred_at: at(3) });
  const kh1 = await logic.listNotifications({ page: 1, limit: 10 }, { accountId: '1', role: 'customer' });
  assert.deepEqual(ids(kh1), ['TRIP_ACCEPTED', 'BOOKING_CREATED']);
  assert.deepEqual(kh1.data[0], {
    type: 'TRIP_ACCEPTED', title: 'Tài xế đã nhận chuyến', body: 'Tài xế 11 đã nhận chuyến 1000',
    data: { trip_id: 1000, booking_id: 1000, driver_id: 11, status: 'ACCEPTED' }, created_at: at(3),
  });
  assert.deepEqual(kh1.pagination, { page: 1, limit: 10, total: 2, total_pages: 1 });
  assert.deepEqual(ids(await logic.listNotifications({ page: 1, limit: 10 }, { accountId: '11', role: 'driver' })), ['OFFER_CREATED']);
  const p2 = await logic.listNotifications({ page: 2, limit: 1 }, { accountId: '1', role: 'customer' });
  assert.deepEqual([ids(p2), p2.pagination.total, p2.pagination.total_pages], [['BOOKING_CREATED'], 2, 2]);
  const empty = await logic.listNotifications({ page: 1, limit: 10 }, { accountId: '99', role: 'admin' });
  assert.deepEqual(empty, { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } });
  for (const [page, limit] of [[0, 10], [1, 0], [1, 51]]) {
    await assert.rejects(logic.listNotifications({ page, limit }, { accountId: '1', role: 'customer' }), (e) => e.code === 'INVALID_PAGINATION');
  }
  await assert.rejects(logic.listNotifications({ page: 1, limit: 10 }, {}), (e) => e.code === 'IDENTITY_MISSING' && e.kind === 'UNAUTHENTICATED');
  await assert.rejects(logic.listNotifications({ page: 1, limit: 10 }, { role: 'system' }), (e) => e.code === 'IDENTITY_MISSING');
});

test('gRPC ListNotifications: metadata x-account-id / x-role → danh sách; thiếu danh tính → UNAUTHENTICATED IDENTITY_MISSING', async () => {
  const { logic } = setup();
  await logic.onEvent('', env('payment.status-changed', { payment_id: 5, booking_id: 5, customer_id: 1, method: 'ONLINE', amount: 45000, status: 'REFUNDED' }, 'r'));
  const server = createGrpcServer({ health: { check: async () => 'SERVING' }, notifications: logic, log: { info() {}, warn() {}, error() {} } });
  const port = await startGrpcServer(server, 0);
  const { NotificationService } = loadProto('notification.proto').cab.notification.v1;
  const client = new NotificationService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const list = (meta) => new Promise((resolve) => {
    const md = new grpc.Metadata();
    for (const [k, v] of Object.entries(meta)) md.set(k, v);
    client.ListNotifications({ page: 1, limit: 10 }, md, { deadline: Date.now() + 1000 }, (err, res) => resolve({ err, res }));
  });
  try {
    const ok = await list({ 'x-account-id': '1', 'x-role': 'customer' });
    assert.equal(ok.err, null);
    assert.equal(ok.res.data[0].type, 'PAYMENT_REFUNDED');
    assert.equal(ok.res.data[0].data.amount, 45000);
    assert.equal(ok.res.data[0].data.payment_id, 5);
    assert.equal(ok.res.pagination.total, 1);
    const bad = await list({});
    assert.equal(bad.err.code, grpc.status.UNAUTHENTICATED);
    assert.equal(bad.err.details, 'IDENTITY_MISSING');
  } finally {
    client.close();
    server.forceShutdown();
  }
});
