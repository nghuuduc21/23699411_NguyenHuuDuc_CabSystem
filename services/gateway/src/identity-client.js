import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const protoPath = fileURLToPath(
  new URL('../../../proto/identity.proto', import.meta.url),
);

// Dùng cùng tùy chọn với Identity để hai bên hiểu message giống nhau.
const definition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: false,
});

const { IdentityService } =
  grpc.loadPackageDefinition(definition).cab.identity.v1;

// Tạo stub gọi Identity. Stub chưa kết nối ngay;
// kết nối được mở ở lần gọi đầu tiên và dùng lại cho các lần sau.
export function createIdentityClient(address) {
  const stub = new IdentityService(
    address,
    grpc.credentials.createInsecure(),
  );

  // Chuyển hàm callback của gRPC thành Promise, luôn kèm deadline
  // để Gateway không chờ vô hạn khi Identity chậm hoặc tắt.
  function call(method, request, timeoutMs) {
    return new Promise((resolve, reject) => {
      stub[method](
        request,
        { deadline: Date.now() + timeoutMs },
        (error, response) => (error ? reject(error) : resolve(response)),
      );
    });
  }

  return {
    check: () => call('Check', {}, 7000),
    register: (request) => call('Register', request, 10000),
  };
}
