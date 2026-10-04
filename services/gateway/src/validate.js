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
