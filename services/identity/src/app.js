import express from 'express';
import { db } from './db.js';

const app = express();

app.use(express.json({ limit: '21kb' }));

app.use((req, res, next) => {
  console.log(`[Identity] ${req.method} ${req.path}`);
  next();
});

// Liveness: tiến trình Identity có phản hồi HTTP không?
// Không truy vấn database tại endpoint này.
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'identity',
    status: 'healthy',
  });
});

// Readiness: Identity có dùng được dependency cần thiết không?
app.get('/ready', async (req, res) => {
  try {
    // Một câu SQL đơn giản để kiểm tra kết nối và thực thi truy vấn.
    // Chưa đọc hoặc ghi dữ liệu tài khoản.
    await db.query('SELECT 1');

    res.status(200).json({
      service: 'identity',
      status: 'ready',
      dependencies: {
        database: 'ready',
      },
    });
  } catch (error) {
    console.error(
      '[Identity] Database readiness failed:',
      error.code || error.name,
    );

    res.status(503).json({
      service: 'identity',
      status: 'not_ready',
      dependencies: {
        database: 'unavailable',
      },
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'ROUTE_NOT_FOUND',
    message: 'Đường dẫn API không tồn tại.',
  });
});

export default app;