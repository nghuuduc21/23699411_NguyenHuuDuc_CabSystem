// Điểm khởi động payment-service: ghép các phần theo thứ tự của spec 00 mục 2.1
// đọc biến môi trường → nối database (thử lại) → migration → seed (nếu giả lập) → mở gRPC → SERVING
// → chạy tiến trình nền hết hạn thanh toán (mỗi giây) → nghe K3, K4, K5 (spec 17-18: hoàn tiền, tiền mặt).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './log.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool, pingDatabase, waitForDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { createHealth } from './health.js';
import { createGrpcServer, startGrpcServer } from './grpc/server.js';
import { createPaymentsRepo } from './payments-repo.js';
import {
  createPaymentLogic, TOPIC_BOOKING_CANCELED, TOPIC_NO_DRIVER_FOUND, TOPIC_TRIP_STATUS_CHANGED,
} from './domain/payments.js';
import { startConsumer } from './consumer.js';
import { createSimulatedProvider } from './adapters/provider-sim.js';
import { createEventPublisher, createKafkaProducer } from './events.js';

// Tiến trình nền chạy mỗi 1 giây (DX4, hằng số): hết hạn được ghi nhận trong ~1 giây như mọi thứ khác.
const EXPIRE_INTERVAL_MS = 1000;

const log = createLogger(process.env.SERVICE_NAME || 'payment-service');
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
// Bộ phát K6. Chưa nối Kafka ở đây: nối lúc gửi lần đầu, nên Kafka dừng không chặn khởi động.
const events = createEventPublisher({
  producer: createKafkaProducer({ brokers: config.kafkaBrokers, clientId: config.serviceName, log }),
  log,
});
const payments = createPaymentLogic({
  payments: createPaymentsRepo(pool),
  provider: createSimulatedProvider({ simulationMode: config.simulationMode }),
  events,
  log,
  config: { paymentTimeoutSeconds: config.paymentTimeoutSeconds, callbackSecret: config.paymentCallbackSecret },
});
const server = createGrpcServer({ health, payments, log });

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

// Tiến trình hết hạn: không chạy chồng (lượt trước chưa xong thì bỏ lượt này); lỗi (database dừng) chỉ ghi log,
// lượt sau thử lại.
let expiring = false;
const timer = setInterval(() => {
  if (expiring) return;
  expiring = true;
  payments.expireOverdue()
    .catch((err) => log.warn('hết hạn thanh toán: lỗi, thử lại lượt sau', { code: err.code, name: err.name }))
    .finally(() => { expiring = false; });
}, EXPIRE_INTERVAL_MS);

// Nghe K3, K4, K5 trong nền (group `payment-service`): Kafka chưa sẵn sàng thì consumer tự thử lại, gRPC vẫn phục vụ.
const consumer = startConsumer({
  brokers: config.kafkaBrokers,
  groupId: config.serviceName,
  topics: [TOPIC_NO_DRIVER_FOUND, TOPIC_BOOKING_CANCELED, TOPIC_TRIP_STATUS_CHANGED],
  onEvent: (topic, envelope) => payments.onBookingEvent(topic, envelope),
  log,
});

// `docker compose stop` gửi SIGTERM. Node chạy là tiến trình số 1 trong container nên phải tự bắt,
// nếu không Docker chờ 10 giây rồi mới giết — demo dừng/bật service sẽ chậm.
const shutdown = () => {
  log.info('đang dừng');
  clearInterval(timer);
  server.forceShutdown();
  Promise.allSettled([consumer.stop(), events.close()])
    .then(() => pool.end())
    .finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
