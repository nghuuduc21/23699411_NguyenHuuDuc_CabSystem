// Đọc và kiểm tra biến môi trường của auth-service (spec 00 mục 3.5).
// Vì sao kiểm tra ngay khi khởi động: thiếu khóa mà vẫn chạy thì lỗi chỉ lộ ra
// giữa lúc demo; thoát mã 1 ngay thì `docker compose logs` chỉ rõ biến nào thiếu.
// Lỗi chỉ nêu TÊN biến, không bao giờ nêu giá trị (giá trị có thể là bí mật).

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

// JWT ký HS256 (ADR-016): khóa ngắn thì dễ dò, nên bắt buộc ít nhất 32 ký tự.
function jwtSecret(env, name) {
  const value = required(env, name);
  if (value.length < 32) throw new ConfigError(name, 'TOO_SHORT');
  return value;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    serviceName: required(env, 'SERVICE_NAME'),
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtSecret: jwtSecret(env, 'JWT_SECRET'),
    jwtTtlSeconds: positiveInt(env, 'JWT_TTL_SECONDS'),
    otpTtlSeconds: positiveInt(env, 'OTP_TTL_SECONDS'),
    seedPassword: required(env, 'SEED_PASSWORD'),
    simulationMode: bool(env, 'SIMULATION_MODE'),
  });
}
