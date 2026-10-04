// Đọc và kiểm tra biến môi trường của payment-service (spec 00 mục 3.5).
// Vì sao kiểm tra ngay khi khởi động: thiếu khóa mà vẫn chạy thì lỗi chỉ lộ ra
// giữa lúc demo; thoát mã 1 ngay thì `docker compose logs` chỉ rõ biến nào thiếu.
// Lỗi chỉ nêu TÊN biến, không bao giờ nêu giá trị (giá trị có thể là bí mật).
// Service chỉ đọc biến của mình: Compose cũng chỉ truyền đúng các biến này (spec 00 H9).

export class ConfigError extends Error {
  constructor(variable, reason) {
    super(`${variable}: ${reason}`);
    this.variable = variable;
    this.reason = reason;
  }
}

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

function bool(env, name) {
  const value = required(env, name);
  if (value !== 'true' && value !== 'false') throw new ConfigError(name, 'NOT_TRUE_OR_FALSE');
  return value === 'true';
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    databaseUrl: required(env, 'DATABASE_URL'),
    paymentCallbackSecret: required(env, 'PAYMENT_CALLBACK_SECRET'),
    paymentTimeoutSeconds: positiveInt(env, 'PAYMENT_TIMEOUT_SECONDS'),
    // Địa chỉ Kafka: phát K6 payment.status-changed (spec 14-15-16-19-30 mục 6).
    kafkaBrokers: required(env, 'KAFKA_BROKERS'),
    simulationMode: bool(env, 'SIMULATION_MODE'),
  });
}
