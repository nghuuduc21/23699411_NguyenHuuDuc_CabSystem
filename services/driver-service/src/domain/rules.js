// Quy tắc kiểm tra và chuẩn hóa dữ liệu tài xế, xe, tọa độ, phân trang, danh tính người gọi
// (spec 12-13-21-23 mục 4, 5.2). Không phụ thuộc gRPC hay database: test gọi thẳng các hàm này.
// Service tự kiểm tra lại mọi điều Gateway đã kiểm: service không tin bên gọi (spec mục 5.2).

// Lỗi nghiệp vụ. `kind` trùng tên gRPC status để tầng gRPC đổi một-một,
// nhưng file này không import thư viện gRPC (logic tách khỏi tầng giao tiếp).
export class DriverError extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind; // INVALID_ARGUMENT | UNAUTHENTICATED | PERMISSION_DENIED | NOT_FOUND | ALREADY_EXISTS | FAILED_PRECONDITION | INTERNAL
    this.code = code; // mã lỗi trả cho client, ví dụ DRIVER_NOT_FOUND
  }
}

export const invalid = (code = 'INVALID_INPUT') => new DriverError('INVALID_ARGUMENT', code);
export const forbidden = () => new DriverError('PERMISSION_DENIED', 'FORBIDDEN');

export const NAME_MAX = 100;
export const VEHICLE_TEXT_MAX = 50; // brand, model, color
export const REASON_MAX = 255;
export const PAGE_MAX = 999_999; // `^[1-9][0-9]{0,5}$` (04 mục 1.3)
export const LIMIT_MAX = 50;
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
const ROLES = ['customer', 'driver', 'admin'];
const LICENSE = /^[A-Z0-9-]{4,20}$/;
const PLATE = /^[A-Z0-9.-]{5,15}$/;

// Danh tính lấy từ metadata do Gateway dựng (04 mục 1.7). Thiếu hoặc sai dạng = có ai đó gọi thẳng
// service mà không qua Gateway → từ chối, KHÔNG tự đoán một danh tính mặc định.
export function checkIdentity({ accountId, role }) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId) || !ROLES.includes(role)) {
    throw new DriverError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  }
  return { accountId: Number(accountId), role };
}

// Role của lời gọi nội bộ service → service (spec 14-15-16-19-30 mục 5.5, DX2 đã chốt): booking-service gửi
// `x-role: system`, không có x-account-id vì không có tài khoản nào đứng sau. Gateway không bao giờ gửi role này:
// token chỉ mang 3 role, và Gateway tự dựng metadata, bỏ header cùng tên của client.
export const SYSTEM_ROLE = 'system';

// Role được phép của rpc. Gateway đã chặn; service chặn lại khi bị gọi thẳng.
// `system` chỉ được nhận ở rpc có nó trong danh sách (FindNearbyDrivers — DX-M1).
export function requireRole(identity, roles) {
  if (identity?.role === SYSTEM_ROLE && roles.includes(SYSTEM_ROLE)) return { accountId: null, role: SYSTEM_ROLE };
  const checked = checkIdentity(identity);
  if (!roles.includes(checked.role)) throw forbidden();
  return checked;
}

// rpc CHỈ dành cho service khác (ReserveDriver, ReleaseDriver): không có x-role → IDENTITY_MISSING;
// có role nhưng không phải `system` (kể cả customer / driver / admin) → FORBIDDEN (AC-DX-23).
export function requireSystem(identity) {
  if (typeof identity?.role !== 'string' || identity.role === '') throw new DriverError('UNAUTHENTICATED', 'IDENTITY_MISSING');
  if (identity.role !== SYSTEM_ROLE) throw forbidden();
}

// Mã trong request (int64 → số). Gateway đã chặn mã sai dạng; service vẫn chặn khi bị gọi thẳng.
// `code`: mã đường dẫn sai → INVALID_ID; mã trong message của lời gọi nội bộ → INVALID_INPUT.
export function checkId(value, code = 'INVALID_ID') {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(code);
  return value;
}

const hasHtml = (text) => text.includes('<') || text.includes('>');
const length = (text) => [...text].length; // đếm theo ký tự (code point), không theo byte

// Văn bản tự do (name, brand, model, color): cắt khoảng trắng, chặn `<` `>` (mục chấm 26), giới hạn độ dài.
export function cleanText(value, max) {
  if (typeof value !== 'string') throw invalid();
  const text = value.trim();
  if (hasHtml(text)) throw invalid('TEXT_CONTAINS_HTML');
  if (length(text) < 1 || length(text) > max) throw invalid();
  return text;
}

// Số giấy phép: cắt khoảng trắng, chữ hoa, chỉ chữ, số, `-`; 4–20 ký tự.
export function normalizeLicense(value) {
  if (typeof value !== 'string') throw invalid();
  const license = value.trim().toUpperCase();
  if (!LICENSE.test(license)) throw invalid();
  return license;
}

// Biển số: chữ hoa, BỎ MỌI khoảng trắng, GIỮ `-` và `.` (03 mục 5.3; TX4 đã chốt: `59A-00001`).
// Không tự đoán thêm dấu `-`: "59a 00001" thành "59A00001", khác "59A-00001".
export function normalizePlate(value) {
  if (typeof value !== 'string') throw invalid();
  if (hasHtml(value)) throw invalid('TEXT_CONTAINS_HTML');
  const plate = value.replace(/\s+/g, '').toUpperCase();
  if (!PLATE.test(plate)) throw invalid();
  return plate;
}

// Mã loại xe: chữ hoa (enum không phân biệt hoa thường — 04 mục 1.8). Có trong vehicle_types hay không
// là việc của database (khóa ngoại / truy vấn), không chép danh sách vào code.
export function normalizeVehicle(value) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid();
  return value.trim().toUpperCase();
}

// Lý do từ chối (A16): bắt buộc; chỉ khoảng trắng coi như thiếu (FR36).
export function cleanReason(value) {
  if (value === undefined || value === null) throw invalid('REASON_REQUIRED');
  if (typeof value !== 'string') throw invalid();
  const reason = value.trim();
  if (reason === '') throw invalid('REASON_REQUIRED');
  if (hasHtml(reason)) throw invalid('TEXT_CONTAINS_HTML');
  if (length(reason) > REASON_MAX) throw invalid();
  return reason;
}

// Tọa độ: phải là số hữu hạn (NaN, Infinity → INVALID_INPUT), trong khoảng → không thì INVALID_COORDINATES.
export function checkCoordinates(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) throw invalid();
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw invalid('INVALID_COORDINATES');
  return { lat, lng };
}

// Phân trang (04 mục 1.3): sai thì báo lỗi, không âm thầm sửa.
export function checkPagination(page, limit) {
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) throw invalid('INVALID_PAGINATION');
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw invalid('INVALID_PAGINATION');
  return { page, limit, offset: (page - 1) * limit };
}

export const pagination = (page, limit, total) => ({ page, limit, total, total_pages: Math.ceil(total / limit) });

// ---- Tìm quanh tọa độ (ADR-011, 03 mục 5.4) ----
export const SEARCH_RADIUS_M = 1000; // hằng số (03 mục 13, 04 P18): không có tham số bán kính
const EARTH_RADIUS_M = 6_371_000;
// Số mét của một độ vĩ, tính từ CÙNG bán kính Trái Đất với Haversine (π·R/180 ≈ 111 195 m).
// Không dùng 111 320 (spec mục 7.3): với số đó khung hẹp hơn hình tròn 1 km khoảng 1 m, nên tài xế
// ở 999–1 000 m về phía bắc / nam bị khung loại nhầm dù Haversine tính ra ≤ 1 000 m (đã báo BA).
export const METERS_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

// Nửa cạnh khung chữ nhật quanh điểm, tính bằng độ. Database lọc khung này trước (dùng index)
// rồi mới tính Haversine cho số ít tài xế còn lại.
// Một độ kinh tuyến ngắn dần khi đi xa xích đạo (nhân cos vĩ độ), nên khung theo lng rộng hơn theo lat.
export function boundingBox(lat, radiusM = SEARCH_RADIUS_M) {
  return {
    dLat: radiusM / METERS_PER_DEGREE_LAT,
    dLng: radiusM / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180)),
  };
}

// Haversine bằng JavaScript — CÙNG công thức với câu SQL ở drivers-repo.js; dùng cho unit test
// để kiểm con số (10.82,106.68)→(10.821,106.68) ≈ 111 m mà không cần database.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// proto3: field `optional` không gửi là undefined.
export const isPresent = (value) => value !== undefined && value !== null;
