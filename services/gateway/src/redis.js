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
