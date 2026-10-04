// Kiểm tra HÌNH THỨC body ở Gateway (04 mục 1, 1.2; spec 09-10 mục 4.1 bước 8).
// Chỉ kiểm tra kiểu và độ dài; quy tắc nghiệp vụ (định dạng số điện thoại, mật khẩu ≥ 8 ký tự…)
// thuộc service. Mục đích: chặn request rác sớm, rẻ, trước khi gọi gRPC.

// fields: { tên: { required: boolean, max: số ký tự tối đa } }
// Trả null nếu hợp lệ, hoặc mã lỗi.
export function checkStringFields(body, fields) {
  // Body phải là object JSON: mảng, số, chuỗi, null đều sai.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'INVALID_INPUT';
  for (const key of Object.keys(body)) {
    // Field lạ → 400: chặn client tự gửi `role`, `account_id` để gán thừa (DN4).
    if (!Object.hasOwn(fields, key)) return 'INVALID_INPUT';
  }
  for (const [key, rule] of Object.entries(fields)) {
    const value = body[key];
    if (value === undefined) {
      if (rule.required) return 'INVALID_INPUT';
      continue;
    }
    if (typeof value !== 'string' || value.length < 1 || value.length > rule.max) return 'INVALID_INPUT';
  }
  return null;
}

// A04 POST /api/v1/accounts
export function validateRegister(body) {
  return checkStringFields(body, {
    phone: { required: true, max: 20 },
    email: { required: false, max: 254 },
    password: { required: true, max: 128 },
  });
}

// A05 POST /api/v1/auth/login — đúng một trong `phone`, `email` (DN1).
export function validateLogin(body) {
  const error = checkStringFields(body, {
    phone: { required: false, max: 254 },
    email: { required: false, max: 254 },
    password: { required: true, max: 128 },
  });
  if (error) return error;
  if ((body.phone === undefined) === (body.email === undefined)) return 'INVALID_INPUT';
  return null;
}

// ---- Hồ sơ khách (spec 11 mục 4.1) ----
// Gateway chỉ kiểm tra HÌNH THỨC: đúng field, đúng kiểu, không rỗng, không quá dài một cách rõ ràng,
// và chặn `<` `>` (mục chấm 26, lớp 1 — 04 mục 1.6). Quy tắc chính xác (1–100 ký tự sau khi cắt
// khoảng trắng, ngày có thật, từ 1900 đến hôm nay) thuộc customer-service, là chủ dữ liệu.
// Giới hạn 200 đơn vị UTF-16 ở đây chỉ để chặn rác: tên tiếng Việt viết dạng tổ hợp (dấu tách rời)
// dài hơn số ký tự nhìn thấy, nên không đặt đúng 100 ở Gateway để khỏi từ chối nhầm.
const NAME_FORM_MAX = 200;
const DOB_FORM_MAX = 10; // YYYY-MM-DD

function checkCustomerBody(body, { nameRequired, dobNullable }) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'INVALID_INPUT';
  // Field lạ (ví dụ `customer_id`) → 400: mã khách lấy từ token, client không được gửi.
  for (const key of Object.keys(body)) if (key !== 'name' && key !== 'dob') return 'INVALID_INPUT';
  const { name, dob } = body;
  if (name === undefined) {
    if (nameRequired) return 'INVALID_INPUT';
  } else if (typeof name !== 'string' || name.length < 1 || name.length > NAME_FORM_MAX) {
    return 'INVALID_INPUT'; // gồm cả `"name": null`
  }
  // `"dob": null` chỉ có nghĩa ở A10 (xóa ngày sinh, HS2); ở A37 cứ không gửi là được.
  if (dob !== undefined && !(dob === null && dobNullable)) {
    if (typeof dob !== 'string' || dob.length < 1 || dob.length > DOB_FORM_MAX) return 'INVALID_INPUT';
  }
  if (typeof name === 'string' && (name.includes('<') || name.includes('>'))) return 'TEXT_CONTAINS_HTML';
  return null;
}

// A37 POST /api/v1/customers — `name` bắt buộc, `dob` tùy chọn.
export function validateCreateCustomer(body) {
  return checkCustomerBody(body, { nameRequired: true, dobNullable: false });
}

// A10 PATCH /api/v1/customers/me — ít nhất một field; `"dob": null` = xóa ngày sinh.
export function validateUpdateCustomer(body) {
  const error = checkCustomerBody(body, { nameRequired: false, dobNullable: true });
  if (error) return error;
  return Object.keys(body).length === 0 ? 'INVALID_INPUT' : null;
}

// A09 GET /api/v1/customers/{id} — mã phải là số nguyên dương, tối đa 16 chữ số (ADR-015).
// `1 OR 1=1`, `abc`, `0`, `-1` bị chặn ở đây, chưa tới service hay database (mục chấm 25).
const ID = /^[1-9][0-9]{0,15}$/;
export function validateIdParam(params) {
  return ID.test(params.id) ? null : 'INVALID_ID';
}

// ---- Tài xế (spec 12-13-21-23 mục 4) ----
// Như hồ sơ khách: Gateway chỉ kiểm HÌNH THỨC (đúng field, đúng kiểu, độ dài chặn rác, `<` `>`),
// đổi enum sang chữ hoa (04 mục 1.8), và tra bảng chọn biến thể (04 mục 1.10).
// Quy tắc chính xác (định dạng giấy phép, biển số, loại xe có trong danh mục…) thuộc driver-service.
// Các hàm `parse…` trả { error } hoặc { variant, request } — request là message gRPC dựng sẵn.

const hasHtml = (value) => typeof value === 'string' && (value.includes('<') || value.includes('>'));
const isObject = (body) => body !== null && typeof body === 'object' && !Array.isArray(body);
const onlyKeys = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));

// A07 POST /api/v1/otps
export function validateRequestOtp(body) {
  return checkStringFields(body, { phone: { required: true, max: 20 } });
}

// A08 POST /api/v1/driver-accounts — field lạ (gồm `role`) → 400: client không tự chọn role.
export function validateRegisterDriver(body) {
  return checkStringFields(body, {
    phone: { required: true, max: 20 },
    otp: { required: true, max: 10 },
    password: { required: true, max: 128 },
  });
}

// A11 POST /api/v1/drivers — không nhận driver_id, approval_status, status (tài xế không tự duyệt mình).
const SUBMIT_TEXT_FIELDS = ['name', 'plate', 'brand', 'model', 'color'];
export function validateSubmitDriver(body) {
  const error = checkStringFields(body, {
    name: { required: true, max: NAME_FORM_MAX },
    license: { required: true, max: 30 },
    plate: { required: true, max: 30 },
    vehicle: { required: false, max: 20 },
    brand: { required: false, max: NAME_FORM_MAX },
    model: { required: false, max: NAME_FORM_MAX },
    color: { required: false, max: NAME_FORM_MAX },
  });
  if (error) return error;
  return SUBMIT_TEXT_FIELDS.some((key) => hasHtml(body[key])) ? 'TEXT_CONTAINS_HTML' : null;
}

// A11: dựng message gRPC. Loại xe mặc định CAR_4 (04 mục 1.8: lựa chọn phổ biến nhất, bớt một field khi thi).
export function buildSubmitRequest(body) {
  const request = { name: body.name, license: body.license, plate: body.plate, vehicle: (body.vehicle ?? 'CAR_4').toUpperCase() };
  for (const key of ['brand', 'model', 'color']) if (body[key] !== undefined) request[key] = body[key];
  return request;
}

// Tọa độ trong BODY: số JSON (không nhận chuỗi "10.82" — TX8). Trả mã lỗi hoặc null.
function checkBodyCoordinates(body) {
  const { lat, lng } = body;
  if (lat === undefined || lng === undefined) return 'INVALID_INPUT'; // thiếu nửa cặp
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'INVALID_INPUT';
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'INVALID_COORDINATES';
  return null;
}

// Tọa độ trong QUERY: luôn là chuỗi; phải khớp mẫu số thập phân rồi mới đổi sang số.
const QUERY_COORD = /^-?[0-9]{1,3}(\.[0-9]{1,10})?$/;
const QUERY_PAGE = /^[1-9][0-9]{0,5}$/;
const QUERY_LIMIT = /^[1-9][0-9]?$/;
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const LIMIT_MAX = 50;

// Đọc page / limit (04 mục 1.3): sai thì báo, không âm thầm sửa.
function readPagination(query) {
  const page = query.page ?? String(DEFAULT_PAGE);
  const limit = query.limit ?? String(DEFAULT_LIMIT);
  if (!QUERY_PAGE.test(page) || !QUERY_LIMIT.test(limit) || Number(limit) > LIMIT_MAX) return { error: 'INVALID_PAGINATION' };
  return { page: Number(page), limit: Number(limit) };
}

// GET /api/v1/drivers — chọn biến thể theo query: có `lat` HOẶC `lng` → A12 tìm quanh tọa độ;
// không có → A13 danh sách hồ sơ. Tham số lạ → 400 (TX7: gõ nhầm `long` thì báo ngay, không lặng lẽ bỏ qua).
export function parseDriversQuery(query) {
  // Express đọc `?a=1&a=2` thành mảng: không phải dạng hợp lệ ở API này.
  if (Object.values(query).some((value) => typeof value !== 'string')) return { error: 'INVALID_INPUT' };
  if (Object.hasOwn(query, 'lat') || Object.hasOwn(query, 'lng')) {
    if (!onlyKeys(query, ['lat', 'lng', 'vehicle', 'page', 'limit'])) return { error: 'INVALID_INPUT' };
    if (query.lat === undefined || query.lng === undefined) return { error: 'INVALID_INPUT' };
    if (!QUERY_COORD.test(query.lat) || !QUERY_COORD.test(query.lng)) return { error: 'INVALID_INPUT' };
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: 'INVALID_COORDINATES' };
    if (query.vehicle !== undefined && (query.vehicle === '' || query.vehicle.length > 20)) return { error: 'INVALID_INPUT' };
    const paging = readPagination(query);
    if (paging.error) return paging;
    const request = { lat, lng, page: paging.page, limit: paging.limit };
    if (query.vehicle !== undefined) request.vehicle = query.vehicle.toUpperCase();
    return { variant: 'A12', request };
  }
  if (!onlyKeys(query, ['approval_status', 'page', 'limit'])) return { error: 'INVALID_INPUT' };
  const request = {};
  if (query.approval_status !== undefined) {
    const status = query.approval_status.toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return { error: 'INVALID_INPUT' };
    request.approval_status = status;
  }
  const paging = readPagination(query);
  if (paging.error) return paging;
  return { variant: 'A13', request: { ...request, page: paging.page, limit: paging.limit } };
}

// PATCH /api/v1/drivers/me — chọn biến thể theo body:
//   status ONLINE → A17 (cho phép lat, lng — cả hai hoặc không); status OFFLINE → A39 (chỉ status);
//   không có status, có lat / lng → A18 (bắt buộc cả hai). BUSY, giá trị lạ, body rỗng → 400:
//   BUSY chỉ hệ thống đặt khi giao chuyến (D8).
export function parseDriverMeBody(body) {
  if (!isObject(body)) return { error: 'INVALID_INPUT' };
  if (body.status !== undefined) {
    if (typeof body.status !== 'string') return { error: 'INVALID_INPUT' };
    const status = body.status.toUpperCase();
    if (status === 'OFFLINE') {
      if (!onlyKeys(body, ['status'])) return { error: 'INVALID_INPUT' };
      return { variant: 'A39', request: { status } };
    }
    if (status !== 'ONLINE' || !onlyKeys(body, ['status', 'lat', 'lng'])) return { error: 'INVALID_INPUT' };
    if (body.lat === undefined && body.lng === undefined) return { variant: 'A17', request: { status } };
    const error = checkBodyCoordinates(body);
    if (error) return { error };
    return { variant: 'A17', request: { status, lat: body.lat, lng: body.lng } };
  }
  if (body.lat === undefined && body.lng === undefined) return { error: 'INVALID_INPUT' };
  if (!onlyKeys(body, ['lat', 'lng'])) return { error: 'INVALID_INPUT' };
  const error = checkBodyCoordinates(body);
  if (error) return { error };
  return { variant: 'A18', request: { lat: body.lat, lng: body.lng } };
}

// PATCH /api/v1/drivers/{id} — chọn theo approval_status: APPROVED → A15; REJECTED → A16 (bắt buộc reason).
// PENDING hay giá trị khác → 400: admin không "trả về chờ duyệt" (D5).
export const REASON_MAX = 255;
export function parseReviewBody(body) {
  if (!isObject(body) || typeof body.approval_status !== 'string') return { error: 'INVALID_INPUT' };
  const status = body.approval_status.toUpperCase();
  if (status === 'APPROVED') {
    // `reason` ở A15 là field lạ → 400: duyệt thì không có lý do.
    if (!onlyKeys(body, ['approval_status'])) return { error: 'INVALID_INPUT' };
    return { variant: 'A15', request: {} };
  }
  if (status !== 'REJECTED' || !onlyKeys(body, ['approval_status', 'reason'])) return { error: 'INVALID_INPUT' };
  const { reason } = body;
  if (reason === undefined || reason === null) return { error: 'REASON_REQUIRED' };
  if (typeof reason !== 'string') return { error: 'INVALID_INPUT' };
  const trimmed = reason.trim();
  if (trimmed === '') return { error: 'REASON_REQUIRED' }; // chỉ khoảng trắng = không có lý do (FR36)
  if (hasHtml(trimmed)) return { error: 'TEXT_CONTAINS_HTML' };
  if ([...trimmed].length > REASON_MAX) return { error: 'INVALID_INPUT' };
  return { variant: 'A16', request: { reason } };
}
