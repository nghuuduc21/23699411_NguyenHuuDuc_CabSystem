// Logic nghiệp vụ của Identity & Access: đăng ký khách (UC01) và đăng nhập (UC02).
// Mọi phụ thuộc (kho tài khoản, hàm băm, bộ ký token, log) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL và không cần gRPC.
import { AuthError, checkNewPassword, isPresent, normalizeEmail, normalizePhone } from './rules.js';

// Tên ràng buộc UNIQUE trong migration 001 → mã lỗi trả cho client.
const UNIQUE_TO_CODE = {
  accounts_phone_key: 'PHONE_ALREADY_EXISTS',
  accounts_email_key: 'EMAIL_ALREADY_EXISTS',
};

export function createAuthLogic({ accounts, passwords, tokens, log }) {
  return {
    // A04: chỉ tạo `customer` (A1). Role do server đặt, request không có field role.
    async registerCustomer({ phone, email, password }) {
      // Service tự kiểm tra lại dù Gateway đã kiểm tra: service không tin bên gọi.
      if (!isPresent(phone) || !isPresent(password)) throw new AuthError('INVALID_ARGUMENT', 'INVALID_INPUT');
      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = email === undefined ? null : normalizeEmail(email);
      checkNewPassword(password);

      const passwordHash = await passwords.hash(password);
      let row;
      try {
        // INSERT thẳng, để UNIQUE của database chặn trùng: không có khe hở giữa "kiểm tra" và "ghi"
        // khi hai người đăng ký cùng số một lúc.
        row = await accounts.insert({ phone: normalizedPhone, email: normalizedEmail, passwordHash, role: 'customer' });
      } catch (err) {
        // 23505 = vi phạm UNIQUE; tên ràng buộc cho biết trùng số hay trùng email.
        if (err.code === '23505' && UNIQUE_TO_CODE[err.constraint]) {
          throw new AuthError('ALREADY_EXISTS', UNIQUE_TO_CODE[err.constraint]);
        }
        throw err;
      }
      log.info('register_ok', { account_id: row.account_id });
      return { account_id: row.account_id, role: row.role };
    },

    // A05: cả ba role dùng chung. Không có tài khoản và sai mật khẩu trả CÙNG một lỗi
    // để người ngoài không dò được số nào đã đăng ký (DN5).
    async login({ phone, email, password }) {
      const hasPhone = isPresent(phone);
      const hasEmail = isPresent(email);
      if (hasPhone === hasEmail || !isPresent(password)) {
        throw new AuthError('INVALID_ARGUMENT', 'INVALID_INPUT');
      }
      const account = hasPhone
        ? await accounts.findByPhone(normalizePhone(phone))
        : await accounts.findByEmail(normalizeEmail(email));

      if (!account || !(await passwords.verify(password, account.password_hash))) {
        log.info('login_failed', { code: 'INVALID_CREDENTIALS' });
        throw new AuthError('UNAUTHENTICATED', 'INVALID_CREDENTIALS');
      }
      // Chỉ báo "bị khóa" khi mật khẩu ĐÚNG: người không biết mật khẩu không biết được tài khoản bị khóa.
      if (account.status !== 'ACTIVE') {
        log.info('login_failed', { code: 'ACCOUNT_LOCKED', account_id: account.account_id });
        throw new AuthError('PERMISSION_DENIED', 'ACCOUNT_LOCKED');
      }

      const token = tokens.sign({ accountId: account.account_id, role: account.role });
      log.info('login_ok', { account_id: account.account_id });
      return { token, account_id: account.account_id, role: account.role, expires_in: tokens.ttlSeconds };
    },
  };
}
