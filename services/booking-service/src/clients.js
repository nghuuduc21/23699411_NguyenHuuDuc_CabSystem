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
import grpc from '@grpc/grpc-js';
import { loadProto } from './grpc/server.js';

export const SERVICE_DEADLINE_MS = 1000;

// Rút ngắn khoảng chờ nối lại (mặc định tới 2 phút) để service vừa bật lại được gọi ngay (như Gateway).
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

function systemMetadata(requestId) {
  const metadata = new grpc.Metadata();
  metadata.set('x-role', 'system');
  if (requestId) metadata.set('x-request-id', requestId);
  return metadata;
}

// Gọi một rpc unary. Lỗi gRPC được gắn thêm `statusName` (tên status dạng chữ, ví dụ "FAILED_PRECONDITION")
// để logic nghiệp vụ đọc mà không phải import thư viện gRPC.
function call(client, method, request, requestId) {
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
