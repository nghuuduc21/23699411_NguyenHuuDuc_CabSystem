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
