// Quy tắc kiểm tra của rating-service (spec 20-29 mục 4.1, 5.3). Không phụ thuộc gRPC hay database.
// Service tự kiểm tra lại mọi điều Gateway đã kiểm: không tin bên gọi (ai đó có thể gọi thẳng service).

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class RatingError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind;
    this.code = code;
  }
}

export const invalid = (code = 'INVALID_INPUT') => new RatingError('INVALID_ARGUMENT', code);

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];

// Danh tính do Gateway dựng từ token (04 mục 1.7). Thiếu / sai dạng = có ai gọi thẳng service → từ chối.
export function requireRole(identity, roles) {
  const { accountId, role } = identity ?? {};
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
    throw new RatingError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
  if (!roles.includes(role)) throw new RatingError('PERMISSION_DENIED', 'FORBIDDEN');
  return { accountId: Number(accountId), role };
}

// Mã (chuyến, tài xế): số nguyên dương an toàn trong JavaScript (ADR-015).
export function checkId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}

// V4 / DG1: điểm là số nguyên 1–5.
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;
export function checkScore(value) {
  if (!Number.isInteger(value) || value < SCORE_MIN || value > SCORE_MAX) throw invalid();
  return value;
}

// DG7: nhận xét tùy chọn; cắt khoảng trắng hai đầu; 1–500 ký tự; không `<` `>` (mục chấm 26, lớp 2).
// Trả null khi không gửi. Đếm theo ký tự (code point) như CHECK char_length của PostgreSQL.
export const COMMENT_MAX = 500;
export function checkComment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid();
  const text = value.trim();
  if (text === '' || [...text].length > COMMENT_MAX) throw invalid();
  if (text.includes('<') || text.includes('>')) throw invalid('TEXT_CONTAINS_HTML');
  return text;
}

// DG4: trung bình làm tròn 1 chữ số thập phân, tính từ tổng + số lượng (9 / 2 = 4.5; 14 / 3 = 4.7).
export const average = (sum, count) => Math.round((sum * 10) / count) / 10;
