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

// addrs: { 'auth-service': 'auth-service:50051', … } — gọi bằng tên service trong Compose.
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
