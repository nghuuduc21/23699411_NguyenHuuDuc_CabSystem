import express from 'express';

// Hàm tạo ứng dụng Gateway.
// Cho phép bên gọi truyền địa chỉ Identity vào:
// - Chạy thật: dùng Identity thật.
// - Chạy test: dùng server giả lập.
export function createApp({
  identityUrl = process.env.IDENTITY_URL || 'http://127.0.0.1:3002',
} = {}) {
  const app = express();

  app.use(express.json({ limit: '16kb' }));

  app.use((req, res, next) => {
    console.log(`[Gateway] ${req.method} ${req.path}`);
    next();
  });

  // Chỉ kiểm tra Gateway còn phản hồi.
  app.get('/health', (req, res) => {
    res.status(200).json({
      service: 'gateway',
      status: 'healthy',
    });
  });

  // Kiểm tra service mà Gateway phụ thuộc.
  app.get('/health/services', async (req, res) => {
    try {
      const response = await fetch(`${identityUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });

      // fetch không tự báo lỗi khi server trả HTTP 503.
      if (!response.ok) {
        throw new Error(`Identity trả HTTP ${response.status}`);
      }

      const identity = await response.json();

      // Kiểm tra cả cấu trúc/nội dung phản hồi.
      if (
        identity.service !== 'identity' ||
        identity.status !== 'healthy'
      ) {
        throw new Error('Identity trả health response không hợp lệ');
      }

      res.status(200).json({
        status: 'ready',
        services: {
          identity: 'healthy',
        },
      });
    } catch (error) {
      console.error(
        '[Gateway] Identity health check failed:',
        error.message,
      );

      res.status(503).json({
        status: 'not_ready',
        services: {
          identity: 'unavailable',
        },
      });
    }
  });

  // Đặt sau tất cả route hợp lệ.
  app.use((req, res) => {
    res.status(404).json({
      error: 'ROUTE_NOT_FOUND',
      message: 'Đường dẫn API không tồn tại.',
    });
  });

  return app;
}

// Giữ cách import cũ để server.js và test Gateway trước vẫn chạy.
export default createApp();