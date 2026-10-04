// Trạng thái health của service (spec 00 mục 5).
// SERVING khi đã chạy xong migration VÀ database trả lời ngay lúc được hỏi.
// Vì sao hỏi database mỗi lần Check: service còn sống mà mất database thì vẫn không làm được việc;
// Gateway cần thấy NOT_SERVING để báo đúng ở /health/services.
// Kafka cố ý KHÔNG nằm trong điều kiện: Kafka dừng không được làm service "chết" (NFR05).
// `ping` được truyền từ ngoài vào để test không cần database thật.

export function createHealth({ ping }) {
  let ready = false;
  return {
    markReady() {
      ready = true;
    },
    async check() {
      if (!ready) return 'NOT_SERVING';
      try {
        await ping();
        return 'SERVING';
      } catch {
        return 'NOT_SERVING';
      }
    },
  };
}
