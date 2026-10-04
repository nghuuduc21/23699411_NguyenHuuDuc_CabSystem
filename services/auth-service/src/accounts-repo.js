// Truy cập bảng `accounts`. MỌI giá trị đi qua tham số $1, $2… — không bao giờ ghép chuỗi vào SQL.
// Vì sao chống được SQL injection (mục chấm 25): driver gửi câu lệnh và giá trị TÁCH RIÊNG cho
// PostgreSQL, nên `' OR '1'='1` chỉ là một chuỗi dữ liệu bình thường, không thành một phần câu lệnh.

export function createAccountsRepo(pool) {
  return {
    async insert({ phone, email, passwordHash, role }) {
      const { rows } = await pool.query(
        'INSERT INTO accounts (phone, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING account_id, role',
        [phone, email, passwordHash, role],
      );
      return rows[0];
    },
    async findByPhone(phone) {
      const { rows } = await pool.query(
        'SELECT account_id, password_hash, role, status FROM accounts WHERE phone = $1',
        [phone],
      );
      return rows[0] ?? null;
    },
    async findByEmail(email) {
      const { rows } = await pool.query(
        'SELECT account_id, password_hash, role, status FROM accounts WHERE email = $1',
        [email],
      );
      return rows[0] ?? null;
    },
  };
}
