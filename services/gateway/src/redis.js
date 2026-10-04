// Kết nối Redis của Gateway. Redis chỉ dùng cho hai việc: bộ đếm rate limit và
// danh sách token đã thu hồi (CLAUDE.md, ADR-010). Không cache dữ liệu nghiệp vụ.
import Redis from 'ioredis';

export const REDIS_PING_TIMEOUT_MS = 500;
const RECONNECT_DELAY_MS = 1000;

export function createRedis(url, log) {
  const redis = new Redis(url, {
    // Redis dừng thì lệnh báo lỗi NGAY thay vì xếp hàng chờ: Gateway cho request đi qua
    // (quyết định đã chốt) chứ không treo theo Redis.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    // Thử nối lại mỗi giây, mãi mãi: Redis bật lại là Gateway tự dùng lại, không cần khởi động lại.
    retryStrategy: () => RECONNECT_DELAY_MS,
  });

  // Chỉ ghi log khi trạng thái ĐỔI, để Redis dừng không làm log tràn mỗi giây một dòng.
  let up = null;
  redis.on('ready', () => {
    if (up !== true) log.info('redis: đã kết nối');
    up = true;
  });
  const markDown = (code) => {
    if (up !== false) log.warn('redis: không kết nối được, tạm bỏ qua rate limit và danh sách thu hồi', { code });
    up = false;
  };
  // Redis dừng êm (docker compose stop) chỉ phát 'close'; Redis không tới được thì phát 'error'.
  redis.on('close', () => markDown('CONNECTION_CLOSED'));
  redis.on('error', (err) => markDown(err.code));
  return redis;
}

// PING có hạn 500 ms (A02). Trả true/false, không ném lỗi.
export async function pingRedis(redis, timeoutMs = REDIS_PING_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('REDIS_PING_TIMEOUT')), timeoutMs);
  });
  try {
    return (await Promise.race([redis.ping(), timeout])) === 'PONG';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Danh sách token đã thu hồi khi đăng xuất (FR42; 03 mục 12): key `revoked:{jti}`, giá trị 1.
// Chỉ lưu `jti` (mã của token), không lưu cả token: đủ để nhận ra token, không giữ thứ dùng được để đăng nhập.
// Mỗi lệnh có hạn 500 ms như PING: Redis treo cũng không làm request treo theo.
export const REDIS_COMMAND_TIMEOUT_MS = 500;

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('REDIS_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createRevocationStore(redis, timeoutMs = REDIS_COMMAND_TIMEOUT_MS) {
  return {
    // Ném lỗi khi Redis dừng; bên gọi (token.js) quyết định cho qua.
    async isRevoked(jti) {
      return (await withTimeout(redis.exists(`revoked:${jti}`), timeoutMs)) === 1;
    },
    // EX = thời gian sống còn lại của token: hết hạn thì token tự vô hiệu, key cũng tự xóa,
    // Redis không phình ra theo thời gian.
    async revoke(jti, ttlSeconds) {
      await withTimeout(redis.set(`revoked:${jti}`, '1', 'EX', ttlSeconds), timeoutMs);
    },
  };
}
