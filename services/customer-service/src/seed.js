// Seed dữ liệu demo của customer-service (03 mục 14; spec 11 mục 7.2).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định).
//   - Mã khách = mã tài khoản seed ở auth (KH1 = 1, KH2 = 2, KH9 = 9). KHÔNG gọi auth-service:
//     hai service không gọi nhau (ADR-013), quy luật mã đã cố định nên khớp mà không cần tra.
//   - KH3 (mã 3) cố ý KHÔNG có hồ sơ để demo "xem → 404, tạo → 201" (mục chấm 11 phụ).
//   - Mã hóa bằng CÙNG module với API tạo hồ sơ (A37): database chỉ thấy bản mã, kể cả dữ liệu seed.
//   - Số điện thoại liên hệ (ADR-021): quy luật 090000000n ↔ mã n ↔ email đăng nhập khn@cab.vn (ở auth).
//   - ON CONFLICT DO NOTHING: khởi động lại không nhân đôi, không ghi đè dữ liệu đã sửa khi demo.
import { createFieldCipher } from './domain/crypto.js';

export const SEED_PROFILES = [
  { id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01', phone: '0900000001' }, // KH1
  { id: 2, name: 'Trần Thị Bình', dob: '2000-02-02', phone: '0900000002' }, // KH2: KH1 xem mã 2 → 403
  { id: 9, name: 'Lê Văn Chín', dob: null, phone: '0900000009' }, // KH9: tài khoản khóa, hồ sơ không có ngày sinh
];

export async function runSeed({ pool, log, config }) {
  const cipher = createFieldCipher(config.customerDataKey);
  let rows = 0;
  for (const profile of SEED_PROFILES) {
    const result = await pool.query(
      `INSERT INTO customer_profiles (customer_id, full_name_enc, date_of_birth_enc, phone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) DO NOTHING`,
      [profile.id, cipher.encrypt(profile.name), profile.dob === null ? null : cipher.encrypt(profile.dob), profile.phone],
    );
    rows += result.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
