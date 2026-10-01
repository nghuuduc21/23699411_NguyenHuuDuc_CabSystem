// Hàm này chỉ kiểm tra dữ liệu, không gọi HTTP hoặc database.
// Vì vậy có thể viết unit test trực tiếp.
export function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_BODY' };
  }

  // API đăng ký công khai của bài này chỉ tạo Customer.
  // Không cho người gọi tự nâng quyền bằng role=operator.
  if (body.role !== undefined && body.role !== 'customer') {
    return { error: 'CUSTOMER_REGISTRATION_ONLY' };
  }

  const fullName =
    typeof body.full_name === 'string' ? body.full_name.trim() : '';

  if (fullName.length < 2 || fullName.length > 100) {
    return { error: 'INVALID_FULL_NAME' };
  }

  // Giữ số điện thoại dưới dạng chuỗi, không chuyển thành Number.
  if (
    typeof body.phone !== 'string' ||
    !/^\+?[0-9]{9,15}$/.test(body.phone)
  ) {
    return { error: 'INVALID_PHONE' };
  }

  let email = null;

  // Email tùy chọn; nếu cung cấp thì phải hợp lệ.
  if (body.email !== undefined && body.email !== null) {
    if (typeof body.email !== 'string') {
      return { error: 'INVALID_EMAIL' };
    }

    // Quy ước của hệ thống: chuẩn hóa email về chữ thường.
    email = body.email.trim().toLowerCase();

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return { error: 'INVALID_EMAIL' };
    }
  }

  // Không trim mật khẩu: dấu cách có thể là ký tự người dùng chọn.
  if (
    typeof body.password !== 'string' ||
    body.password.length < 8 ||
    body.password.length > 128
  ) {
    return { error: 'PASSWORD_LENGTH_8_128' };
  }

  // Chỉ chọn các trường được phép, không chuyển nguyên body vào database.
  return {
    value: {
      full_name: fullName,
      phone: body.phone,
      email,
      password: body.password,
    },
  };
}