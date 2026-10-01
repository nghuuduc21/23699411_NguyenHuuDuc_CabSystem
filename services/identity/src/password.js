import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

// Chuyển hàm dạng callback thành hàm có thể dùng await.
const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  // Mỗi lần băm sử dụng salt ngẫu nhiên riêng.
  // Hai tài khoản dùng cùng mật khẩu vẫn có hash khác nhau.
  const salt = randomBytes(16).toString('hex');

  // scrypt được thiết kế để việc thử hàng loạt mật khẩu tốn tài nguyên.
  const derivedKey = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  // Lưu cả tên thuật toán, salt và hash để kiểm tra khi đăng nhập.
  // Salt không phải bí mật; mật khẩu gốc không được lưu.
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}