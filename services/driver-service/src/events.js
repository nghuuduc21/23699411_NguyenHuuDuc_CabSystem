// Phát event Kafka ngay sau khi commit database (ADR-017; spec 00 mục 3.3). Không có bảng outbox.
// Thư viện: kafkajs — client Kafka viết thuần JavaScript, không cần biên dịch thư viện C như node-rdkafka.
//
// Quy tắc gửi (hằng số trong code — 03 mục 13):
//   - Thử tối đa 3 lần, tổng thời gian ≤ 1 giây. Kafka dừng thì người dùng chỉ chờ thêm ≤ 1 giây,
//     rồi bên gọi ghi log EVENT_PUBLISH_FAILED và vẫn trả thành công (NFR05).
//   - Nối Kafka lúc gửi lần đầu, không nối lúc khởi động: Kafka dừng không làm service không lên được.
//   - Phong bì chung (02 mục 6.1): event_id (UUID, để bên nghe chống lặp), event_type (= tên topic — TX5),
//     occurred_at (ISO UTC), data.
import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, Partitioners } from 'kafkajs';

export const PUBLISH_ATTEMPTS = 3;
export const PUBLISH_BUDGET_MS = 1000;
const RETRY_DELAY_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bao một lời hứa bằng hạn chót: quá hạn thì coi như lỗi, không chờ thư viện tự bỏ cuộc (có thể rất lâu).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('KAFKA_TIMEOUT'), { name: 'KafkaTimeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function buildEnvelope(topic, data, { newId = randomUUID, now = () => new Date() } = {}) {
  return { event_id: newId(), event_type: topic, occurred_at: now().toISOString(), data };
}

// `producer` = đối tượng có connect(), send(), disconnect() — producer thật của kafkajs, hoặc bản giả trong test.
export function createEventPublisher({ producer, log, attempts = PUBLISH_ATTEMPTS, budgetMs = PUBLISH_BUDGET_MS, newId, now }) {
  let connected = false;

  async function sendOnce(topic, key, value, remainingMs) {
    if (!connected) {
      await withTimeout(producer.connect(), remainingMs);
      connected = true;
    }
    await withTimeout(producer.send({ topic, messages: [{ key, value }] }), remainingMs);
  }

  return {
    // Ném lỗi nếu cả 3 lần đều hỏng; bên gọi (logic nghiệp vụ) quyết định ghi log và vẫn trả thành công.
    async publish(topic, key, data) {
      const value = JSON.stringify(buildEnvelope(topic, data, { newId, now }));
      const deadline = Date.now() + budgetMs;
      let lastError;
      for (let i = 1; i <= attempts; i += 1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        try {
          await sendOnce(topic, key, value, remaining);
          return;
        } catch (err) {
          lastError = err;
          // Bỏ kết nối hỏng để lần sau nối lại từ đầu (Kafka vừa khởi động lại thì gửi được ngay).
          connected = false;
          producer.disconnect().catch(() => {});
          log.warn('kafka: gửi event lỗi, thử lại', { topic, attempt: i, reason: err?.name ?? 'Error' });
          if (i < attempts) await sleep(Math.min(RETRY_DELAY_MS, Math.max(0, deadline - Date.now())));
        }
      }
      throw lastError ?? new Error('KAFKA_TIMEOUT');
    },
    async close() {
      if (connected) await producer.disconnect().catch(() => {});
    },
  };
}

// Producer thật. Tắt cơ chế thử lại của kafkajs (retries: 0) vì ta tự thử lại trong ngân sách 1 giây.
// Log của kafkajs chuyển sang logger của service, chỉ lấy câu thông báo (không chép dữ liệu message).
export function createKafkaProducer({ brokers, clientId, log }) {
  const kafka = new Kafka({
    clientId,
    brokers: brokers.split(',').map((b) => b.trim()).filter(Boolean),
    connectionTimeout: 500,
    requestTimeout: 1000,
    retry: { retries: 0 },
    logLevel: logLevel.WARN,
    logCreator: () => ({ level, log: entry }) => {
      const fields = { kafka: entry.message };
      if (level <= logLevel.ERROR) log.warn('kafkajs', fields);
    },
  });
  // allowAutoTopicCreation: false — topic phải được đăng ký sẵn ở kafka-init (mục chấm 7).
  return kafka.producer({ allowAutoTopicCreation: false, createPartitioner: Partitioners.DefaultPartitioner, retry: { retries: 0 } });
}
