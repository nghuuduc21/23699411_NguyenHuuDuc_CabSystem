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
// Mọi lời gọi bật `waitForReady` (spec 00 H14, ADR-020 bổ sung 2026-10-21 — xem systemMetadata).
import grpc from '@grpc/grpc-js';
import { loadProto } from './grpc/server.js';

export const SERVICE_DEADLINE_MS = 1000;

// Rút ngắn khoảng chờ nối lại (mặc định tới 2 phút) để service vừa bật lại được gọi ngay (như Gateway).
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

// `waitForReady` là tùy chọn của Metadata trong grpc-js (không phải của call options), nên phải tạo bằng
// `new grpc.Metadata({ waitForReady: true })` rồi đặt x-role, x-request-id vào CHÍNH đối tượng đó.
// Vì sao (lỗi L1 2026-10-05, L2 2026-10-21): service kia dừng rồi chạy lại (Docker có thể đổi IP), kênh gRPC của
// booking đang ở trạng thái "lỗi kết nối"; lời gọi mặc định bị từ chối NGAY (UNAVAILABLE) dù service đã healthy
// → khách nhận 503 oan. Có waitForReady, lời gọi CHỜ kênh tự phân giải lại tên và nối xong rồi mới gửi, trong hạn
// deadline 1 s. Đánh đổi: service dừng hẳn thì lỗi (DEADLINE_EXCEEDED → 503) đến sau 1 s thay vì ngay.
// Thay cho cách cũ "UNAVAILABLE thì gọi lại một lần" (H14): không còn vòng lặp, không gửi lặp thao tác ghi.
export function systemMetadata(requestId) {
  const metadata = new grpc.Metadata({ waitForReady: true });
  metadata.set('x-role', 'system');
  if (requestId) metadata.set('x-request-id', requestId);
  return metadata;
}

// Gọi một rpc unary. Lỗi gRPC được gắn thêm `statusName` (tên status dạng chữ, ví dụ "FAILED_PRECONDITION")
// để logic nghiệp vụ đọc mà không phải import thư viện gRPC. Export để unit test kiểm metadata và deadline (AC-HT-19).
export function call(client, method, request, requestId) {
  return new Promise((resolve, reject) => {
    const options = { deadline: Date.now() + SERVICE_DEADLINE_MS };
    client[method](request, systemMetadata(requestId), options, (err, response) => {
      if (err) {
        err.statusName = Object.keys(grpc.status).find((name) => grpc.status[name] === err.code) ?? 'UNKNOWN';
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

export function createServiceClients({ driverAddr, paymentAddr, tripAddr }) {
  const { DriverService } = loadProto('driver.proto').cab.driver.v1;
  const { PaymentService } = loadProto('payment.proto').cab.payment.v1;
  const { TripService } = loadProto('trip.proto').cab.trip.v1;
  const driver = new DriverService(driverAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  const payment = new PaymentService(paymentAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  const trip = new TripService(tripAddr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);

  return {
    findNearbyDrivers: (req, requestId) => call(driver, 'FindNearbyDrivers', req, requestId),
    reserveDriver: (req, requestId) => call(driver, 'ReserveDriver', req, requestId),
    releaseDriver: (req, requestId) => call(driver, 'ReleaseDriver', req, requestId),
    // expires_at là field `optional`: chỉ có với thanh toán ONLINE.
    createPayment: (req, requestId) => call(payment, 'CreatePayment', req, requestId),
    createTrip: (req, requestId) => call(trip, 'CreateTrip', req, requestId),
    close() {
      driver.close();
      payment.close();
      trip.close();
    },
  };
}
