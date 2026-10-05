// Truy cập bảng `ratings`, `driver_ratings` (spec 20-29 mục 5.3, 7.1).
// MỌI giá trị đi qua tham số $1, $2… — không ghép chuỗi vào SQL (mục chấm 25).
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ ở src/domain/.

export function createRatingsRepo(pool) {
  return {
    // V3 + V5 trong một giao dịch. Trả { rating_id, rating_count, rating_sum } hoặc null nếu chuyến đã có đánh giá.
    // Vì sao không cần khóa thêm:
    //   - UNIQUE trip_id + ON CONFLICT DO NOTHING: hai đánh giá cùng chuyến gửi cùng lúc → một dòng, bên kia nhận null.
    //   - ON CONFLICT (driver_id) DO UPDATE khóa dòng driver_ratings: hai đánh giá cùng tài xế cộng tuần tự, không mất số.
    async insertWithDriverTotal({ tripId, customerId, driverId, score, comment }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO ratings (trip_id, customer_id, driver_id, score, comment)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (trip_id) DO NOTHING
           RETURNING rating_id`,
          [tripId, customerId, driverId, score, comment],
        );
        if (inserted.rowCount === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const total = await client.query(
          `INSERT INTO driver_ratings (driver_id, rating_count, rating_sum) VALUES ($1, 1, $2)
           ON CONFLICT (driver_id) DO UPDATE
             SET rating_count = driver_ratings.rating_count + 1,
                 rating_sum = driver_ratings.rating_sum + EXCLUDED.rating_sum,
                 updated_at = now()
           RETURNING rating_count, rating_sum`,
          [driverId, score],
        );
        await client.query('COMMIT');
        return { rating_id: inserted.rows[0].rating_id, ...total.rows[0] };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async findByTrip(tripId) {
      const { rows } = await pool.query(
        'SELECT rating_id, trip_id, customer_id, driver_id, score, comment, created_at FROM ratings WHERE trip_id = $1',
        [tripId],
      );
      return rows[0] ?? null;
    },

    async findDriverTotal(driverId) {
      const { rows } = await pool.query('SELECT rating_count, rating_sum FROM driver_ratings WHERE driver_id = $1', [driverId]);
      return rows[0] ?? null;
    },
  };
}
