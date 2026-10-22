// Truy cập bảng `trips`, `trip_status_history` (spec 14-15-16-19-30 mục 5.3, 7.3; spec 17-18 mục 5.4).
// MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ ở src/domain/.

const TRIP_COLUMNS = 'trip_id, booking_id, customer_id, driver_id, status';
const VIEW_COLUMNS = `trip_id, booking_id, customer_id, driver_id, status, vehicle_type, pickup_lat, pickup_lng, destination_lat,
  destination_lng, pickup_address, destination_address, payment_method, fare_amount, started_at, ended_at, canceled_by,
  cancel_reason, created_at, driver_name, driver_plate`;

// Lịch sử cũ nhất trước; cùng thời điểm thì theo mã dòng (các lệnh trong một giao dịch có cùng now()).
async function selectHistory(db, tripId) {
  const { rows } = await db.query(
    'SELECT to_status, changed_at FROM trip_status_history WHERE trip_id = $1 ORDER BY changed_at, history_id',
    [tripId],
  );
  return rows;
}

// Câu lệnh dùng bên trong giao dịch của A28 / A29 (db = kết nối của giao dịch).
function txStatements(db) {
  return {
    // Khóa dòng chuyến đến hết giao dịch: tiến trạng thái và hủy cùng lúc thì xếp hàng, bên sau thấy trạng thái mới.
    async lockTrip(tripId) {
      const { rows } = await db.query(`SELECT ${TRIP_COLUMNS} FROM trips WHERE trip_id = $1 FOR UPDATE`, [tripId]);
      return rows[0] ?? null;
    },

    // PICKED_UP ghi started_at ("chuyến bắt đầu" — BRULE16); COMPLETED ghi ended_at.
    async setStatus(tripId, status) {
      await db.query(
        `UPDATE trips
         SET status = $2,
             started_at = CASE WHEN $2 = 'PICKED_UP' THEN now() ELSE started_at END,
             ended_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE ended_at END,
             updated_at = now()
         WHERE trip_id = $1`,
        [tripId, status],
      );
    },

    async cancel(tripId, canceledBy, reason) {
      await db.query(
        `UPDATE trips
         SET status = 'CANCELED', canceled_by = $2, cancel_reason = $3, ended_at = now(), updated_at = now()
         WHERE trip_id = $1`,
        [tripId, canceledBy, reason],
      );
    },

    // Chỉ ghi thêm (FR34, NFR10): ai đổi trạng thái gì, lúc nào, vì sao.
    async insertHistory({ tripId, from, to, changedBy, role, reason }) {
      await db.query(
        `INSERT INTO trip_status_history (trip_id, from_status, to_status, changed_by, changed_by_role, reason, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [tripId, from, to, changedBy, role, reason],
      );
    },

    listHistory: (tripId) => selectHistory(db, tripId),
  };
}

export function createTripsRepo(pool) {
  return {
    // Mở một giao dịch, đưa cho fn bộ câu lệnh chạy trên CÙNG kết nối; commit nếu fn xong, rollback nếu fn ném lỗi.
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

    // A27: chuyến + lịch sử + bản chụp họ tên, biển số tài xế (CD10) — đọc từ chính trip-db, không gọi Driver.
    async findTripView(tripId) {
      const { rows } = await pool.query(`SELECT ${VIEW_COLUMNS} FROM trips WHERE trip_id = $1`, [tripId]);
      if (rows.length === 0) return null;
      return { ...rows[0], history: await selectHistory(pool, tripId) };
    },

    // CreateTrip: một giao dịch gồm chuyến (ACCEPTED) và dòng lịch sử đầu (from_status NULL).
    // ON CONFLICT (booking_id) DO NOTHING: booking đã có chuyến thì không tạo thêm, không ném lỗi;
    // không có dòng trả về = đã có → trả null để logic đọc chuyến cũ (T1).
    // Lịch sử ghi `changed_by` = tài xế, role `driver` (DX17): người khiến chuyến ra đời là tài xế bấm nhận.
    async insertAccepted(s) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO trips (booking_id, customer_id, driver_id, vehicle_type, pickup_lat, pickup_lng,
                              destination_lat, destination_lng, pickup_address, destination_address,
                              payment_method, fare_amount, driver_name, driver_plate, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACCEPTED')
           ON CONFLICT (booking_id) DO NOTHING
           RETURNING ${TRIP_COLUMNS}`,
          [s.bookingId, s.customerId, s.driverId, s.vehicleType, s.pickupLat, s.pickupLng,
            s.destinationLat, s.destinationLng, s.pickupAddress, s.destinationAddress, s.paymentMethod, s.fareAmount,
            s.driverName, s.driverPlate],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          `INSERT INTO trip_status_history (trip_id, from_status, to_status, changed_by, changed_by_role, changed_at)
           VALUES ($1, NULL, 'ACCEPTED', $2, 'driver', now())`,
          [rows[0].trip_id, s.driverId],
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // S7: đọc theo khóa chính, không khóa dòng — COMPLETED là trạng thái cuối nên kết quả không đổi sau khi đọc.
    async findForRating(tripId) {
      const { rows } = await pool.query('SELECT trip_id, status, customer_id, driver_id FROM trips WHERE trip_id = $1', [tripId]);
      return rows[0] ?? null;
    },

    async findByBooking(bookingId) {
      const { rows } = await pool.query(`SELECT ${TRIP_COLUMNS} FROM trips WHERE booking_id = $1`, [bookingId]);
      return rows[0] ?? null;
    },
  };
}
