// Logic nghiệp vụ của Trip. Spec 14-15-16-19-30 chỉ có CreateTrip (S5, mục 5.3); cập nhật trạng thái,
// hủy chuyến ở spec 17, 18. Mọi phụ thuộc (kho dữ liệu, bộ phát event, log) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL, Kafka hay gRPC.
import { ADDRESS_MAX, checkId, checkLat, checkLng, invalid, isPresent, PAYMENT_METHODS, requireSystem, TripError } from './rules.js';

export const TOPIC_TRIP_STATUS_CHANGED = 'trip.status-changed'; // K5

export function createTripLogic({ trips, events, log }) {
  // Phát K5 SAU KHI commit (ADR-017). Gửi lỗi thì KHÔNG hoàn tác chuyến và vẫn trả thành công:
  // tài xế đã nhận chuyến thì chuyến phải tồn tại dù Kafka / Notification lỗi (NFR05). Chỉ ghi log.
  // Event chỉ mang mã và trạng thái — không tọa độ, địa chỉ (02 mục 6.1).
  async function publishStatusChanged(trip) {
    const data = {
      trip_id: trip.trip_id,
      booking_id: trip.booking_id,
      customer_id: trip.customer_id,
      driver_id: trip.driver_id,
      status: 'ACCEPTED',
      previous_status: null,
    };
    try {
      await events.publish(TOPIC_TRIP_STATUS_CHANGED, String(trip.trip_id), data);
    } catch (err) {
      log.error('EVENT_PUBLISH_FAILED', { topic: TOPIC_TRIP_STATUS_CHANGED, key: String(trip.trip_id), reason: err?.name ?? 'Error' });
    }
  }

  return {
    // S5 CreateTrip: booking-service gọi khi tài xế nhận chuyến (UC08). Chuyến ra đời ở ACCEPTED.
    // Gọi lặp an toàn (T1): booking có thể gọi lại sau khi lần trước quá hạn ở phía nó (Q35).
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
        await publishStatusChanged(inserted);
        return { trip_id: inserted.trip_id, status: inserted.status, created: true };
      }

      // Đã có Trip cho booking này: cùng tài xế → lần gọi lặp, trả Trip cũ, KHÔNG phát lại K5 (T1).
      const existing = await trips.findByBooking(snapshot.bookingId);
      if (!existing) throw new TripError('INTERNAL', 'INTERNAL'); // vừa xung đột mà không đọc được: lỗi bất thường
      if (existing.driver_id !== snapshot.driverId) throw new TripError('FAILED_PRECONDITION', 'BOOKING_ALREADY_ASSIGNED');
      return { trip_id: existing.trip_id, status: existing.status, created: false };
    },
  };
}
