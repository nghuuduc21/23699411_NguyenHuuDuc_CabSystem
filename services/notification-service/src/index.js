// Điểm khởi động notification-service: ghép các phần theo thứ tự của spec 00 mục 2.1
// đọc biến môi trường → nối MongoDB (thử lại) → tạo index → seed (nếu giả lập) → mở gRPC → SERVING.
import { createLogger } from './log.js';
import { ConfigError, loadConfig } from './config.js';
import { createMongoClient, pingDatabase, waitForDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { createHealth } from './health.js';
import { createGrpcServer, startGrpcServer } from './grpc/server.js';

const log = createLogger(process.env.SERVICE_NAME || 'notification-service');

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  // Chỉ nêu tên biến và lý do, không nêu giá trị.
  log.error('cấu hình sai, dừng service', { variable: err.variable, reason: err.reason });
  process.exit(1);
}

if (config.simulationMode) log.warn('đang chạy chế độ giả lập');

const client = createMongoClient(config.mongodbUri);
let db;
const health = createHealth({ ping: () => pingDatabase(db) });
const server = createGrpcServer({ health });

try {
  db = await waitForDatabase(client, log);
  await runMigrations({ db, log });
  if (config.simulationMode) await runSeed({ db, log, config });
  const port = await startGrpcServer(server);
  health.markReady();
  log.info('gRPC đang nghe', { port });
} catch (err) {
  // Database không lên hoặc tạo index lỗi: thoát 1 để Compose khởi động lại (restart: unless-stopped).
  log.error('khởi động thất bại', { code: err.code ?? err.name, message: err.message });
  process.exit(1);
}

// `docker compose stop` gửi SIGTERM. Node chạy là tiến trình số 1 trong container nên phải tự bắt,
// nếu không Docker chờ 10 giây rồi mới giết.
const shutdown = () => {
  log.info('đang dừng');
  server.forceShutdown();
  client.close().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
