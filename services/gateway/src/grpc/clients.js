// Tạo kênh gRPC từ Gateway tới 8 service (G9). Spec 00 chỉ có client health;
// spec sau thêm client nghiệp vụ (auth.proto, customer.proto, …) dùng chung cách tạo kênh này.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

// Deadline là hằng số trong code (03 mục 13): Gateway → service 3 000 ms, health 1 000 ms.
export const GATEWAY_DEADLINE_MS = 3000;
export const HEALTH_DEADLINE_MS = 1000;

// Mặc định grpc-js chờ tới 2 phút trước khi nối lại một service vừa dừng, và 30 giây trước khi
// hỏi lại DNS. Khi demo `docker compose start rating-service`, /health/services phải thấy SERVING
// lại sau vài giây, nên rút ngắn các khoảng chờ này.
const CHANNEL_OPTIONS = {
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 2000,
  'grpc.dns_min_time_between_resolutions_ms': 1000,
};

// Trong Docker, Dockerfile đặt PROTO_DIR=/app/proto. Chạy ngoài Docker (test) thì lấy proto/ ở gốc repo.
export function protoDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return process.env.PROTO_DIR ?? path.resolve(here, '../../../../proto');
}

export function loadProto(file) {
  const definition = protoLoader.loadSync(path.join(protoDir(), file), {
    keepCase: true,
    longs: Number, // int64 → số JavaScript (ADR-015)
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(definition);
}

// addrs: { 'auth-service': 'auth-service:50051', 'customer-service': 'customer-service:50052', … } — gọi bằng tên
// service trong Compose; mỗi service một cổng riêng (lỗi L3, xem GRPC_PORT ở server.js của từng service).
// Tạo client không mở kết nối ngay; kết nối thật mở ở lời gọi đầu, nên service chưa lên
// không làm Gateway lỗi khi khởi động (Gateway chỉ chờ `service_started`, spec 00 H3).
export function createHealthClients(addrs) {
  const { Health } = loadProto('health.proto').grpc.health.v1;
  const clients = {};
  for (const [service, addr] of Object.entries(addrs)) {
    clients[service] = new Health(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  }
  return clients;
}

// Client nghiệp vụ của auth-service (A04, A05). Cùng tùy chọn kênh với client health.
export function createAuthClient(addr) {
  const { AuthService } = loadProto('auth.proto').cab.auth.v1;
  return new AuthService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của customer-service (A37, A38, A09, A10).
export function createCustomerClient(addr) {
  const { CustomerService } = loadProto('customer.proto').cab.customer.v1;
  return new CustomerService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của driver-service (A11–A18, A39).
export function createDriverClient(addr) {
  const { DriverService } = loadProto('driver.proto').cab.driver.v1;
  return new DriverService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của booking-service (A19–A21, A23–A25).
export function createBookingClient(addr) {
  const { BookingService } = loadProto('booking.proto').cab.booking.v1;
  return new BookingService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của payment-service (A30–A32).
export function createPaymentClient(addr) {
  const { PaymentService } = loadProto('payment.proto').cab.payment.v1;
  return new PaymentService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của trip-service (A27–A29).
export function createTripClient(addr) {
  const { TripService } = loadProto('trip.proto').cab.trip.v1;
  return new TripService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Client nghiệp vụ của notification-service (A33).
export function createNotificationClient(addr) {
  const { NotificationService } = loadProto('notification.proto').cab.notification.v1;
  return new NotificationService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}

// Metadata Gateway gửi kèm mỗi lời gọi (04 mục 1.7). Gateway TỰ DỰNG từ token đã kiểm tra,
// không chép header cùng tên của client — nếu chép thì ai cũng giả được danh tính bằng một header.
//   x-request-id: luôn có, để lần theo một request qua log của nhiều service.
//   x-account-id (= sub, dạng chuỗi), x-role: chỉ khi route có token.
//   `extra`: metadata riêng của một route, chỉ ghi khi có giá trị — `idempotency-key` (A31, từ header
//   Idempotency-Key), `x-callback-secret` (A32, từ header X-Callback-Secret; Gateway KHÔNG giữ khóa, chỉ chuyển).
export function buildMetadata(req, extra = {}) {
  const metadata = new grpc.Metadata();
  metadata.set('x-request-id', req.requestId);
  if (req.identity) {
    metadata.set('x-account-id', req.identity.accountId);
    metadata.set('x-role', req.identity.role);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string' && value !== '') metadata.set(key, value);
  }
  return metadata;
}

// Gọi một rpc unary có deadline 3 000 ms (mọi lời gọi gRPC phải có deadline: service treo
// thì client nhận 503 sau 3 giây thay vì chờ mãi). Trả Promise để handler dùng await.
export function callUnary(client, method, request, metadata, deadlineMs = GATEWAY_DEADLINE_MS) {
  return new Promise((resolve, reject) => {
    client[method](request, metadata, { deadline: Date.now() + deadlineMs }, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

// Client nghiệp vụ của rating-service (A34–A36).
export function createRatingClient(addr) {
  const { RatingService } = loadProto('rating.proto').cab.rating.v1;
  return new RatingService(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
}
