// Truy cập bảng `customer_profiles`. MỌI giá trị đi qua tham số $1, $2… — không bao giờ ghép chuỗi vào SQL
// (mục chấm 25): driver gửi câu lệnh và giá trị TÁCH RIÊNG cho PostgreSQL, nên dữ liệu không thể
// biến thành một phần câu lệnh.
// Repo chỉ đọc / ghi byte đã mã hóa; mã hóa và giải mã nằm ở logic nghiệp vụ (src/domain/).

const COLUMNS = 'customer_id, full_name_enc, date_of_birth_enc, email';

export function createProfilesRepo(pool) {
  return {
    // ON CONFLICT DO NOTHING: đã có hồ sơ thì không ghi đè, không ném lỗi; rowCount = 0 cho biết là trùng.
    // `email` lưu dạng rõ (ADR-019); thiếu thì NULL.
    async insert({ customerId, nameEnc, dobEnc, email = null }) {
      const result = await pool.query(
        `INSERT INTO customer_profiles (customer_id, full_name_enc, date_of_birth_enc, email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id) DO NOTHING
         RETURNING customer_id`,
        [customerId, nameEnc, dobEnc, email],
      );
      return result.rowCount === 1;
    },

    async findById(customerId) {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM customer_profiles WHERE customer_id = $1`, [customerId]);
      return rows[0] ?? null;
    },

    // Sửa trong MỘT giao dịch: khóa dòng → `change(row)` tính giá trị mới → UPDATE → COMMIT.
    // Không có dòng → trả null (hồ sơ chưa tạo). `change` ném lỗi (ví dụ giải mã hỏng) → ROLLBACK.
    async updateLocked(customerId, change) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT ${COLUMNS} FROM customer_profiles WHERE customer_id = $1 FOR UPDATE`,
          [customerId],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const next = await change(rows[0]);
        await client.query(
          `UPDATE customer_profiles
           SET full_name_enc = $2, date_of_birth_enc = $3, email = $4, updated_at = now()
           WHERE customer_id = $1`,
          [customerId, next.nameEnc, next.dobEnc, next.email],
        );
        await client.query('COMMIT');
        return next;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
