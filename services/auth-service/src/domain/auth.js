// Logic nghiệp vụ của Identity & Access: đăng ký khách (UC01) và đăng nhập (UC02).
// Mọi phụ thuộc (kho tài khoản, hàm băm, bộ ký token, log) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL và không cần gRPC.
import { AuthError, checkNewPassword, isPresent, normalizeEmail, normalizePhone } from './rules.js';

// Tên ràng buộc UNIQUE trong migration 001 → mã lỗi trả cho client.
const UNIQUE_TO_CODE = {
  accounts_phone_key: 'PHONE_ALREADY_EXISTS',
  accounts_email_key: 'EMAIL_ALREADY_EXISTS',
};

// OTP (spec 12-13-21-23 mục 4.2, 4.3, 5.1).
export const OTP_MAX_ATTEMPTS = 5; // hằng số trong code (03 mục 13): sai 5 lần thì mã hết hiệu lực
const OTP_FORMAT = /^[0-9]{6}$/;
const otpError = (code) => new AuthError('INVALID_ARGUMENT', code);

// Sinh OTP 6 chữ số bằng bộ sinh số ngẫu nhiên an toàn (randomInt), đệm số 0 ở đầu: 7 → "000007".
// Math.random() đoán được nên không dùng cho mã bảo mật.
export function randomOtp(randomInt) {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Các phụ thuộc OTP (otps, otpTtlSeconds, simulationMode, newOtp) chỉ cần cho A07, A08;
// test cũ của A04, A05 không truyền vẫn chạy.
export function createAuthLogic({ accounts, passwords, tokens, log, otps, otpTtlSeconds, simulationMode = false, newOtp }) {
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

    // A07: xin OTP đăng ký tài xế (UC29 bước 1).
    async requestDriverOtp({ phone }) {
      if (!isPresent(phone)) throw new AuthError('INVALID_ARGUMENT', 'INVALID_INPUT');
      const normalizedPhone = normalizePhone(phone);
      // Số đã có tài khoản (mọi role) → 409 ngay, không phát OTP vô ích (BA TX1).
      if (await accounts.findByPhone(normalizedPhone)) throw new AuthError('ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');

      const otp = newOtp();
      // Băm bằng CÙNG module scrypt với mật khẩu: database chỉ có bản băm (mục chấm 24).
      const { otp_id: otpId } = await otps.insert({ phone: normalizedPhone, otpHash: await passwords.hash(otp), ttlSeconds: otpTtlSeconds });
      // Đây CHÍNH LÀ kênh SMS giả lập (ADR-014): ghi mã ra log. Không ghi số điện thoại (NFR08).
      log.info('otp_sms_simulated', { otp_id: otpId, otp });
      const response = { phone: normalizedPhone, expires_in: otpTtlSeconds };
      // Chỉ trả mã trong response khi bật chế độ giả lập; chạy thật thì người dùng nhận qua SMS.
      if (simulationMode) response.otp = otp;
      return response;
    },

    // A08: kiểm tra OTP rồi tạo tài khoản `driver` (UC29 bước 2). Thứ tự theo spec mục 4.3.
    async registerDriver({ phone, otp, password }) {
      if (!isPresent(phone) || !isPresent(otp) || !isPresent(password)) throw new AuthError('INVALID_ARGUMENT', 'INVALID_INPUT');
      // Bước 1: hình thức. OTP sai định dạng KHÔNG tính lượt sai (chưa đụng database) (TX2).
      const normalizedPhone = normalizePhone(phone);
      checkNewPassword(password);
      if (!OTP_FORMAT.test(otp)) throw otpError('OTP_INVALID');
      // Bước 2: số đã có tài khoản.
      if (await accounts.findByPhone(normalizedPhone)) throw new AuthError('ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
      // Băm mật khẩu TRƯỚC khi mở giao dịch: scrypt chậm có chủ ý, không nên giữ khóa dòng trong lúc đó.
      const passwordHash = await passwords.hash(password);

      let outcome;
      try {
        // Bước 3–6 trong MỘT giao dịch. Lỗi "OTP sai" trả về dạng { fail } để giao dịch vẫn COMMIT
        // phần tăng lượt sai; nếu ném lỗi thì ROLLBACK làm mất luôn lượt sai.
        outcome = await otps.transaction(async (tx) => {
          const row = await tx.latestForUpdate(normalizedPhone);
          // Chưa xin OTP, hoặc mã mới nhất đã dùng → OTP_INVALID.
          if (!row || row.consumed_at !== null) return { fail: 'OTP_INVALID' };
          // Hết hạn hoặc đã sai đủ 5 lần → OTP_EXPIRED: với người dùng cả hai đều là "xin mã mới" (TX2).
          if (row.expired || row.attempt_count >= OTP_MAX_ATTEMPTS) return { fail: 'OTP_EXPIRED' };
          if (!(await passwords.verify(otp, row.otp_hash))) {
            await tx.addAttempt(row.otp_id);
            return { fail: 'OTP_INVALID' };
          }
          await tx.consume(row.otp_id);
          return { account: await tx.insertAccount({ phone: normalizedPhone, passwordHash, role: 'driver' }) };
        });
      } catch (err) {
        // Hai request song song cùng số: UNIQUE của database chặn request sau.
        if (err.code === '23505' && err.constraint === 'accounts_phone_key') throw new AuthError('ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS');
        throw err;
      }
      if (outcome.fail) {
        log.info('otp_failed', { code: outcome.fail });
        throw otpError(outcome.fail);
      }

      const { account_id: accountId, role } = outcome.account;
      log.info('driver_registered', { account_id: accountId });
      // Bước 7: ký token bằng cùng module với Login → tài xế nộp hồ sơ ngay, khỏi đăng nhập lại.
      const token = tokens.sign({ accountId, role });
      return { account_id: accountId, role, token, expires_in: tokens.ttlSeconds };
    },
  };
}
