// Mã hóa / giải mã trường cá nhân bằng AES-256-GCM (03 mục 11.4; ADR-012; mục chấm 24).
// Vì sao MÃ HÓA chứ không BĂM như mật khẩu: số giấy phép phải hiện lại cho chủ và admin (A14),
// nên cần giải ngược được khi có khóa. Mật khẩu thì không bao giờ cần đọc lại nên băm.
// Vì sao GCM: vừa giữ bí mật vừa có thẻ xác thực (tag) — ai sửa một byte trong database thì
// giải mã báo lỗi thay vì trả ra dữ liệu sai.
// Khóa (32 byte) truyền từ ngoài vào (config.js đọc DRIVER_DATA_KEY), không nằm trong code.
// Cùng cách với customer-service (spec 11) nhưng KHÁC khóa: lộ khóa của một service không mở được dữ liệu service kia.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // độ dài IV khuyến nghị cho GCM
const TAG_BYTES = 16;

export function createFieldCipher(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('DRIVER_DATA_KEY phải đúng 32 byte');
  return {
    // Mỗi lần mã hóa một IV ngẫu nhiên mới: cùng số giấy phép ở hai hồ sơ ra hai bản mã khác nhau,
    // nhìn database không đoán được hai hồ sơ trùng giấy phép.
    // Kết quả lưu một cột bytea: IV ‖ bản mã ‖ tag (giải mã tự tách lại theo độ dài cố định).
    encrypt(text) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]);
    },
    // Ném lỗi nếu dữ liệu bị sửa, bị cắt, hoặc mã bằng khóa khác (tag không khớp).
    decrypt(stored) {
      if (!Buffer.isBuffer(stored) || stored.length < IV_BYTES + TAG_BYTES) throw new Error('DECRYPT_FAILED');
      const iv = stored.subarray(0, IV_BYTES);
      const tag = stored.subarray(stored.length - TAG_BYTES);
      const body = stored.subarray(IV_BYTES, stored.length - TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}
