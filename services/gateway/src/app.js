// Ứng dụng HTTP của Gateway: áp quy định chung cho MỌI route (spec 00 mục 4, 04 mục 1).
// Không chứa logic nghiệp vụ, không nối database: chỉ nhận REST, kiểm tra token/role/(spec sau)
// rate limit/hình thức, rồi chuyển sang gRPC.
import { randomUUID } from 'node:crypto';
import express from 'express';

// Header bảo vệ trên mọi response (mục chấm 26, NFR08):
//   nosniff: trình duyệt không đoán kiểu nội dung (chặn đoán JSON thành HTML/script)
//   CSP default-src 'none': API chỉ trả JSON, không cho tải gì từ response
//   no-store: không lưu response (có thể chứa dữ liệu cá nhân, token) vào cache
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  });
  next();
}

// Mỗi request một mã do Gateway sinh (bỏ qua mã client gửi), trả lại trong header X-Request-Id
// và (spec sau) chuyển cho service qua metadata `x-request-id` để lần theo một request qua nhiều log.
// Log một dòng khi response xong: KHÔNG ghi header Authorization, body, query (có thể chứa dữ liệu cá nhân).
function requestContext(log) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.on('finish', () => {
      log.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        request_id: req.requestId,
      });
    });
    next();
  };
}

// Body đọc là JSON BẤT KỂ Content-Type (luật thi: Postman chọn "Text" vẫn chạy).
// GET bỏ qua body: đổi tab từ POST sang GET, Postman vẫn gửi body cũ — không bắt người thi xóa.
// Trả null nếu ổn (req.body đã gán), hoặc mã lỗi.
export function parseBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.body = {};
    return null;
  }
  const raw = typeof req.body === 'string' ? req.body : '';
  if (raw.trim() === '') {
    req.body = {};
    return null;
  }
  try {
    req.body = JSON.parse(raw);
    return null;
  } catch {
    return 'INVALID_JSON';
  }
}

// Bọc hàm xử lý của route theo đúng thứ tự kiểm tra (spec 09-10 mục 4.1; 04 mục 1):
//   0. khớp route (Express làm) → 404 nếu không có
//   2–5. route cần token: đọc, kiểm tra chữ ký, hạn, claim, danh sách thu hồi → 401
//   6. role của token có trong danh sách của route không → 403
//   7. đọc body là JSON → 400 INVALID_JSON
//   8. kiểm tra hình thức body → 400; rồi tham số đường dẫn (ví dụ mã `{id}` phải là số) → 400
//   9. gọi handler (gọi gRPC)
// Lỗi rẻ nhất trả trước; vì vậy sai role bị 403 dù body rỗng hay hỏng (mục chấm 28).
// Đọc body SAU khi khớp route để đường dẫn không tồn tại luôn trả 404, dù body hỏng.
function wrap(route, authenticate) {
  return async (req, res) => {
    if (route.roles) {
      const result = await authenticate(req);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      if (!route.roles.includes(result.identity.role)) {
        res.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      req.identity = result.identity;
    }
    const error = parseBody(req) ?? route.validate?.(req.body) ?? route.validateParams?.(req.params);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    // Một đường dẫn, nhiều mã API (04 mục 1.10): `select` TRA BẢNG theo một field của body / query để
    // chọn biến thể, đồng thời kiểm tra hình thức của biến thể đó. Không quyết định nghiệp vụ nào.
    //   10. sai hình thức / không chọn được biến thể → 400
    //   11. role của BIẾN THỂ (sau role của đường dẫn) → 403, ví dụ khách gọi A13 chỉ dành cho admin
    if (route.select) {
      const variant = route.select(req);
      if (variant.error) {
        res.status(400).json({ error: variant.error });
        return;
      }
      if (variant.roles && !variant.roles.includes(req.identity.role)) {
        res.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      await variant.handler(req, res);
      return;
    }
    await route.handler(req, res);
  };
}

export function createApp({ routes, log, authenticate }) {
  const app = express();
  app.disable('x-powered-by'); // không lộ tên framework
  app.disable('etag');

  app.use(requestContext(log));
  app.use(securityHeaders);
  // Đọc body dạng chữ cho mọi Content-Type; tự phân tích JSON ở parseBody.
  app.use(express.text({ type: () => true, limit: '100kb' }));

  for (const route of routes) {
    // Route cần token mà không có bộ kiểm tra token là lỗi lắp ghép: dừng ngay khi khởi động.
    if (route.roles && !authenticate) throw new Error(`route ${route.path} cần token nhưng thiếu authenticate`);
    app[route.method.toLowerCase()](route.path, wrap(route, authenticate));
  }

  // Route không tồn tại (gồm đường dẫn nghiệp vụ thiếu /api/v1, hoặc /api/health).
  app.use((req, res) => {
    res.status(404).json({ error: 'ROUTE_NOT_FOUND' });
  });

  // Lỗi không lường trước: 503, không trả stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Lỗi khi đọc body (quá lớn, sai bảng mã…) là lỗi của request, không phải của hệ thống.
    if (err?.type && err.status >= 400 && err.status < 500) {
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }
    log.error('lỗi không lường trước', { request_id: req.requestId, name: err?.name, message: err?.message });
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  });

  return app;
}
