// Seed dữ liệu demo của customer-service (03 mục 14; spec 11 mục 7.2).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định).
//   - Mã khách = mã tài khoản seed ở auth (KH1 = 1, KH2 = 2, KH9 = 9). KHÔNG gọi auth-service:
//     hai service không gọi nhau (ADR-013), quy luật mã đã cố định nên khớp mà không cần tra.
//   - KH3 (mã 3) cố ý KHÔNG có hồ sơ để demo "xem → 404, tạo → 201" (mục chấm 11 phụ).
//   - Mã hóa bằng CÙNG module với API tạo hồ sơ (A37): database chỉ thấy bản mã, kể cả dữ liệu seed.
//   - Khởi động lại không nhân đôi, không ghi đè họ tên / ngày sinh đã sửa khi demo.
//   - Email (ADR-019, thêm 2026-10-05): database đã seed TRƯỚC khi có cột email thì KH1, KH2 có email = NULL.
//     Để không phải `docker compose down -v`, khi trùng mã seed chỉ ĐIỀN email nếu đang NULL; email đã có
//     (kể cả đã sửa khi demo) giữ nguyên. Đánh đổi: khách seed tự xóa email (A10 `"email": null`) rồi
//     customer-service khởi động lại thì email seed được điền lại — chỉ ảnh hưởng mã seed 1, 2.
import { createFieldCipher } from './domain/crypto.js';

export const SEED_PROFILES = [
  { id: 1, name: 'Nguyễn Văn An', dob: '2000-01-01', email: 'kh1@cab.vn' }, // KH1
  { id: 2, name: 'Trần Thị Bình', dob: '2000-02-02', email: 'kh2@cab.vn' }, // KH2: KH1 xem mã 2 → 403
  { id: 9, name: 'Lê Văn Chín', dob: null, email: null }, // KH9: tài khoản khóa, hồ sơ không có ngày sinh, email
];

export async function runSeed({ pool, log, config }) {
  const cipher = createFieldCipher(config.customerDataKey);
  let rows = 0;
  for (const profile of SEED_PROFILES) {
    const result = await pool.query(
      // DO UPDATE ... WHERE: chỉ đụng tới dòng khi email đang NULL và seed có email; ngoài ra như DO NOTHING
      // (rowCount = 0). Không bao giờ ghi lại cột mã hóa.
      `INSERT INTO customer_profiles (customer_id, full_name_enc, date_of_birth_enc, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) DO UPDATE SET email = EXCLUDED.email
       WHERE customer_profiles.email IS NULL AND EXCLUDED.email IS NOT NULL`,
      [profile.id, cipher.encrypt(profile.name), profile.dob === null ? null : cipher.encrypt(profile.dob), profile.email],
    );
    rows += result.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
