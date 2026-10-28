// Điểm khởi động Gateway (spec 00 mục 2.1 bước 5): nối Redis, tạo 8 kênh gRPC, mở HTTP 0.0.0.0:3000.
// Gateway KHÔNG chờ Redis hay service lên mới mở cổng: thiếu chúng thì /ready, /health/services
// báo lỗi, còn /health vẫn 200 để Docker biết tiến trình Gateway sống.
import { createLogger } from './log.js';
import { BACKEND_SERVICES, ConfigError, loadConfig } from './config.js';
import { createRedis, createRevocationStore, pingRedis } from './redis.js';
import {
  createAuthClient, createBookingClient, createCustomerClient, createDriverClient, createHealthClients, createNotificationClient,
  createPaymentClient, createRatingClient, createTripClient,
} from './grpc/clients.js';
import { createRatingHandlers } from './handlers/ratings.js';
import { createRateLimiter } from './rate-limit.js';
import { createAuthHandlers } from './handlers/auth.js';
import { createCustomerHandlers } from './handlers/customers.js';
import { createDriverHandlers } from './handlers/drivers.js';
import { createBookingHandlers } from './handlers/bookings.js';
import { createPaymentHandlers } from './handlers/payments.js';
import { createTripHandlers } from './handlers/trips.js';
import { createNotificationHandlers } from './handlers/notifications.js';
import { createAuthenticator } from './token.js';
import { createHealthHandlers } from './health.js';
import { buildRoutes } from './routes.js';
import { createApp } from './app.js';

// Cổng là hằng số trong code (03 mục 13); Compose ánh xạ 3000:3000 — cổng DUY NHẤT cho nghiệp vụ (mục chấm 8).
const HTTP_PORT = 3000;

const log = createLogger(process.env.SERVICE_NAME || 'gateway');

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  log.error('cấu hình sai, dừng service', { variable: err.variable, reason: err.reason });
  process.exit(1);
}

const redis = createRedis(config.redisUrl, log);
const healthClients = createHealthClients(config.grpcAddrs);
const authClient = createAuthClient(config.grpcAddrs['auth-service']);
const customerClient = createCustomerClient(config.grpcAddrs['customer-service']);
const driverClient = createDriverClient(config.grpcAddrs['driver-service']);
const bookingClient = createBookingClient(config.grpcAddrs['booking-service']);
const paymentClient = createPaymentClient(config.grpcAddrs['payment-service']);
const tripClient = createTripClient(config.grpcAddrs['trip-service']);
const notificationClient = createNotificationClient(config.grpcAddrs['notification-service']);
const ratingClient = createRatingClient(config.grpcAddrs['rating-service']);
const revocations = createRevocationStore(redis);
// Rate limit (mục chấm 29): ngưỡng và cửa sổ đọc từ môi trường để chỉnh khi demo / khi chạy bộ test tự động.
const rateLimiter = createRateLimiter({
  redis,
  windowSeconds: config.rateLimitWindowSeconds,
  publicMax: config.rateLimitPublicMax,
  accountMax: config.rateLimitAccountMax,
  bookingMax: config.rateLimitBookingMax,
  log,
});

const health = createHealthHandlers({
  redisPing: () => pingRedis(redis),
  healthClients,
  expectedServices: BACKEND_SERVICES.map(([name]) => name),
  log, // ghi lý do service `unhealthy` (NOT_SERVING / UNREACHABLE / DEADLINE_EXCEEDED) — không trả ra ngoài
});
const auth = createAuthHandlers({ authClient, revocations, log });
const customers = createCustomerHandlers({ customerClient });
const drivers = createDriverHandlers({ driverClient });
const bookings = createBookingHandlers({ bookingClient });
const payments = createPaymentHandlers({ paymentClient });
const trips = createTripHandlers({ tripClient });
const notifications = createNotificationHandlers({ notificationClient });
const ratings = createRatingHandlers({ ratingClient });
const authenticate = createAuthenticator({ secret: config.jwtSecret, isRevoked: revocations.isRevoked, log });
const app = createApp({
  routes: buildRoutes({ health, auth, customers, drivers, bookings, payments, trips, notifications, ratings }),
  log,
  authenticate,
  rateLimiter,
});

const server = app.listen(HTTP_PORT, '0.0.0.0', () => log.info('HTTP đang nghe', { port: HTTP_PORT }));

// Bắt SIGTERM để `docker compose stop gateway` dừng ngay, không phải chờ 10 giây.
const shutdown = () => {
  log.info('đang dừng');
  server.close();
  for (const client of Object.values(healthClients)) client.close();
  authClient.close();
  customerClient.close();
  driverClient.close();
  bookingClient.close();
  paymentClient.close();
  tripClient.close();
  notificationClient.close();
  ratingClient.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
