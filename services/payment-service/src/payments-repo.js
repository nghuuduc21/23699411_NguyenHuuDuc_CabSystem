// Truy cập bảng `fare_rates`, `fares`, `payments`, `payment_transactions`, `idempotency_keys`
// (spec 14-15-16-19-30 mục 5.7, 7.2). MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ (khi nào được thanh toán, cước bao nhiêu) ở src/domain/.
//
// `transaction(fn)`: mở một giao dịch, đưa cho fn một bộ hàm chạy TRÊN CÙNG kết nối đó, commit nếu fn xong,
// rollback nếu fn ném lỗi. Logic nghiệp vụ nhờ vậy gom nhiều bước thành một khối "cùng thành công hoặc cùng không"
// mà không phải biết tới thư viện `pg`.

const PAYMENT_COLUMNS = `payment_id, booking_id, customer_id, method, amount, status, status_reason, expires_at,
  (expires_at IS NOT NULL AND expires_at <= now()) AS expired`;
const TXN_COLUMNS = 'transaction_id, payment_id, type, attempt_no, provider_transaction_id, amount, status, callback_response';

// Bộ câu lệnh dùng chung cho kết nối của giao dịch (client) hoặc pool (đọc lẻ).
function statements(db) {
  return {
    async findPaymentByBooking(bookingId) {
      const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE booking_id = $1`, [bookingId]);
      return rows[0] ?? null;
    },

    async findRate(vehicleType) {
      const { rows } = await db.query('SELECT vehicle_type, base_fare, per_km_rate, min_fare FROM fare_rates WHERE vehicle_type = $1', [vehicleType]);
      return rows[0] ?? null;
    },

    // Bản chụp bảng giá lúc tính (BRULE08): cước không đổi dù bảng giá đổi sau này.
    async insertFare({ bookingId, vehicleType, distanceM, rate, total }) {
      const { rows } = await db.query(
        `INSERT INTO fares (booking_id, vehicle_type, distance_m, base_fare, per_km_rate, min_fare, total_amount, calculated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING fare_id`,
        [bookingId, vehicleType, distanceM, rate.base_fare, rate.per_km_rate, rate.min_fare, total],
      );
      return rows[0].fare_id;
    },

    // Hạn thanh toán tính bằng giờ của database (now() + n giây) để mọi so sánh "quá hạn" cùng một đồng hồ.
    async insertPayment({ bookingId, fareId, customerId, method, amount, timeoutSeconds }) {
      const { rows } = await db.query(
        `INSERT INTO payments (booking_id, fare_id, customer_id, method, amount, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING',
                 CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(secs => $6::int) END)
         RETURNING ${PAYMENT_COLUMNS}`,
        [bookingId, fareId, customerId, method, amount, timeoutSeconds],
      );
      return rows[0];
    },

    // Khóa dòng thanh toán đến hết giao dịch: request khác trên cùng thanh toán phải chờ.
    async lockPayment(paymentId) {
      const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE payment_id = $1 FOR UPDATE`, [paymentId]);
      return rows[0] ?? null;
    },

    async findIdempotencyKey(paymentId, key) {
      const { rows } = await db.query(
        'SELECT request_hash, response FROM idempotency_keys WHERE payment_id = $1 AND idempotency_key = $2',
        [paymentId, key],
      );
      return rows[0] ?? null;
    },

    async insertIdempotencyKey(paymentId, key, hash) {
      await db.query(
        'INSERT INTO idempotency_keys (payment_id, idempotency_key, request_hash) VALUES ($1, $2, $3)',
        [paymentId, key, hash],
      );
    },

    async saveIdempotencyResponse(paymentId, key, response) {
      await db.query(
        'UPDATE idempotency_keys SET response = $3 WHERE payment_id = $1 AND idempotency_key = $2',
        [paymentId, key, JSON.stringify(response)],
      );
    },

    // Số lần thu đã có (để đánh số lần thử) và có lần nào đang chờ kết quả không.
    async chargeSummary(paymentId) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS count, coalesce(bool_or(status = 'PENDING'), false) AS pending
         FROM payment_transactions WHERE payment_id = $1 AND type = 'CHARGE'`,
        [paymentId],
      );
      return rows[0];
    },

    async insertCharge({ paymentId, attemptNo, txnId, amount }) {
      const { rows } = await db.query(
        `INSERT INTO payment_transactions (payment_id, type, attempt_no, provider_transaction_id, amount, status)
         VALUES ($1, 'CHARGE', $2, $3, $4, 'PENDING')
         RETURNING ${TXN_COLUMNS}`,
        [paymentId, attemptNo, txnId, amount],
      );
      return rows[0];
    },

    // Khóa giao dịch theo mã của cổng thanh toán (UNIQUE) — chống xử lý một callback hai lần.
    async lockTransaction(providerTxnId) {
      const { rows } = await db.query(
        `SELECT ${TXN_COLUMNS} FROM payment_transactions WHERE provider_transaction_id = $1 FOR UPDATE`,
        [providerTxnId],
      );
      return rows[0] ?? null;
    },

    // Kết quả và response đã trả ghi CÙNG một lệnh (CHECK: có kết quả ⇔ có response).
    async finishTransaction(transactionId, status, callbackResponse) {
      await db.query(
        `UPDATE payment_transactions SET status = $2, callback_response = $3, processed_at = now()
         WHERE transaction_id = $1`,
        [transactionId, status, JSON.stringify(callbackResponse)],
      );
    },

    async insertRefund({ paymentId, txnId, amount, status, callbackResponse }) {
      await db.query(
        `INSERT INTO payment_transactions (payment_id, type, provider_transaction_id, amount, status, callback_response, processed_at)
         VALUES ($1, 'REFUND', $2, $3, $4, $5, now())`,
        [paymentId, txnId, amount, status, JSON.stringify(callbackResponse)],
      );
    },

    // Đổi trạng thái trong MỘT lệnh để các CHECK mức bảng (paid_at, refunded_at, status_reason) luôn đúng.
    // `reason` NULL = giữ lý do cũ (hoàn tiền sau khi hủy vẫn giữ PAYMENT_EXPIRED).
    async updatePayment(paymentId, { status, reason = null, paid = false, refunded = false }) {
      await db.query(
        `UPDATE payments
         SET status = $2,
             status_reason = COALESCE($3, status_reason),
             paid_at = CASE WHEN $4 THEN now() ELSE paid_at END,
             refunded_at = CASE WHEN $5 THEN now() ELSE refunded_at END,
             updated_at = now()
         WHERE payment_id = $1`,
        [paymentId, status, reason, paid, refunded],
      );
    },
  };
}

export function createPaymentsRepo(pool) {
  return {
    ...statements(pool),

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(statements(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // A30: thanh toán + bản chụp cước + mọi giao dịch theo thứ tự tạo.
    async findPaymentView(paymentId) {
      const { rows } = await pool.query(
        `SELECT p.payment_id, p.booking_id, p.customer_id, p.method, p.amount, p.status, p.status_reason,
                p.expires_at, p.paid_at, p.refunded_at,
                f.distance_m, f.base_fare, f.per_km_rate, f.min_fare
         FROM payments p JOIN fares f ON f.fare_id = p.fare_id
         WHERE p.payment_id = $1`,
        [paymentId],
      );
      if (rows.length === 0) return null;
      const txns = await pool.query(
        `SELECT provider_transaction_id, type, attempt_no, status, amount
         FROM payment_transactions WHERE payment_id = $1 ORDER BY transaction_id`,
        [paymentId],
      );
      return { ...rows[0], transactions: txns.rows };
    },

    // Tiến trình hết hạn: một lệnh UPDATE cho mọi thanh toán quá hạn, trả kèm trạng thái cũ để dựng K6.
    // SKIP LOCKED: dòng đang bị A31 / A32 khóa thì để lượt sau, không đứng chờ.
    async expireOverdue() {
      const { rows } = await pool.query(
        `WITH due AS (
           SELECT payment_id, status AS previous_status FROM payments
           WHERE method = 'ONLINE' AND status IN ('PENDING', 'FAILED') AND expires_at <= now()
           FOR UPDATE SKIP LOCKED
         )
         UPDATE payments p
         SET status = 'CANCELED', status_reason = 'PAYMENT_EXPIRED', updated_at = now()
         FROM due WHERE p.payment_id = due.payment_id
         RETURNING p.payment_id, p.booking_id, p.customer_id, p.method, p.amount, due.previous_status`,
      );
      return rows;
    },
  };
}
