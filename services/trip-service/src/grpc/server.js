// Tầng gRPC của trip-service: grpc.health.v1.Health/Check (spec 00) và cab.trip.v1.TripService
// (spec 14-15-16-19-30: CreateTrip; spec 17-18: GetTrip, UpdateTripStatus, CancelTrip). Tầng này chỉ đọc danh tính
// trong metadata, đổi request gRPC → lời gọi logic nghiệp vụ, và lỗi nghiệp vụ → gRPC status.
// Quy tắc nghiệp vụ nằm ở src/domain/.
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

// Đổi lỗi nghiệp vụ (TripError) sang gRPC status, `details` = mã lỗi.
// Lỗi khác (database dừng…) → INTERNAL, không lộ thông điệp bên trong.
function toGrpcError(err, log) {
  if (err?.kind && grpc.status[err.kind] !== undefined) return { code: grpc.status[err.kind], details: err.code };
  log.error('lỗi không lường trước', { name: err?.name, code: err?.code });
  return { code: grpc.status.INTERNAL, details: 'INTERNAL' };
}

// Danh tính người gọi: CreateTrip chỉ nhận `x-role: system` của booking-service (spec 14 mục 5.5); GetTrip,
// UpdateTripStatus, CancelTrip nhận `x-account-id`, `x-role` do Gateway dựng từ token (04 mục 1.7).
export function readIdentity(metadata) {
  const first = (key) => {
    const value = metadata.get(key)[0];
    return typeof value === 'string' ? value : undefined;
  };
  return { accountId: first('x-account-id'), role: first('x-role') };
}

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

export function createGrpcServer({ health, trips, log }) {
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
  // trips = logic nghiệp vụ (src/domain/trips.js). Test chỉ kiểm tra health thì không truyền.
  if (trips) {
    const tripProto = loadProto('trip.proto');
    server.addService(tripProto.cab.trip.v1.TripService.service, {
      CreateTrip: unary((req, identity) => trips.createTrip(req, identity), log),
      GetTrip: unary((req, identity) => trips.getTrip(req, identity), log),
      UpdateTripStatus: unary((req, identity) => trips.updateTripStatus(req, identity), log),
      CancelTrip: unary((req, identity) => trips.cancelTrip(req, identity), log),
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
