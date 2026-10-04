// Seed dữ liệu demo của driver-service (03 mục 14; spec 12-13-21-23 mục 7.4).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định).
//   - driver_id = mã tài khoản seed ở auth (TX1–TX8 = 11–18). KHÔNG gọi auth-service: hai service không
//     gọi nhau, quy luật mã đã cố định nên khớp mà không cần tra.
//   - Quy luật dễ nhớ: "Tài Xế n", biển số 59A-0000n, giấy phép GPLX-0000n, vehicle_id = driver_id.
//   - Vị trí quanh điểm mẫu P0 = (10.82, 106.68): TXn lệch 0.00n độ vĩ ≈ n × 111 m về phía bắc,
//     nên khoảng cách đọc ra ngay từ số thứ tự (TX1 111 m, TX2 222 m, …). TX8 ở xa 2,2 km (ngoài 1 km).
//   - Mã hóa số giấy phép bằng CÙNG module với A11: database chỉ thấy bản mã, kể cả dữ liệu seed.
//   - ON CONFLICT DO NOTHING: khởi động lại không nhân đôi, không ghi đè dữ liệu đã đổi khi demo.
import { createFieldCipher } from './domain/crypto.js';

const LNG = 106.68;
export const SEED_DRIVERS = [
  { id: 11, vehicle: 'CAR_4', approval: 'APPROVED', availability: 'ONLINE', lat: 10.821 },
  { id: 12, vehicle: 'MOTORBIKE', approval: 'APPROVED', availability: 'ONLINE', lat: 10.822 },
  { id: 13, vehicle: 'CAR_4', approval: 'APPROVED', availability: 'ONLINE', lat: 10.823 },
  { id: 14, vehicle: 'CAR_7', approval: 'APPROVED', availability: 'ONLINE', lat: 10.824 },
  { id: 15, vehicle: 'CAR_4', approval: 'APPROVED', availability: 'OFFLINE', lat: 10.825 }, // tắt nhận chuyến
  { id: 16, vehicle: 'CAR_4', approval: 'APPROVED', availability: 'BUSY', lat: 10.826, bookingId: 5 }, // đang chở B5
  { id: 17, vehicle: 'CAR_4', approval: 'PENDING', availability: 'OFFLINE', lat: null }, // hồ sơ chờ duyệt (mục 22)
  { id: 18, vehicle: 'CAR_4', approval: 'APPROVED', availability: 'ONLINE', lat: 10.84 }, // ngoài 1 km
].map((d) => ({ ...d, n: d.id - 10 }));

const ADMIN_ID = 99; // AD1 — người duyệt các hồ sơ seed đã duyệt

export async function runSeed({ pool, log, config }) {
  const cipher = createFieldCipher(config.driverDataKey);
  let rows = 0;
  for (const d of SEED_DRIVERS) {
    const approved = d.approval === 'APPROVED';
    const driver = await pool.query(
      `INSERT INTO drivers (driver_id, full_name, license_number_enc, approval_status, reviewed_by, reviewed_at,
                            availability, current_booking_id, current_lat, current_lng, location_updated_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END, $7, $8, $9, $10,
               CASE WHEN $9::double precision IS NULL THEN NULL ELSE now() END)
       ON CONFLICT DO NOTHING`,
      [
        d.id, `Tài Xế ${d.n}`, cipher.encrypt(`GPLX-0000${d.n}`), d.approval, approved ? ADMIN_ID : null, approved,
        d.availability, d.bookingId ?? null, d.lat, d.lat === null ? null : LNG,
      ],
    );
    // OVERRIDING SYSTEM VALUE: cột identity không cho tự đặt mã; seed đặt vehicle_id = driver_id cho dễ nhớ.
    // Dãy identity vẫn bắt đầu 1000 nên xe tạo qua API không trùng.
    const vehicle = await pool.query(
      `INSERT INTO vehicles (vehicle_id, driver_id, vehicle_type, license_plate)
       OVERRIDING SYSTEM VALUE VALUES ($1, $1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [d.id, d.vehicle, `59A-0000${d.n}`],
    );
    rows += driver.rowCount + vehicle.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
