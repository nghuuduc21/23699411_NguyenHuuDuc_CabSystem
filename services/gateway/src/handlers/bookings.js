// Hàm xử lý A19–A25 — đặt xe, lời mời (spec 14-15-16-19-30 mục 4.2–4.6), hủy booking A22 (spec 17-18 mục 4.3).
// Không có logic nghiệp vụ: chỉ đổi REST ↔ gRPC. Tính quãng đường, ai được mời, khi nào nhận được… là việc
// của booking-service. Token, role, hình thức, chọn biến thể đã làm ở app.js / validate.js; message gRPC đã
// dựng sẵn ở `req.rpcRequest`.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { pick, toList } from './pick.js';

const CREATED_KEYS = ['booking_id', 'status', 'vehicle', 'pay', 'distance_m', 'fare', 'payment_id', 'payment_expires_at'];
const BOOKING_KEYS = [...CREATED_KEYS, 'from', 'to', 'from_address', 'to_address', 'driver_id', 'trip_id', 'canceled_by', 'cancel_reason', 'created_at'];
const LIST_KEYS = ['booking_id', 'status', 'vehicle', 'pay', 'fare', 'created_at'];
const OFFER_KEYS = ['offer_id', 'booking_id', 'distance_m', 'status', 'expires_at', 'from', 'to', 'pay', 'fare'];

export function createBookingHandlers({ bookingClient }) {
  // Gọi rpc với request do `build` dựng; đổi response bằng `toJson`; lỗi gRPC → HTTP theo bảng chung.
  const forward = (method, build, toJson, okStatus = 200) => async (req, res) => {
    try {
      const response = await callUnary(bookingClient, method, build(req), buildMetadata(req));
      res.status(okStatus).json(toJson(response));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };
  const prepared = (req) => req.rpcRequest;
  // Mã trong đường dẫn gửi dạng chuỗi để số lớn không bị làm tròn trước khi tới service.

  return {
    // A19: 201 vì tạo mới một booking. Mã khách lấy từ token ở service, không nằm trong message.
    create: forward('CreateBooking', prepared, (r) => pick(r, CREATED_KEYS), 201),
    // A20: booking theo mã khách trong đường dẫn (service kiểm khách chỉ xem mã của mình).
    list: forward('ListBookings', prepared, toList(LIST_KEYS)),
    // A21: chủ hoặc admin (service kiểm quyền sở hữu → 403 NOT_OWNER).
    byId: forward('GetBooking', (req) => ({ booking_id: req.params.id }), (r) => pick(r, BOOKING_KEYS)),
    // A23: lời mời của chính tài xế.
    offers: forward('ListOffers', prepared, toList(OFFER_KEYS)),
    // A24 / A25: hai biến thể của PATCH /api/v1/offers/{id}.
    accept: forward('AcceptOffer', (req) => ({ offer_id: req.params.id }),
      (r) => pick(r, ['offer_id', 'status', 'booking_id', 'booking_status', 'trip_id', 'trip_status'])),
    reject: forward('RejectOffer', (req) => ({ offer_id: req.params.id }), (r) => pick(r, ['offer_id', 'status'])),
    // A22: khách hủy booking chưa có tài xế. Không cần payment-service chạy: hoàn / hủy bỏ đi bằng K4 (NFR05).
    cancel: forward('CancelBooking', (req) => ({ booking_id: req.params.id, ...req.rpcRequest }),
      (r) => pick(r, ['booking_id', 'status', 'canceled_by'])),
  };
}
