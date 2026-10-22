// Quy tắc kiểm tra của trip-service (spec 14-15-16-19-30 mục 5.3, 5.5). Không phụ thuộc gRPC hay database.
// Service tự kiểm tra lại mọi thứ, kể cả khi bên gọi là service nội bộ: không tin bên gọi.

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class TripError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind;
    this.code = code;
  }
}

export const invalid = (code = 'INVALID_INPUT') => new TripError('INVALID_ARGUMENT', code);

// Lời gọi nội bộ (DX2 đã chốt): booking-service gửi metadata `x-role: system`.
// Không có x-role → IDENTITY_MISSING; role khác → FORBIDDEN. Gateway không bao giờ gửi `system`.
export const SYSTEM_ROLE = 'system';
export function requireSystem(identity) {
  if (typeof identity?.role !== 'string' || identity.role === '') throw new TripError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  if (identity.role !== SYSTEM_ROLE) throw new TripError('PERMISSION_DENIED', 'FORBIDDEN');
}

export const PAYMENT_METHODS = ['CASH', 'ONLINE'];
export const ADDRESS_MAX = 255;

export function checkId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}

export function checkLat(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -90 || value > 90) throw invalid();
  return value;
}

export function checkLng(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -180 || value > 180) throw invalid();
  return value;
}

// Họ tên, biển số tài xế chụp vào chuyến (DX25). Cùng giới hạn với CHECK của migration 002: kiểm ở đây để dữ liệu
// sai trả INVALID_INPUT rõ ràng thay vì lỗi CHECK của database (INTERNAL). proto3 `string` không gửi = chuỗi rỗng.
const PLATE = /^[A-Z0-9.-]{5,15}$/;
export function checkDriverName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '' || [...text].length > 100) throw invalid();
  return text;
}
export function checkPlate(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!PLATE.test(text)) throw invalid();
  return text;
}

// proto3: field `optional` không gửi là undefined.
export const isPresent = (value) => value !== undefined && value !== null;

// ---- Spec 17-18: xem, tiến trạng thái, hủy chuyến (A27–A29) ----

export const conflict = (code) => new TripError('FAILED_PRECONDITION', code);
export const TRIP_STATUSES = ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'];
// T2: chỉ được tiến ĐÚNG bước kế tiếp. Bảng hằng số — đọc là hiểu trình tự, không cần lật code.
export const NEXT = Object.freeze({ ACCEPTED: 'ARRIVED', ARRIVED: 'PICKED_UP', PICKED_UP: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' });
// Trạng thái tài xế được gửi ở A28 (CANCELED đi đường A29 riêng vì cần lý do và cả khách cũng hủy được).
export const DRIVER_STEPS = ['ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED'];
// T5, BRULE16: chỉ hủy được TRƯỚC khi đón khách (PICKED_UP = chuyến bắt đầu).
export const CANCELABLE = ['ACCEPTED', 'ARRIVED'];
export const REASON_MAX = 255;

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];

// Danh tính do Gateway dựng từ token (04 mục 1.7). Thiếu / sai dạng = có ai gọi thẳng service → từ chối.
// `system` (booking) không nằm trong ROLES nên không gọi được các rpc dành cho người dùng.
export function requireRole(identity, roles) {
  const { accountId, role } = identity ?? {};
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
    throw new TripError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
  if (!roles.includes(role)) throw new TripError('PERMISSION_DENIED', 'FORBIDDEN');
  return { accountId: Number(accountId), role };
}

// Mã chuyến trong đường dẫn: số nguyên dương (Gateway đã chặn, service kiểm lại).
export function checkTripId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('INVALID_ID');
  return value;
}

// Lý do hủy (spec 17-18 mục 4): bắt buộc (FR36), chặn `<` `>` (mục chấm 26), tối đa 255 ký tự sau khi cắt.
// proto3 `string` không gửi thì là chuỗi rỗng → REASON_REQUIRED như khi gửi toàn khoảng trắng.
export function checkReason(value) {
  if (value === undefined || value === null) throw invalid('REASON_REQUIRED');
  if (typeof value !== 'string') throw invalid();
  const text = value.trim();
  if (text === '') throw invalid('REASON_REQUIRED');
  if (text.includes('<') || text.includes('>')) throw invalid('TEXT_CONTAINS_HTML');
  if ([...text].length > REASON_MAX) throw invalid();
  return text;
}
