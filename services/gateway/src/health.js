// Ba endpoint health của Gateway (A01–A03, mục chấm 6). Mỗi endpoint trả lời một câu hỏi khác nhau:
//   /health          Gateway còn sống không?               → luôn 200 nếu tiến trình chạy
//   /ready           Gateway đủ phụ thuộc của chính nó chưa? → Redis trả lời và đã tạo 8 client gRPC
//   /health/services 8 service phía sau thế nào?            → gọi Health/Check song song
// Chữ trả ra ngoài (sửa 2026-10-14 theo yêu cầu giảng viên, spec 00 H13) chỉ có:
//   healthy / unhealthy  — từng service, từng mục `checks`, tổng của /health, /health/services
//   ready / not_ready    — tổng của /ready
// Vì sao gộp NOT_SERVING / UNREACHABLE / quá hạn thành một chữ `unhealthy`: người gọi chỉ cần biết dùng được hay
// không. Lý do cụ thể ghi vào log `warn` của Gateway (xem bằng `docker compose logs gateway`).
// Phụ thuộc truyền từ ngoài vào (redisPing, healthClients, log) để test không cần Redis và service thật.
import { HEALTH_DEADLINE_MS } from './grpc/clients.js';

const DEADLINE_EXCEEDED = 4; // mã gRPC status

// Hỏi một service. Không bao giờ ném lỗi; trả { healthy, reason } — `reason` chỉ dùng để ghi log.
export function checkService(client, deadlineMs = HEALTH_DEADLINE_MS) {
  return new Promise((resolve) => {
    client.Check({ service: '' }, { deadline: Date.now() + deadlineMs }, (err, response) => {
      // Không kết nối được (service dừng) hoặc quá deadline (service treo).
      if (err) resolve({ healthy: false, reason: err.code === DEADLINE_EXCEEDED ? 'DEADLINE_EXCEEDED' : 'UNREACHABLE' });
      // Service trả lời nhưng không SERVING: thường là mất database của nó.
      else if (response.status !== 'SERVING') resolve({ healthy: false, reason: 'NOT_SERVING' });
      else resolve({ healthy: true });
    });
  });
}

const word = (ok) => (ok ? 'healthy' : 'unhealthy');

export function createHealthHandlers({ redisPing, healthClients, expectedServices, log }) {
  return {
    live(req, res) {
      res.status(200).json({ status: 'healthy' });
    },

    async ready(req, res) {
      const redisUp = await redisPing();
      const clientsCreated = expectedServices.every((name) => healthClients[name]);
      const checks = { redis: word(redisUp), grpc_clients: word(clientsCreated) };
      const ok = redisUp && clientsCreated;
      // 503 chỉ là báo cáo: Gateway vẫn phục vụ request khác khi Redis dừng (quyết định đã chốt).
      res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks });
    },

    async services(req, res) {
      // Gọi song song: tổng thời gian ≈ một deadline (1 giây) dù nhiều service cùng dừng.
      const results = await Promise.all(expectedServices.map((name) => checkService(healthClients[name])));
      // Thứ tự key theo thứ tự 8 service (auth … rating) để người chấm đọc nhanh.
      const services = {};
      expectedServices.forEach((name, i) => {
        services[name] = word(results[i].healthy);
        if (!results[i].healthy) log?.warn('service_unhealthy', { service: name, reason: results[i].reason, request_id: req.requestId });
      });
      const allHealthy = results.every((result) => result.healthy);
      res.status(allHealthy ? 200 : 503).json({ status: word(allHealthy), services });
    },
  };
}
