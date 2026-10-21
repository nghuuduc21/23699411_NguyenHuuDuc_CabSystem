// Hàm xử lý A04, A05, A06 (spec 09-10 mục 4.2–4.4) và A07, A08 (spec 12-13-21-23 mục 4.2, 4.3).
// Không có logic nghiệp vụ: A04, A05 chỉ đổi REST ↔ gRPC; A06 chỉ ghi `jti` vào danh sách thu hồi.
// Kiểm tra token, role, hình thức body đã làm ở app.js trước khi vào đây.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp, SERVICE_UNAVAILABLE } from '../grpc/errors.js';

// Chỉ chép field có mặt: field `optional` của proto (`email`, `phone` của Login) không gửi khác với gửi chuỗi rỗng.
function pick(body, keys) {
  const out = {};
  for (const key of keys) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

export function createAuthHandlers({ authClient, revocations, log, now = () => Date.now() }) {
  // Gọi rpc rồi trả JSON; lỗi gRPC đổi sang HTTP theo bảng chung (errors.js).
  // `outKeys`: chỉ trả các key này. Cần cho response có field `optional` (A07 `otp`): với oneofs: true,
  // thư viện thêm key phụ `_otp` — không được lọt ra JSON.
  const forward = (method, keys, okStatus, outKeys) => async (req, res) => {
    try {
      const response = await callUnary(authClient, method, pick(req.body, keys), buildMetadata(req));
      res.status(okStatus).json(outKeys ? pick(response, outKeys) : response);
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };

  return {
    // A04: 201 vì tạo mới một tài khoản. Không trả token: mục 9 phải thấy "đăng ký xong ĐĂNG NHẬP được".
    // Khách đăng ký bằng email (ADR-021).
    register: forward('RegisterCustomer', ['email', 'password'], 201),
    // A05: 200, đăng nhập không tạo bản ghi nào (JWT không lưu phiên). Đúng một trong email / phone (đã kiểm).
    login: forward('Login', ['email', 'phone', 'password'], 200),
    // A07: 201 — mỗi lần xin là một mã OTP mới được tạo và lưu (TX-Q1 đã chốt). `otp` chỉ có khi giả lập.
    requestOtp: forward('RequestDriverOtp', ['phone'], 201, ['phone', 'expires_in', 'otp']),
    // A08: 201 vì tạo mới tài khoản tài xế; response có luôn token để nộp hồ sơ ngay.
    registerDriver: forward('RegisterDriver', ['phone', 'otp', 'password'], 201, ['account_id', 'role', 'token', 'expires_in']),

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
