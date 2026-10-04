// Seed dữ liệu demo của trip-service (03 mục 14; spec 14-15-16-19-30 mục 7.4).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Không gọi service khác: quy luật mã đã cố định.
//   - Quy luật: mã trip = mã booking = mã payment (T3 ↔ B3…). Khách KH1 (mã 1), tuyến P0 → D0.
//   - T3 (TX1) và T4 (TX3) đã COMPLETED, đủ 5 dòng lịch sử cách nhau 1 phút; T5 (TX6) đang ACCEPTED (mục 18).
//   - Lịch sử KHÔNG có khóa tự nhiên để ON CONFLICT, nên CHỈ chèn khi `INSERT trips` vừa tạo dòng:
//     khởi động lại không nhân đôi (AC-DX-04: 11 dòng).
//   - Thời điểm: booking Bn tạo lúc seed − (8 − n) giờ (DX16); chuyến nhận sau đó 1 phút.

export const P0 = [10.82, 106.68];
export const D0 = [10.83, 106.69];
const CUSTOMER_ID = 1; // KH1
const FARE_CAR_4 = 45000; // cước CAR_4 tuyến P0 → D0 (03 mục 6.3)

export const SEED_TRIPS = [
  { id: 3, driverId: 11, pay: 'CASH', status: 'COMPLETED' }, // TX1
  { id: 4, driverId: 13, pay: 'ONLINE', status: 'COMPLETED' }, // TX3
  { id: 5, driverId: 16, pay: 'ONLINE', status: 'ACCEPTED' }, // TX6 (đang BUSY với booking 5 ở driver-service)
];

const FLOW = ['ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED'];
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export async function runSeed({ pool, log, now = () => Date.now() }) {
  const seedAt = now();
  let rows = 0;
  for (const t of SEED_TRIPS) {
    const acceptedAt = seedAt - (8 - t.id) * HOUR_MS + MINUTE_MS;
    const at = (step) => new Date(acceptedAt + step * MINUTE_MS); // bước thứ `step` trong FLOW
    const steps = t.status === 'COMPLETED' ? FLOW.length : 1;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // OVERRIDING SYSTEM VALUE: đặt mã nhỏ theo quy luật; dãy identity vẫn bắt đầu 1000 cho chuyến tạo qua API.
      const inserted = await client.query(
        `INSERT INTO trips (trip_id, booking_id, customer_id, driver_id, vehicle_type, pickup_lat, pickup_lng,
                            destination_lat, destination_lng, payment_method, fare_amount, status,
                            started_at, ended_at, created_at, updated_at)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $1, $2, $3, 'CAR_4', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT DO NOTHING
         RETURNING trip_id`,
        [
          t.id, CUSTOMER_ID, t.driverId, P0[0], P0[1], D0[0], D0[1], t.pay, FARE_CAR_4, t.status,
          t.status === 'COMPLETED' ? at(2) : null, // started_at = lúc PICKED_UP
          t.status === 'COMPLETED' ? at(4) : null, // ended_at = lúc COMPLETED
          at(0), at(steps - 1),
        ],
      );
      if (inserted.rowCount === 1) {
        rows += 1;
        for (let i = 0; i < steps; i += 1) {
          await client.query(
            `INSERT INTO trip_status_history (trip_id, from_status, to_status, changed_by, changed_by_role, changed_at)
             VALUES ($1, $2, $3, $4, 'driver', $5)`,
            [t.id, i === 0 ? null : FLOW[i - 1], FLOW[i], t.driverId, at(i)],
          );
          rows += 1;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
