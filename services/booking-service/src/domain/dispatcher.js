// Bộ ghép tài xế chạy nền trong booking-service (UC06, UC07, UC09; spec 14-15-16-19-30 mục 2.2, 2.4, 5.6).
// Không có service ghép riêng (giảng viên chốt 8 service): ghép là một phần của context Booking.
//
// Mỗi vòng ghép (dispatch):
//   1. Hỏi driver-service (S2 FindNearbyDrivers) danh sách MỚI NHẤT: ONLINE, đúng loại xe, trong 1 km, gần nhất trước
//      (BRULE01–03). Lỗi → thử lại tối đa 3 lần cách 1 giây; vẫn lỗi → coi như không có tài xế (DX7 / Q24 đã chốt).
//   2. Trong một giao dịch, khóa booking; bỏ người đã được mời cho booking này (B6) và người đang có lời mời chờ
//      của booking khác (B10); mời người GẦN NHẤT còn lại (B4).
//   3. Không còn ai → NO_DRIVER_FOUND → K3 (Payment hoàn tiền ở spec 18, Notification báo khách).
// Kích hoạt: booking tiền mặt vừa tạo; K6 COMPLETED; tài xế từ chối; Offer hết hạn; khởi động lại (NFR15).
//
// Phụ thuộc truyền từ ngoài vào (kho dữ liệu, client gRPC, bộ phát event, log, đồng hồ chờ) để test không cần
// PostgreSQL, Kafka hay gRPC.
import { randomUUID } from 'node:crypto';
import { createSafePublisher, TOPIC_NO_DRIVER_FOUND, TOPIC_OFFER_CREATED } from './topics.js';
import { iso } from './rules.js';

// Hằng số trong code (03 mục 13): S2 thử 3 lần, cách 1 giây; mỗi vòng hỏi tối đa 50 ứng viên (DX3).
export const FIND_ATTEMPTS = 3;
export const FIND_RETRY_DELAY_MS = 1000;
export const CANDIDATE_LIMIT = 50;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultDefer = (fn) => setImmediate(fn);

export function createDispatcher({ bookings, services, events, log, config, sleep = defaultSleep, defer = defaultDefer }) {
  const publish = createSafePublisher({ events, log });

  // S2 có thử lại. Trả danh sách ứng viên, hoặc null nếu cả 3 lần đều lỗi.
  async function findCandidates(booking, requestId) {
    for (let attempt = 1; attempt <= FIND_ATTEMPTS; attempt += 1) {
      try {
        const res = await services.findNearbyDrivers({
          lat: booking.pickup_lat, lng: booking.pickup_lng, vehicle: booking.vehicle_type, page: 1, limit: CANDIDATE_LIMIT,
        }, requestId);
        return res.data ?? [];
      } catch (err) {
        log.warn('tìm tài xế lỗi, thử lại', { booking_id: booking.booking_id, attempt, status: err?.statusName });
        if (attempt < FIND_ATTEMPTS) await sleep(FIND_RETRY_DELAY_MS);
      }
    }
    return null;
  }

  // Một vòng ghép cho một booking. Gọi lặp / gọi song song đều an toàn: giao dịch kiểm lại trạng thái
  // và "đã có Offer chờ chưa" sau khi khóa booking.
  async function dispatch(bookingId, requestId = randomUUID()) {
    const booking = await bookings.findBooking(bookingId);
    if (!booking || booking.status !== 'SEARCHING') return null;
    const candidates = (await findCandidates(booking, requestId)) ?? [];

    const outcome = await bookings.transaction(async (tx) => {
      const locked = await tx.lockBooking(bookingId);
      // Trong lúc hỏi driver, booking có thể đã bị hủy / đã có người nhận / vòng ghép khác đã mời ai đó.
      if (!locked || locked.status !== 'SEARCHING') return null;
      if (await tx.hasPendingOffer(bookingId)) return null;
      const excluded = new Set(await tx.excludedDrivers(bookingId));
      for (const candidate of candidates) {
        if (excluded.has(candidate.driver_id)) continue;
        const offer = await tx.insertOffer({
          bookingId, driverId: candidate.driver_id, distanceM: candidate.distance_m, timeoutSeconds: config.offerTimeoutSeconds,
        });
        // null = tài xế vừa được booking khác mời cùng lúc (UNIQUE B10) → thử người kế tiếp.
        if (offer) return { type: 'offer', offer };
      }
      await tx.setBookingStatus(bookingId, 'NO_DRIVER_FOUND');
      return { type: 'none', customerId: locked.customer_id, tried: await tx.countOffers(bookingId) };
    });

    if (!outcome) return null;
    if (outcome.type === 'offer') {
      const { offer } = outcome;
      log.info('offer_created', { offer_id: offer.offer_id, booking_id: bookingId, driver_id: offer.driver_id });
      await publish(TOPIC_OFFER_CREATED, bookingId, {
        offer_id: offer.offer_id, booking_id: bookingId, driver_id: offer.driver_id, expires_at: iso(offer.expires_at),
      });
    } else {
      log.info('no_driver_found', { booking_id: bookingId, offers_tried: outcome.tried });
      await publish(TOPIC_NO_DRIVER_FOUND, bookingId, {
        booking_id: bookingId, customer_id: outcome.customerId, offers_tried: outcome.tried,
      });
    }
    return outcome;
  }

  // Chạy một vòng ghép NỀN: người gọi (khách đặt xe, tài xế từ chối) không phải chờ (B2).
  function schedule(bookingId, requestId) {
    defer(() => {
      dispatch(bookingId, requestId).catch((err) => log.error('ghép tài xế lỗi', { booking_id: bookingId, name: err?.name, code: err?.code }));
    });
  }

  return {
    dispatch,
    schedule,

    // Tiến trình nền mỗi giây (FR09, BRULE06): Offer quá hạn → EXPIRED → nhả tài xế (phòng khi nhận dở dang —
    // DX5) → hỏi người kế tiếp. Không event, không báo Payment: không hoàn tiền (BRULE15).
    async expireOffers() {
      const due = await bookings.findDueOffers();
      for (const offer of due) {
        // Khóa booking trước (quy ước khóa): nếu tài xế đang nhận đúng lúc này thì chờ; nhận xong Offer đã ACCEPTED
        // nên lệnh dưới không khớp, không nhả nhầm.
        const expired = await bookings.transaction(async (tx) => {
          await tx.lockBooking(offer.booking_id);
          return tx.respondOffer(offer.offer_id, 'EXPIRED');
        });
        if (!expired) continue;
        log.info('offer_expired', { offer_id: offer.offer_id, booking_id: offer.booking_id, driver_id: offer.driver_id });
        const requestId = randomUUID();
        try {
          await services.releaseDriver({ driver_id: offer.driver_id, booking_id: offer.booking_id }, requestId);
        } catch (err) {
          log.warn('nhả tài xế lỗi', { driver_id: offer.driver_id, booking_id: offer.booking_id, status: err?.statusName });
        }
        schedule(offer.booking_id, requestId);
      }
      return due.length;
    },

    // Khởi động lại (NFR15): mọi booking SEARCHING chưa có Offer chờ được ghép tiếp.
    async resume() {
      const ids = await bookings.findSearchingWithoutOffer();
      for (const id of ids) schedule(id);
      if (ids.length > 0) log.info('ghép tiếp sau khởi động', { bookings: ids.length });
      return ids.length;
    },
  };
}
