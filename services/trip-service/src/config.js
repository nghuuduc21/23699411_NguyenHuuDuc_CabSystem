// Đọc và kiểm tra biến môi trường của trip-service (spec 00 mục 3.5).
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

export function loadConfig(env = process.env) {
  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    databaseUrl: required(env, 'DATABASE_URL'),
    // Địa chỉ Kafka: phát K5 trip.status-changed (spec 14-15-16-19-30 mục 6).
    kafkaBrokers: required(env, 'KAFKA_BROKERS'),
    // Không có địa chỉ gRPC của service nào: trip-service không gọi ai (spec 17-18 mục 6). Họ tên, biển số tài xế
    // đã được chụp vào chuyến lúc nhận (CD10) nên S6 GetDriverSummary bỏ hẳn, bỏ luôn DRIVER_GRPC_ADDR (spec 00 H14).
    simulationMode: bool(env, 'SIMULATION_MODE'),
  });
}
