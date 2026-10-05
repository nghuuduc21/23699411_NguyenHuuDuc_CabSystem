// Logic nghiệp vụ của Customer: tạo, xem, sửa hồ sơ khách (UC03, UC19; FR27, BRULE18).
// Mọi phụ thuộc (kho hồ sơ, bộ mã hóa, log, đồng hồ) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL và không cần gRPC.
// `identity` = { accountId, role } dạng chuỗi lấy từ metadata do Gateway dựng (tầng gRPC đọc giúp).
import { checkDob, checkIdentity, CustomerError, isPresent, normalizeEmail, normalizeName } from './rules.js';

const forbidden = () => new CustomerError('PERMISSION_DENIED', 'FORBIDDEN');
const notFound = () => new CustomerError('NOT_FOUND', 'CUSTOMER_NOT_FOUND');

export function createCustomerLogic({ profiles, cipher, log, now = () => Date.now() }) {
  // Giải mã một dòng. Hỏng (sửa tay trong database, sai khóa) thì KHÔNG trả dữ liệu sai cho client:
  // ghi log kèm mã khách (không kèm dữ liệu) rồi báo INTERNAL → Gateway 503.
  function decode(row) {
    try {
      return {
        name: cipher.decrypt(row.full_name_enc),
        dob: row.date_of_birth_enc === null ? null : cipher.decrypt(row.date_of_birth_enc),
      };
    } catch {
      log.error('decrypt_failed', { customer_id: row.customer_id });
      throw new CustomerError('INTERNAL', 'INTERNAL');
    }
  }

  // Hình dạng message `Customer`: không có ngày sinh / email thì bỏ field (proto `optional`);
  // Gateway đổi "không có" thành `null` trong JSON.
  const toCustomer = (customerId, { name, dob, email }) => {
    const customer = { customer_id: customerId, name };
    if (dob !== null && dob !== undefined) customer.dob = dob;
    if (email !== null && email !== undefined) customer.email = email;
    return customer;
  };

  return {
    // A37: customer_id = mã tài khoản trong token (C4): client không gửi mã, nên không tạo hộ người khác.
    async createCustomer({ name, dob, email }, identity) {
      const { accountId, role } = checkIdentity(identity);
      if (role !== 'customer') throw forbidden(); // admin chỉ xem, driver không liên quan (BRULE18)
      const cleanName = normalizeName(name);
      const cleanDob = isPresent(dob) ? checkDob(dob, now()) : null;
      // Email tùy chọn (ADR-019): lưu dạng rõ, chữ thường; KHÔNG qua bộ mã hóa.
      const cleanEmail = isPresent(email) ? normalizeEmail(email) : null;

      // INSERT thẳng, để PK của database chặn hồ sơ thứ hai (C1): không có khe hở giữa
      // "kiểm tra đã có chưa" và "ghi" khi hai request tạo cùng lúc.
      const inserted = await profiles.insert({
        customerId: accountId,
        nameEnc: cipher.encrypt(cleanName),
        dobEnc: cleanDob === null ? null : cipher.encrypt(cleanDob),
        email: cleanEmail,
      });
      if (!inserted) throw new CustomerError('ALREADY_EXISTS', 'CUSTOMER_ALREADY_EXISTS');
      // Chỉ ghi mã, KHÔNG ghi họ tên, ngày sinh, email (NFR08, NFR10).
      log.info('customer_created', { customer_id: accountId });
      return toCustomer(accountId, { name: cleanName, dob: cleanDob, email: cleanEmail });
    },

    // A38 (Gateway điền mã = sub) và A09 (mã trong đường dẫn).
    async getCustomer({ customer_id: customerId }, identity) {
      const { accountId, role } = checkIdentity(identity);
      if (role === 'driver') throw forbidden();
      // HS1: khách xem mã KHÁC mình → 403 NGAY, chưa đọc database. Mã là số nhỏ dễ đoán; nếu tra trước
      // rồi mới so chủ thì 404 / 403 sẽ lộ "mã này đã có hồ sơ hay chưa".
      // So được ngay vì customer_id = account_id.
      if (role === 'customer' && customerId !== accountId) throw new CustomerError('PERMISSION_DENIED', 'NOT_OWNER');
      // Gateway đã chặn mã sai dạng; service vẫn chặn khi bị gọi thẳng (admin gửi 0 hoặc số âm).
      if (!Number.isSafeInteger(customerId) || customerId < 1) throw new CustomerError('INVALID_ARGUMENT', 'INVALID_ID');

      const row = await profiles.findById(customerId);
      if (!row) throw notFound();
      return toCustomer(customerId, { ...decode(row), email: row.email ?? null });
    },

    // A10: sửa MỘT PHẦN hồ sơ của chính mình. Field vắng = giữ nguyên; clear_dob = xóa ngày sinh (HS2);
    // clear_email = xóa email (HS6).
    async updateCustomer({ name, dob, clear_dob: clearDob, email, clear_email: clearEmail }, identity) {
      const { accountId, role } = checkIdentity(identity);
      if (role !== 'customer') throw forbidden();
      const hasName = isPresent(name);
      const hasDob = isPresent(dob);
      const hasEmail = isPresent(email);
      // Phải đổi ít nhất một thứ; vừa đặt vừa xóa cùng một field là mâu thuẫn.
      if ((!hasName && !hasDob && !clearDob && !hasEmail && !clearEmail) || (hasDob && clearDob) || (hasEmail && clearEmail)) {
        throw new CustomerError('INVALID_ARGUMENT', 'INVALID_INPUT');
      }
      // Kiểm tra TRƯỚC khi mở giao dịch: dữ liệu sai (ví dụ có `<script>`, email sai) thì hồ sơ không bị đụng tới.
      const newName = hasName ? normalizeName(name) : undefined;
      const newDob = hasDob ? checkDob(dob, now()) : undefined;
      const newEmail = hasEmail ? normalizeEmail(email) : undefined;

      // Khóa dòng (SELECT … FOR UPDATE) trong một giao dịch: hai lần sửa cùng lúc không ghi đè
      // nửa chừng lên nhau (C5). Hàm dưới chạy khi đã giữ khóa dòng.
      const result = await profiles.updateLocked(accountId, (row) => {
        const current = decode(row);
        const next = {
          name: newName ?? current.name,
          dob: clearDob ? null : (newDob ?? current.dob),
          email: clearEmail ? null : (newEmail ?? row.email ?? null),
        };
        return {
          // Field không đổi giữ nguyên bản mã cũ; field đổi mã hóa lại với IV mới.
          nameEnc: hasName ? cipher.encrypt(next.name) : row.full_name_enc,
          dobEnc: hasDob ? cipher.encrypt(next.dob) : (clearDob ? null : row.date_of_birth_enc),
          email: next.email, // dạng rõ, không mã hóa (ADR-019)
          plain: next,
        };
      });
      if (!result) throw notFound();
      log.info('customer_updated', { customer_id: accountId });
      return toCustomer(accountId, result.plain);
    },
  };
}
