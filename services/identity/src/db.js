import pg from 'pg';

// Dừng sớm nếu thiếu cấu hình, thay vì chạy rồi báo lỗi khó hiểu.
const requiredVariables = [
  'IDENTITY_DB_USER',
  'IDENTITY_DB_PASSWORD',
  'IDENTITY_DB_NAME',
  'IDENTITY_DB_HOST',
  'IDENTITY_DB_PORT',
];

for (const name of requiredVariables) {
  if (!process.env[name]) {
    throw new Error(`Thiếu biến môi trường: ${name}`);
  }
}

const port = Number(process.env.IDENTITY_DB_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('IDENTITY_DB_PORT không hợp lệ');
}

// Pool quản lý một nhóm kết nối có thể tái sử dụng.
// Không tạo kết nối database mới cho từng request bằng tay.
export const db = new pg.Pool({
  host: process.env.IDENTITY_DB_HOST,
  port,
  user: process.env.IDENTITY_DB_USER,
  password: process.env.IDENTITY_DB_PASSWORD,
  database: process.env.IDENTITY_DB_NAME,

  // Giới hạn số kết nối tối đa của tiến trình Identity này.
  max: 5,

  // Không đợi kết nối vô hạn khi database bị tắt.
  connectionTimeoutMillis: 3000,

  // Giới hạn thời gian thực hiện mỗi câu SQL trên server.
  statement_timeout: 5000,
});

// Pool có thể phát lỗi ở kết nối đang nhàn rỗi.
// Ghi mã lỗi, không ghi cấu hình có chứa mật khẩu.
db.on('error', (error) => {
  console.error('[Identity DB] Pool error:', error.code);
});