// Hàm xử lý A34–A36 — đánh giá chuyến, xem đánh giá của chuyến, điểm tài xế (spec 20-29 mục 4.1, 4.2; mục chấm 20).
// Không có logic nghiệp vụ: chuyến đã hoàn thành chưa, ai là khách của chuyến, đã đánh giá chưa… là việc của
// rating-service. Token, role, hình thức, chọn biến thể đã làm ở app.js / validate.js; message gRPC ở `req.rpcRequest`.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { pick } from './pick.js';

export function createRatingHandlers({ ratingClient }) {
  const forward = (method, okStatus, toJson) => async (req, res) => {
    try {
      const response = await callUnary(ratingClient, method, req.rpcRequest, buildMetadata(req));
      res.status(okStatus).json(toJson(response));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };

  return {
    // A34: 201 vì tạo mới một đánh giá; trả luôn điểm trung bình mới của tài xế để khỏi gọi thêm request.
    create: forward('CreateRating', 201, (r) => pick(r, ['rating_id', 'trip_id', 'driver_id', 'score', 'comment', 'driver_avg', 'driver_count'])),
    // A35: khách / tài xế của chuyến, admin (service kiểm).
    byTrip: forward('GetRatingByTrip', 200, (r) => pick(r, ['rating_id', 'trip_id', 'driver_id', 'score', 'comment', 'created_at'])),
    // A36: luôn ghi `count` (kể cả 0); `avg` chỉ có khi đã có đánh giá.
    driver: forward('GetDriverRating', 200, (r) => ({ ...pick(r, ['driver_id', 'avg']), count: r.count ?? 0 })),
  };
}
