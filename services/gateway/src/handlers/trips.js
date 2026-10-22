// Hàm xử lý A27–A29 — xem chuyến, tài xế tiến trạng thái, khách / tài xế hủy chuyến (spec 17-18 mục 4.1, 4.2).
// Không có logic nghiệp vụ: trình tự trạng thái, ai là chủ chuyến, khi nào còn hủy được… là việc của trip-service.
// Token, role, hình thức, chọn biến thể đã làm ở app.js / validate.js; message gRPC dựng sẵn ở `req.rpcRequest`.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { pick } from './pick.js';

// Hai nửa để khối `driver` nằm ngay sau `driver_id` như ví dụ response của spec 17-18 mục 4.2.
const TRIP_KEYS_HEAD = ['trip_id', 'booking_id', 'status', 'vehicle', 'pay', 'fare', 'customer_id', 'driver_id'];
const TRIP_KEYS_TAIL = [
  'from', 'to', 'from_address', 'to_address', 'started_at', 'ended_at', 'canceled_by', 'cancel_reason', 'created_at',
];
const history = (items) => (items ?? []).map((h) => pick(h, ['status', 'at']));
// Khối `driver` (spec 17-18 CD10, thêm 2026-10-21): tài xế của chuyến cho khách thấy ai tới đón (FR14). Lọc key như
// mọi chỗ khác để không lọt `_name`, `_plate` (oneof ẩn của field optional); không có thì không có key `driver`.
const driverView = (d) => (d ? { driver: pick(d, ['driver_id', 'name', 'plate']) } : {});

export function createTripHandlers({ tripClient }) {
  const forward = (method, build, toJson) => async (req, res) => {
    try {
      const response = await callUnary(tripClient, method, build(req), buildMetadata(req));
      res.status(200).json(toJson(response));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };
  // Mã trong đường dẫn gửi dạng chuỗi để số lớn không bị làm tròn trước khi tới service.
  const withId = (req) => ({ trip_id: req.params.id, ...req.rpcRequest });

  return {
    // A27: khách / tài xế của chuyến, admin.
    byId: forward('GetTrip', (req) => ({ trip_id: req.params.id }), (r) => ({
      ...pick(r, TRIP_KEYS_HEAD), ...driverView(r.driver), ...pick(r, TRIP_KEYS_TAIL), history: history(r.history),
    })),
    // A28: 200 kèm lịch sử để người chấm thấy đủ trình tự mà không phải gọi thêm request (mục 17).
    update: forward('UpdateTripStatus', withId, (r) => ({ ...pick(r, ['trip_id', 'status']), history: history(r.history) })),
    // A29: canceled_by lấy từ role trong token ở trip-service.
    cancel: forward('CancelTrip', withId, (r) => pick(r, ['trip_id', 'status', 'canceled_by', 'reason'])),
  };
}
