// Logic nghiệp vụ của Trip: tạo chuyến (S5 CreateTrip — spec 14-15-16-19-30 mục 5.3), xem chuyến (A27), tài xế
// tiến trạng thái đúng trình tự (A28, mục 17), khách / tài xế hủy chuyến trước khi đón (A29, mục 18) — spec 17-18.
// Mọi phụ thuộc (kho dữ liệu, bộ phát event, log) truyền từ ngoài vào nên test chạy được không cần PostgreSQL,
// Kafka hay gRPC. `identity` = { accountId, role } lấy từ metadata do Gateway (hoặc booking) gửi.
//
// Trip KHÔNG gọi Payment, Driver hay Booking (spec 17-18 mục 6): kết thúc / hủy chuyến chỉ phát K5 lên Kafka; ai cần
// (Driver trả tài xế về rảnh, Payment ghi nhận tiền mặt / hoàn tiền, Notification báo tin) tự nghe. Nhờ vậy tài xế
// bấm "hoàn thành" không bao giờ lỗi chỉ vì một trong ba service kia đang dừng (NFR05).
import {
  ADDRESS_MAX, CANCELABLE, checkDriverName, checkId, checkPlate, checkLat, checkLng, checkReason, checkTripId, conflict, DRIVER_STEPS, invalid,
  isPresent, NEXT, PAYMENT_METHODS, requireRole, requireSystem, TripError,
} from './rules.js';

export const TOPIC_TRIP_STATUS_CHANGED = 'trip.status-changed'; // K5

const tripNotFound = () => new TripError('NOT_FOUND', 'TRIP_NOT_FOUND');
const notOwner = () => new TripError('PERMISSION_DENIED', 'NOT_OWNER');
const iso = (value) => new Date(value).toISOString();
const historyView = (rows) => rows.map((h) => ({ status: h.to_status, at: iso(h.changed_at) }));

// Kiểm quyền sở hữu theo role (T3, T5, T7). Mã số dễ đoán (`/trips/5` → `/trips/6`) nên MỌI API theo mã phải kiểm.
function checkOwner(trip, { accountId, role }) {
  if (role === 'customer' && trip.customer_id !== accountId) throw notOwner();
  if (role === 'driver' && trip.driver_id !== accountId) throw notOwner();
}

export function createTripLogic({ trips, events, log }) {
  // Phát K5 SAU KHI commit (ADR-017). Gửi lỗi thì KHÔNG hoàn tác và vẫn trả thành công: việc ngoài đời đã xảy ra
  // (tài xế đã nhận / đã đón / đã trả khách) thì chuyến phải ghi nhận dù Kafka lỗi (NFR05). Chỉ ghi log để xử lý tay.
  // Event chỉ mang mã và trạng thái — KHÔNG tọa độ, địa chỉ, lý do hủy (lý do là văn bản người dùng gõ — 02 mục 6.1).
  // Key = trip_id: mọi event của một chuyến vào cùng partition nên bên nghe nhận đúng thứ tự.
  async function publishStatusChanged(trip, status, previousStatus, canceledBy) {
    const data = {
      trip_id: trip.trip_id,
      booking_id: trip.booking_id,
      customer_id: trip.customer_id,
      driver_id: trip.driver_id,
      status,
      previous_status: previousStatus,
    };
    if (canceledBy) data.canceled_by = canceledBy;
    try {
      await events.publish(TOPIC_TRIP_STATUS_CHANGED, String(trip.trip_id), data);
    } catch (err) {
      log.error('EVENT_PUBLISH_FAILED', { topic: TOPIC_TRIP_STATUS_CHANGED, key: String(trip.trip_id), reason: err?.name ?? 'Error' });
    }
  }

  return {
    // S5 CreateTrip: booking-service gọi khi tài xế nhận chuyến (UC08). Chuyến ra đời ở ACCEPTED.
    // Gọi lặp an toàn (T1): booking có thể gọi lại sau khi lần trước quá hạn / UNAVAILABLE ở phía nó (Q35, L1).
    async createTrip(req, identity) {
      requireSystem(identity);
      const snapshot = {
        bookingId: checkId(req.booking_id),
        customerId: checkId(req.customer_id),
        driverId: checkId(req.driver_id),
        vehicleType: typeof req.vehicle_type === 'string' && req.vehicle_type.trim() !== '' ? req.vehicle_type.trim() : null,
        pickupLat: checkLat(req.pickup_lat),
        pickupLng: checkLng(req.pickup_lng),
        destinationLat: checkLat(req.destination_lat),
        destinationLng: checkLng(req.destination_lng),
        pickupAddress: isPresent(req.pickup_address) ? req.pickup_address : null,
        destinationAddress: isPresent(req.destination_address) ? req.destination_address : null,
        paymentMethod: req.payment_method,
        fareAmount: req.fare_amount,
        // Bản chụp họ tên, biển số tài xế lúc nhận (CD10, DX25): booking chép từ kết quả ReserveDriver.
        // Thiếu / rỗng → INVALID_INPUT, để chuyến mới LUÔN có giá trị cho khối `driver` ở A27.
        driverName: checkDriverName(req.driver_name),
        driverPlate: checkPlate(req.driver_plate),
      };
      if (snapshot.vehicleType === null) throw invalid();
      if (!PAYMENT_METHODS.includes(snapshot.paymentMethod)) throw invalid();
      if (!Number.isInteger(snapshot.fareAmount) || snapshot.fareAmount <= 0) throw invalid();
      for (const address of [snapshot.pickupAddress, snapshot.destinationAddress]) {
        if (address !== null && (typeof address !== 'string' || [...address].length > ADDRESS_MAX)) throw invalid();
      }

      // Một giao dịch: INSERT … ON CONFLICT (booking_id) DO NOTHING + dòng lịch sử đầu tiên.
      const inserted = await trips.insertAccepted(snapshot);
      if (inserted) {
        log.info('trip_created', { trip_id: inserted.trip_id, booking_id: inserted.booking_id });
        await publishStatusChanged(inserted, 'ACCEPTED', null);
        return { trip_id: inserted.trip_id, status: inserted.status, created: true };
      }

      // Đã có Trip cho booking này: cùng tài xế → lần gọi lặp, trả Trip cũ, KHÔNG phát lại K5 (T1).
      const existing = await trips.findByBooking(snapshot.bookingId);
      if (!existing) throw new TripError('INTERNAL', 'INTERNAL'); // vừa xung đột mà không đọc được: lỗi bất thường
      if (existing.driver_id !== snapshot.driverId) throw new TripError('FAILED_PRECONDITION', 'BOOKING_ALREADY_ASSIGNED');
      return { trip_id: existing.trip_id, status: existing.status, created: false };
    },

    // S7 GetTripForRating (spec 20-29 mục 5.2): rating-service hỏi trước khi nhận đánh giá; chỉ nhận `x-role: system`.
    // Trip CHỈ BÁO SỰ THẬT (trạng thái, khách, tài xế); không kiểm chủ, không quyết định "được đánh giá không" —
    // quy tắc V1 (đã COMPLETED), V2 (đúng khách) thuộc Rating (01 mục 6.8). Chỉ đọc, không phát event.
    async getTripForRating({ trip_id: tripId }, identity) {
      requireSystem(identity);
      if (!Number.isSafeInteger(tripId) || tripId < 1) throw invalid();
      const trip = await trips.findForRating(tripId);
      if (!trip) throw tripNotFound();
      return { trip_id: trip.trip_id, status: trip.status, customer_id: trip.customer_id, driver_id: trip.driver_id };
    },

    // A27 — xem chuyến (UC10). Khách / tài xế CỦA CHUYẾN, hoặc admin (T7). Chỉ đọc.
    async getTrip({ trip_id: tripId }, identity) {
      const who = requireRole(identity, ['customer', 'driver', 'admin']);
      checkTripId(tripId);
      const trip = await trips.findTripView(tripId);
      if (!trip) throw tripNotFound();
      checkOwner(trip, who);
      const out = {
        trip_id: trip.trip_id,
        booking_id: trip.booking_id,
        status: trip.status,
        vehicle: trip.vehicle_type,
        pay: trip.payment_method,
        fare: trip.fare_amount,
        customer_id: trip.customer_id,
        driver_id: trip.driver_id,
        from: [trip.pickup_lat, trip.pickup_lng],
        to: [trip.destination_lat, trip.destination_lng],
        created_at: iso(trip.created_at),
        history: historyView(trip.history),
      };
      // Field không có giá trị thì không có key (proto `optional`).
      if (trip.pickup_address !== null) out.from_address = trip.pickup_address;
      if (trip.destination_address !== null) out.to_address = trip.destination_address;
      if (trip.started_at !== null) out.started_at = iso(trip.started_at);
      if (trip.ended_at !== null) out.ended_at = iso(trip.ended_at);
      if (trip.canceled_by !== null) out.canceled_by = trip.canceled_by;
      if (trip.cancel_reason !== null) out.cancel_reason = trip.cancel_reason;
      // Tài xế của chuyến (FR14): bản chụp lúc nhận, cùng nội dung cho khách, tài xế, admin. Không gọi Driver (CD10).
      // Chuyến tạo trước migration 002 không có tên / biển số → khối chỉ có driver_id (NULL thì không có key).
      out.driver = { driver_id: trip.driver_id };
      if (trip.driver_name != null) out.driver.name = trip.driver_name;
      if (trip.driver_plate != null) out.driver.plate = trip.driver_plate;
      return out;
    },

    // A28 — tài xế của chuyến tiến trạng thái (UC11, mục 17). Chỉ ĐÚNG bước kế tiếp (T2):
    // ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED. Nhảy cóc, lùi, gửi lại trạng thái đang có, chuyến đã
    // kết thúc → 409 INVALID_STATUS_TRANSITION (CD1: một quy tắc, không cần chống lặp riêng).
    async updateTripStatus({ trip_id: tripId, status: rawStatus }, identity) {
      const who = requireRole(identity, ['driver']);
      checkTripId(tripId);
      const status = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
      if (!DRIVER_STEPS.includes(status)) throw invalid();

      // Một giao dịch: khóa dòng chuyến (FOR UPDATE) → hai lần bấm cùng lúc xếp hàng, lần sau thấy trạng thái mới
      // → 409. Cập nhật chuyến + một dòng lịch sử (T4) cùng thành công hoặc cùng không.
      const result = await trips.transaction(async (tx) => {
        const trip = await tx.lockTrip(tripId);
        if (!trip) throw tripNotFound();
        checkOwner(trip, who);
        if (NEXT[trip.status] !== status) throw conflict('INVALID_STATUS_TRANSITION');
        await tx.setStatus(tripId, status);
        await tx.insertHistory({ tripId, from: trip.status, to: status, changedBy: who.accountId, role: 'driver', reason: null });
        return { trip, previous: trip.status, history: await tx.listHistory(tripId) };
      });

      log.info('trip_status_changed', { trip_id: tripId, from: result.previous, to: status });
      await publishStatusChanged(result.trip, status, result.previous);
      return { trip_id: tripId, status, history: historyView(result.history) };
    },

    // A29 — khách (UC27) hoặc tài xế (UC32, FR41) CỦA CHUYẾN hủy, kèm lý do. Chỉ trước khi đón khách (BRULE16, T5).
    // Hệ thống KHÔNG tìm tài xế khác (T6): khách được hoàn tiền (Payment nghe K5) và đặt lại.
    // Admin không hủy chuyến trong phạm vi 30 mục (CD-Q7) → Gateway chặn 403, service cũng chặn.
    async cancelTrip({ trip_id: tripId, reason: rawReason }, identity) {
      const who = requireRole(identity, ['customer', 'driver']);
      checkTripId(tripId);
      const reason = checkReason(rawReason);

      const result = await trips.transaction(async (tx) => {
        const trip = await tx.lockTrip(tripId);
        if (!trip) throw tripNotFound();
        checkOwner(trip, who);
        if (!CANCELABLE.includes(trip.status)) throw conflict('TRIP_NOT_CANCELABLE');
        await tx.cancel(tripId, who.role, reason);
        await tx.insertHistory({ tripId, from: trip.status, to: 'CANCELED', changedBy: who.accountId, role: who.role, reason });
        return { trip, previous: trip.status };
      });

      // Không ghi lý do vào log (văn bản người dùng có thể chứa thông tin cá nhân — NFR08).
      log.info('trip_canceled', { trip_id: tripId, canceled_by: who.role });
      await publishStatusChanged(result.trip, 'CANCELED', result.previous, who.role);
      return { trip_id: tripId, status: 'CANCELED', canceled_by: who.role, reason };
    },
  };
}
