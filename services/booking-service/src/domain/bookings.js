// Logic nghiệp vụ của Booking (spec 14-15-16-19-30): đặt xe (UC04, UC05), xem booking (UC18), xem lời mời,
// tài xế nhận (UC08) / từ chối (UC09), nghe kết quả thanh toán K6 (UC14, BRULE13, BRULE17).
// Mọi phụ thuộc (kho dữ liệu, client gRPC tới payment / driver / trip, bộ ghép, bộ phát event, log, cấu hình)
// truyền từ ngoài vào nên test chạy được không cần PostgreSQL, Kafka hay gRPC.
// `identity` = { accountId, role, requestId } lấy từ metadata do Gateway dựng (tầng gRPC đọc giúp).
import { estimateDistanceM } from './distance.js';
import {
  BOOKING_STATUSES, BookingError, checkId, checkPagination, checkPoint, cleanAddress, conflict, invalid, iso,
  normalizeEnum, OFFER_STATUSES, pagination, PAY_METHODS, requireRole, unavailable,
} from './rules.js';
import { createSafePublisher, TOPIC_BOOKING_CANCELED, TOPIC_BOOKING_CREATED } from './topics.js';

const bookingNotFound = () => new BookingError('NOT_FOUND', 'BOOKING_NOT_FOUND');
const offerNotFound = () => new BookingError('NOT_FOUND', 'OFFER_NOT_FOUND');
const notOwner = () => new BookingError('PERMISSION_DENIED', 'NOT_OWNER');
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SYSTEM_CANCEL_REASONS = ['PAYMENT_EXPIRED', 'ATTEMPTS_EXHAUSTED'];

// Phần chung của một booking trong mọi response (A19, A20, A21). Tên field ngắn của API ↔ tên cột đầy đủ.
const core = (row) => ({
  booking_id: row.booking_id,
  status: row.status,
  vehicle: row.vehicle_type,
  pay: row.payment_method,
  distance_m: row.estimated_distance_m,
  fare: row.fare_amount,
  payment_id: row.payment_id,
});

export function createBookingLogic({ bookings, services, dispatcher, events, log }) {
  const publish = createSafePublisher({ events, log });

  // Gọi S3 ReleaseDriver "phòng khi đã giữ"; lỗi chỉ ghi log (Offer hết hạn sẽ gọi lại — DX5).
  async function releaseQuietly(driverId, bookingId, requestId) {
    try {
      await services.releaseDriver({ driver_id: driverId, booking_id: bookingId }, requestId);
    } catch (err) {
      log.warn('nhả tài xế lỗi', { driver_id: driverId, booking_id: bookingId, status: err?.statusName });
    }
  }

  // Đọc Offer và kiểm chủ trước khi mở giao dịch (A24, A25): không có → 404; của tài xế khác → 403.
  async function ownOffer(offerId, accountId) {
    checkId(offerId);
    const offer = await bookings.findOffer(offerId);
    if (!offer) throw offerNotFound();
    if (offer.driver_id !== accountId) throw notOwner();
    return offer;
  }

  // Kiểm Offer trong giao dịch, theo thứ tự: đã trả lời → INVALID_STATUS_TRANSITION; quá hạn → OFFER_EXPIRED
  // (tiến trình nền chưa kịp đánh dấu — AC-DX-16).
  function checkPendingOffer(offer) {
    if (offer.status !== 'PENDING') throw conflict('INVALID_STATUS_TRANSITION');
    if (offer.expired) throw conflict('OFFER_EXPIRED');
  }

  return {
    // A19 — đặt xe (mục 15). Không cần hồ sơ khách (Q56): có token customer và đủ dữ liệu là đặt được.
    async createBooking(req, identity) {
      const { accountId } = requireRole(identity, ['customer']);
      const from = checkPoint(req.from);
      const to = checkPoint(req.to);
      const vehicle = typeof req.vehicle === 'string' ? req.vehicle.trim().toUpperCase() : '';
      if (vehicle === '' || vehicle.length > 20) throw invalid();
      const pay = normalizeEnum(req.pay, PAY_METHODS);
      if (!pay) throw invalid();
      const fromAddress = cleanAddress(req.from_address);
      const toAddress = cleanAddress(req.to_address);
      // Quãng đường ước tính = Haversine × 1,3 (FR16). Bằng 0 = điểm đón trùng điểm đến.
      const distanceM = estimateDistanceM(from, to);
      if (distanceM <= 0) throw invalid('SAME_PICKUP_AND_DESTINATION');

      // Lấy số booking trước để gửi cho Payment; Payment tính cước cố định và tạo thanh toán (S4, B15).
      const bookingId = await bookings.nextBookingId();
      let payment;
      try {
        payment = await services.createPayment({
          booking_id: bookingId, customer_id: accountId, vehicle_type: vehicle, distance_m: distanceM, method: pay,
        }, identity.requestId);
      } catch (err) {
        // Loại xe không có giá… → trả nguyên lỗi 400 của Payment. Payment dừng / quá hạn → 503, KHÔNG tạo booking
        // (đánh đổi ADR-009: trả trước nên đặt xe phụ thuộc Payment).
        if (err?.statusName === 'INVALID_ARGUMENT') throw invalid(ERROR_CODE.test(err.details) ? err.details : 'INVALID_INPUT');
        log.warn('tạo thanh toán lỗi', { booking_id: bookingId, status: err?.statusName });
        throw unavailable();
      }

      // BRULE13: tiền mặt tìm tài xế ngay; điện tử chờ thanh toán xong (K6) mới tìm.
      const status = pay === 'CASH' ? 'SEARCHING' : 'PENDING_PAYMENT';
      try {
        await bookings.insertBooking({
          bookingId, customerId: accountId, vehicleType: vehicle, from, to, fromAddress, toAddress, pay, distanceM,
          fare: payment.amount, paymentId: payment.payment_id, status,
        });
      } catch (err) {
        // Payment đã tạo mà booking không ghi được → thanh toán mồ côi; chấp nhận, ghi log để xử lý tay (ADR-017).
        log.error('BOOKING_INSERT_FAILED', { booking_id: bookingId, payment_id: payment.payment_id, code: err?.code });
        throw err;
      }
      // Không ghi tọa độ, địa chỉ vào log (NFR08).
      log.info('booking_created', { booking_id: bookingId, payment_id: payment.payment_id, status });
      await publish(TOPIC_BOOKING_CREATED, bookingId, {
        booking_id: bookingId, customer_id: accountId, vehicle_type: vehicle, payment_method: pay, status,
      });
      if (status === 'SEARCHING') dispatcher.schedule(bookingId, identity.requestId);

      const out = { ...core({ booking_id: bookingId, status, vehicle_type: vehicle, payment_method: pay, estimated_distance_m: distanceM, fare_amount: payment.amount, payment_id: payment.payment_id }) };
      if (pay === 'ONLINE' && payment.expires_at) out.payment_expires_at = payment.expires_at;
      return out;
    },

    // A20 — booking của CHÍNH khách trong token (B14), mới nhất trước, phân trang (mục 14).
    async listBookings({ status, page, limit }, identity) {
      const { accountId } = requireRole(identity, ['customer']);
      const filter = normalizeEnum(status, BOOKING_STATUSES) ?? null;
      const paging = checkPagination(page, limit);
      const { rows, total } = await bookings.listBookings({ customerId: accountId, status: filter, limit: paging.limit, offset: paging.offset });
      return {
        data: rows.map((row) => ({
          booking_id: row.booking_id, status: row.status, vehicle: row.vehicle_type, pay: row.payment_method,
          fare: row.fare_amount, created_at: iso(row.created_at),
        })),
        pagination: pagination(paging.page, paging.limit, total),
      };
    },

    // A21 — chủ booking hoặc admin. Mã số dễ đoán nên PHẢI kiểm quyền sở hữu (CLAUDE.md "Khóa chính").
    async getBooking({ booking_id: bookingId }, identity) {
      const { accountId, role } = requireRole(identity, ['customer', 'admin']);
      checkId(bookingId);
      const row = await bookings.findBookingView(bookingId);
      if (!row) throw bookingNotFound();
      if (role === 'customer' && row.customer_id !== accountId) throw notOwner();
      const out = {
        ...core(row),
        from: [row.pickup_lat, row.pickup_lng],
        to: [row.destination_lat, row.destination_lng],
        created_at: iso(row.created_at),
      };
      // Field không có giá trị thì không có key (proto `optional`).
      if (row.pickup_address !== null) out.from_address = row.pickup_address;
      if (row.destination_address !== null) out.to_address = row.destination_address;
      if (row.driver_id !== null && row.driver_id !== undefined) out.driver_id = row.driver_id;
      if (row.trip_id !== null && row.trip_id !== undefined) out.trip_id = row.trip_id;
      if (row.canceled_by !== null) out.canceled_by = row.canceled_by;
      if (row.cancel_reason !== null) out.cancel_reason = row.cancel_reason;
      return out;
    },

    // A23 — lời mời của CHÍNH tài xế (mặc định PENDING). Có điểm đón / đến để quyết định nhận; không tên,
    // số điện thoại khách.
    async listOffers({ status, page, limit }, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      const filter = normalizeEnum(status, OFFER_STATUSES) ?? 'PENDING';
      const paging = checkPagination(page, limit);
      const { rows, total } = await bookings.listOffers({ driverId: accountId, status: filter, limit: paging.limit, offset: paging.offset });
      return {
        data: rows.map((row) => ({
          offer_id: row.offer_id, booking_id: row.booking_id, distance_m: row.distance_m, status: row.status,
          expires_at: iso(row.expires_at), from: [row.pickup_lat, row.pickup_lng], to: [row.destination_lat, row.destination_lng],
          pay: row.payment_method, fare: row.fare_amount,
        })),
        pagination: pagination(paging.page, paging.limit, total),
      };
    },

    // A24 — tài xế nhận chuyến (mục 16; UC08). Giữ khóa dòng booking trong lúc gọi Driver (S3) và Trip (S5)
    // (DX1): hủy (spec 18) và nhận cùng khóa một dòng nên bên đến sau thấy trạng thái mới, không cần trạng thái
    // trung gian. Đánh đổi: giữ một kết nối database tối đa ~2 giây (hai deadline 1 giây).
    async acceptOffer({ offer_id: offerId }, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      const found = await ownOffer(offerId, accountId);
      const { requestId } = identity;
      let tripId;

      await bookings.transaction(async (tx) => {
        const booking = await tx.lockBooking(found.booking_id);
        const offer = await tx.lockOffer(offerId);
        checkPendingOffer(offer);
        if (booking.status !== 'SEARCHING') throw conflict('INVALID_STATUS_TRANSITION');

        // S3: Driver là nơi DUY NHẤT biết tài xế còn rảnh không (D8, B11).
        try {
          await services.reserveDriver({ driver_id: accountId, booking_id: booking.booking_id }, requestId);
        } catch (err) {
          // Tài xế đã tắt Online / bận → 409, Offer giữ PENDING đến hết hạn (DX-Q6 đã chốt).
          if (err?.statusName === 'FAILED_PRECONDITION' || err?.statusName === 'NOT_FOUND') throw conflict('DRIVER_NOT_AVAILABLE');
          // Lỗi khác / quá hạn: không biết đã giữ chưa → nhả "phòng khi" rồi 503; Offer vẫn chờ, bấm lại được (Q35).
          await releaseQuietly(accountId, booking.booking_id, requestId);
          throw unavailable();
        }

        // S5: tài xế cần NGAY mã chuyến để cập nhật trạng thái (B17). Bản chụp booking sang Trip.
        try {
          const trip = await services.createTrip({
            booking_id: booking.booking_id, customer_id: booking.customer_id, driver_id: accountId,
            vehicle_type: booking.vehicle_type, pickup_lat: booking.pickup_lat, pickup_lng: booking.pickup_lng,
            destination_lat: booking.destination_lat, destination_lng: booking.destination_lng,
            ...(booking.pickup_address !== null ? { pickup_address: booking.pickup_address } : {}),
            ...(booking.destination_address !== null ? { destination_address: booking.destination_address } : {}),
            payment_method: booking.payment_method, fare_amount: booking.fare_amount,
          }, requestId);
          tripId = trip.trip_id;
        } catch (err) {
          // Trip lỗi → nhả tài xế, rollback → 503; Offer vẫn chờ (Q35, AC-DX-21).
          log.warn('tạo chuyến lỗi', { booking_id: booking.booking_id, status: err?.statusName });
          await releaseQuietly(accountId, booking.booking_id, requestId);
          throw unavailable();
        }

        await tx.respondOffer(offerId, 'ACCEPTED');
        await tx.setBookingStatus(booking.booking_id, 'DRIVER_ASSIGNED');
        await tx.insertAssignment({ bookingId: booking.booking_id, offerId, driverId: accountId, tripId });
      }).catch((err) => {
        // Trip đã tạo mà commit booking lỗi: rủi ro đã chấp nhận (DX-Q4) — chỉ ghi log để xử lý tay.
        if (tripId !== undefined && !(err instanceof BookingError)) {
          log.error('ACCEPT_COMMIT_FAILED', { booking_id: found.booking_id, trip_id: tripId, code: err?.code });
        }
        throw err;
      });

      // Trip tự phát K5 ACCEPTED (Notification báo khách "tài xế đã nhận"); Booking không phát thêm.
      log.info('offer_accepted', { offer_id: offerId, booking_id: found.booking_id, driver_id: accountId, trip_id: tripId });
      return {
        offer_id: offerId, status: 'ACCEPTED', booking_id: found.booking_id, booking_status: 'DRIVER_ASSIGNED',
        trip_id: tripId, trip_status: 'ACCEPTED',
      };
    },

    // A25 — tài xế từ chối lời mời (FR08). Không hủy booking, không event, không báo Payment → không hoàn tiền
    // (BRULE15). Bộ ghép hỏi người kế tiếp ngay (chạy nền).
    async rejectOffer({ offer_id: offerId }, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      const found = await ownOffer(offerId, accountId);
      await bookings.transaction(async (tx) => {
        await tx.lockBooking(found.booking_id); // quy ước: khóa booking trước, Offer sau
        const offer = await tx.lockOffer(offerId);
        checkPendingOffer(offer);
        await tx.respondOffer(offerId, 'REJECTED');
      });
      log.info('offer_rejected', { offer_id: offerId, booking_id: found.booking_id, driver_id: accountId });
      dispatcher.schedule(found.booking_id, identity.requestId);
      return { offer_id: offerId, status: 'REJECTED' };
    },

    // Nghe K6 payment.status-changed (B16, B18). Chống lặp bằng chính trạng thái: chỉ đổi khi booking còn
    // PENDING_PAYMENT, event lặp thì không đổi gì (03 mục 11.3). Lỗi database → ném để Kafka giao lại.
    async onPaymentStatusChanged(envelope) {
      const data = envelope?.data;
      if (!data || !Number.isSafeInteger(data.booking_id)) {
        log.warn('bỏ qua event sai dạng', { topic: 'payment.status-changed', event_id: envelope?.event_id });
        return null;
      }
      if (data.status === 'COMPLETED') {
        // Trả trước thành công → bắt đầu tìm tài xế (BRULE13).
        const row = await bookings.markPaid(data.booking_id);
        if (!row) return null;
        log.info('booking_paid', { booking_id: data.booking_id, payment_id: data.payment_id });
        dispatcher.schedule(data.booking_id);
        return 'SEARCHING';
      }
      if (data.status === 'CANCELED' && SYSTEM_CANCEL_REASONS.includes(data.reason)) {
        // Quá hạn / hết lượt thanh toán → hệ thống hủy booking (BRULE17) → K4 để Notification báo khách.
        const row = await bookings.cancelBySystem(data.booking_id, data.reason);
        if (!row) return null;
        log.info('booking_canceled', { booking_id: data.booking_id, canceled_by: 'system', reason: data.reason });
        await publish(TOPIC_BOOKING_CANCELED, data.booking_id, {
          booking_id: data.booking_id, customer_id: row.customer_id, canceled_by: 'system',
          previous_status: 'PENDING_PAYMENT', pending_offer_driver_id: null, reason: data.reason,
        });
        return 'CANCELED';
      }
      // FAILED: booking vẫn chờ thanh toán lại (B16). REFUNDED, lý do khác: không liên quan bước chờ thanh toán.
      return null;
    },
  };
}
