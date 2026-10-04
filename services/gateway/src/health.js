// Ba endpoint health của Gateway (A01–A03, mục chấm 6). Mỗi endpoint trả lời một câu hỏi khác nhau:
//   /health          Gateway còn sống không?               → luôn 200 nếu tiến trình chạy
//   /ready           Gateway đủ phụ thuộc của chính nó chưa? → Redis trả lời và đã tạo 8 client gRPC
//   /health/services 8 service phía sau thế nào?            → gọi Health/Check song song
// Phụ thuộc truyền từ ngoài vào (redisPing, healthClients) để test không cần Redis và service thật.
import { HEALTH_DEADLINE_MS } from './grpc/clients.js';

// Hỏi một service. Không bao giờ ném lỗi: mọi lỗi kết nối hay quá hạn đều là UNREACHABLE.
export function checkService(client, deadlineMs = HEALTH_DEADLINE_MS) {
  return new Promise((resolve) => {
    client.Check({ service: '' }, { deadline: Date.now() + deadlineMs }, (err, response) => {
      if (err) resolve('UNREACHABLE');
      // Service trả lời nhưng không SERVING: thường là mất database của nó.
      else resolve(response.status === 'SERVING' ? 'SERVING' : 'NOT_SERVING');
    });
  });
}

export function createHealthHandlers({ redisPing, healthClients, expectedServices }) {
  return {
    live(req, res) {
      res.status(200).json({ status: 'UP' });
    },

    async ready(req, res) {
      const redis = (await redisPing()) ? 'UP' : 'DOWN';
      const clientsCreated = expectedServices.every((name) => healthClients[name]);
      const checks = { redis, grpc_clients: clientsCreated ? 'UP' : 'DOWN' };
      const ok = redis === 'UP' && clientsCreated;
      // 503 chỉ là báo cáo: Gateway vẫn phục vụ request khác khi Redis dừng (quyết định đã chốt).
      res.status(ok ? 200 : 503).json({ status: ok ? 'READY' : 'NOT_READY', checks });
    },

    async services(req, res) {
      // Gọi song song: tổng thời gian ≈ một deadline (1 giây) dù nhiều service cùng dừng.
      const results = await Promise.all(expectedServices.map((name) => checkService(healthClients[name])));
      const services = {};
      expectedServices.forEach((name, i) => {
        services[name] = results[i];
      });
      const allServing = results.every((status) => status === 'SERVING');
      res.status(allServing ? 200 : 503).json({ status: allServing ? 'UP' : 'DEGRADED', services });
    },
  };
}
