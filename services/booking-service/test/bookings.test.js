// Unit test logic Booking và bộ ghép (spec 14-15-16-19-30 mục 2, 5.6) với kho giả trong bộ nhớ, client gRPC giả,
// bộ phát event giả: không cần PostgreSQL, Kafka hay gRPC. Kho giả mô phỏng giao dịch bằng bản chụp (ROLLBACK)
// và các UNIQUE của driver_offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingLogic } from '../src/domain/bookings.js';
import { createDispatcher } from '../src/domain/dispatcher.js';
import { estimateDistanceM, haversineMeters } from '../src/domain/distance.js';

const KH1 = { accountId: '1', role: 'customer', requestId: 'r1' };
const KH2 = { accountId: '2', role: 'customer', requestId: 'r2' };
const TX1 = { accountId: '11', role: 'driver', requestId: 'r3' };
const TX3 = { accountId: '13', role: 'driver', requestId: 'r4' };
const AD1 = { accountId: '99', role: 'admin', requestId: 'r5' };
const ROUTE = { from: [10.82, 106.68], to: [10.83, 106.69], vehicle: 'CAR_4', pay: 'CASH' };

function fakeRepo() {
  let db = { bookings: new Map(), offers: [], assignments: [], nextBooking: 1000, nextOffer: 1000 };
  const pending = (o) => o.status === 'PENDING';
  const tx = () => ({
    async lockBooking(id) { const b = db.bookings.get(id); return b ? { ...b } : null; },
    async lockOffer(id) { const o = db.offers.find((x) => x.offer_id === id); return o ? { ...o, expired: o.expires_at <= Date.now() } : null; },
    async hasPendingOffer(id) { return db.offers.some((o) => o.booking_id === id && pending(o)); },
    async excludedDrivers(id) { return db.offers.filter((o) => o.booking_id === id || pending(o)).map((o) => o.driver_id); },
    async insertOffer({ bookingId, driverId, distanceM, timeoutSeconds }) {
      if (db.offers.some((o) => o.driver_id === driverId && pending(o))) return null; // UNIQUE (driver_id) WHERE PENDING
      const o = { offer_id: db.nextOffer++, booking_id: bookingId, driver_id: driverId, distance_m: distanceM, status: 'PENDING', expires_at: Date.now() + timeoutSeconds * 1000 };
      db.offers.push(o);
      return { ...o };
    },
    async countOffers(id) { return db.offers.filter((o) => o.booking_id === id).length; },
    async setBookingStatus(id, status) { db.bookings.get(id).status = status; },
    async respondOffer(id, status) {
      const o = db.offers.find((x) => x.offer_id === id);
      if (!o || !pending(o)) return false;
      o.status = status;
      return true;
    },
    async insertAssignment(a) { db.assignments.push(a); },
    async cancelByCustomer(id, reason) { Object.assign(db.bookings.get(id), { status: 'CANCELED', canceled_by: 'customer', cancel_reason: reason }); },
    async voidPendingOffer(id) {
      const o = db.offers.find((x) => x.booking_id === id && pending(x));
      if (!o) return null;
      o.status = 'VOIDED';
      return o.driver_id;
    },
  });
  return {
    get db() { return db; },
    async transaction(fn) {
      const snapshot = structuredClone(db);
      try {
        return await fn(tx());
      } catch (err) {
        db = snapshot;
        throw err;
      }
    },
    async nextBookingId() { return db.nextBooking++; },
    async insertBooking(b) {
      db.bookings.set(b.bookingId, {
        booking_id: b.bookingId, customer_id: b.customerId, vehicle_type: b.vehicleType, pickup_lat: b.from[0], pickup_lng: b.from[1],
        destination_lat: b.to[0], destination_lng: b.to[1], pickup_address: b.fromAddress, destination_address: b.toAddress,
        payment_method: b.pay, estimated_distance_m: b.distanceM, fare_amount: b.fare, payment_id: b.paymentId, status: b.status,
        cancel_reason: null, canceled_by: null, created_at: new Date('2026-10-04T00:00:00Z'),
      });
    },
    async findBooking(id) { const b = db.bookings.get(id); return b ? { ...b } : null; },
    async findBookingView(id) {
      const b = db.bookings.get(id);
      if (!b) return null;
      const a = db.assignments.find((x) => x.bookingId === id);
      return { ...b, driver_id: a?.driverId ?? null, trip_id: a?.tripId ?? null };
    },
    async listBookings({ customerId, status, limit, offset }) {
      const all = [...db.bookings.values()].filter((b) => b.customer_id === customerId && (status === null || b.status === status)).reverse();
      return { rows: all.slice(offset, offset + limit), total: all.length };
    },
    async findOffer(id) { const o = db.offers.find((x) => x.offer_id === id); return o ? { ...o } : null; },
    async listOffers({ driverId, status, limit, offset }) {
      const all = db.offers.filter((o) => o.driver_id === driverId && o.status === status).map((o) => {
        const b = db.bookings.get(o.booking_id);
        return { ...o, pickup_lat: b.pickup_lat, pickup_lng: b.pickup_lng, destination_lat: b.destination_lat, destination_lng: b.destination_lng, payment_method: b.payment_method, fare_amount: b.fare_amount };
      });
      return { rows: all.slice(offset, offset + limit), total: all.length };
    },
    async findDueOffers() { return db.offers.filter((o) => pending(o) && o.expires_at <= Date.now()).map((o) => ({ ...o })); },
    async findSearchingWithoutOffer() {
      return [...db.bookings.values()].filter((b) => b.status === 'SEARCHING' && !db.offers.some((o) => o.booking_id === b.booking_id && pending(o))).map((b) => b.booking_id);
    },
    async markPaid(id) {
      const b = db.bookings.get(id);
      if (!b || b.status !== 'PENDING_PAYMENT') return null;
      b.status = 'SEARCHING';
      return { booking_id: id, customer_id: b.customer_id };
    },
    async cancelBySystem(id, reason) {
      const b = db.bookings.get(id);
      if (!b || b.status !== 'PENDING_PAYMENT') return null;
      Object.assign(b, { status: 'CANCELED', canceled_by: 'system', cancel_reason: reason });
      return { booking_id: id, customer_id: b.customer_id };
    },
  };
}

const grpcError = (statusName, details) => Object.assign(new Error(details), { statusName, details });
// Ứng viên quanh P0 như seed: TX1 111 m, TX3 334 m (CAR_4).
const CANDIDATES = [{ driver_id: 11, distance_m: 111 }, { driver_id: 13, distance_m: 334 }];

function setup(overrides = {}) {
  const repo = fakeRepo();
  const published = [];
  const calls = [];
  const services = {
    async createPayment(req) {
      calls.push(['createPayment', req]);
      if (req.vehicle_type === 'BUS') throw grpcError('INVALID_ARGUMENT', 'INVALID_INPUT');
      const amount = { CAR_4: 45000, CAR_7: 56000, MOTORBIKE: 21000 }[req.vehicle_type];
      return { payment_id: req.booking_id, amount, status: 'PENDING', ...(req.method === 'ONLINE' ? { expires_at: '2026-10-04T00:10:00.000Z' } : {}) };
    },
    async findNearbyDrivers(req) { calls.push(['findNearbyDrivers', req]); return { data: CANDIDATES }; },
    async reserveDriver(req) { calls.push(['reserveDriver', req]); return { ...req, status: 'BUSY' }; },
    async releaseDriver(req) { calls.push(['releaseDriver', req]); return { driver_id: req.driver_id, released: true }; },
    async createTrip(req) { calls.push(['createTrip', req]); return { trip_id: 1000, status: 'ACCEPTED', created: true }; },
    ...overrides,
  };
  const events = { async publish(topic, key, data) { published.push({ topic, key, data }); } };
  const log = { info() {}, warn() {}, error() {} };
  const scheduled = [];
  const dispatcher = createDispatcher({
    bookings: repo, services, events, log, config: { offerTimeoutSeconds: 300 }, sleep: async () => {}, defer: (fn) => scheduled.push(fn),
  });
  const logic = createBookingLogic({ bookings: repo, services, dispatcher, events, log });
  // Chạy hết các vòng ghép đang xếp hàng (thay cho setImmediate), chờ từng vòng xong.
  const flush = async () => {
    while (scheduled.length) {
      scheduled.shift()();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return { repo, published, calls, logic, dispatcher, flush };
}

async function rejectsWith(promise, kind, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.equal(err.code, code);
    return true;
  });
}

test('quãng đường: P0 → D0 ≈ 1 559 m → 2 026 m; TX1 cách P0 111 m', () => {
  assert.equal(Math.round(haversineMeters(10.82, 106.68, 10.83, 106.69)), 1559);
  assert.equal(estimateDistanceM([10.82, 106.68], [10.83, 106.69]), 2026);
  assert.equal(Math.round(haversineMeters(10.821, 106.68, 10.82, 106.68)), 111);
});

test('A19 tiền mặt: 201 SEARCHING, cước từ Payment, K1 không tọa độ; bộ ghép mời TX1 gần nhất (K2)', async () => {
  const { logic, published, calls, repo, flush } = setup();
  const res = await logic.createBooking(ROUTE, KH1);
  assert.deepEqual(res, { booking_id: 1000, status: 'SEARCHING', vehicle: 'CAR_4', pay: 'CASH', distance_m: 2026, fare: 45000, payment_id: 1000 });
  assert.deepEqual(calls[0], ['createPayment', { booking_id: 1000, customer_id: 1, vehicle_type: 'CAR_4', distance_m: 2026, method: 'CASH' }]);
  assert.deepEqual(published[0], { topic: 'booking.created', key: '1000', data: { booking_id: 1000, customer_id: 1, vehicle_type: 'CAR_4', payment_method: 'CASH', status: 'SEARCHING' } });
  await flush();
  assert.deepEqual(calls[1], ['findNearbyDrivers', { lat: 10.82, lng: 106.68, vehicle: 'CAR_4', page: 1, limit: 50 }]);
  assert.deepEqual(repo.db.offers.map((o) => [o.offer_id, o.driver_id, o.distance_m, o.status]), [[1000, 11, 111, 'PENDING']]);
  assert.equal(published[1].topic, 'booking.offer-created');
  assert.equal(published[1].data.driver_id, 11);
});

test('A19 ONLINE: PENDING_PAYMENT, có payment_expires_at, KHÔNG tìm tài xế (BRULE13)', async () => {
  const { logic, calls, flush } = setup();
  const res = await logic.createBooking({ ...ROUTE, vehicle: 'car_7', pay: 'online' }, KH2);
  assert.equal(res.status, 'PENDING_PAYMENT');
  assert.equal(res.fare, 56000);
  assert.equal(res.payment_expires_at, '2026-10-04T00:10:00.000Z');
  await flush();
  assert.equal(calls.filter(([n]) => n === 'findNearbyDrivers').length, 0);
});

test('A19 lỗi: dữ liệu sai 400; Payment 400 trả nguyên; Payment dừng → 503, không tạo booking', async () => {
  const { logic, repo } = setup({ async createPayment() { throw grpcError('UNAVAILABLE', 'x'); } });
  await rejectsWith(logic.createBooking({ ...ROUTE, to: ROUTE.from }, KH1), 'INVALID_ARGUMENT', 'SAME_PICKUP_AND_DESTINATION');
  await rejectsWith(logic.createBooking({ ...ROUTE, from: [91, 106] }, KH1), 'INVALID_ARGUMENT', 'INVALID_COORDINATES');
  await rejectsWith(logic.createBooking({ ...ROUTE, from: [10.82] }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.createBooking({ ...ROUTE, from_address: '<b>' }, KH1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.createBooking(ROUTE, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.createBooking(ROUTE, KH1), 'UNAVAILABLE', 'SERVICE_UNAVAILABLE');
  assert.equal(repo.db.bookings.size, 0);
  const ok = setup();
  await rejectsWith(ok.logic.createBooking({ ...ROUTE, vehicle: 'BUS' }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
});

test('B10: booking thứ hai không mời TX1 đang có Offer chờ → mời TX3', async () => {
  const { logic, repo, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  await logic.createBooking(ROUTE, KH2);
  await flush();
  assert.deepEqual(repo.db.offers.map((o) => [o.booking_id, o.driver_id]), [[1000, 11], [1001, 13]]);
});

test('A25 từ chối → hỏi TX3; TX3 từ chối → NO_DRIVER_FOUND + K3 offers_tried 2; không gọi Payment', async () => {
  const { logic, repo, published, calls, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  assert.deepEqual(await logic.rejectOffer({ offer_id: 1000 }, TX1), { offer_id: 1000, status: 'REJECTED' });
  await flush();
  assert.deepEqual(repo.db.offers.map((o) => [o.driver_id, o.status]), [[11, 'REJECTED'], [13, 'PENDING']]);
  await logic.rejectOffer({ offer_id: 1001 }, TX3);
  await flush();
  assert.equal(repo.db.bookings.get(1000).status, 'NO_DRIVER_FOUND');
  assert.deepEqual(published.at(-1), { topic: 'booking.no-driver-found', key: '1000', data: { booking_id: 1000, customer_id: 1, offers_tried: 2 } });
  assert.equal(calls.filter(([n]) => n === 'createPayment').length, 1);
  await rejectsWith(logic.rejectOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
});

test('A24 nhận: Reserve → CreateTrip (bản chụp) → DRIVER_ASSIGNED, có trip_id; nhận lại → 409', async () => {
  const { logic, repo, calls, flush } = setup();
  await logic.createBooking({ ...ROUTE, from_address: 'IUH' }, KH1);
  await flush();
  const res = await logic.acceptOffer({ offer_id: 1000 }, TX1);
  assert.deepEqual(res, { offer_id: 1000, status: 'ACCEPTED', booking_id: 1000, booking_status: 'DRIVER_ASSIGNED', trip_id: 1000, trip_status: 'ACCEPTED' });
  assert.deepEqual(calls.find(([n]) => n === 'reserveDriver')[1], { driver_id: 11, booking_id: 1000 });
  assert.deepEqual(calls.find(([n]) => n === 'createTrip')[1], {
    booking_id: 1000, customer_id: 1, driver_id: 11, vehicle_type: 'CAR_4', pickup_lat: 10.82, pickup_lng: 106.68,
    destination_lat: 10.83, destination_lng: 106.69, pickup_address: 'IUH', payment_method: 'CASH', fare_amount: 45000,
  });
  const view = await logic.getBooking({ booking_id: 1000 }, KH1);
  assert.equal(view.status, 'DRIVER_ASSIGNED');
  assert.equal(view.driver_id, 11);
  assert.equal(view.trip_id, 1000);
  assert.equal(view.from_address, 'IUH');
  await rejectsWith(logic.acceptOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
  await rejectsWith(logic.acceptOffer({ offer_id: 1000 }, TX3), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.acceptOffer({ offer_id: 999 }, TX1), 'NOT_FOUND', 'OFFER_NOT_FOUND');
  assert.equal(repo.db.assignments.length, 1);
});

test('A24: Trip lỗi → nhả tài xế, 503, Offer vẫn PENDING (Q35); tài xế không rảnh → 409, Offer giữ PENDING (DX-Q6)', async () => {
  const tripDown = setup({ async createTrip() { throw grpcError('UNAVAILABLE', 'x'); } });
  await tripDown.logic.createBooking(ROUTE, KH1);
  await tripDown.flush();
  await rejectsWith(tripDown.logic.acceptOffer({ offer_id: 1000 }, TX1), 'UNAVAILABLE', 'SERVICE_UNAVAILABLE');
  assert.ok(tripDown.calls.some(([n, req]) => n === 'releaseDriver' && req.driver_id === 11 && req.booking_id === 1000));
  assert.equal(tripDown.repo.db.offers[0].status, 'PENDING');
  assert.equal(tripDown.repo.db.bookings.get(1000).status, 'SEARCHING');

  const busy = setup({ async reserveDriver() { throw grpcError('FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE'); } });
  await busy.logic.createBooking(ROUTE, KH1);
  await busy.flush();
  await rejectsWith(busy.logic.acceptOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
  assert.equal(busy.repo.db.offers[0].status, 'PENDING');
});

test('Offer quá hạn: nhận → OFFER_EXPIRED; tiến trình nền → EXPIRED, nhả tài xế, mời người kế tiếp (FR09)', async () => {
  const { logic, dispatcher, repo, calls, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  repo.db.offers[0].expires_at = Date.now() - 1;
  await rejectsWith(logic.acceptOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'OFFER_EXPIRED');
  assert.equal(await dispatcher.expireOffers(), 1);
  await flush();
  assert.deepEqual(repo.db.offers.map((o) => [o.driver_id, o.status]), [[11, 'EXPIRED'], [13, 'PENDING']]);
  assert.ok(calls.some(([n, req]) => n === 'releaseDriver' && req.driver_id === 11));
  await rejectsWith(logic.acceptOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
});

test('S2 lỗi 3 lần → NO_DRIVER_FOUND + K3 (DX7)', async () => {
  let tries = 0;
  const { logic, repo, published, flush } = setup({ async findNearbyDrivers() { tries += 1; throw grpcError('UNAVAILABLE', 'x'); } });
  await logic.createBooking(ROUTE, KH1);
  await flush();
  assert.equal(tries, 3);
  assert.equal(repo.db.bookings.get(1000).status, 'NO_DRIVER_FOUND');
  assert.equal(published.at(-1).topic, 'booking.no-driver-found');
});

test('K6: COMPLETED → SEARCHING + ghép; lặp không đổi gì; CANCELED → hủy (system) + K4; FAILED bỏ qua', async () => {
  const { logic, repo, published, flush } = setup();
  await logic.createBooking({ ...ROUTE, pay: 'ONLINE' }, KH1);
  await logic.createBooking({ ...ROUTE, pay: 'ONLINE' }, KH1);
  const env = (data) => ({ event_id: 'e', data });
  assert.equal(await logic.onPaymentStatusChanged(env({ booking_id: 1000, status: 'FAILED' })), null);
  assert.equal(repo.db.bookings.get(1000).status, 'PENDING_PAYMENT');
  assert.equal(await logic.onPaymentStatusChanged(env({ booking_id: 1000, payment_id: 1000, status: 'COMPLETED' })), 'SEARCHING');
  assert.equal(await logic.onPaymentStatusChanged(env({ booking_id: 1000, payment_id: 1000, status: 'COMPLETED' })), null);
  await flush();
  assert.equal(repo.db.offers.length, 1);
  assert.equal(await logic.onPaymentStatusChanged(env({ booking_id: 1001, status: 'CANCELED', reason: 'ATTEMPTS_EXHAUSTED' })), 'CANCELED');
  assert.deepEqual(published.at(-1), {
    topic: 'booking.canceled', key: '1001',
    data: { booking_id: 1001, customer_id: 1, canceled_by: 'system', previous_status: 'PENDING_PAYMENT', pending_offer_driver_id: null, reason: 'ATTEMPTS_EXHAUSTED' },
  });
  const view = await logic.getBooking({ booking_id: 1001 }, KH1);
  assert.deepEqual([view.status, view.canceled_by, view.cancel_reason], ['CANCELED', 'system', 'ATTEMPTS_EXHAUSTED']);
  assert.equal(await logic.onPaymentStatusChanged({ data: { status: 'COMPLETED' } }), null); // sai dạng → bỏ qua
});

test('A20 / A21 / A23: chỉ của mình; admin xem A21; phân trang và lọc', async () => {
  const { logic, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await logic.createBooking({ ...ROUTE, pay: 'ONLINE' }, KH1);
  await flush();
  const list = await logic.listBookings({ page: 1, limit: 1 }, KH1);
  assert.deepEqual(list.pagination, { page: 1, limit: 1, total: 2, total_pages: 2 });
  assert.deepEqual(Object.keys(list.data[0]), ['booking_id', 'status', 'vehicle', 'pay', 'fare', 'created_at']);
  assert.equal((await logic.listBookings({ status: 'searching', page: 1, limit: 10 }, KH1)).pagination.total, 1);
  assert.equal((await logic.listBookings({ page: 1, limit: 10 }, KH2)).pagination.total, 0);
  await rejectsWith(logic.listBookings({ page: 1, limit: 51 }, KH1), 'INVALID_ARGUMENT', 'INVALID_PAGINATION');
  await rejectsWith(logic.listBookings({ status: 'XYZ', page: 1, limit: 10 }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.getBooking({ booking_id: 1000 }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  assert.equal((await logic.getBooking({ booking_id: 1000 }, AD1)).booking_id, 1000);
  await rejectsWith(logic.getBooking({ booking_id: 999 }, KH1), 'NOT_FOUND', 'BOOKING_NOT_FOUND');
  const offers = await logic.listOffers({ page: 1, limit: 10 }, TX1);
  assert.deepEqual(offers.data[0].from, [10.82, 106.68]);
  assert.equal(offers.data[0].fare, 45000);
  assert.equal((await logic.listOffers({ status: 'EXPIRED', page: 1, limit: 10 }, TX1)).pagination.total, 0);
  await rejectsWith(logic.listOffers({ page: 1, limit: 10 }, KH1), 'PERMISSION_DENIED', 'FORBIDDEN');
});

test('khởi động lại: booking SEARCHING chưa có Offer được ghép tiếp, có Offer thì không (NFR15)', async () => {
  const { logic, dispatcher, repo, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  repo.db.bookings.get(1000).status = 'SEARCHING';
  assert.equal(await dispatcher.resume(), 0); // đã có Offer chờ
  await logic.createBooking({ ...ROUTE, pay: 'ONLINE' }, KH1);
  repo.db.bookings.get(1001).status = 'SEARCHING';
  assert.equal(await dispatcher.resume(), 1);
  await flush();
  assert.deepEqual(repo.db.offers.map((o) => [o.booking_id, o.driver_id]), [[1000, 11], [1001, 13]]);
});

// ---- Spec 17-18 mục 2.4: A22 khách hủy booking chưa có tài xế ----

test('A22 SEARCHING có Offer chờ: CANCELED, Offer VOIDED, nhả TX1 phòng khi, K4 không có key reason; bộ ghép dừng', async () => {
  const { logic, repo, published, calls, flush } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  const res = await logic.cancelBooking({ booking_id: 1000, reason: '  doi y ' }, KH1);
  assert.deepEqual(res, { booking_id: 1000, status: 'CANCELED', canceled_by: 'customer' });
  const b = repo.db.bookings.get(1000);
  assert.deepEqual([b.status, b.canceled_by, b.cancel_reason], ['CANCELED', 'customer', 'doi y']);
  assert.equal(repo.db.offers[0].status, 'VOIDED');
  assert.ok(calls.some(([n, req]) => n === 'releaseDriver' && req.driver_id === 11 && req.booking_id === 1000));
  assert.deepEqual(published.at(-1), {
    topic: 'booking.canceled', key: '1000',
    data: { booking_id: 1000, customer_id: 1, canceled_by: 'customer', previous_status: 'SEARCHING', pending_offer_driver_id: 11 },
  });
  // Tài xế bấm nhận Offer đã VOIDED → 409; bộ ghép không mời ai nữa.
  await rejectsWith(logic.acceptOffer({ offer_id: 1000 }, TX1), 'FAILED_PRECONDITION', 'INVALID_STATUS_TRANSITION');
  await logic.rejectOffer({ offer_id: 1000 }, TX1).catch(() => {});
  await flush();
  assert.equal(repo.db.offers.length, 1);
  // Hủy lại → 409 BOOKING_NOT_CANCELABLE.
  await rejectsWith(logic.cancelBooking({ booking_id: 1000, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'BOOKING_NOT_CANCELABLE');
});

test('A22 PENDING_PAYMENT (chưa có Offer): CANCELED, K4 pending_offer_driver_id null, không gọi ReleaseDriver; nhả lỗi cũng không chặn hủy', async () => {
  const { logic, published, calls } = setup({ async releaseDriver() { throw grpcError('UNAVAILABLE', 'x'); } });
  await logic.createBooking({ ...ROUTE, pay: 'ONLINE' }, KH1);
  const res = await logic.cancelBooking({ booking_id: 1000, reason: 'doi y' }, KH1);
  assert.equal(res.status, 'CANCELED');
  assert.equal(published.at(-1).data.previous_status, 'PENDING_PAYMENT');
  assert.equal(published.at(-1).data.pending_offer_driver_id, null);
  assert.ok(!('reason' in published.at(-1).data));
  assert.equal(calls.filter(([n]) => n === 'releaseDriver').length, 0);

  const down = setup({ async releaseDriver() { throw grpcError('UNAVAILABLE', 'x'); } });
  await down.logic.createBooking(ROUTE, KH1);
  await down.flush();
  assert.equal((await down.logic.cancelBooking({ booking_id: 1000, reason: 'x' }, KH1)).status, 'CANCELED');
});

test('A22 lỗi: DRIVER_ASSIGNED 409; NO_DRIVER_FOUND 409; không phải chủ 403; 999 → 404; reason sai → 400; tài xế / admin 403', async () => {
  const { logic, flush, repo } = setup();
  await logic.createBooking(ROUTE, KH1);
  await flush();
  await logic.acceptOffer({ offer_id: 1000 }, TX1);
  await rejectsWith(logic.cancelBooking({ booking_id: 1000, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'BOOKING_ALREADY_ASSIGNED');
  await logic.createBooking(ROUTE, KH1);
  repo.db.bookings.get(1001).status = 'NO_DRIVER_FOUND';
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: 'x' }, KH1), 'FAILED_PRECONDITION', 'BOOKING_NOT_CANCELABLE');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: 'x' }, KH2), 'PERMISSION_DENIED', 'NOT_OWNER');
  await rejectsWith(logic.cancelBooking({ booking_id: 999, reason: 'x' }, KH1), 'NOT_FOUND', 'BOOKING_NOT_FOUND');
  await rejectsWith(logic.cancelBooking({ booking_id: 0, reason: 'x' }, KH1), 'INVALID_ARGUMENT', 'INVALID_ID');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: '' }, KH1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: '  ' }, KH1), 'INVALID_ARGUMENT', 'REASON_REQUIRED');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: '<b>' }, KH1), 'INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: 'a'.repeat(256) }, KH1), 'INVALID_ARGUMENT', 'INVALID_INPUT');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: 'x' }, TX1), 'PERMISSION_DENIED', 'FORBIDDEN');
  await rejectsWith(logic.cancelBooking({ booking_id: 1001, reason: 'x' }, AD1), 'PERMISSION_DENIED', 'FORBIDDEN');
});
