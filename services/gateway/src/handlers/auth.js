// Hàm xử lý A04, A05, A06 (spec 09-10 mục 4.2–4.4).
// Không có logic nghiệp vụ: A04, A05 chỉ đổi REST ↔ gRPC; A06 chỉ ghi `jti` vào danh sách thu hồi.
// Kiểm tra token, role, hình thức body đã làm ở app.js trước khi vào đây.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp, SERVICE_UNAVAILABLE } from '../grpc/errors.js';

// Chỉ chép field có mặt: `email` trong proto là `optional`, không gửi khác với gửi chuỗi rỗng.
function pick(body, keys) {
  const out = {};
  for (const key of keys) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

export function createAuthHandlers({ authClient, revocations, log, now = () => Date.now() }) {
  // Gọi rpc rồi trả JSON; lỗi gRPC đổi sang HTTP theo bảng chung (errors.js).
  const forward = (method, keys, okStatus) => async (req, res) => {
    try {
      const response = await callUnary(authClient, method, pick(req.body, keys), buildMetadata(req));
      res.status(okStatus).json(response);
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };

  return {
    // A04: 201 vì tạo mới một tài khoản. Không trả token: mục 9 phải thấy "đăng ký xong ĐĂNG NHẬP được".
    register: forward('RegisterCustomer', ['phone', 'email', 'password'], 201),
    // A05: 200, đăng nhập không tạo bản ghi nào (JWT không lưu phiên).
    login: forward('Login', ['phone', 'email', 'password'], 200),

    // A06: Gateway tự xử lý, không gọi auth-service (FR42).
    async logout(req, res) {
      const { jti, exp } = req.identity;
      // Giữ key đúng bằng thời gian sống còn lại của token (tối thiểu 1 giây): sau đó token tự hết hạn.
      const ttl = Math.max(1, exp - Math.floor(now() / 1000));
      try {
        await revocations.revoke(jti, ttl);
      } catch (err) {
        // Khác với lúc KIỂM TRA (Redis dừng thì cho qua): ở đây không ghi được thì việc đăng xuất
        // chưa có hiệu lực, trả 200 là báo sai cho người dùng → 503 (DN-Q1).
        log.warn('redis: không ghi được token thu hồi, đăng xuất thất bại', { code: err.code ?? err.message, request_id: req.requestId });
        res.status(SERVICE_UNAVAILABLE.status).json(SERVICE_UNAVAILABLE.body);
        return;
      }
      res.status(200).json({ status: 'LOGGED_OUT' });
    },
  };
}
