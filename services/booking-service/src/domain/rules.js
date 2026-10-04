// Quy tắc kiểm tra và danh tính của booking-service (spec 14-15-16-19-30 mục 4, 5.1).
// Không phụ thuộc gRPC hay database: test gọi thẳng các hàm này.
// Service tự kiểm tra lại mọi điều Gateway đã kiểm: service không tin bên gọi.

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class BookingError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind; // INVALID_ARGUMENT | UNAUTHENTICATED | PERMISSION_DENIED | NOT_FOUND | FAILED_PRECONDITION | UNAVAILABLE | INTERNAL
    this.code = code;
  }
}

export const invalid = (code = 'INVALID_INPUT') => new BookingError('INVALID_ARGUMENT', code);
export const conflict = (code) => new BookingError('FAILED_PRECONDITION', code);
// Service phía sau (payment, driver, trip) lỗi hoặc quá hạn → Gateway trả 503 SERVICE_UNAVAILABLE.
export const unavailable = () => new BookingError('UNAVAILABLE', 'SERVICE_UNAVAILABLE');

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'SEARCHING', 'DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELED'];
export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'VOIDED'];
export const PAY_METHODS = ['CASH', 'ONLINE'];
export const ADDRESS_MAX = 255;
export const PAGE_MAX = 999_999;
export const LIMIT_MAX = 50;

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];

// Danh tính do Gateway dựng từ token (04 mục 1.7). Thiếu / sai dạng = có ai gọi thẳng service → từ chối.
export function requireRole(identity, roles) {
  const { accountId, role } = identity ?? {};
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
    throw new BookingError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
  if (!roles.includes(role)) throw new BookingError('PERMISSION_DENIED', 'FORBIDDEN');
  return { accountId: Number(accountId), role };
}

export function checkId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('INVALID_ID');
  return value;
}

// Tọa độ dạng mảng [lat, lng] (spec mục 4.1): đúng 2 số hữu hạn → không thì INVALID_INPUT;
// ngoài khoảng → INVALID_COORDINATES.
export function checkPoint(value) {
  if (!Array.isArray(value) || value.length !== 2) throw invalid();
  const [lat, lng] = value;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) throw invalid();
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw invalid('INVALID_COORDINATES');
  return [lat, lng];
}

// Địa chỉ tùy chọn: cắt khoảng trắng, chặn `<` `>` (mục chấm 26), 1–255 ký tự. Không gửi → null.
export function cleanAddress(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid();
  const text = value.trim();
  if (text.includes('<') || text.includes('>')) throw invalid('TEXT_CONTAINS_HTML');
  const length = [...text].length;
  if (length < 1 || length > ADDRESS_MAX) throw invalid();
  return text;
}

// Enum không phân biệt hoa thường (04 mục 1.8). `undefined` = không gửi.
export function normalizeEnum(value, allowed) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid();
  const upper = value.trim().toUpperCase();
  if (!allowed.includes(upper)) throw invalid();
  return upper;
}

// Phân trang (04 mục 1.3): sai thì báo lỗi, không âm thầm sửa.
export function checkPagination(page, limit) {
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) throw invalid('INVALID_PAGINATION');
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw invalid('INVALID_PAGINATION');
  return { page, limit, offset: (page - 1) * limit };
}

export const pagination = (page, limit, total) => ({ page, limit, total, total_pages: Math.ceil(total / limit) });
export const iso = (value) => new Date(value).toISOString();
