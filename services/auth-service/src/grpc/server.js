// Tầng gRPC của service: grpc.health.v1.Health/Check (spec 00) và cab.auth.v1.AuthService (spec 09-10).
// Tầng này chỉ đổi request gRPC → lời gọi logic nghiệp vụ, và lỗi nghiệp vụ → gRPC status.
// Quy tắc nghiệp vụ nằm ở src/domain/, không nằm ở đây.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

// Mọi service nghe cùng cổng nội bộ 50051, phân biệt bằng tên host trong mạng Compose (spec 00 H1).
export const GRPC_PORT = 50051;

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

// Đổi lỗi nghiệp vụ (AuthError) sang gRPC status, `details` = mã lỗi; Gateway đổi tiếp sang HTTP.
// Lỗi khác (database dừng…) → INTERNAL, không lộ thông điệp bên trong; Gateway trả 503.
function toGrpcError(err, log) {
  if (err?.kind && grpc.status[err.kind] !== undefined) return { code: grpc.status[err.kind], details: err.code };
  log.error('lỗi không lường trước', { name: err?.name, code: err?.code });
  return { code: grpc.status.INTERNAL, details: 'INTERNAL' };
}

// Bọc một hàm nghiệp vụ async thành handler unary của grpc-js.
function unary(fn, log) {
  return (call, callback) => {
    fn(call.request).then(
      (result) => callback(null, result),
      (err) => callback(toGrpcError(err, log)),
    );
  };
}

export function createGrpcServer({ health, auth, log }) {
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
  // auth = logic nghiệp vụ (src/domain/auth.js). Test chỉ kiểm tra health thì không truyền.
  if (auth) {
    const authProto = loadProto('auth.proto');
    server.addService(authProto.cab.auth.v1.AuthService.service, {
      // Hai rpc công khai: không đọc x-account-id / x-role trong metadata.
      RegisterCustomer: unary((req) => auth.registerCustomer(req), log),
      Login: unary((req) => auth.login(req), log),
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
