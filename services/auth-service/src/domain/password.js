// Băm và so mật khẩu bằng scrypt (03 mục 2; mục chấm 24).
// Vì sao scrypt: có sẵn trong node:crypto (không cần gói phải biên dịch như bcrypt/argon2),
// có salt riêng từng mật khẩu và chậm có chủ ý nên dò ngược rất tốn.
// Vì sao không mã hóa hai chiều: có khóa là giải ra được mật khẩu; băm thì không ai giải được.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Tham số cố định trong code để chuỗi lưu ngắn, dễ đọc khi demo: scrypt$<salt hex>$<hash hex>.
const PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, Buffer.from(parts[1], 'hex'));
  // timingSafeEqual: so hết mọi byte dù sai ngay byte đầu, kẻ tấn công không đo thời gian để đoán dần.
  return timingSafeEqual(actual, expected);
}
