// Quy tắc kiểm tra và danh tính của payment-service (spec 14-15-16-19-30 mục 4.8, 4.9, 5.2, 5.5).
// Không phụ thuộc gRPC hay database: test gọi thẳng các hàm này.
// Service tự kiểm tra lại mọi điều Gateway đã kiểm: service không tin bên gọi.
import { createHash, timingSafeEqual } from 'node:crypto';

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class PaymentError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind;
    this.code = code;
  }
}

export const invalid = (code = 'INVALID_INPUT') => new PaymentError('INVALID_ARGUMENT', code);
export const conflict = (code) => new PaymentError('FAILED_PRECONDITION', code);
const forbidden = () => new PaymentError('PERMISSION_DENIED', 'FORBIDDEN');
const identityMissing = () => new PaymentError('UNAUTHENTICATED', 'IDENTITY_MISSING');

export const METHODS = ['CASH', 'ONLINE'];
export const SIMULATE_RESULTS = ['SUCCESS', 'FAILED', 'MANUAL'];
export const CALLBACK_RESULTS = ['SUCCESS', 'FAILED'];
// Tối đa 3 lần thử thanh toán (BRULE17). Hằng số trong code (03 mục 13), không gắn cứng vào CHECK.
export const MAX_ATTEMPTS = 3;
export const IDEMPOTENCY_KEY_MAX = 100;

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];
export const SYSTEM_ROLE = 'system';

// Danh tính do Gateway dựng từ token (04 mục 1.7). Thiếu / sai dạng = có ai gọi thẳng service → từ chối.
export function requireRole(identity, roles) {
  const { accountId, role } = identity ?? {};
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) throw identityMissing();
  if (!roles.includes(role)) throw forbidden();
  return { accountId: Number(accountId), role };
}

// Lời gọi nội bộ của booking-service (S4) mang `x-role: system` (DX2 đã chốt), không có x-account-id.
export function requireSystem(identity) {
  if (typeof identity?.role !== 'string' || identity.role === '') throw identityMissing();
  if (identity.role !== SYSTEM_ROLE) throw forbidden();
}

export function checkId(value, code = 'INVALID_ID') {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(code);
  return value;
}

// Enum không phân biệt hoa thường (04 mục 1.8). `undefined` = không gửi.
export function normalizeEnum(value, allowed) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid();
  const upper = value.trim().toUpperCase();
  if (!allowed.includes(upper)) throw invalid();
  return upper;
}

// Header Idempotency-Key: bắt buộc, 1–100 ký tự sau khi cắt khoảng trắng (spec mục 4.1).
export function checkIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 1 || key.length > IDEMPOTENCY_KEY_MAX) throw invalid('IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

// "Cùng nội dung" = cùng SHA-256 của body ĐÃ CHUẨN HÓA (04 mục 1.4): body rỗng → `{}`,
// có simulate_result → `{"simulate_result":"<CHỮ HOA>"}`. Nhờ vậy gõ "manual" hay "MANUAL" vẫn là cùng một request.
export function requestHash(simulateResult) {
  const canonical = simulateResult === undefined ? '{}' : JSON.stringify({ simulate_result: simulateResult });
  return createHash('sha256').update(canonical).digest('hex');
}

// So khóa bí mật của callback bằng thời gian KHÔNG phụ thuộc nội dung (timingSafeEqual): kẻ tấn công
// không đoán dần được từng ký tự qua thời gian phản hồi. Độ dài khác → sai ngay (04 mục 2.7).
export function secretMatches(given, expected) {
  if (typeof given !== 'string' || given === '') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const iso = (value) => (value === null || value === undefined ? undefined : new Date(value).toISOString());
export const isPresent = (value) => value !== undefined && value !== null;
