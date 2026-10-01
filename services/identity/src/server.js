import { db } from './db.js';
import { createIdentityServer, listen } from './grpc-server.js';
import { registerAccount } from './register-account.js';

// Identity chỉ nhận gRPC từ Gateway, không mở HTTP cho client.
// Chạy trong Docker sẽ đổi thành 0.0.0.0:50051.
const ADDRESS = process.env.IDENTITY_GRPC_BIND || '127.0.0.1:50051';

const server = createIdentityServer({
  // Một câu SQL đơn giản để kiểm tra kết nối và thực thi truy vấn.
  checkDatabase: () => db.query('SELECT 1'),
  registerAccount: (request) => registerAccount(db, request),
});

await listen(server, ADDRESS);
console.log(`Identity gRPC đang chạy tại ${ADDRESS}`);

// Ctrl+C: ngừng nhận request mới, chờ request đang chạy xong rồi đóng pool.
process.once('SIGINT', () => {
  server.tryShutdown(async () => {
    await db.end();
    process.exit(0);
  });
});
