// Client gRPC từ rating-service tới service DUY NHẤT nó được gọi (02 mục 4.3): S7 trip GetTripForRating.
// Đồng bộ vì chưa biết chuyến đã COMPLETED và thuộc khách này thì không được nhận đánh giá — cần câu trả lời ngay để
// trả lời khách (BRULE11, V1, V2; gRPC là mặc định — ADR-007).
//
// Danh tính: metadata `x-role: system` (DG3), KHÔNG gửi x-account-id: Trip chỉ báo sự thật, quy tắc "đúng khách" là
// của Rating. Kèm `x-request-id` để lần theo một request qua log của nhiều service.
// Deadline 1 000 ms (03 mục 13): Trip treo thì khách nhận 503 chứ không treo theo.
import grpc from '@grpc/grpc-js';
import { loadProto } from './grpc/server.js';

export const SERVICE_DEADLINE_MS = 1000;

// Rút ngắn khoảng chờ nối lại (mặc định tới 2 phút) để Trip vừa bật lại được gọi ngay (như Gateway, booking).
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

// `waitForReady` là tùy chọn của Metadata trong grpc-js: true = kênh đang lỗi kết nối thì CHỜ kênh nối lại
// (trong deadline) thay vì báo UNAVAILABLE ngay.
function systemMetadata(requestId, waitForReady) {
  const metadata = new grpc.Metadata({ waitForReady });
  metadata.set('x-role', 'system');
  if (requestId) metadata.set('x-request-id', requestId);
  return metadata;
}

// Lỗi gRPC được gắn `statusName` (ví dụ "NOT_FOUND") để logic nghiệp vụ đọc mà không phải import thư viện gRPC.
function callOnce(client, method, request, requestId, waitForReady) {
  return new Promise((resolve, reject) => {
    client[method](request, systemMetadata(requestId, waitForReady), { deadline: Date.now() + SERVICE_DEADLINE_MS }, (err, response) => {
      if (err) {
        err.statusName = Object.keys(grpc.status).find((name) => grpc.status[name] === err.code) ?? 'UNKNOWN';
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Cùng cách sửa lỗi L1 như booking-service: trip-service vừa dừng rồi chạy lại thì kênh gRPC còn ở trạng thái
// "lỗi kết nối" và lời gọi đầu bị UNAVAILABLE ngay dù Trip đã sẵn sàng. Gặp UNAVAILABLE thì thử lại MỘT lần, lần này
// chờ kênh nối lại. GetTripForRating chỉ đọc nên gọi hai lần cũng an toàn. Trip thật sự dừng → khách chờ thêm tối đa
// ~1 giây rồi vẫn nhận 503.
export async function callWithRetry(attempt) {
  try {
    return await attempt(false);
  } catch (err) {
    if (err?.statusName !== 'UNAVAILABLE') throw err;
    return attempt(true);
  }
}

export function createTripClient(addr) {
  const { TripService } = loadProto('trip.proto').cab.trip.v1;
  const trip = new TripService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  return {
    getTripForRating: (tripId, requestId) =>
      callWithRetry((waitForReady) => callOnce(trip, 'GetTripForRating', { trip_id: tripId }, requestId, waitForReady)),
    close: () => trip.close(),
  };
}
