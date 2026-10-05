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

// Lý do (từ chối hồ sơ, hủy booking, hủy chuyến — spec 17-18 mục 4): thiếu / null / chỉ khoảng trắng → REASON_REQUIRED
// (FR36: hủy phải có lý do); không phải chuỗi → INVALID_INPUT; có `<` `>` → TEXT_CONTAINS_HTML; > 255 ký tự sau khi cắt
// → INVALID_INPUT. Trả mã lỗi hoặc null. Service kiểm lại đúng các quy tắc này.
export function checkReason(reason) {
  if (reason === undefined || reason === null) return 'REASON_REQUIRED';
  if (typeof reason !== 'string') return 'INVALID_INPUT';
  const trimmed = reason.trim();
  if (trimmed === '') return 'REASON_REQUIRED';
  if (hasHtml(trimmed)) return 'TEXT_CONTAINS_HTML';
  if ([...trimmed].length > REASON_MAX) return 'INVALID_INPUT';
  return null;
}

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
  const error = checkReason(reason); // chỉ khoảng trắng = không có lý do (FR36)
  if (error) return { error };
  return { variant: 'A16', request: { reason } };
}

// ---- Đặt xe, lời mời, thanh toán (spec 14-15-16-19-30 mục 4) ----
// Như các phần trước: Gateway chỉ kiểm HÌNH THỨC, đổi enum sang chữ hoa, điền giá trị mặc định (04 mục 1.8)
// và chọn biến thể. Quy tắc nghiệp vụ (điểm đón trùng điểm đến, loại xe có giá không, trạng thái thanh toán…)
// thuộc booking-service / payment-service.

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'SEARCHING', 'DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELED'];
export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'VOIDED'];
const ADDRESS_FORM_MAX = 510; // chặn rác; giới hạn chính xác 255 ký tự sau khi cắt khoảng trắng ở service
const VEHICLE_FORM_MAX = 20;
const IDEMPOTENCY_KEY_MAX = 100;
const TXN_ID_MAX = 100;

// Tọa độ dạng mảng `[lat, lng]` (spec mục 4.1): đúng 2 SỐ JSON. Chuỗi "10.82,106.68", 1 hay 3 phần tử,
// phần tử là chuỗi → INVALID_INPUT; ngoài khoảng → INVALID_COORDINATES. Trả mã lỗi hoặc null.
function checkPointShape(value) {
  if (!Array.isArray(value) || value.length !== 2) return 'INVALID_INPUT';
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'INVALID_INPUT';
  return null;
}
const pointInRange = ([lat, lng]) => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

// Enum không phân biệt hoa thường (04 mục 1.8): trả chữ hoa, hoặc null nếu không phải giá trị cho phép.
function upperEnum(value, allowed) {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  return allowed.includes(upper) ? upper : null;
}

// A19 POST /api/v1/bookings — `from`, `to` bắt buộc; mặc định `vehicle` = CAR_4, `pay` = CASH.
// Field lạ (gồm `customer_id`, `fare`) → 400: mã khách lấy từ token, cước do hệ thống tính.
export function parseCreateBooking(body) {
  if (!isObject(body) || !onlyKeys(body, ['from', 'to', 'vehicle', 'pay', 'from_address', 'to_address'])) return { error: 'INVALID_INPUT' };
  const shapeError = checkPointShape(body.from) ?? checkPointShape(body.to);
  if (shapeError) return { error: shapeError };
  const request = { from: body.from, to: body.to, vehicle: 'CAR_4', pay: 'CASH' };
  if (body.vehicle !== undefined) {
    if (typeof body.vehicle !== 'string' || body.vehicle.length < 1 || body.vehicle.length > VEHICLE_FORM_MAX) return { error: 'INVALID_INPUT' };
    request.vehicle = body.vehicle.toUpperCase();
  }
  if (body.pay !== undefined) {
    request.pay = upperEnum(body.pay, ['CASH', 'ONLINE']);
    if (!request.pay) return { error: 'INVALID_INPUT' };
  }
  for (const key of ['from_address', 'to_address']) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length < 1 || value.length > ADDRESS_FORM_MAX) return { error: 'INVALID_INPUT' };
    request[key] = value;
  }
  if (!pointInRange(body.from) || !pointInRange(body.to)) return { error: 'INVALID_COORDINATES' };
  if (hasHtml(body.from_address) || hasHtml(body.to_address)) return { error: 'TEXT_CONTAINS_HTML' };
  return { variant: 'A19', request };
}

// Query danh sách có lọc trạng thái + phân trang (A20, A23). Tham số lạ (`sort`) → 400.
function parseStatusListQuery(query, statuses) {
  if (Object.values(query).some((value) => typeof value !== 'string')) return { error: 'INVALID_INPUT' };
  if (!onlyKeys(query, ['status', 'page', 'limit'])) return { error: 'INVALID_INPUT' };
  const request = {};
  if (query.status !== undefined) {
    request.status = upperEnum(query.status, statuses);
    if (!request.status) return { error: 'INVALID_INPUT' };
  }
  const paging = readPagination(query);
  if (paging.error) return paging;
  return { request: { ...request, page: paging.page, limit: paging.limit } };
}

// A20 GET /api/v1/bookings?status&page&limit
export function parseBookingsQuery(query) {
  const parsed = parseStatusListQuery(query, BOOKING_STATUSES);
  return parsed.error ? parsed : { variant: 'A20', request: parsed.request };
}

// A23 GET /api/v1/offers?status&page&limit — không gửi `status` thì service lọc PENDING.
export function parseOffersQuery(query) {
  const parsed = parseStatusListQuery(query, OFFER_STATUSES);
  return parsed.error ? parsed : { variant: 'A23', request: parsed.request };
}

// PATCH /api/v1/offers/{id} — chọn theo `status`: ACCEPTED → A24 nhận; REJECTED → A25 từ chối.
// Thiếu `status`, giá trị khác (PENDING, EXPIRED…), field lạ, body rỗng → 400.
export function parseOfferBody(body) {
  if (!isObject(body) || !onlyKeys(body, ['status'])) return { error: 'INVALID_INPUT' };
  const status = upperEnum(body.status, ['ACCEPTED', 'REJECTED']);
  if (status === 'ACCEPTED') return { variant: 'A24', request: {} };
  if (status === 'REJECTED') return { variant: 'A25', request: {} };
  return { error: 'INVALID_INPUT' };
}

// A31 POST /api/v1/payments/{id}/transactions — body rỗng hoặc `{"simulate_result": …}`;
// header Idempotency-Key bắt buộc, 1–100 ký tự sau khi cắt khoảng trắng (04 mục 1.4).
export function parsePayRequest(req) {
  const { body } = req;
  if (!isObject(body) || !onlyKeys(body, ['simulate_result'])) return { error: 'INVALID_INPUT' };
  const request = {};
  if (body.simulate_result !== undefined) {
    request.simulate_result = upperEnum(body.simulate_result, ['SUCCESS', 'FAILED', 'MANUAL']);
    if (!request.simulate_result) return { error: 'INVALID_INPUT' };
  }
  const key = (req.get('idempotency-key') ?? '').trim();
  if (key.length < 1 || key.length > IDEMPOTENCY_KEY_MAX) return { error: 'IDEMPOTENCY_KEY_REQUIRED' };
  req.idempotencyKey = key;
  return { variant: 'A31', request };
}

// A32 POST /api/v1/payment-callbacks — `txn_id` bắt buộc; `result` mặc định SUCCESS; `amount` số nguyên > 0.
export function parseCallbackBody(body) {
  if (!isObject(body) || !onlyKeys(body, ['txn_id', 'result', 'amount'])) return { error: 'INVALID_INPUT' };
  if (typeof body.txn_id !== 'string' || body.txn_id.trim() === '' || body.txn_id.length > TXN_ID_MAX) return { error: 'INVALID_INPUT' };
  const request = { txn_id: body.txn_id.trim() };
  if (body.result !== undefined) {
    request.result = upperEnum(body.result, ['SUCCESS', 'FAILED']);
    if (!request.result) return { error: 'INVALID_INPUT' };
  }
  if (body.amount !== undefined) {
    // int32 của proto: số nguyên dương không quá 2^31 − 1.
    if (!Number.isInteger(body.amount) || body.amount <= 0 || body.amount > 2_147_483_647) return { error: 'INVALID_INPUT' };
    request.amount = body.amount;
  }
  return { variant: 'A32', request };
}

// ---- Chuyến đi, hủy, thông báo (spec 17-18 mục 4) ----

// PATCH /api/v1/bookings/{id} — A22 khách hủy booking: `status` phải là CANCELED, `reason` bắt buộc.
// `status` khác (SEARCHING…), field lạ, body rỗng → 400 INVALID_INPUT. Đổi trạng thái bằng PATCH + status (ADR-018).
export function parseCancelBookingBody(body) {
  if (!isObject(body) || !onlyKeys(body, ['status', 'reason'])) return { error: 'INVALID_INPUT' };
  if (upperEnum(body.status, ['CANCELED']) !== 'CANCELED') return { error: 'INVALID_INPUT' };
  const error = checkReason(body.reason);
  if (error) return { error };
  return { variant: 'A22', request: { reason: body.reason } };
}

// PATCH /api/v1/trips/{id} — chọn biến thể theo `status` (04 mục 1.10):
//   ARRIVED / PICKED_UP / IN_PROGRESS / COMPLETED → A28 tiến trạng thái (chỉ `status`; có `reason` → 400);
//   CANCELED → A29 hủy (`status` + `reason` bắt buộc).
//   Thiếu / khác (ACCEPTED, BUSY, số…) → 400: ACCEPTED chỉ có khi tài xế nhận lời mời (A24), không đặt tay được.
// Trình tự đúng hay sai (nhảy cóc → 409) là việc của trip-service, Gateway không biết trạng thái hiện tại.
const TRIP_STEPS = ['ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED'];
export function parseTripBody(body) {
  if (!isObject(body)) return { error: 'INVALID_INPUT' };
  const status = upperEnum(body.status, [...TRIP_STEPS, 'CANCELED']);
  if (!status) return { error: 'INVALID_INPUT' };
  if (status === 'CANCELED') {
    if (!onlyKeys(body, ['status', 'reason'])) return { error: 'INVALID_INPUT' };
    const error = checkReason(body.reason);
    if (error) return { error };
    return { variant: 'A29', request: { reason: body.reason } };
  }
  if (!onlyKeys(body, ['status'])) return { error: 'INVALID_INPUT' };
  return { variant: 'A28', request: { status } };
}

// GET /api/v1/notifications?page&limit — A33. Chỉ `page`, `limit`; tham số lạ → 400 INVALID_INPUT.
export function parseNotificationsQuery(query) {
  if (Object.values(query).some((value) => typeof value !== 'string')) return { error: 'INVALID_INPUT' };
  if (!onlyKeys(query, ['page', 'limit'])) return { error: 'INVALID_INPUT' };
  const paging = readPagination(query);
  if (paging.error) return paging;
  return { variant: 'A33', request: { page: paging.page, limit: paging.limit } };
}
