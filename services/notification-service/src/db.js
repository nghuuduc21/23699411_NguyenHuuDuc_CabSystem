// Kết nối MongoDB của riêng notification-service (database-per-service).
// Vì sao MongoDB: mỗi loại thông báo mang phần `data` khác nhau, chỉ ghi thêm và đọc theo người nhận (03 mục 1.1).
import { MongoClient } from 'mongodb';

// Hằng số trong code (03 mục 13).
export const CONNECT_ATTEMPTS = 15;
export const CONNECT_DELAY_MS = 2000;
export const PING_TIMEOUT_MS = 500;

export function createMongoClient(uri) {
  // serverSelectionTimeoutMS ngắn: database dừng thì lệnh báo lỗi sau 2 giây thay vì treo 30 giây.
  return new MongoClient(uri, { serverSelectionTimeoutMS: 2000, maxPoolSize: 5 });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Container database có thể lên chậm hơn service; thử lại vài lần thay vì chết ngay.
// Hết lượt thì ném lỗi để index.js thoát mã 1 và Compose khởi động lại (spec 00 mục 2.1).
export async function waitForDatabase(client, log, { attempts = CONNECT_ATTEMPTS, delayMs = CONNECT_DELAY_MS, sleep = defaultSleep } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await client.connect();
      await client.db().command({ ping: 1 });
      log.info('database: đã kết nối', { attempt: i });
      return client.db(); // tên database lấy từ đường dẫn trong MONGODB_URI (`/notification`)
    } catch (err) {
      log.warn('database: chưa sẵn sàng, thử lại', { attempt: i, code: err.code ?? err.name });
      if (i === attempts) throw err;
      await sleep(delayMs);
    }
  }
  return undefined;
}

// Dùng cho health: database phải trả lời `ping` trong 500 ms, quá thì coi như hỏng.
export async function pingDatabase(db, timeoutMs = PING_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DB_PING_TIMEOUT')), timeoutMs);
  });
  try {
    await Promise.race([db.command({ ping: 1 }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
