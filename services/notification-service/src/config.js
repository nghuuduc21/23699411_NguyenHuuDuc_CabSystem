// Đọc và kiểm tra biến môi trường của notification-service (spec 00 mục 3.5).
// Vì sao kiểm tra ngay khi khởi động: thiếu biến mà vẫn chạy thì lỗi chỉ lộ ra
// giữa lúc demo; thoát mã 1 ngay thì `docker compose logs` chỉ rõ biến nào thiếu.
// Lỗi chỉ nêu TÊN biến, không bao giờ nêu giá trị (MONGODB_URI chứa mật khẩu).

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

function bool(env, name) {
  const value = required(env, name);
  if (value !== 'true' && value !== 'false') throw new ConfigError(name, 'NOT_TRUE_OR_FALSE');
  return value === 'true';
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    mongodbUri: required(env, 'MONGODB_URI'),
    // Địa chỉ Kafka; dùng khi spec sau nghe event (02 mục 6).
    kafkaBrokers: required(env, 'KAFKA_BROKERS'),
    simulationMode: bool(env, 'SIMULATION_MODE'),
  });
}
