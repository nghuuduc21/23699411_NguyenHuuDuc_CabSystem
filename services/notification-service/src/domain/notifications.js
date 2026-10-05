// Logic nghiệp vụ của Notification (spec 17-18 mục 2.7, 4.4, 5.4; N1–N5). Mục chấm 16, 18 (các bên được báo).
//
// Notification KHÔNG quyết định nghiệp vụ: chỉ đổi mỗi event Kafka (K1–K7) thành 0–2 thông báo theo một BẢNG cố
// định, lưu vào MongoDB và ghi log một dòng (giả lập kênh gửi — ADR-014). Vì sao nghe Kafka chứ không để service khác
// gọi gRPC sang: đặt xe, nhận chuyến, hủy chuyến… không bao giờ được chờ hay lỗi theo Notification (NFR05).
//
// `toNotifications(envelope)` là hàm THUẦN (không database, không Kafka) để test cả 15 loại thông báo không cần MongoDB.
// Phụ thuộc của phần còn lại (kho dữ liệu, log) truyền từ ngoài vào.

export class NotificationError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind; // trùng tên gRPC status để tầng gRPC đổi một-một
    this.code = code;
  }
}

const invalid = (code = 'INVALID_INPUT') => new NotificationError('INVALID_ARGUMENT', code);
const isId = (value) => Number.isSafeInteger(value) && value > 0;

// Trả 0–2 bản ghi thông báo { recipient_id, type, title, body, data } cho một event. Event sai dạng / thiếu mã /
// không có trong bảng → [] (bên gọi ghi log `warn` rồi bỏ qua: giao lại bao nhiêu lần cũng vẫn sai).
// `body` chỉ chứa mã, trạng thái, số tiền — KHÔNG họ tên, số điện thoại, địa chỉ, lý do hủy.
function rowsFor(topic, d) {
  switch (topic) {
    case 'booking.created': // K1 — FR21
      if (!isId(d.booking_id) || !isId(d.customer_id)) return null;
      return [{ recipient_id: d.customer_id, type: 'BOOKING_CREATED', title: 'Đã nhận yêu cầu đặt xe',
        body: `Booking ${d.booking_id} đã được tiếp nhận`, data: { booking_id: d.booking_id, status: d.status } }];

    case 'booking.offer-created': // K2 — FR06: báo tài xế được mời
      if (!isId(d.offer_id) || !isId(d.booking_id) || !isId(d.driver_id)) return null;
      return [{ recipient_id: d.driver_id, type: 'OFFER_CREATED', title: 'Có lời mời nhận chuyến',
        body: `Lời mời ${d.offer_id} cho booking ${d.booking_id}`, data: { offer_id: d.offer_id, booking_id: d.booking_id } }];

    case 'booking.no-driver-found': // K3 — FR10
      if (!isId(d.booking_id) || !isId(d.customer_id)) return null;
      return [{ recipient_id: d.customer_id, type: 'NO_DRIVER_FOUND', title: 'Không tìm được tài xế',
        body: `Booking ${d.booking_id} không có tài xế phù hợp. Nếu đã thanh toán, bạn được hoàn đủ`, data: { booking_id: d.booking_id } }];

    case 'booking.canceled': { // K4 — FR36; báo cả tài xế đang có lời mời chờ (CD13)
      if (!isId(d.booking_id) || !isId(d.customer_id)) return null;
      const rows = [{ recipient_id: d.customer_id, type: 'BOOKING_CANCELED', title: 'Booking đã hủy',
        body: `Booking ${d.booking_id} đã hủy`, data: { booking_id: d.booking_id, status: 'CANCELED' } }];
      if (isId(d.pending_offer_driver_id)) {
        rows.push({ recipient_id: d.pending_offer_driver_id, type: 'OFFER_VOIDED', title: 'Lời mời không còn hiệu lực',
          body: `Booking ${d.booking_id} đã bị khách hủy`, data: { booking_id: d.booking_id } });
      }
      return rows;
    }

    case 'trip.status-changed': { // K5 — FR22, FR23, BR10
      if (!isId(d.trip_id) || !isId(d.booking_id) || !isId(d.customer_id) || !isId(d.driver_id)) return null;
      const data = { trip_id: d.trip_id, booking_id: d.booking_id, driver_id: d.driver_id, status: d.status };
      const toCustomer = (type, title, body) => [{ recipient_id: d.customer_id, type, title, body, data }];
      if (d.status === 'ACCEPTED') return toCustomer('TRIP_ACCEPTED', 'Tài xế đã nhận chuyến', `Tài xế ${d.driver_id} đã nhận chuyến ${d.trip_id}`);
      if (d.status === 'ARRIVED') return toCustomer('TRIP_ARRIVED', 'Tài xế đã đến điểm đón', `Chuyến ${d.trip_id}`);
      if (d.status === 'COMPLETED') return toCustomer('TRIP_COMPLETED', 'Chuyến đi hoàn thành', `Chuyến ${d.trip_id} đã hoàn thành`);
      if (d.status === 'CANCELED') {
        // CD9 / CD-Q3: báo CẢ khách và tài xế (kể cả người hủy) — mục 18 khách thấy ngay, "các bên được báo".
        const who = d.canceled_by === 'driver' ? 'tài xế' : 'khách hàng';
        const one = { type: 'TRIP_CANCELED', title: 'Chuyến đi đã hủy', body: `Chuyến ${d.trip_id} đã bị ${who} hủy`, data };
        return [{ recipient_id: d.customer_id, ...one }, { recipient_id: d.driver_id, ...one }];
      }
      // PICKED_UP, IN_PROGRESS: BR10 không liệt kê → không tạo (CD8). Không phải event sai dạng.
      return ['PICKED_UP', 'IN_PROGRESS'].includes(d.status) ? [] : null;
    }

    case 'payment.status-changed': { // K6 — FR17, FR19, FR24, FR40, BRULE17
      if (!isId(d.payment_id) || !isId(d.booking_id) || !isId(d.customer_id) || !Number.isInteger(d.amount)) return null;
      const data = { payment_id: d.payment_id, booking_id: d.booking_id, amount: d.amount, status: d.status };
      const row = (type, title, body) => [{ recipient_id: d.customer_id, type, title, body, data }];
      if (d.status === 'COMPLETED') return row('PAYMENT_COMPLETED', 'Thanh toán thành công', `Thanh toán ${d.payment_id}: ${d.amount} đ`);
      if (d.status === 'FAILED') return row('PAYMENT_FAILED', 'Thanh toán thất bại', `Thanh toán ${d.payment_id} thất bại, bạn có thể thử lại`);
      if (d.status === 'CANCELED') {
        const why = { PAYMENT_EXPIRED: 'quá hạn', ATTEMPTS_EXHAUSTED: 'hết lượt thử' }[d.reason] ?? 'đã hủy';
        return row('PAYMENT_CANCELED', 'Thanh toán đã hủy', `Thanh toán ${d.payment_id} ${why}`);
      }
      if (d.status === 'REFUNDED') return row('PAYMENT_REFUNDED', 'Đã hoàn tiền', `Đã hoàn ${d.amount} đ cho thanh toán ${d.payment_id}`);
      return null;
    }

    case 'driver.application-reviewed': { // K7 — FR39, AC20
      if (!isId(d.driver_id)) return null;
      const data = { driver_id: d.driver_id, status: d.result };
      if (d.result === 'APPROVED') {
        return [{ recipient_id: d.driver_id, type: 'APPLICATION_APPROVED', title: 'Hồ sơ tài xế đã được duyệt', body: `Hồ sơ tài xế ${d.driver_id}`, data }];
      }
      if (d.result === 'REJECTED') {
        return [{ recipient_id: d.driver_id, type: 'APPLICATION_REJECTED', title: 'Hồ sơ tài xế bị từ chối', body: `Hồ sơ tài xế ${d.driver_id}`, data }];
      }
      return null;
    }

    default:
      return null;
  }
}

// Bỏ key không có giá trị khỏi `data` (ví dụ K1 thiếu status): chỉ lưu đúng các key của NotificationData.
function compact(data) {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null));
}

// Phong bì event (02 mục 6.1) → danh sách thông báo cần lưu, hoặc null nếu event sai dạng.
// `created_at` = `occurred_at` của event — lúc sự việc xảy ra (CD6): Notification dừng rồi đọc bù vẫn đúng thứ tự.
export function toNotifications(envelope, { now = () => new Date() } = {}) {
  if (!envelope || typeof envelope !== 'object') return null;
  const { event_id: eventId, event_type: topic, occurred_at: occurredAt, data } = envelope;
  if (typeof eventId !== 'string' || eventId === '' || !data || typeof data !== 'object') return null;
  const rows = rowsFor(topic, data);
  if (rows === null) return null;
  const at = new Date(occurredAt);
  const createdAt = typeof occurredAt === 'string' && !Number.isNaN(at.getTime()) ? at : now();
  return rows.map((row) => ({ event_id: eventId, ...row, data: compact(row.data), created_at: createdAt }));
}

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];
export const PAGE_MAX = 999_999;
export const LIMIT_MAX = 50;

export function createNotificationLogic({ notifications, log }) {
  return {
    // Consumer K1–K7. Chống trùng (N4): kho dữ liệu ghi bằng upsert theo UNIQUE (event_id, recipient_id) → event lặp
    // (Kafka giao lại, đọc lại từ đầu) không tạo thêm. MongoDB lỗi → ném để Kafka giao lại, không mất thông báo (N1).
    async onEvent(topic, envelope) {
      const docs = toNotifications(envelope);
      if (docs === null) {
        log.warn('bỏ qua event sai dạng', { topic, event_id: envelope?.event_id });
        return 0;
      }
      let created = 0;
      for (const doc of docs) {
        if (await notifications.insertOnce(doc)) {
          created += 1;
          // Giả lập "gửi": một dòng log. KHÔNG ghi title, body (NFR08).
          log.info('notification_created', { type: doc.type, recipient_id: doc.recipient_id, event_id: doc.event_id });
        }
      }
      return created;
    },

    // A33 — thông báo của CHÍNH người trong token (N2), mới nhất trước. Không có tham số "của ai": lọc theo
    // x-account-id nên không xem được thông báo người khác dù đổi gì trong request.
    async listNotifications({ page, limit }, identity) {
      const { accountId, role } = identity ?? {};
      if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
        throw new NotificationError('UNAUTHENTICATED', 'IDENTITY_MISSING');
      }
      if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) throw invalid('INVALID_PAGINATION');
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw invalid('INVALID_PAGINATION');
      const { rows, total } = await notifications.listByRecipient(Number(accountId), { skip: (page - 1) * limit, limit });
      return {
        // Không trả _id, event_id, recipient_id (CD14): không API nào theo mã thông báo.
        data: rows.map((n) => ({ type: n.type, title: n.title, body: n.body, data: n.data ?? {}, created_at: new Date(n.created_at).toISOString() })),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      };
    },
  };
}
