// Kiểm tra token ở Gateway (spec 09-10 mục 4.1 bước 2–5; mục chấm 27; FR42).
// Gateway kiểm tra TẠI CHỖ bằng JWT_SECRET, không gọi auth-service mỗi request: Auth không thành
// điểm nghẽn, và Gateway là nơi duy nhất mọi request đi qua.
// Phụ thuộc (khóa, hàm tra danh sách thu hồi, log) truyền từ ngoài vào để test không cần Redis.
import jwt from 'jsonwebtoken';

export const ROLES = Object.freeze(['customer', 'driver', 'admin']);
const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;

const fail = (status, error) => ({ ok: false, status, error });

// Bước 2: đọc header `Authorization: Bearer <token>`.
// Không có header hoặc token rỗng = chưa đăng nhập (TOKEN_MISSING); có mà sai dạng = TOKEN_INVALID.
export function readBearer(header) {
  if (header === undefined || header.trim() === '') return { error: 'TOKEN_MISSING' };
  const match = /^Bearer(?:\s+(.*))?$/i.exec(header.trim());
  if (!match) return { error: 'TOKEN_INVALID' };
  const token = (match[1] ?? '').trim();
  if (token === '') return { error: 'TOKEN_MISSING' };
  if (/\s/.test(token)) return { error: 'TOKEN_INVALID' };
  return { token };
}

// Bước 3–4: chữ ký, hạn, claim. Trả payload đã kiểm tra hoặc mã lỗi.
export function verifyToken(token, secret) {
  let payload;
  try {
    // algorithms: ['HS256'] — CHỈ nhận HS256. Token tự khai "alg": "none" hay thuật toán khác bị từ chối,
    // nên không ai làm giả được token bằng cách bỏ chữ ký.
    // Thư viện kiểm tra chữ ký TRƯỚC rồi mới tới hạn: token bị sửa luôn là TOKEN_INVALID.
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    return { error: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' };
  }
  // Chữ ký đúng nhưng nội dung phải đúng dạng auth-service phát hành. Cần `exp` để biết
  // giữ `revoked:{jti}` trong Redis bao lâu khi đăng xuất.
  const valid = payload !== null && typeof payload === 'object'
    && typeof payload.sub === 'string' && ACCOUNT_ID.test(payload.sub)
    && ROLES.includes(payload.role)
    && typeof payload.jti === 'string' && payload.jti !== ''
    && Number.isInteger(payload.exp);
  if (!valid) return { error: 'TOKEN_INVALID' };
  return { payload };
}

export function createAuthenticator({ secret, isRevoked, log }) {
  return async function authenticate(req) {
    const bearer = readBearer(req.get('authorization'));
    if (bearer.error) return fail(401, bearer.error);

    const checked = verifyToken(bearer.token, secret);
    if (checked.error) return fail(401, checked.error);
    const { sub, role, jti, exp } = checked.payload;

    // Bước 5: token đã đăng xuất? Redis dừng thì CHO QUA và cảnh báo (quyết định đã chốt):
    // hệ thống không dừng chỉ vì thiếu danh sách thu hồi; đánh đổi là token đã đăng xuất tạm dùng lại được.
    try {
      if (await isRevoked(jti)) return fail(401, 'TOKEN_REVOKED');
    } catch (err) {
      log.warn('redis: không tra được danh sách thu hồi, cho request đi qua', { code: err.code ?? err.message, request_id: req.requestId });
    }
    return { ok: true, identity: { accountId: sub, role, jti, exp } };
  };
}
