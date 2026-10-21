// Seed dữ liệu demo của auth-service (03 mục 14; spec 09-10 mục 7.3).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định).
//   - Mã là số nhỏ theo quy luật để gõ tay và học thuộc được (ADR-021: "tài xế dùng số, mọi người khác dùng email"):
//     khách khn@cab.vn ↔ mã n, tài xế 091000000n ↔ mã 10 + n, admin admin@cab.vn ↔ mã 99.
//   - Khách / admin: email, phone NULL; tài xế: phone, email NULL — đúng CHECK accounts_identity_by_role.
//     Số điện thoại liên hệ của khách nằm ở hồ sơ (seed của customer-service).
//   - OVERRIDING SYSTEM VALUE: cột identity mặc định không cho tự đặt mã; seed cần đặt mã cố định.
//     Dãy số của identity không bị đẩy lên nên mã tạo qua API vẫn bắt đầu từ 1000.
//   - ON CONFLICT DO NOTHING: khởi động lại không nhân đôi và không ghi đè dữ liệu đã đổi khi demo.
//   - Mật khẩu băm bằng CÙNG module với đăng ký (scrypt), mỗi tài khoản một salt riêng.
import { hashPassword } from './domain/password.js';

export const SEED_ACCOUNTS = [
  { id: 1, email: 'kh1@cab.vn', phone: null, role: 'customer', status: 'ACTIVE' }, // KH1
  { id: 2, email: 'kh2@cab.vn', phone: null, role: 'customer', status: 'ACTIVE' }, // KH2
  { id: 3, email: 'kh3@cab.vn', phone: null, role: 'customer', status: 'ACTIVE' }, // KH3 (chưa có hồ sơ)
  { id: 9, email: 'kh9@cab.vn', phone: null, role: 'customer', status: 'LOCKED' }, // KH9 bị khóa → 403 ở mục 10
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 11 + i, // TX1–TX8 = 11–18
    email: null,
    phone: `091000000${i + 1}`,
    role: 'driver',
    status: 'ACTIVE',
  })),
  // AD1: bỏ số 0999999999 (ADR-021) — một luật duy nhất, đăng nhập bằng số chỉ có thể ra tài xế.
  { id: 99, email: 'admin@cab.vn', phone: null, role: 'admin', status: 'ACTIVE' },
];

export async function runSeed({ pool, log, config, hash = hashPassword }) {
  let rows = 0;
  for (const account of SEED_ACCOUNTS) {
    const passwordHash = await hash(config.seedPassword);
    const result = await pool.query(
      `INSERT INTO accounts (account_id, email, phone, password_hash, role, status)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [account.id, account.email, account.phone, passwordHash, account.role, account.status],
    );
    rows += result.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
