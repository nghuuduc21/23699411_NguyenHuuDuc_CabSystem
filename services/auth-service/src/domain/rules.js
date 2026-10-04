// Quy tắc kiểm tra và chuẩn hóa dữ liệu tài khoản (spec 09-10 mục 4.2, 4.3).
// Không phụ thuộc gRPC hay database: test gọi thẳng các hàm này.

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class AuthError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind; // INVALID_ARGUMENT | ALREADY_EXISTS | UNAUTHENTICATED | PERMISSION_DENIED
    this.code = code; // mã lỗi trả cho client, ví dụ PHONE_ALREADY_EXISTS
  }
}

const PHONE = /^(?:\+84|84|0)([35789][0-9]{8})$/;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Một số điện thoại có nhiều cách viết (+84912…, 84912…, 0912 345 678). Chuẩn hóa về 0 + 9 chữ số
// để UNIQUE chặn đúng trùng và đăng nhập tra đúng một dòng.
// Chuỗi như `' OR 1=1 --` không khớp mẫu nên bị từ chối ở đây, chưa tới database (mục chấm 25).
export function normalizePhone(value) {
  const compact = String(value).replace(/[\s.-]/g, '');
  const match = PHONE.exec(compact);
  if (!match) throw new AuthError('INVALID_ARGUMENT', 'INVALID_PHONE');
  return `0${match[1]}`;
}

// Email không phân biệt hoa thường → lưu chữ thường để UNIQUE có nghĩa.
export function normalizeEmail(value) {
  const email = String(value).trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new AuthError('INVALID_ARGUMENT', 'INVALID_EMAIL');
  return email;
}

// Chỉ áp dụng khi ĐĂNG KÝ. Đăng nhập không kiểm tra độ dài để không lộ quy tắc mật khẩu.
export function checkNewPassword(value) {
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw new AuthError('INVALID_ARGUMENT', 'INVALID_PASSWORD');
  }
}

// proto3: field `optional` không gửi là undefined; field thường không gửi là chuỗi rỗng.
export const isPresent = (value) => typeof value === 'string' && value !== '';
