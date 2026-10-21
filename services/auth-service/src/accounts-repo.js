// Truy cập bảng `accounts`. MỌI giá trị đi qua tham số $1, $2… — không bao giờ ghép chuỗi vào SQL.
// Vì sao chống được SQL injection (mục chấm 25): driver gửi câu lệnh và giá trị TÁCH RIÊNG cho
// PostgreSQL, nên `' OR '1'='1` chỉ là một chuỗi dữ liệu bình thường, không thành một phần câu lệnh.

export function createAccountsRepo(pool) {
  return {
    // Khách / admin: email, phone NULL; tài xế: phone, email NULL (ADR-021, CHECK accounts_identity_by_role).
    // Tài xế tạo trong giao dịch OTP (otps-repo.js), nên ở đây chỉ còn đường đăng ký khách.
    async insert({ email, phone, passwordHash, role }) {
      const { rows } = await pool.query(
        'INSERT INTO accounts (email, phone, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING account_id, role',
        [email, phone, passwordHash, role],
      );
      return rows[0];
    },
    // Đăng nhập khách / admin. Email đã chuẩn hóa chữ thường trước khi tới đây; UNIQUE email là index.
    async findByEmail(email) {
      const { rows } = await pool.query(
        'SELECT account_id, password_hash, role, status FROM accounts WHERE email = $1',
        [email],
      );
      return rows[0] ?? null;
    },
    // Đăng nhập tài xế và kiểm "số đã có tài khoản" khi xin OTP / đăng ký tài xế.
    async findByPhone(phone) {
      const { rows } = await pool.query(
        'SELECT account_id, password_hash, role, status FROM accounts WHERE phone = $1',
        [phone],
      );
      return rows[0] ?? null;
    },
  };
}
