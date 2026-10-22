// Client gRPC từ rating-service tới service DUY NHẤT nó được gọi (02 mục 4.3): S7 trip GetTripForRating.
// Đồng bộ vì chưa biết chuyến đã COMPLETED và thuộc khách này thì không được nhận đánh giá — cần câu trả lời ngay để
// trả lời khách (BRULE11, V1, V2; gRPC là mặc định — ADR-007).
//
// Danh tính: metadata `x-role: system` (DG3), KHÔNG gửi x-account-id: Trip chỉ báo sự thật, quy tắc "đúng khách" là
// của Rating. Kèm `x-request-id` để lần theo một request qua log của nhiều service.
// Deadline 1 000 ms (03 mục 13): Trip treo thì khách nhận 503 chứ không treo theo. Có waitForReady (H14).
import grpc from '@grpc/grpc-js';
import { loadProto } from './grpc/server.js';

export const SERVICE_DEADLINE_MS = 1000;

// Rút ngắn khoảng chờ nối lại (mặc định tới 2 phút) để Trip vừa bật lại được gọi ngay (như Gateway, booking).
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

// `waitForReady` là tùy chọn của Metadata trong grpc-js nên phải tạo bằng `new grpc.Metadata({ waitForReady: true })`
// rồi đặt x-role, x-request-id vào CHÍNH đối tượng đó (spec 00 H14, ADR-020 bổ sung 2026-10-21).
// Vì sao (lỗi L1, L2): trip-service vừa dừng rồi chạy lại (Docker có thể đổi IP), kênh gRPC còn ở trạng thái
// "lỗi kết nối"; lời gọi mặc định bị từ chối NGAY dù Trip đã sẵn sàng → khách nhận 503 oan. Có waitForReady, lời gọi
// CHỜ kênh nối lại trong deadline 1 s rồi mới gửi. Đánh đổi: Trip dừng hẳn → 503 sau ≈ 1 s thay vì ngay.
// Thay cho cách cũ "UNAVAILABLE thì gọi lại một lần" (H14 đã loại): không còn vòng lặp.
export function systemMetadata(requestId) {
  const metadata = new grpc.Metadata({ waitForReady: true });
  metadata.set('x-role', 'system');
  if (requestId) metadata.set('x-request-id', requestId);
  return metadata;
}

// Lỗi gRPC được gắn `statusName` (ví dụ "NOT_FOUND") để logic nghiệp vụ đọc mà không phải import thư viện gRPC.
// Export để unit test kiểm metadata và deadline (AC-HT-19).
export function call(client, method, request, requestId) {
  return new Promise((resolve, reject) => {
    client[method](request, systemMetadata(requestId), { deadline: Date.now() + SERVICE_DEADLINE_MS }, (err, response) => {
      if (err) {
        err.statusName = Object.keys(grpc.status).find((name) => grpc.status[name] === err.code) ?? 'UNKNOWN';
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

export function createTripClient(addr) {
  const { TripService } = loadProto('trip.proto').cab.trip.v1;
  const trip = new TripService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  return {
    getTripForRating: (tripId, requestId) => call(trip, 'GetTripForRating', { trip_id: tripId }, requestId),
    close: () => trip.close(),
  };
}
