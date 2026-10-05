// Tầng gRPC của notification-service: grpc.health.v1.Health/Check (spec 00) và cab.notification.v1.NotificationService
// (spec 17-18 mục 5.3: ListNotifications). Tầng này chỉ đọc danh tính trong metadata, đổi request gRPC → lời gọi logic
// nghiệp vụ, và lỗi nghiệp vụ → gRPC status. Quy tắc nằm ở src/domain/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

// Mỗi service MỘT cổng gRPC riêng (auth 50051 … rating 50058; lỗi L3). Vì sao không dùng chung 50051: Docker cấp lại
// IP khi container khởi động lại; kênh gRPC cũ của bên gọi có thể còn giữ IP cũ, mà IP đó nay thuộc service KHÁC.
// Cùng cổng thì kết nối thành công nhầm (Gateway gọi notification mà tới payment). Khác cổng thì kết nối nhầm
// bị từ chối ngay, kênh tự hỏi lại DNS và nối đúng service.
export const GRPC_PORT = 50057;

// Trong Docker, Dockerfile đặt PROTO_DIR=/app/proto. Chạy ngoài Docker (test) thì lấy thư mục proto/ ở gốc repo.
export function protoDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return process.env.PROTO_DIR ?? path.resolve(here, '../../../../proto');
}

export function loadProto(file) {
  const definition = protoLoader.loadSync(path.join(protoDir(), file), {
    keepCase: true, // giữ tên trường snake_case như trong .proto
    longs: Number, // int64 → số JavaScript (ADR-015)
    enums: String, // enum dạng chữ ("SERVING") để log và JSON dễ đọc
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(definition);
}

// Đổi lỗi nghiệp vụ sang gRPC status, `details` = mã lỗi. Lỗi khác (MongoDB dừng…) → INTERNAL, Gateway trả 503.
function toGrpcError(err, log) {
  if (err?.kind && grpc.status[err.kind] !== undefined) return { code: grpc.status[err.kind], details: err.code };
  log.error('lỗi không lường trước', { name: err?.name, code: err?.code });
  return { code: grpc.status.INTERNAL, details: 'INTERNAL' };
}

// Danh tính do Gateway dựng từ token đã kiểm tra (04 mục 1.7).
export function readIdentity(metadata) {
  const first = (key) => {
    const value = metadata.get(key)[0];
    return typeof value === 'string' ? value : undefined;
  };
  return { accountId: first('x-account-id'), role: first('x-role') };
}

// notifications = logic nghiệp vụ (src/domain/notifications.js). Test chỉ kiểm tra health thì không truyền.
export function createGrpcServer({ health, notifications, log }) {
  const server = new grpc.Server();
  const healthProto = loadProto('health.proto');

  server.addService(healthProto.grpc.health.v1.Health.service, {
    // Watch có trong hợp đồng chuẩn nhưng không cài; grpc-js tự trả UNIMPLEMENTED.
    Check: (call, callback) => {
      // Service chỉ báo sức khỏe chung (service = ""). Tên lạ → NOT_FOUND như chuẩn grpc.health.v1.
      if (call.request.service !== '') {
        callback({ code: grpc.status.NOT_FOUND, details: 'SERVICE_NOT_FOUND' });
        return;
      }
      health.check().then((status) => callback(null, { status }));
    },
  });
  if (notifications) {
    const proto = loadProto('notification.proto');
    server.addService(proto.cab.notification.v1.NotificationService.service, {
      ListNotifications: (call, callback) => {
        Promise.resolve()
          .then(() => notifications.listNotifications(call.request, readIdentity(call.metadata)))
          .then((result) => callback(null, result), (err) => callback(toGrpcError(err, log)));
      },
    });
  }
  return server;
}

// Nghe 0.0.0.0 để container khác trong mạng Compose gọi được; không mở cổng ra máy (mục chấm 8).
export function startGrpcServer(server, port = GRPC_PORT) {
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) reject(err);
      else resolve(boundPort);
    });
  });
}
