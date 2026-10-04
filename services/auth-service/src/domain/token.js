// Ký JWT HS256 bằng JWT_SECRET (ADR-016; spec 09-10 mục 4.3).
// Vì sao HS256: một khóa bí mật dùng chung với Gateway, không phải sinh cặp khóa.
// Sửa payload (ví dụ đổi role) thì chữ ký tính lại không khớp → Gateway trả 401 (mục chấm 27).
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export function createTokenSigner({ secret, ttlSeconds, newId = randomUUID }) {
  return {
    ttlSeconds,
    sign({ accountId, role }) {
      // Payload chỉ có mã và role: payload là base64, ai cũng đọc được, nên KHÔNG đưa
      // số điện thoại, email, họ tên vào.
      //   sub: chuỗi theo chuẩn JWT ("1"); Gateway chuyển nguyên chuỗi này xuống service.
      //   jti: mã riêng của token này, để đăng xuất thu hồi đúng một token (FR42).
      //   iat, exp: thư viện tự thêm; exp = iat + JWT_TTL_SECONDS.
      return jwt.sign({ role }, secret, {
        algorithm: 'HS256',
        subject: String(accountId),
        jwtid: newId(),
        expiresIn: ttlSeconds,
      });
    },
  };
}
