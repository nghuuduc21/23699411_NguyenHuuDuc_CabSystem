// Đọc và kiểm tra biến môi trường của Gateway (spec 00 mục 3.5).
// Thiếu biến hoặc sai định dạng → ném ConfigError chỉ nêu TÊN biến; index.js ghi log rồi thoát mã 1.

export class ConfigError extends Error {
  constructor(variable, reason) {
    super(`${variable}: ${reason}`);
    this.variable = variable;
    this.reason = reason;
  }
}

// Tám service phía sau Gateway và biến chứa địa chỉ gRPC của từng service.
// Thứ tự này cũng là thứ tự hiển thị ở /health/services.
export const BACKEND_SERVICES = [
  ['auth-service', 'AUTH_GRPC_ADDR'],
  ['customer-service', 'CUSTOMER_GRPC_ADDR'],
  ['driver-service', 'DRIVER_GRPC_ADDR'],
  ['booking-service', 'BOOKING_GRPC_ADDR'],
  ['trip-service', 'TRIP_GRPC_ADDR'],
  ['payment-service', 'PAYMENT_GRPC_ADDR'],
  ['notification-service', 'NOTIFICATION_GRPC_ADDR'],
  ['rating-service', 'RATING_GRPC_ADDR'],
];

function required(env, name) {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new ConfigError(name, 'MISSING');
  return value.trim();
}

function positiveInt(env, name) {
  const value = required(env, name);
  if (!/^[1-9][0-9]*$/.test(value)) throw new ConfigError(name, 'NOT_POSITIVE_INTEGER');
  return Number(value);
}

// Gateway chỉ KIỂM TRA chữ ký JWT (HS256, ADR-016); khóa ngắn dễ bị dò nên bắt buộc ≥ 32 ký tự.
function jwtSecret(env, name) {
  const value = required(env, name);
  if (value.length < 32) throw new ConfigError(name, 'TOO_SHORT');
  return value;
}

export function loadConfig(env = process.env) {
  const grpcAddrs = {};
  for (const [service, variable] of BACKEND_SERVICES) grpcAddrs[service] = required(env, variable);

  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    redisUrl: required(env, 'REDIS_URL'),
    jwtSecret: jwtSecret(env, 'JWT_SECRET'),
    // Rate limit (mục chấm 29) dùng ở spec sau; đọc từ môi trường để chỉnh ngắn khi demo.
    rateLimitWindowSeconds: positiveInt(env, 'RATE_LIMIT_WINDOW_SECONDS'),
    rateLimitPublicMax: positiveInt(env, 'RATE_LIMIT_PUBLIC_MAX'),
    rateLimitAccountMax: positiveInt(env, 'RATE_LIMIT_ACCOUNT_MAX'),
    grpcAddrs: Object.freeze(grpcAddrs),
  });
}
