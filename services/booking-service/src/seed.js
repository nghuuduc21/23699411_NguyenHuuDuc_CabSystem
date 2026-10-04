// Seed dữ liệu demo của booking-service (03 mục 14; spec 14-15-16-19-30 mục 7.4).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Không gọi service khác: quy luật mã đã cố định.
//   - Quy luật: mã booking = mã payment = mã trip = mã offer = mã phân công = 1…7 (nếu có).
//   - Khách KH1 (mã 1); mọi booking đi P0 (10.82, 106.68) → D0 (10.83, 106.69).
//   - Quãng đường tính bằng CHÍNH hàm domain/distance.js (≈ 2 026 m). Cước là số payment-service tính bằng
//     domain/fare.js của nó cho cùng quãng đường: CAR_4 45 000 đ, CAR_7 56 000 đ (03 mục 6.3).
//   - Bn tạo lúc seed − (8 − n) giờ (DX16): mục 14 luôn ra 7, 6 rồi 5, 4.
//   - B7 (CAR_7, ONLINE, PENDING_PAYMENT) dành cho mục 19, 30; sau khi thanh toán, lời mời tới TX4 (CAR_7),
//     không giữ TX1 của mục 15.
//   - OVERRIDING SYSTEM VALUE + ON CONFLICT DO NOTHING: khởi động lại không nhân đôi, không ghi đè dữ liệu
//     đã đổi khi demo; dãy identity vẫn bắt đầu 1000 cho dữ liệu tạo qua API.
import { estimateDistanceM } from './domain/distance.js';

export const P0 = [10.82, 106.68];
export const D0 = [10.83, 106.69];
const CUSTOMER_ID = 1; // KH1
const FARES = { CAR_4: 45000, CAR_7: 56000 };
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const OFFER_TIMEOUT_MS = 300_000;

export const SEED_BOOKINGS = [
  { id: 1, vehicle: 'CAR_4', pay: 'CASH', status: 'CANCELED', canceledBy: 'customer', reason: 'doi y', canceledAfter: 2 },
  { id: 2, vehicle: 'CAR_4', pay: 'ONLINE', status: 'NO_DRIVER_FOUND' },
  { id: 3, vehicle: 'CAR_4', pay: 'CASH', status: 'DRIVER_ASSIGNED', driverId: 11, offerDistance: 111 }, // TX1
  { id: 4, vehicle: 'CAR_4', pay: 'ONLINE', status: 'DRIVER_ASSIGNED', driverId: 13, offerDistance: 334 }, // TX3
  { id: 5, vehicle: 'CAR_4', pay: 'ONLINE', status: 'DRIVER_ASSIGNED', driverId: 16, offerDistance: 667 }, // TX6
  { id: 6, vehicle: 'CAR_4', pay: 'ONLINE', status: 'CANCELED', canceledBy: 'system', reason: 'PAYMENT_EXPIRED', canceledAfter: 10 },
  { id: 7, vehicle: 'CAR_7', pay: 'ONLINE', status: 'PENDING_PAYMENT' }, // mục 19, 30
];

export async function runSeed({ pool, log, now = () => Date.now() }) {
  const seedAt = now();
  const distanceM = estimateDistanceM(P0, D0);
  let rows = 0;
  for (const b of SEED_BOOKINGS) {
    const createdMs = seedAt - (8 - b.id) * HOUR_MS;
    const at = (minutes) => new Date(createdMs + minutes * MINUTE_MS);
    const booking = await pool.query(
      `INSERT INTO bookings (booking_id, customer_id, vehicle_type, pickup_lat, pickup_lng, destination_lat, destination_lng,
                             payment_method, estimated_distance_m, fare_amount, payment_id, status,
                             cancel_reason, canceled_by, canceled_at, created_at, updated_at)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1, $11, $12, $13, $14, $15, $15)
       ON CONFLICT DO NOTHING`,
      [
        b.id, CUSTOMER_ID, b.vehicle, P0[0], P0[1], D0[0], D0[1], b.pay, distanceM, FARES[b.vehicle], b.status,
        b.reason ?? null, b.canceledBy ?? null, b.canceledAfter === undefined ? null : at(b.canceledAfter), at(0),
      ],
    );
    rows += booking.rowCount;
    if (!b.driverId) continue;
    // Lời mời đã được nhận 1 phút sau khi đặt; hạn 300 giây tính từ lúc mời.
    const offer = await pool.query(
      `INSERT INTO driver_offers (offer_id, booking_id, driver_id, distance_m, status, expires_at, responded_at, created_at)
       OVERRIDING SYSTEM VALUE VALUES ($1, $1, $2, $3, 'ACCEPTED', $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [b.id, b.driverId, b.offerDistance, new Date(createdMs + 30_000 + OFFER_TIMEOUT_MS), at(1), new Date(createdMs + 30_000)],
    );
    const assignment = await pool.query(
      `INSERT INTO driver_assignments (assignment_id, booking_id, offer_id, driver_id, trip_id, assigned_at, created_at)
       OVERRIDING SYSTEM VALUE VALUES ($1, $1, $1, $2, $1, $3, $3)
       ON CONFLICT DO NOTHING`,
      [b.id, b.driverId, at(1)],
    );
    rows += offer.rowCount + assignment.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
