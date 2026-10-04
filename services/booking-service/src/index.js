// Điểm khởi động booking-service: ghép các phần theo thứ tự của spec 00 mục 2.1
// đọc biến môi trường → nối database (thử lại) → migration → seed (nếu giả lập) → mở gRPC → SERVING
// → nghe K6, chạy tiến trình hết hạn Offer (mỗi giây), ghép tiếp booking đang tìm (NFR15).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './log.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool, pingDatabase, waitForDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { createHealth } from './health.js';
import { createGrpcServer, startGrpcServer } from './grpc/server.js';
import { createBookingsRepo } from './bookings-repo.js';
import { createBookingLogic } from './domain/bookings.js';
import { createDispatcher } from './domain/dispatcher.js';
import { TOPIC_PAYMENT_STATUS_CHANGED } from './domain/topics.js';
import { createServiceClients } from './clients.js';
import { createEventPublisher, createKafkaProducer } from './events.js';
import { startConsumer } from './consumer.js';

// Tiến trình hết hạn Offer chạy mỗi 1 giây (DX4, hằng số).
const EXPIRE_INTERVAL_MS = 1000;

const log = createLogger(process.env.SERVICE_NAME || 'booking-service');
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
// Bộ phát K1–K4. Chưa nối Kafka ở đây: nối lúc gửi lần đầu, nên Kafka dừng không chặn khởi động.
const events = createEventPublisher({
  producer: createKafkaProducer({ brokers: config.kafkaBrokers, clientId: config.serviceName, log }),
  log,
});
const services = createServiceClients({
  driverAddr: config.driverGrpcAddr, paymentAddr: config.paymentGrpcAddr, tripAddr: config.tripGrpcAddr,
});
const repo = createBookingsRepo(pool);
const dispatcher = createDispatcher({ bookings: repo, services, events, log, config: { offerTimeoutSeconds: config.offerTimeoutSeconds } });
const bookings = createBookingLogic({ bookings: repo, services, dispatcher, events, log });
const server = createGrpcServer({ health, bookings, log });

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

// Nghe K6 trong nền: Kafka chưa sẵn sàng thì consumer tự thử lại, gRPC vẫn phục vụ.
const consumer = startConsumer({
  brokers: config.kafkaBrokers,
  groupId: config.serviceName,
  topic: TOPIC_PAYMENT_STATUS_CHANGED,
  onEvent: (envelope) => bookings.onPaymentStatusChanged(envelope),
  log,
});

// Ghép tiếp booking đang tìm mà chưa có Offer chờ (service vừa khởi động lại giữa chừng — NFR15).
dispatcher.resume().catch((err) => log.warn('ghép tiếp sau khởi động lỗi', { code: err.code, name: err.name }));

// Tiến trình hết hạn Offer: không chạy chồng; lỗi (database dừng) chỉ ghi log, lượt sau thử lại.
let expiring = false;
const timer = setInterval(() => {
  if (expiring) return;
  expiring = true;
  dispatcher.expireOffers()
    .catch((err) => log.warn('hết hạn lời mời: lỗi, thử lại lượt sau', { code: err.code, name: err.name }))
    .finally(() => { expiring = false; });
}, EXPIRE_INTERVAL_MS);

// `docker compose stop` gửi SIGTERM. Node chạy là tiến trình số 1 trong container nên phải tự bắt,
// nếu không Docker chờ 10 giây rồi mới giết — demo dừng/bật service sẽ chậm.
const shutdown = () => {
  log.info('đang dừng');
  clearInterval(timer);
  server.forceShutdown();
  services.close();
  Promise.allSettled([consumer.stop(), events.close()])
    .then(() => pool.end())
    .finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
