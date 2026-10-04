// Tầng gRPC của service: grpc.health.v1.Health/Check (spec 00) và cab.customer.v1.CustomerService (spec 11).
// Tầng này chỉ đọc danh tính trong metadata, đổi request gRPC → lời gọi logic nghiệp vụ,
// và lỗi nghiệp vụ → gRPC status. Quy tắc nghiệp vụ nằm ở src/domain/, không nằm ở đây.
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

// Đổi lỗi nghiệp vụ (CustomerError) sang gRPC status, `details` = mã lỗi; Gateway đổi tiếp sang HTTP.
// Lỗi khác (database dừng…) → INTERNAL, không lộ thông điệp bên trong; Gateway trả 503.
function toGrpcError(err, log) {
  if (err?.kind && grpc.status[err.kind] !== undefined) return { code: grpc.status[err.kind], details: err.code };
  log.error('lỗi không lường trước', { name: err?.name, code: err?.code });
  return { code: grpc.status.INTERNAL, details: 'INTERNAL' };
}

// Danh tính do Gateway dựng từ token đã kiểm tra (04 mục 1.7). Service tin metadata vì chỉ Gateway
// vào được mạng nội bộ; service KHÔNG tự kiểm tra JWT. Thiếu thì để undefined, logic sẽ từ chối.
export function readIdentity(metadata) {
  const first = (key) => {
    const value = metadata.get(key)[0];
    return typeof value === 'string' ? value : undefined;
  };
  return { accountId: first('x-account-id'), role: first('x-role') };
}

// Bọc một hàm nghiệp vụ async (request, identity) thành handler unary của grpc-js.
function unary(fn, log) {
  return (call, callback) => {
    Promise.resolve()
      .then(() => fn(call.request, readIdentity(call.metadata)))
      .then(
        (result) => callback(null, result),
        (err) => callback(toGrpcError(err, log)),
      );
  };
}

export function createGrpcServer({ health, customers, log }) {
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
  // customers = logic nghiệp vụ (src/domain/customers.js). Test chỉ kiểm tra health thì không truyền.
  if (customers) {
    const customerProto = loadProto('customer.proto');
    server.addService(customerProto.cab.customer.v1.CustomerService.service, {
      CreateCustomer: unary((req, identity) => customers.createCustomer(req, identity), log),
      GetCustomer: unary((req, identity) => customers.getCustomer(req, identity), log),
      UpdateCustomer: unary((req, identity) => customers.updateCustomer(req, identity), log),
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
