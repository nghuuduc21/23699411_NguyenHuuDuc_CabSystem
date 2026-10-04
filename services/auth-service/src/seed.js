// Seed dữ liệu demo của auth-service (03 mục 14; spec 09-10 mục 7.3).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định).
//   - Mã là số nhỏ theo quy luật để gõ tay và học thuộc được: khách 090000000n ↔ mã n,
//     tài xế 091000000n ↔ mã 10 + n, admin 0999999999 ↔ mã 99.
//   - OVERRIDING SYSTEM VALUE: cột identity mặc định không cho tự đặt mã; seed cần đặt mã cố định.
//     Dãy số của identity không bị đẩy lên nên mã tạo qua API vẫn bắt đầu từ 1000.
//   - ON CONFLICT DO NOTHING: khởi động lại không nhân đôi và không ghi đè dữ liệu đã đổi khi demo.
//   - Mật khẩu băm bằng CÙNG module với đăng ký (scrypt), mỗi tài khoản một salt riêng.
import { hashPassword } from './domain/password.js';

export const SEED_ACCOUNTS = [
  { id: 1, phone: '0900000001', role: 'customer', status: 'ACTIVE' }, // KH1
  { id: 2, phone: '0900000002', role: 'customer', status: 'ACTIVE' }, // KH2
  { id: 3, phone: '0900000003', role: 'customer', status: 'ACTIVE' }, // KH3 (chưa có hồ sơ)
  { id: 9, phone: '0900000009', role: 'customer', status: 'LOCKED' }, // KH9 bị khóa → 403 ở mục 10
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 11 + i, // TX1–TX8 = 11–18
    phone: `091000000${i + 1}`,
    role: 'driver',
    status: 'ACTIVE',
  })),
  { id: 99, phone: '0999999999', role: 'admin', status: 'ACTIVE' }, // AD1
];

export async function runSeed({ pool, log, config, hash = hashPassword }) {
  let rows = 0;
  for (const account of SEED_ACCOUNTS) {
    const passwordHash = await hash(config.seedPassword);
    const result = await pool.query(
      `INSERT INTO accounts (account_id, phone, password_hash, role, status)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [account.id, account.phone, passwordHash, account.role, account.status],
    );
    rows += result.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
