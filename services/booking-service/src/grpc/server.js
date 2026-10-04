// Tầng gRPC của booking-service: grpc.health.v1.Health/Check (spec 00) và cab.booking.v1.BookingService
// (spec 14-15-16-19-30 mục 5.1). Tầng này chỉ đọc danh tính trong metadata, đổi request gRPC → lời gọi logic
// nghiệp vụ, và lỗi nghiệp vụ → gRPC status. Quy tắc nghiệp vụ nằm ở src/domain/.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

// Đổi lỗi nghiệp vụ (BookingError) sang gRPC status, `details` = mã lỗi; Gateway đổi tiếp sang HTTP.
// Lỗi khác (database dừng…) → INTERNAL, không lộ thông điệp bên trong; Gateway trả 503.
function toGrpcError(err, log) {
  if (err?.kind && grpc.status[err.kind] !== undefined) return { code: grpc.status[err.kind], details: err.code };
  log.error('lỗi không lường trước', { name: err?.name, code: err?.code });
  return { code: grpc.status.INTERNAL, details: 'INTERNAL' };
}

// Danh tính do Gateway dựng từ token đã kiểm tra (04 mục 1.7). `x-request-id` chuyển tiếp sang
// payment / driver / trip để lần theo một request qua log của nhiều service.
export function readIdentity(metadata) {
  const first = (key) => {
    const value = metadata.get(key)[0];
    return typeof value === 'string' ? value : undefined;
  };
  return { accountId: first('x-account-id'), role: first('x-role'), requestId: first('x-request-id') ?? randomUUID() };
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

export function createGrpcServer({ health, bookings, log }) {
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
  // bookings = logic nghiệp vụ (src/domain/bookings.js). Test chỉ kiểm tra health thì không truyền.
  if (bookings) {
    const bookingProto = loadProto('booking.proto');
    server.addService(bookingProto.cab.booking.v1.BookingService.service, {
      CreateBooking: unary((req, identity) => bookings.createBooking(req, identity), log),
      ListBookings: unary((req, identity) => bookings.listBookings(req, identity), log),
      GetBooking: unary((req, identity) => bookings.getBooking(req, identity), log),
      ListOffers: unary((req, identity) => bookings.listOffers(req, identity), log),
      AcceptOffer: unary((req, identity) => bookings.acceptOffer(req, identity), log),
      RejectOffer: unary((req, identity) => bookings.rejectOffer(req, identity), log),
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
