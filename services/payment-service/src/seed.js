// Seed dữ liệu demo của payment-service (03 mục 14; spec 14-15-16-19-30 mục 7.4).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Không gọi service khác: quy luật mã đã cố định.
//   - Quy luật: mã payment = mã fare = mã booking = 1…7; khách KH1 (mã 1); tuyến P0 → D0.
//   - Cước tính bằng CHÍNH hàm domain/fare.js (CAR_4 45 000 đ, CAR_7 56 000 đ).
//   - Thời điểm: Bn tạo lúc seed − (8 − n) giờ (DX16). Thanh toán ONLINE có hạn = lúc tạo + 600 s (đã qua, nhưng
//     không còn PENDING / FAILED nên tiến trình hết hạn không chạm). RIÊNG B7: hạn = lúc seed + 1 ngày để mục 19,
//     30 chấm lúc nào trong ngày cũng được — đây là dữ liệu mẫu, không phải quy tắc.
//   - Giao dịch seed có callback_response đúng dạng A32. ON CONFLICT DO NOTHING (UNIQUE mã giao dịch):
//     khởi động lại không nhân đôi, không ghi đè dữ liệu đã đổi khi demo (ví dụ B7 đã được thanh toán).
import { calculateFare } from './domain/fare.js';

const CUSTOMER_ID = 1; // KH1
// Quãng đường ước tính P0 (10.82, 106.68) → D0 (10.83, 106.69): Haversine ≈ 1 559 m × 1,3 = 2 026 m.
// booking-service tính bằng domain/distance.js và seed cùng số này (03 mục 6.3).
export const SEED_DISTANCE_M = 2026;
const RATES = {
  CAR_4: { base_fare: 20000, per_km_rate: 12000, min_fare: 30000 },
  CAR_7: { base_fare: 25000, per_km_rate: 15000, min_fare: 40000 },
};
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;
const PAYMENT_TIMEOUT_MS = 600_000;

// paidAfter / refundedAfter: số phút sau lúc tạo.
export const SEED_PAYMENTS = [
  { id: 1, vehicle: 'CAR_4', method: 'CASH', status: 'CANCELED', reason: 'BOOKING_CANCELED' },
  { id: 2, vehicle: 'CAR_4', method: 'ONLINE', status: 'REFUNDED', reason: 'NO_DRIVER_FOUND', paidAfter: 1, refundedAfter: 6 },
  { id: 3, vehicle: 'CAR_4', method: 'CASH', status: 'COMPLETED', paidAfter: 5 }, // tiền mặt thu khi chuyến T3 xong
  { id: 4, vehicle: 'CAR_4', method: 'ONLINE', status: 'COMPLETED', paidAfter: 1 },
  { id: 5, vehicle: 'CAR_4', method: 'ONLINE', status: 'COMPLETED', paidAfter: 1 },
  { id: 6, vehicle: 'CAR_4', method: 'ONLINE', status: 'CANCELED', reason: 'PAYMENT_EXPIRED' },
  { id: 7, vehicle: 'CAR_7', method: 'ONLINE', status: 'PENDING', expiresInDay: true }, // mục 19, 30
];

// Giao dịch seed: lần thu thành công của B2, B4, B5 và lần hoàn của B2.
export const SEED_TRANSACTIONS = [
  { paymentId: 2, type: 'CHARGE', attemptNo: 1, txnId: 'SIM-2-1', status: 'COMPLETED', after: 1 },
  { paymentId: 2, type: 'REFUND', attemptNo: null, txnId: 'SIM-R-2', status: 'REFUNDED', after: 6 },
  { paymentId: 4, type: 'CHARGE', attemptNo: 1, txnId: 'SIM-4-1', status: 'COMPLETED', after: 1 },
  { paymentId: 5, type: 'CHARGE', attemptNo: 1, txnId: 'SIM-5-1', status: 'COMPLETED', after: 1 },
];

export async function runSeed({ pool, log, now = () => Date.now() }) {
  const seedAt = now();
  const createdAt = (id) => seedAt - (8 - id) * HOUR_MS;
  const after = (id, minutes) => (minutes === undefined ? null : new Date(createdAt(id) + minutes * MINUTE_MS));
  const amounts = {};
  let rows = 0;

  for (const p of SEED_PAYMENTS) {
    const rate = RATES[p.vehicle];
    const total = calculateFare(rate, SEED_DISTANCE_M);
    amounts[p.id] = total;
    const created = new Date(createdAt(p.id));
    let expiresAt = null;
    if (p.method === 'ONLINE') expiresAt = new Date(p.expiresInDay ? seedAt + DAY_MS : createdAt(p.id) + PAYMENT_TIMEOUT_MS);
    // OVERRIDING SYSTEM VALUE: đặt mã nhỏ theo quy luật; dãy identity vẫn bắt đầu 1000 cho dữ liệu tạo qua API.
    const fare = await pool.query(
      `INSERT INTO fares (fare_id, booking_id, vehicle_type, distance_m, base_fare, per_km_rate, min_fare, total_amount, calculated_at, created_at)
       OVERRIDING SYSTEM VALUE VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT DO NOTHING`,
      [p.id, p.vehicle, SEED_DISTANCE_M, rate.base_fare, rate.per_km_rate, rate.min_fare, total, created],
    );
    const payment = await pool.query(
      `INSERT INTO payments (payment_id, booking_id, fare_id, customer_id, method, amount, status, status_reason,
                             expires_at, paid_at, refunded_at, created_at, updated_at)
       OVERRIDING SYSTEM VALUE VALUES ($1, $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT DO NOTHING`,
      [p.id, CUSTOMER_ID, p.method, total, p.status, p.reason ?? null, expiresAt, after(p.id, p.paidAfter), after(p.id, p.refundedAfter), created],
    );
    rows += fare.rowCount + payment.rowCount;
  }

  for (const t of SEED_TRANSACTIONS) {
    const response = { txn_id: t.txnId, txn_status: 'SUCCEEDED', payment_id: t.paymentId, status: t.status };
    const at = after(t.paymentId, t.after);
    const txn = await pool.query(
      `INSERT INTO payment_transactions (payment_id, type, attempt_no, provider_transaction_id, amount, status,
                                         callback_response, processed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'SUCCEEDED', $6, $7, $7)
       ON CONFLICT DO NOTHING`,
      [t.paymentId, t.type, t.attemptNo, t.txnId, amounts[t.paymentId], JSON.stringify(response), at],
    );
    rows += txn.rowCount;
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
