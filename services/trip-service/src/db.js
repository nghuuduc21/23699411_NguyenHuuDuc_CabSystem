// Kết nối PostgreSQL của riêng service này (database-per-service).
import pg from 'pg';

// `pg` trả cột bigint (mã OID 20) dạng chuỗi vì JavaScript không chứa hết số 64 bit.
// Mã của project luôn < 2^53 nên đổi sang số an toàn; JSON trả số, không lẫn "1" và 1
// (ADR-015, 03 mục 2).
pg.types.setTypeParser(20, Number);

// Hằng số trong code (03 mục 13): không phải thứ cần chỉnh khi demo.
export const CONNECT_ATTEMPTS = 15;
export const CONNECT_DELAY_MS = 2000;
export const PING_TIMEOUT_MS = 500;

export function createPool(databaseUrl, log) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2000 });
  // Khi database dừng, kết nối đang rảnh trong pool báo lỗi. Không bắt sự kiện này
  // thì Node coi là lỗi chưa xử lý và tắt cả tiến trình; ta chỉ ghi log,
  // health sẽ báo NOT_SERVING cho tới khi database trở lại.
  pool.on('error', (err) => log.warn('database: kết nối rảnh bị lỗi', { code: err.code }));
  return pool;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Container database có thể lên chậm hơn service; thử lại vài lần thay vì chết ngay.
// Hết lượt thì ném lỗi để index.js thoát mã 1 và Compose khởi động lại (spec 00 mục 2.1).
export async function waitForDatabase(pool, log, { attempts = CONNECT_ATTEMPTS, delayMs = CONNECT_DELAY_MS, sleep = defaultSleep } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      log.info('database: đã kết nối', { attempt: i });
      return;
    } catch (err) {
      log.warn('database: chưa sẵn sàng, thử lại', { attempt: i, code: err.code });
      if (i === attempts) throw err;
      await sleep(delayMs);
    }
  }
}

// Dùng cho health: database phải trả lời trong 500 ms, quá thì coi như hỏng.
export async function pingDatabase(pool, timeoutMs = PING_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DB_PING_TIMEOUT')), timeoutMs);
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
