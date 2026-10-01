import express from 'express';
import grpc from '@grpc/grpc-js';
import { createIdentityClient } from './identity-client.js';

// gRPC status → HTTP status cho các lỗi nghiệp vụ.
// Các mã còn lại (UNAVAILABLE, DEADLINE_EXCEEDED, ...) là lỗi hạ tầng → 503.
const HTTP_STATUS_BY_GRPC_CODE = {
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.UNAUTHENTICATED]: 401,
  [grpc.status.PERMISSION_DENIED]: 403,
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.ALREADY_EXISTS]: 409,
};

// Service trả mã lỗi dạng INVALID_PHONE trong details.
// Lỗi do chính thư viện gRPC tạo (mất kết nối, ...) có details là câu mô tả
// kỹ thuật, không nên trả cho client.
const isErrorCode = (details) => /^[A-Z][A-Z_]*$/.test(details ?? '');

function sendGrpcError(res, error, fallbackCode) {
  const status = HTTP_STATUS_BY_GRPC_CODE[error.code] ?? 503;

  res.status(status).json({
    error: isErrorCode(error.details) ? error.details : fallbackCode,
  });
}

// Chỉ lấy các field có trong hợp đồng .proto.
// protobuf tự đổi số 123 thành chuỗi "123", nên Gateway phải chặn sai kiểu
// trước khi gửi, để Identity nhận đúng dữ liệu client gửi.
const REGISTER_FIELDS = ['full_name', 'phone', 'email', 'password', 'role'];

function toRegisterRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const request = {};

  for (const field of REGISTER_FIELDS) {
    const value = body[field];

    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return null;

    request[field] = value;
  }

  return request;
}

// Hàm tạo ứng dụng Gateway.
// Cho phép bên gọi truyền Identity client vào:
// - Chạy thật: gọi gRPC đến Identity thật.
// - Chạy test: gọi đến gRPC server giả lập.
export function createApp({
  identityClient = createIdentityClient(
    process.env.IDENTITY_GRPC_URL || '127.0.0.1:50051',
  ),
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
      const identity = await identityClient.check();

      // Kiểm tra cả nội dung phản hồi.
      if (
        identity.service !== 'identity' ||
        identity.status !== 'ready'
      ) {
        throw new Error('Identity chưa sẵn sàng');
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
        grpc.status[error.code] ?? error.message,
      );

      res.status(503).json({
        status: 'not_ready',
        services: {
          identity: 'unavailable',
        },
      });
    }
  });

  // REST từ client → gRPC đến Identity.
  // Identity sở hữu quy tắc đăng ký và việc ghi database.
  app.post('/api/v1/auth/register', async (req, res) => {
    const request = toRegisterRequest(req.body);

    if (!request) {
      return res.status(400).json({
        error: 'INVALID_BODY',
      });
    }

    try {
      const account = await identityClient.register(request);

      res.status(201).json({
        account: { ...account, email: account.email ?? null },
      });
    } catch (error) {
      console.error(
        '[Gateway] Register upstream failed:',
        grpc.status[error.code] ?? error.name,
      );

      sendGrpcError(res, error, 'IDENTITY_UNAVAILABLE');
    }
  });

  // Đặt sau tất cả route hợp lệ.
  app.use((req, res) => {
    res.status(404).json({
      error: 'ROUTE_NOT_FOUND',
      message: 'Đường dẫn API không tồn tại.',
    });
  });

  // Middleware xử lý lỗi có đủ bốn tham số.
  // express.json() chuyển lỗi JSON hỏng đến đây.
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'INVALID_JSON',
      });
    }

    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'BODY_TOO_LARGE',
      });
    }

    console.error('[HTTP] Unexpected error:', error.name);

    res.status(500).json({
      error: 'INTERNAL_ERROR',
    });
  });

  return app;
}

// Giữ cách import cũ để server.js và test Gateway trước vẫn chạy.
export default createApp();
