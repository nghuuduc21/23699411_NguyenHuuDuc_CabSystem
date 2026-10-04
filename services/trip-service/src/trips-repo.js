// Truy cập bảng `trips`, `trip_status_history` (spec 14-15-16-19-30 mục 5.3, 7.3).
// MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ ở src/domain/.

const TRIP_COLUMNS = 'trip_id, booking_id, customer_id, driver_id, status';

export function createTripsRepo(pool) {
  return {
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
                              payment_method, fare_amount, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACCEPTED')
           ON CONFLICT (booking_id) DO NOTHING
           RETURNING ${TRIP_COLUMNS}`,
          [s.bookingId, s.customerId, s.driverId, s.vehicleType, s.pickupLat, s.pickupLng,
            s.destinationLat, s.destinationLng, s.pickupAddress, s.destinationAddress, s.paymentMethod, s.fareAmount],
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

    async findByBooking(bookingId) {
      const { rows } = await pool.query(`SELECT ${TRIP_COLUMNS} FROM trips WHERE booking_id = $1`, [bookingId]);
      return rows[0] ?? null;
    },
  };
}
