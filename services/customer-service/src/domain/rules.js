// Quy tắc kiểm tra hồ sơ khách và danh tính người gọi (spec 11 mục 4.1, mục 5).
// Không phụ thuộc gRPC hay database: test gọi thẳng các hàm này.

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class CustomerError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind; // INVALID_ARGUMENT | UNAUTHENTICATED | PERMISSION_DENIED | NOT_FOUND | ALREADY_EXISTS
    this.code = code; // mã lỗi trả cho client, ví dụ CUSTOMER_NOT_FOUND
  }
}

export const NAME_MAX = 100;
export const DOB_MIN = '1900-01-01';
const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // giờ Việt Nam = UTC+7, không có giờ mùa hè

// Danh tính lấy từ metadata do Gateway dựng (04 mục 1.7). Thiếu hoặc sai dạng = có ai đó gọi thẳng
// service mà không qua Gateway → từ chối, KHÔNG tự đoán một danh tính mặc định (HS4).
export function checkIdentity({ accountId, role }) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
    throw new CustomerError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
  return { accountId: Number(accountId), role };
}

// Họ tên: cắt khoảng trắng hai đầu, chặn `<` `>` (mục chấm 26, lớp 1 ở service — service là chủ dữ liệu
// nên vẫn chặn dù Gateway đã chặn), rồi 1–100 KÝ TỰ. Đếm bằng [...chuỗi] (theo code point) chứ không
// đếm byte: "Nguyễn" là 6 ký tự dù UTF-8 tốn nhiều byte hơn.
export function normalizeName(value) {
  if (typeof value !== 'string') throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
  const name = value.trim();
  if (name.includes('<') || name.includes('>')) throw new CustomerError('INVALID_ARGUMENT', 'TEXT_CONTAINS_HTML');
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX) throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
  return name;
}

// Ngày hôm nay theo giờ Việt Nam dạng YYYY-MM-DD. `now` truyền vào để test cố định được ngày.
export function todayInVietnam(now = Date.now()) {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
}

// Ngày sinh: đúng mẫu YYYY-MM-DD, là ngày có thật (chặn 2000-02-30), từ 1900-01-01 đến hôm nay (HS5).
// Chuỗi YYYY-MM-DD so sánh theo thứ tự chữ cũng chính là so sánh theo ngày.
export function checkDob(value, now = Date.now()) {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!real || value < DOB_MIN || value > todayInVietnam(now)) throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
  return value;
}

// Email (ADR-019; spec 11 mục 4.1, HS7): cắt khoảng trắng, đổi chữ thường (email không phân biệt hoa thường,
// lưu một dạng để hiển thị nhất quán), 1–254 ký tự, khớp mẫu đơn giản. Mẫu này không có `<` `>` nên cũng chặn
// luôn văn bản HTML (mục chấm 26). Sai kiểu → INVALID_INPUT; rỗng / sai dạng / quá dài → INVALID_EMAIL
// (mã riêng để người dùng biết phải sửa email). KHÔNG kiểm trùng: email không UNIQUE.
export const EMAIL_MAX = 254;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
  const email = value.trim().toLowerCase();
  if (email.length < 1 || email.length > EMAIL_MAX || !EMAIL.test(email)) throw new CustomerError('INVALID_ARGUMENT', 'INVALID_EMAIL');
  return email;
}

// proto3: field `optional` không gửi là undefined.
export const isPresent = (value) => value !== undefined && value !== null;
