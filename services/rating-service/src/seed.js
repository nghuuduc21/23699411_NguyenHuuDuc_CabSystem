// Seed dữ liệu demo của rating-service (03 mục 14; spec 20-29 mục 7.2).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Không gọi service khác: quy luật mã đã cố định.
//   - Đánh giá mã 3 cho chuyến T3 (KH1 đi với TX1 = tài xế 11), 5 sao, không nhận xét. Mã đánh giá = mã chuyến.
//   - T4 (TX3, COMPLETED) cố ý KHÔNG có đánh giá → dùng cho mục 20; T5 đang ACCEPTED → demo TRIP_NOT_COMPLETED.
//   - `driver_ratings` của tài xế 11 CHỈ chèn khi dòng `ratings` vừa được tạo: khởi động lại sau demo không cộng
//     lại lần nữa và không ghi đè số đã cộng khi demo (AC-DG-13).

export const SEED_RATING = { ratingId: 3, tripId: 3, customerId: 1, driverId: 11, score: 5 };

export async function runSeed({ pool, log }) {
  const r = SEED_RATING;
  let rows = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // OVERRIDING SYSTEM VALUE: đặt mã nhỏ theo quy luật; dãy identity vẫn bắt đầu 1000 cho đánh giá tạo qua API.
    const inserted = await client.query(
      `INSERT INTO ratings (rating_id, trip_id, customer_id, driver_id, score)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING rating_id`,
      [r.ratingId, r.tripId, r.customerId, r.driverId, r.score],
    );
    if (inserted.rowCount === 1) {
      rows += 1;
      await client.query(
        `INSERT INTO driver_ratings (driver_id, rating_count, rating_sum) VALUES ($1, 1, $2)
         ON CONFLICT (driver_id) DO NOTHING`,
        [r.driverId, r.score],
      );
      rows += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
