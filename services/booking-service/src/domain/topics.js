// Topic Kafka booking-service phát (02 mục 6.2; spec 14-15-16-19-30 mục 6) và cách phát an toàn.
// Mỗi topic có lý do nghiệp vụ bắt buộc bất đồng bộ (CLAUDE.md):
//   K1 booking.created          → notification: Notification lỗi không được làm hỏng đặt xe (NFR05)
//   K2 booking.offer-created    → notification: bộ ghép chạy nền, không ai chờ
//   K3 booking.no-driver-found  → payment (hoàn tiền, spec 18), notification: nhiều bên cùng cần biết
//   K4 booking.canceled         → payment, notification: nhiều bên cùng cần biết
export const TOPIC_BOOKING_CREATED = 'booking.created';
export const TOPIC_OFFER_CREATED = 'booking.offer-created';
export const TOPIC_NO_DRIVER_FOUND = 'booking.no-driver-found';
export const TOPIC_BOOKING_CANCELED = 'booking.canceled';
// Topic booking NGHE: K6 kết quả thanh toán (payment phát).
export const TOPIC_PAYMENT_STATUS_CHANGED = 'payment.status-changed';

// Phát SAU KHI commit (ADR-017). Gửi lỗi KHÔNG hoàn tác việc đã ghi và không làm request thất bại
// (NFR05): chỉ ghi log EVENT_PUBLISH_FAILED để xử lý tay. Key = booking_id: mọi event của một booking vào cùng
// partition nên bên nghe nhận đúng thứ tự. Event chỉ mang mã và trạng thái — không tọa độ, địa chỉ (02 mục 6.1).
export function createSafePublisher({ events, log }) {
  return async function publish(topic, bookingId, data) {
    try {
      await events.publish(topic, String(bookingId), data);
    } catch (err) {
      log.error('EVENT_PUBLISH_FAILED', { topic, key: String(bookingId), reason: err?.name ?? 'Error' });
    }
  };
}
