// Truy cập bảng `bookings`, `driver_offers`, `driver_assignments` (spec 14-15-16-19-30 mục 5.6, 7.1).
// MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ (ai được mời, khi nào nhận được) ở src/domain/.
//
// `transaction(fn)`: mở một giao dịch, đưa cho fn bộ câu lệnh chạy trên CÙNG kết nối, commit nếu fn xong,
// rollback nếu fn ném lỗi. Quy ước khóa (B12): trong mọi giao dịch luôn khóa `bookings` TRƯỚC rồi mới
// tới `driver_offers` — hai giao dịch không bao giờ chờ nhau theo vòng tròn (không deadlock).

const BOOKING_COLUMNS = `b.booking_id, b.customer_id, b.vehicle_type, b.pickup_lat, b.pickup_lng, b.destination_lat,
  b.destination_lng, b.pickup_address, b.destination_address, b.payment_method, b.estimated_distance_m, b.fare_amount,
  b.payment_id, b.status, b.cancel_reason, b.canceled_by, b.created_at`;
const OFFER_COLUMNS = `o.offer_id, o.booking_id, o.driver_id, o.distance_m, o.status, o.expires_at,
  (o.expires_at <= now()) AS expired`;

// Câu lệnh dùng bên trong giao dịch (db = kết nối của giao dịch).
function txStatements(db) {
  return {
    // Khóa dòng booking đến hết giao dịch: ghép, nhận, từ chối, hết hạn, hủy (spec 18) xếp hàng trên cùng dòng.
    async lockBooking(bookingId) {
      const { rows } = await db.query(`SELECT ${BOOKING_COLUMNS} FROM bookings b WHERE b.booking_id = $1 FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },

    async lockOffer(offerId) {
      const { rows } = await db.query(`SELECT ${OFFER_COLUMNS} FROM driver_offers o WHERE o.offer_id = $1 FOR UPDATE`, [offerId]);
      return rows[0] ?? null;
    },

    async hasPendingOffer(bookingId) {
      const { rowCount } = await db.query("SELECT 1 FROM driver_offers WHERE booking_id = $1 AND status = 'PENDING'", [bookingId]);
      return rowCount > 0;
    },

    // Tài xế KHÔNG được mời: đã được mời cho booking này (B6, kể cả đã từ chối / hết hạn) hoặc đang có
    // Offer chờ của booking khác (B10).
    async excludedDrivers(bookingId) {
      const { rows } = await db.query(
        "SELECT driver_id FROM driver_offers WHERE booking_id = $1 OR status = 'PENDING'",
        [bookingId],
      );
      return rows.map((row) => row.driver_id);
    },

    // Tạo Offer trong một SAVEPOINT: nếu vấp UNIQUE (tài xế vừa được booking khác mời cùng lúc) thì chỉ
    // lùi lại lệnh này, giao dịch vẫn dùng được để thử người kế tiếp. Trả null khi vấp UNIQUE.
    async insertOffer({ bookingId, driverId, distanceM, timeoutSeconds }) {
      await db.query('SAVEPOINT tao_offer');
      try {
        const { rows } = await db.query(
          `INSERT INTO driver_offers (booking_id, driver_id, distance_m, status, expires_at)
           VALUES ($1, $2, $3, 'PENDING', now() + make_interval(secs => $4::int))
           RETURNING offer_id, booking_id, driver_id, distance_m, status, expires_at`,
          [bookingId, driverId, distanceM, timeoutSeconds],
        );
        await db.query('RELEASE SAVEPOINT tao_offer');
        return rows[0];
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT tao_offer');
        if (err.code === '23505') return null;
        throw err;
      }
    },

    async countOffers(bookingId) {
      const { rows } = await db.query('SELECT count(*)::int AS n FROM driver_offers WHERE booking_id = $1', [bookingId]);
      return rows[0].n;
    },

    async setBookingStatus(bookingId, status) {
      await db.query('UPDATE bookings SET status = $2, updated_at = now() WHERE booking_id = $1', [bookingId, status]);
    },

    // Trả lời / hết hạn Offer: chỉ khi còn PENDING (lặp an toàn). Trả true nếu đã đổi.
    async respondOffer(offerId, status) {
      const { rowCount } = await db.query(
        "UPDATE driver_offers SET status = $2, responded_at = now() WHERE offer_id = $1 AND status = 'PENDING'",
        [offerId, status],
      );
      return rowCount > 0;
    },

    async insertAssignment({ bookingId, offerId, driverId, tripId }) {
      await db.query(
        `INSERT INTO driver_assignments (booking_id, offer_id, driver_id, trip_id, assigned_at)
         VALUES ($1, $2, $3, $4, now())`,
        [bookingId, offerId, driverId, tripId],
      );
    },
  };
}

export function createBookingsRepo(pool) {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(txStatements(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // Lấy số booking TRƯỚC khi gọi Payment (B15; 03 mục 6.1).
    async nextBookingId() {
      const { rows } = await pool.query("SELECT nextval(pg_get_serial_sequence('bookings', 'booking_id')) AS id");
      return Number(rows[0].id);
    },

    async insertBooking(b) {
      const { rows } = await pool.query(
        `INSERT INTO bookings (booking_id, customer_id, vehicle_type, pickup_lat, pickup_lng, destination_lat, destination_lng,
                               pickup_address, destination_address, payment_method, estimated_distance_m, fare_amount,
                               payment_id, status)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING booking_id, created_at`,
        [b.bookingId, b.customerId, b.vehicleType, b.from[0], b.from[1], b.to[0], b.to[1], b.fromAddress, b.toAddress,
          b.pay, b.distanceM, b.fare, b.paymentId, b.status],
      );
      return rows[0];
    },

    async findBooking(bookingId) {
      const { rows } = await pool.query(`SELECT ${BOOKING_COLUMNS} FROM bookings b WHERE b.booking_id = $1`, [bookingId]);
      return rows[0] ?? null;
    },

    // A21: booking + phân công (nếu có).
    async findBookingView(bookingId) {
      const { rows } = await pool.query(
        `SELECT ${BOOKING_COLUMNS}, a.driver_id, a.trip_id
         FROM bookings b LEFT JOIN driver_assignments a ON a.booking_id = b.booking_id
         WHERE b.booking_id = $1`,
        [bookingId],
      );
      return rows[0] ?? null;
    },

    // A20: mới nhất trước; cùng giờ thì mã lớn trước để thứ tự cố định khi phân trang.
    async listBookings({ customerId, status, limit, offset }) {
      const where = 'b.customer_id = $1 AND ($2::text IS NULL OR b.status = $2)';
      const { rows } = await pool.query(
        `SELECT ${BOOKING_COLUMNS} FROM bookings b WHERE ${where}
         ORDER BY b.created_at DESC, b.booking_id DESC
         LIMIT $3 OFFSET $4`,
        [customerId, status, limit, offset],
      );
      const count = await pool.query(`SELECT count(*)::int AS total FROM bookings b WHERE ${where}`, [customerId, status]);
      return { rows, total: count.rows[0].total };
    },

    async findOffer(offerId) {
      const { rows } = await pool.query('SELECT offer_id, booking_id, driver_id FROM driver_offers WHERE offer_id = $1', [offerId]);
      return rows[0] ?? null;
    },

    // A23: Offer của một tài xế kèm điểm đón / đến, phương thức, cước của booking (để quyết định nhận).
    async listOffers({ driverId, status, limit, offset }) {
      const where = 'o.driver_id = $1 AND o.status = $2';
      const { rows } = await pool.query(
        `SELECT ${OFFER_COLUMNS}, b.pickup_lat, b.pickup_lng, b.destination_lat, b.destination_lng,
                b.payment_method, b.fare_amount
         FROM driver_offers o JOIN bookings b ON b.booking_id = o.booking_id
         WHERE ${where}
         ORDER BY o.created_at DESC, o.offer_id DESC
         LIMIT $3 OFFSET $4`,
        [driverId, status, limit, offset],
      );
      const count = await pool.query(`SELECT count(*)::int AS total FROM driver_offers o WHERE ${where}`, [driverId, status]);
      return { rows, total: count.rows[0].total };
    },

    // Tiến trình hết hạn: Offer còn PENDING đã quá giờ (so bằng giờ database).
    async findDueOffers() {
      const { rows } = await pool.query(
        "SELECT offer_id, booking_id, driver_id FROM driver_offers WHERE status = 'PENDING' AND expires_at <= now() ORDER BY expires_at",
      );
      return rows;
    },

    // Khởi động lại (NFR15): booking đang tìm mà chưa có Offer chờ thì ghép tiếp.
    async findSearchingWithoutOffer() {
      const { rows } = await pool.query(
        `SELECT b.booking_id FROM bookings b
         WHERE b.status = 'SEARCHING'
           AND NOT EXISTS (SELECT 1 FROM driver_offers o WHERE o.booking_id = b.booking_id AND o.status = 'PENDING')
         ORDER BY b.created_at`,
      );
      return rows.map((row) => row.booking_id);
    },

    // Nghe K6: đổi trạng thái CHỈ KHI booking còn chờ thanh toán — event lặp gặp trạng thái khác thì không đổi gì
    // (chống lặp bằng chính trạng thái nghiệp vụ, 03 mục 11.3). Trả dòng đã đổi hoặc null.
    async markPaid(bookingId) {
      const { rows } = await pool.query(
        `UPDATE bookings SET status = 'SEARCHING', updated_at = now()
         WHERE booking_id = $1 AND status = 'PENDING_PAYMENT'
         RETURNING booking_id, customer_id`,
        [bookingId],
      );
      return rows[0] ?? null;
    },

    async cancelBySystem(bookingId, reason) {
      const { rows } = await pool.query(
        `UPDATE bookings SET status = 'CANCELED', canceled_by = 'system', cancel_reason = $2, canceled_at = now(), updated_at = now()
         WHERE booking_id = $1 AND status = 'PENDING_PAYMENT'
         RETURNING booking_id, customer_id`,
        [bookingId, reason],
      );
      return rows[0] ?? null;
    },
  };
}
