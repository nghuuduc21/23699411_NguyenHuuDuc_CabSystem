// Consumer Kafka (cùng cách với booking-service/src/consumer.js, thêm nghe NHIỀU topic — spec 17-18 mục 5.4).
//   - Consumer group = tên service: nhiều bản cùng service chạy thì mỗi event chỉ một bản xử lý; Kafka UI thấy
//     group này ở mục Consumers (mục chấm 7).
//   - fromBeginning: true (CD11) — lần đầu group được tạo thì đọc cả event phát TRƯỚC đó (Compose khởi động lệch
//     nhau), không mất event nào. Đọc lại event cũ vẫn an toàn vì bên xử lý chịu được event lặp.
//   - Service chạy lại thì đọc tiếp từ chỗ đã dừng (offset của group lưu ở Kafka) → event phát lúc service dừng
//     được xử lý bù (NFR05).
//   - Message hỏng (không phải JSON) → ghi log rồi bỏ qua: giao lại bao nhiêu lần cũng vẫn hỏng.
//     Lỗi khi xử lý (database dừng) → ném lỗi để kafkajs giao lại message sau.
//   - Kafka dừng lúc khởi động → thử nối lại mỗi 5 giây, KHÔNG chặn gRPC (NFR05).
import { Kafka, logLevel } from 'kafkajs';

const RECONNECT_DELAY_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// onEvent(topic, envelope): hàm nghiệp vụ, nhận tên topic và phong bì đã đọc JSON.
export function startConsumer({ brokers, groupId, topics, onEvent, log }) {
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

  async function handle({ topic, message }) {
    let envelope;
    try {
      envelope = JSON.parse(message.value.toString('utf8'));
    } catch {
      log.warn('bỏ qua message không phải JSON', { topic, offset: message.offset });
      return;
    }
    await onEvent(topic, envelope);
  }

  (async () => {
    while (!stopped) {
      try {
        await consumer.connect();
        await consumer.subscribe({ topics, fromBeginning: true });
        await consumer.run({ eachMessage: handle });
        log.info('kafka: đang nghe', { topics, group: groupId });
        return;
      } catch (err) {
        log.warn('kafka: chưa nghe được, thử lại', { topics, reason: err?.name ?? 'Error' });
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
