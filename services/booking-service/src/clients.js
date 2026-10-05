// Client gRPC từ booking-service tới ba service nó được phép gọi (02 mục 4.3; spec 14-15-16-19-30 mục 5.5, 6):
//   S2 driver FindNearbyDrivers — danh sách ứng viên MỚI NHẤT cho mỗi vòng ghép
//   S3 driver ReserveDriver / ReleaseDriver — chỉ Driver biết tài xế còn rảnh không
//   S4 payment CreatePayment — khách phải thấy NGAY cước và mã thanh toán
//   S5 trip CreateTrip — tài xế cần NGAY mã chuyến
// Đồng bộ (gRPC) vì bên gọi cần kết quả ngay để làm bước tiếp theo (gRPC là mặc định — CLAUDE.md).
//
// Danh tính: metadata `x-role: system` (DX2 đã chốt), KHÔNG gửi x-account-id (không có tài khoản nào đứng sau),
// kèm `x-request-id` để lần theo một request qua log của nhiều service.
// Mọi lời gọi có deadline 1 000 ms (03 mục 13): service kia treo thì booking không treo theo.
// Rpc lặp an toàn được thử lại MỘT lần khi UNAVAILABLE (lỗi L1 — xem callWithRetry).
import grpc from '@grpc/grpc-js';
import { loadProto } from './grpc/server.js';

export const SERVICE_DEADLINE_MS = 1000;

// Rút ngắn khoảng chờ nối lại (mặc định tới 2 phút) để service vừa bật lại được gọi ngay (như Gateway).
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

// `waitForReady` là tùy chọn của Metadata trong grpc-js (không phải của call options): true = kênh đang lỗi kết nối
// thì lời gọi CHỜ kênh nối lại (trong deadline) thay vì báo UNAVAILABLE ngay.
function systemMetadata(requestId, waitForReady = false) {
  const metadata = new grpc.Metadata({ waitForReady });
  metadata.set('x-role', 'system');
  if (requestId) metadata.set('x-request-id', requestId);
  return metadata;
}

// Gọi một rpc unary MỘT lần. Lỗi gRPC được gắn thêm `statusName` (tên status dạng chữ, ví dụ "FAILED_PRECONDITION")
// để logic nghiệp vụ đọc mà không phải import thư viện gRPC.
// `waitForReady`: false = kênh đang lỗi kết nối thì báo UNAVAILABLE ngay; true = chờ kênh nối lại (trong deadline).
function callOnce(client, method, request, requestId, waitForReady) {
  return new Promise((resolve, reject) => {
    const options = { deadline: Date.now() + SERVICE_DEADLINE_MS };
    client[method](request, systemMetadata(requestId, waitForReady), options, (err, response) => {
      if (err) {
        err.statusName = Object.keys(grpc.status).find((name) => grpc.status[name] === err.code) ?? 'UNKNOWN';
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Lỗi L1 (báo cáo kiểm thử 2026-10-05): payment-service / trip-service dừng rồi chạy lại, đã healthy, mà lời gọi
// ĐẦU TIÊN từ booking vẫn UNAVAILABLE, lần hai mới được. Vì sao: lúc service kia dừng, kênh gRPC của booking rơi vào
// trạng thái "lỗi kết nối" (TRANSIENT_FAILURE) và chỉ nối lại khi có lời gọi mới. Ở trạng thái đó, lời gọi mặc định
// (không chờ kênh sẵn sàng) bị báo UNAVAILABLE NGAY, dù service đã chạy lại → khách nhận 503 oan; lời gọi đó lại
// khiến kênh nối lại, nên lần hai được.
//
// Cách sửa (sinh viên chốt): gặp UNAVAILABLE thì THỬ LẠI MỘT LẦN, lần này `waitForReady` để CHỜ kênh nối lại thay vì
// thất bại ngay. Mỗi lần vẫn deadline 1 000 ms riêng → service thật sự dừng thì khách chờ thêm tối đa ~1 giây rồi vẫn
// nhận 503 (không treo). Đo trong container sau khi sửa: payment-service vừa healthy → lời gọi đầu ~30 ms, thành công. Chỉ thử lại khi UNAVAILABLE: các lỗi khác (FAILED_PRECONDITION, INVALID_ARGUMENT…)
// là câu trả lời thật của service, gọi lại cũng vậy; DEADLINE_EXCEEDED thì đã chờ hết 1 giây rồi.
//
// Chỉ dùng cho rpc LẶP AN TOÀN (gọi hai lần cho cùng kết quả như gọi một lần) — vì UNAVAILABLE không chắc là
// request chưa tới service (kết nối có thể đứt sau khi service đã xử lý):
//   CreatePayment: lặp an toàn — đã có Payment cho booking_id thì trả Payment cũ (M1, UNIQUE booking_id).
//   CreateTrip:    lặp an toàn — đã có Trip cho booking_id + cùng tài xế thì trả Trip cũ (T1, UNIQUE booking_id).
//   ReserveDriver: lặp an toàn — đang giữ đúng booking này thì trả như lần đầu (D8).
//   ReleaseDriver: lặp an toàn — chỉ nhả khi đang giữ đúng booking; lần hai trả released = false, không lỗi (D9).
// FindNearbyDrivers (chỉ đọc) KHÔNG thử lại ở đây: bộ ghép đã tự thử 3 lần cách 1 giây (DX7); thử lại thêm ở đây sẽ
// kéo dài thời gian kết luận "không có tài xế" khi driver-service dừng (AC-DX-17 ≈ 5 giây).
export async function callWithRetry(attempt) {
  try {
    return await attempt(false);
  } catch (err) {
    if (err?.statusName !== 'UNAVAILABLE') throw err;
    return attempt(true);
  }
}

const call = (client, method, request, requestId) => callOnce(client, method, request, requestId, false);
const callSafe = (client, method, request, requestId) =>
  callWithRetry((waitForReady) => callOnce(client, method, request, requestId, waitForReady));

export function createServiceClients({ driverAddr, paymentAddr, tripAddr }) {
  const { DriverService } = loadProto('driver.proto').cab.driver.v1;
  const { PaymentService } = loadProto('payment.proto').cab.payment.v1;
  const { TripService } = loadProto('trip.proto').cab.trip.v1;
  const driver = new DriverService(driverAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  const payment = new PaymentService(paymentAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  const trip = new TripService(tripAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);

  return {
    findNearbyDrivers: (req, requestId) => call(driver, 'FindNearbyDrivers', req, requestId),
    reserveDriver: (req, requestId) => callSafe(driver, 'ReserveDriver', req, requestId),
    releaseDriver: (req, requestId) => callSafe(driver, 'ReleaseDriver', req, requestId),
    // expires_at là field `optional`: chỉ có với thanh toán ONLINE.
    createPayment: (req, requestId) => callSafe(payment, 'CreatePayment', req, requestId),
    createTrip: (req, requestId) => callSafe(trip, 'CreateTrip', req, requestId),
    close() {
      driver.close();
      payment.close();
      trip.close();
    },
  };
}
