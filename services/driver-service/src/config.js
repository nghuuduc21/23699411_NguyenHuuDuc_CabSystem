// Đọc và kiểm tra biến môi trường của driver-service (spec 00 mục 3.5).
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

function bool(env, name) {
  const value = required(env, name);
  if (value !== 'true' && value !== 'false') throw new ConfigError(name, 'NOT_TRUE_OR_FALSE');
  return value === 'true';
}

// Khóa AES-256-GCM (ADR-012): AES-256 cần đúng 32 byte; sai độ dài thì mã hóa sẽ lỗi
// giữa lúc demo, nên chặn ngay khi khởi động. Khóa ghi trong .env dạng base64 (44 ký tự).
function dataKey(env, name) {
  const value = required(env, name);
  const key = Buffer.from(value, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || key.length !== 32) throw new ConfigError(name, 'NOT_32_BYTES_BASE64');
  return key;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    databaseUrl: required(env, 'DATABASE_URL'),
    driverDataKey: dataKey(env, 'DRIVER_DATA_KEY'),
    // Địa chỉ Kafka: phát K7 driver.application-reviewed (spec 12-13-21-23); nghe K5 trip.status-changed (spec 17-18).
    kafkaBrokers: required(env, 'KAFKA_BROKERS'),
    simulationMode: bool(env, 'SIMULATION_MODE'),
  });
}
