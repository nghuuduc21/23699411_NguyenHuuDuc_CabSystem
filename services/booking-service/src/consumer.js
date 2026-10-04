// Nghe K6 `payment.status-changed` (spec 14-15-16-19-30 mục 5.6). Vì sao bất đồng bộ: kết quả thanh toán đến
// lúc không biết trước (callback), và tiền đã thu thì Payment phải ghi nhận xong dù Booking đang lỗi (NFR14);
// Booking chạy lại thì đọc tiếp từ chỗ đã dừng (offset của consumer group lưu ở Kafka).
//
//   - Consumer group `booking-service`: nhiều bản booking chạy cùng lúc thì mỗi event chỉ một bản xử lý.
//   - fromBeginning: true — lần đầu group được tạo thì đọc cả event phát TRƯỚC đó, không mất event nào.
//   - Không có bảng "event đã xử lý": logic chống lặp bằng chính trạng thái booking (03 mục 11.3).
//   - Message hỏng (không phải JSON) → ghi log rồi bỏ qua: giao lại bao nhiêu lần cũng vẫn hỏng.
//     Lỗi khi xử lý (database dừng) → ném lỗi để kafkajs giao lại message sau.
//   - Kafka dừng lúc khởi động → thử nối lại mỗi 5 giây, KHÔNG chặn gRPC (NFR05).
import { Kafka, logLevel } from 'kafkajs';

const RECONNECT_DELAY_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function startConsumer({ brokers, groupId, topic, onEvent, log }) {
  const kafka = new Kafka({
    clientId: groupId,
    brokers: brokers.split(',').map((b) => b.trim()).filter(Boolean),
    logLevel: logLevel.WARN,
    // Chỉ lấy câu thông báo của kafkajs, không chép dữ liệu message vào log.
    logCreator: () => ({ level, log: entry }) => {
      if (level <= logLevel.ERROR) log.warn('kafkajs', { kafka: entry.message });
    },
  });
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  let stopped = false;

  async function handle({ message }) {
    let envelope;
    try {
      envelope = JSON.parse(message.value.toString('utf8'));
    } catch {
      log.warn('bỏ qua message không phải JSON', { topic, offset: message.offset });
      return;
    }
    await onEvent(envelope);
  }

  (async () => {
    while (!stopped) {
      try {
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: true });
        await consumer.run({ eachMessage: handle });
        log.info('kafka: đang nghe', { topic, group: groupId });
        return;
      } catch (err) {
        log.warn('kafka: chưa nghe được, thử lại', { topic, reason: err?.name ?? 'Error' });
        await consumer.disconnect().catch(() => {});
        await sleep(RECONNECT_DELAY_MS);
      }
    }
  })();

  return {
    // Rời group ngay khi dừng: bản khởi động lại được giao partition liền, không phải chờ hết phiên cũ.
    async stop() {
      stopped = true;
      await consumer.disconnect().catch(() => {});
    },
  };
}
