// Logic nghiệp vụ của Rating (spec 20-29 mục 2, 5.3; mục chấm 20): khách đánh giá chuyến (A34), xem đánh giá của một
// chuyến (A35), xem điểm tài xế (A36). Mọi phụ thuộc (kho dữ liệu, client gọi Trip, log) truyền từ ngoài vào nên test
// chạy được không cần PostgreSQL hay gRPC. `identity` = { accountId, role } lấy từ metadata do Gateway dựng từ token.
//
// Rating KHÔNG dùng Kafka và không giữ bản sao danh sách chuyến: cần biết chuyến thì hỏi Trip đúng lúc (S7, gRPC đồng bộ),
// vì chưa biết chuyến đã COMPLETED và thuộc khách này thì KHÔNG được nhận đánh giá (BRULE11, V1, V2).
import { average, checkComment, checkId, checkScore, requireRole, RatingError } from './rules.js';

export function createRatingLogic({ ratings, trips, log }) {
  // S7: hỏi Trip. NOT_FOUND là câu trả lời thật ("không có chuyến") → 404; mọi lỗi khác (Trip dừng, quá deadline…)
  // nghĩa là KHÔNG BIẾT → 503, không lưu gì (02 S7). Không đoán "chắc là được" khi Trip không trả lời.
  async function askTrip(tripId, requestId) {
    try {
      return await trips.getTripForRating(tripId, requestId);
    } catch (err) {
      if (err?.statusName === 'NOT_FOUND') throw new RatingError('NOT_FOUND', 'TRIP_NOT_FOUND');
      log.warn('trip_unavailable', { trip_id: tripId, status: err?.statusName ?? 'UNKNOWN', request_id: requestId });
      throw new RatingError('UNAVAILABLE', 'TRIP_UNAVAILABLE');
    }
  }

  return {
    // A34 — UC17. Thứ tự lỗi (DG2): chuyến có (404) → là khách của chuyến (403) → đã COMPLETED (409) → chưa đánh giá
    // (409). Kiểm chủ TRƯỚC "đã đánh giá" để người khác không dò được chuyến nào đã có đánh giá.
    async createRating(req, identity, requestId) {
      const who = requireRole(identity, ['customer']);
      const tripId = checkId(req.trip_id);
      const score = checkScore(req.score);
      const comment = checkComment(req.comment);

      const trip = await askTrip(tripId, requestId);
      // V2: chỉ khách của chuyến. customer_id / driver_id lấy từ Trip, KHÔNG từ client (client không gửi được).
      if (trip.customer_id !== who.accountId) throw new RatingError('PERMISSION_DENIED', 'NOT_OWNER');
      // V1: chỉ chuyến đã hoàn thành (CANCELED cũng không được — chuyến không diễn ra thì không có gì để đánh giá).
      if (trip.status !== 'COMPLETED') throw new RatingError('FAILED_PRECONDITION', 'TRIP_NOT_COMPLETED');

      // V3 + V5 trong MỘT giao dịch: thêm đánh giá (UNIQUE trip_id) và cộng điểm tài xế cùng thành công hoặc cùng không.
      const saved = await ratings.insertWithDriverTotal({
        tripId, customerId: trip.customer_id, driverId: trip.driver_id, score, comment,
      });
      if (!saved) throw new RatingError('ALREADY_EXISTS', 'RATING_ALREADY_EXISTS');

      // Không ghi `comment` vào log: văn bản người dùng gõ có thể chứa thông tin cá nhân (NFR08).
      log.info('rating_created', { rating_id: saved.rating_id, trip_id: tripId, driver_id: trip.driver_id, request_id: requestId });
      const out = { rating_id: saved.rating_id, trip_id: tripId, driver_id: trip.driver_id, score };
      if (comment !== null) out.comment = comment;
      out.driver_avg = average(saved.rating_sum, saved.rating_count);
      out.driver_count = saved.rating_count;
      return out;
    },

    // A35 — đánh giá của một chuyến. Khách / tài xế CỦA CHUYẾN (so với cột đã lưu), admin xem mọi chuyến.
    // Kiểm chủ bằng dữ liệu của chính Rating, không cần hỏi Trip.
    async getRatingByTrip(req, identity) {
      const who = requireRole(identity, ['customer', 'driver', 'admin']);
      const tripId = checkId(req.trip_id);
      const r = await ratings.findByTrip(tripId);
      if (!r) throw new RatingError('NOT_FOUND', 'RATING_NOT_FOUND');
      if ((who.role === 'customer' && r.customer_id !== who.accountId) || (who.role === 'driver' && r.driver_id !== who.accountId)) {
        throw new RatingError('PERMISSION_DENIED', 'NOT_OWNER');
      }
      const out = { rating_id: r.rating_id, trip_id: r.trip_id, driver_id: r.driver_id, score: r.score };
      if (r.comment !== null) out.comment = r.comment;
      out.created_at = new Date(r.created_at).toISOString();
      return out;
    },

    // A36 — điểm tài xế, thông tin công khai cho mọi role đã đăng nhập (UC17 bước 5).
    // Rating không giữ danh sách tài xế nên mã chưa có ai đánh giá (kể cả mã không tồn tại) → count 0, không có avg.
    async getDriverRating(req, identity) {
      requireRole(identity, ['customer', 'driver', 'admin']);
      const driverId = checkId(req.driver_id);
      const total = await ratings.findDriverTotal(driverId);
      if (!total) return { driver_id: driverId, count: 0 };
      return { driver_id: driverId, avg: average(total.rating_sum, total.rating_count), count: total.rating_count };
    },
  };
}
