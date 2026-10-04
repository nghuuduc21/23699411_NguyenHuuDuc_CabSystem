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

// proto3: field `optional` không gửi là undefined.
export const isPresent = (value) => value !== undefined && value !== null;
