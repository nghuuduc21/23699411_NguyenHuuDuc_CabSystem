// Điểm khởi động auth-service: ghép các phần theo thứ tự của spec 00 mục 2.1
// đọc biến môi trường → nối database (thử lại) → migration → seed (nếu giả lập) → mở gRPC → SERVING.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './log.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool, pingDatabase, waitForDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { createHealth } from './health.js';
import { createGrpcServer, startGrpcServer } from './grpc/server.js';
import { createAccountsRepo } from './accounts-repo.js';
import { createAuthLogic } from './domain/auth.js';
import { hashPassword, verifyPassword } from './domain/password.js';
import { createTokenSigner } from './domain/token.js';

const log = createLogger(process.env.SERVICE_NAME || 'auth-service');
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

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

const pool = createPool(config.databaseUrl, log);
const health = createHealth({ ping: () => pingDatabase(pool) });
// Ghép logic nghiệp vụ với phụ thuộc thật: database, scrypt, bộ ký JWT.
const auth = createAuthLogic({
  accounts: createAccountsRepo(pool),
  passwords: { hash: hashPassword, verify: verifyPassword },
  tokens: createTokenSigner({ secret: config.jwtSecret, ttlSeconds: config.jwtTtlSeconds }),
  log,
});
const server = createGrpcServer({ health, auth, log });

try {
  await waitForDatabase(pool, log);
  await runMigrations({ pool, dir: migrationsDir, log });
  if (config.simulationMode) await runSeed({ pool, log, config });
  const port = await startGrpcServer(server);
  health.markReady();
  log.info('gRPC đang nghe', { port });
} catch (err) {
  // Database không lên hoặc migration lỗi: thoát 1 để Compose khởi động lại (restart: unless-stopped).
  log.error('khởi động thất bại', { code: err.code, message: err.message });
  process.exit(1);
}

// `docker compose stop` gửi SIGTERM. Node chạy là tiến trình số 1 trong container nên phải tự bắt,
// nếu không Docker chờ 10 giây rồi mới giết — demo dừng/bật service sẽ chậm.
const shutdown = () => {
  log.info('đang dừng');
  server.forceShutdown();
  pool.end().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
