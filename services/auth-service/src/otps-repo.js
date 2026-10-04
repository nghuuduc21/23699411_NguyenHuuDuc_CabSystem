// Truy cập bảng `otp_verifications` (spec 12-13-21-23 mục 4.3, 7.1).
// MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quyết định OTP đúng hay sai, hết hạn hay chưa nằm ở src/domain/auth.js.

export const OTP_PURPOSE = 'DRIVER_REGISTRATION';

export function createOtpsRepo(pool) {
  return {
    // Hạn tính bằng đồng hồ của DATABASE (now() + n giây), và lúc kiểm tra cũng so với now() của
    // database: một đồng hồ duy nhất, không lệch giữa container service và container database.
    async insert({ phone, otpHash, ttlSeconds }) {
      const { rows } = await pool.query(
        `INSERT INTO otp_verifications (phone, otp_hash, purpose, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4))
         RETURNING otp_id`,
        [phone, otpHash, OTP_PURPOSE, ttlSeconds],
      );
      return rows[0];
    },

    // Chạy `work(tx)` trong MỘT giao dịch rồi COMMIT; `work` ném lỗi thì ROLLBACK.
    // Vì sao cần giao dịch: "đánh dấu OTP đã dùng" và "tạo tài khoản" phải cùng thành công hoặc cùng
    // không (spec mục 4.3 bước 6). Lần nhập sai cũng COMMIT để lượt sai được ghi lại.
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          // FOR UPDATE: khóa dòng OTP mới nhất. Hai A08 cùng lúc với cùng mã thì request thứ hai phải chờ,
          // rồi thấy `consumed_at` đã có → OTP_INVALID, không tạo được tài khoản thứ hai.
          // `expired` tính ngay trong database (cùng đồng hồ với lúc tạo).
          async latestForUpdate(phone) {
            const { rows } = await client.query(
              `SELECT otp_id, otp_hash, attempt_count, consumed_at, expires_at <= now() AS expired
               FROM otp_verifications
               WHERE phone = $1 AND purpose = $2
               ORDER BY created_at DESC, otp_id DESC
               LIMIT 1
               FOR UPDATE`,
              [phone, OTP_PURPOSE],
            );
            return rows[0] ?? null;
          },
          async addAttempt(otpId) {
            await client.query('UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE otp_id = $1', [otpId]);
          },
          async consume(otpId) {
            await client.query('UPDATE otp_verifications SET consumed_at = now() WHERE otp_id = $1', [otpId]);
          },
          // Tạo tài khoản TRONG cùng giao dịch. Trùng số (request song song) → lỗi 23505 → ROLLBACK cả OTP.
          async insertAccount({ phone, passwordHash, role }) {
            const { rows } = await client.query(
              'INSERT INTO accounts (phone, password_hash, role) VALUES ($1, $2, $3) RETURNING account_id, role',
              [phone, passwordHash, role],
            );
            return rows[0];
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
