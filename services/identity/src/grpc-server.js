import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const protoPath = fileURLToPath(
  new URL('../../../proto/identity.proto', import.meta.url),
);

// keepCase: giữ tên field full_name như trong .proto.
// defaults: false để field không gửi là undefined, không bị điền chuỗi rỗng.
const definition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: false,
});

const { IdentityService } =
  grpc.loadPackageDefinition(definition).cab.identity.v1;

// Chuyển dòng database thành message Account đúng hợp đồng .proto.
function toAccountMessage(row) {
  return {
    account_id: String(row.account_id),
    full_name: row.full_name,
    email: row.email ?? undefined,
    phone: row.phone,
    role: row.role,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
  };
}

// Tạo gRPC server với các dependency truyền vào:
// - Chạy thật: database thật.
// - Chạy test: hàm giả, không cần PostgreSQL.
export function createIdentityServer({ checkDatabase, registerAccount }) {
  const server = new grpc.Server();

  server.addService(IdentityService.service, {
    async Check(call, callback) {
      try {
        await checkDatabase();

        callback(null, {
          service: 'identity',
          status: 'ready',
          dependencies: { database: 'ready' },
        });
      } catch (error) {
        console.error(
          '[Identity] Database readiness failed:',
          error.code || error.name,
        );

        // Vẫn trả lời thành công ở tầng gRPC:
        // Identity còn sống, chỉ báo là chưa sẵn sàng.
        callback(null, {
          service: 'identity',
          status: 'not_ready',
          dependencies: { database: 'unavailable' },
        });
      }
    },

    async Register(call, callback) {
      console.log('[Identity] gRPC Register');

      try {
        const result = await registerAccount(call.request);

        if (result.error) {
          return callback({
            code: result.error === 'ACCOUNT_ALREADY_EXISTS'
              ? grpc.status.ALREADY_EXISTS
              : grpc.status.INVALID_ARGUMENT,
            details: result.error,
          });
        }

        callback(null, toAccountMessage(result.account));
      } catch (error) {
        // Không ghi toàn bộ error/detail vì có thể chứa dữ liệu người dùng.
        console.error(
          '[Identity] Register failed:',
          error.code || error.name,
        );

        callback({
          code: grpc.status.UNAVAILABLE,
          details: 'REGISTRATION_UNAVAILABLE',
        });
      }
    },
  });

  return server;
}

// Mở cổng; trả về cổng thực tế (hữu ích khi test dùng cổng 0).
export function listen(server, address) {
  return new Promise((resolve, reject) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => (error ? reject(error) : resolve(port)),
    );
  });
}
