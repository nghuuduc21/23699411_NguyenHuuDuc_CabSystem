import { hashPassword } from './password.js';
import { validateRegistration } from './registration.js';

// Use case đăng ký: không biết request đến từ REST hay gRPC.
// Nhận db từ bên ngoài để có thể thay bằng db giả khi test.
// Trả { error } khi lỗi nghiệp vụ, { account } khi thành công.
// Lỗi hạ tầng (database tắt, ...) được ném ra cho tầng gọi xử lý.
export async function registerAccount(db, body) {
  const validation = validateRegistration(body);

  if (validation.error) {
    return { error: validation.error };
  }

  const input = validation.value;
  const passwordHash = await hashPassword(input.password);

  try {
    // SQL có tham số: dữ liệu được truyền riêng, không nối vào câu SQL.
    // Role do server quyết định, không lấy tùy ý từ request.
    const result = await db.query(
      `
        INSERT INTO accounts (
          full_name,
          email,
          phone,
          password_hash,
          role
        )
        VALUES ($1, $2, $3, $4, 'customer')
        RETURNING
          account_id,
          full_name,
          email,
          phone,
          role,
          status,
          created_at
      `,
      [
        input.full_name,
        input.email,
        input.phone,
        passwordHash,
      ],
    );

    // RETURNING phía trên cố tình không có password_hash.
    return { account: result.rows[0] };
  } catch (error) {
    // PostgreSQL dùng mã 23505 cho vi phạm UNIQUE.
    // Bao gồm trường hợp hai request cùng đăng ký một phone/email.
    if (error.code === '23505') {
      return { error: 'ACCOUNT_ALREADY_EXISTS' };
    }

    throw error;
  }
}
