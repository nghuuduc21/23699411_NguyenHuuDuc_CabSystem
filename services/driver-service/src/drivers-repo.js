// Truy cập bảng `drivers`, `vehicles`, `vehicle_types` (spec 12-13-21-23 mục 5.2, 7).
// MỌI giá trị đi qua tham số $1, $2… — không bao giờ ghép chuỗi vào SQL (mục chấm 25): driver `pg`
// gửi câu lệnh và giá trị TÁCH RIÊNG cho PostgreSQL, nên dữ liệu không thể thành một phần câu lệnh.
// Repo chỉ đọc / ghi; quy tắc nghiệp vụ (ai xem được gì, khi nào được bật Online) ở src/domain/.
// Số giấy phép đi qua repo dưới dạng bản mã (bytea); mã hóa / giải mã nằm ở logic nghiệp vụ.

// Cột cần cho một tài xế đầy đủ (A11, A14, A13): một dòng drivers JOIN đúng một xe.
const DRIVER_COLUMNS = `d.driver_id, d.full_name, d.license_number_enc, d.approval_status, d.reject_reason,
  d.availability, d.current_lat, d.current_lng, d.created_at,
  v.vehicle_type, v.license_plate, v.brand, v.model, v.color`;

// Phần chung của câu tìm quanh tọa độ (ADR-011; spec mục 7.3), dùng cho cả câu lấy trang và câu đếm.
//   $1, $2 = tọa độ điểm; $3 = loại xe hoặc NULL (mọi loại); $4, $5 = nửa cạnh khung chữ nhật (độ).
//   Lọc khung chữ nhật TRƯỚC (rẻ, dùng index drivers_tim_idx), tính Haversine SAU cho số ít còn lại.
//   least(1, …): sai số làm tròn có thể đẩy giá trị lên hơi quá 1, asin(>1) sẽ lỗi.
const NEARBY_CTE = `WITH ung_vien AS (
  SELECT d.driver_id, d.full_name, v.vehicle_type, v.license_plate,
         2 * 6371000 * asin(least(1, sqrt(
             power(sin(radians(d.current_lat - $1) / 2), 2)
           + cos(radians($1)) * cos(radians(d.current_lat))
           * power(sin(radians(d.current_lng - $2) / 2), 2)))) AS distance
  FROM drivers d JOIN vehicles v ON v.driver_id = d.driver_id
  WHERE d.availability = 'ONLINE' AND d.approval_status = 'APPROVED'
    AND ($3::text IS NULL OR v.vehicle_type = $3)
    AND d.current_lat BETWEEN $1 - $4 AND $1 + $4
    AND d.current_lng BETWEEN $2 - $5 AND $2 + $5
)`;

export function createDriversRepo(pool) {
  return {
    // A11: một giao dịch tạo hồ sơ + xe (D4, D7). Hai lệnh cùng thành công hoặc cùng không.
    // Trả false nếu tài khoản đã có hồ sơ. Lỗi ràng buộc của xe (trùng biển số, loại xe lạ) ném ra
    // nguyên vẹn (kèm `constraint`) để logic đổi thành mã lỗi; giao dịch đã ROLLBACK nên không còn
    // hồ sơ "mồ côi" không có xe.
    async insertApplication({ driverId, fullName, licenseEnc, vehicleType, plate, brand, model, color }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // ON CONFLICT DO NOTHING: đã có hồ sơ thì không ghi đè, không ném lỗi; không có dòng trả về = trùng.
        const inserted = await client.query(
          `INSERT INTO drivers (driver_id, full_name, license_number_enc)
           VALUES ($1, $2, $3)
           ON CONFLICT (driver_id) DO NOTHING
           RETURNING driver_id`,
          [driverId, fullName, licenseEnc],
        );
        if (inserted.rowCount === 0) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query(
          `INSERT INTO vehicles (driver_id, vehicle_type, license_plate, brand, model, color)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [driverId, vehicleType, plate, brand, model, color],
        );
        await client.query('COMMIT');
        return true;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async findById(driverId) {
      const { rows } = await pool.query(
        `SELECT ${DRIVER_COLUMNS} FROM drivers d JOIN vehicles v ON v.driver_id = d.driver_id WHERE d.driver_id = $1`,
        [driverId],
      );
      return rows[0] ?? null;
    },

    async exists(driverId) {
      const { rowCount } = await pool.query('SELECT 1 FROM drivers WHERE driver_id = $1', [driverId]);
      return rowCount > 0;
    },

    async vehicleTypeExists(code) {
      const { rowCount } = await pool.query('SELECT 1 FROM vehicle_types WHERE code = $1', [code]);
      return rowCount > 0;
    },

    // A13: cũ nhất trước (người nộp trước được xét trước); thêm driver_id để thứ tự cố định khi trùng giờ,
    // trang sau không lặp, không sót. `approvalStatus` NULL = mọi trạng thái.
    async list({ approvalStatus, limit, offset }) {
      const where = '($1::text IS NULL OR d.approval_status = $1)';
      const { rows } = await pool.query(
        `SELECT ${DRIVER_COLUMNS} FROM drivers d JOIN vehicles v ON v.driver_id = d.driver_id
         WHERE ${where}
         ORDER BY d.created_at, d.driver_id
         LIMIT $2 OFFSET $3`,
        [approvalStatus, limit, offset],
      );
      const count = await pool.query(`SELECT count(*)::int AS total FROM drivers d WHERE ${where}`, [approvalStatus]);
      return { rows, total: count.rows[0].total };
    },

    // A12: trang kết quả + tổng số (để Gateway trả `total`, `total_pages`).
    // Gần nhất trước (BRULE03), cùng khoảng cách thì theo driver_id để phân trang ổn định.
    async findNearby({ lat, lng, vehicle, dLat, dLng, radiusM, limit, offset }) {
      const params = [lat, lng, vehicle, dLat, dLng, radiusM];
      const { rows } = await pool.query(
        `${NEARBY_CTE}
         SELECT * FROM ung_vien WHERE distance <= $6
         ORDER BY distance, driver_id
         LIMIT $7 OFFSET $8`,
        [...params, limit, offset],
      );
      const count = await pool.query(
        `${NEARBY_CTE} SELECT count(*)::int AS total FROM ung_vien WHERE distance <= $6`,
        params,
      );
      return { rows, total: count.rows[0].total };
    },

    // A15 / A16: đổi trạng thái CHỈ KHI đang PENDING, trong MỘT lệnh UPDATE (D5).
    // Hai admin duyệt cùng lúc: lệnh thứ hai không còn khớp `PENDING` nên không ghi đè; không cần khóa riêng.
    // Không có dòng trả về = không có hồ sơ hoặc đã xét; logic hỏi thêm `exists` để phân biệt 404 / 409.
    async review({ driverId, approvalStatus, reviewedBy, reason }) {
      const { rows } = await pool.query(
        `UPDATE drivers
         SET approval_status = $2, reviewed_by = $3, reviewed_at = now(), reject_reason = $4, updated_at = now()
         WHERE driver_id = $1 AND approval_status = 'PENDING'
         RETURNING driver_id, approval_status, reject_reason`,
        [driverId, approvalStatus, reviewedBy, reason],
      );
      return rows[0] ?? null;
    },

    // A17 / A39: đọc và sửa trong MỘT giao dịch, khóa dòng của tài xế (SELECT … FOR UPDATE) để không
    // đè lên ReserveDriver chạy cùng lúc (spec 16): ví dụ tài xế bấm Offline đúng lúc hệ thống giao chuyến.
    // `decide(row)` (logic nghiệp vụ) trả trạng thái mới hoặc ném lỗi → ROLLBACK. Không có dòng → null.
    async updateAvailabilityLocked(driverId, decide) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT driver_id, approval_status, availability, current_lat, current_lng
           FROM drivers WHERE driver_id = $1 FOR UPDATE`,
          [driverId],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const next = decide(rows[0]);
        // Gửi kèm tọa độ thì ghi vị trí mới; không gửi thì giữ vị trí cũ (COALESCE).
        const { rows: updated } = await client.query(
          `UPDATE drivers
           SET availability = $2,
               current_lat = COALESCE($3, current_lat),
               current_lng = COALESCE($4, current_lng),
               location_updated_at = CASE WHEN $3::double precision IS NULL THEN location_updated_at ELSE now() END,
               updated_at = now()
           WHERE driver_id = $1
           RETURNING driver_id, availability, current_lat, current_lng`,
          [driverId, next.availability, next.lat ?? null, next.lng ?? null],
        );
        await client.query('COMMIT');
        return updated[0];
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // S3 ReserveDriver: MỘT lệnh, nguyên tử — chỉ khớp khi tài xế đang ONLINE. Trả true nếu đã giữ.
    // SetAvailability khóa dòng (FOR UPDATE) nên hai việc không đè nhau; CHECK D8 chặn trạng thái lệch.
    async reserve(driverId, bookingId) {
      const { rowCount } = await pool.query(
        `UPDATE drivers SET availability = 'BUSY', current_booking_id = $2, updated_at = now()
         WHERE driver_id = $1 AND availability = 'ONLINE'
         RETURNING driver_id`,
        [driverId, bookingId],
      );
      return rowCount > 0;
    },

    // Đọc trạng thái nhận chuyến để biết vì sao reserve không khớp. Không có tài xế → null.
    async findAvailability(driverId) {
      const { rows } = await pool.query('SELECT availability, current_booking_id FROM drivers WHERE driver_id = $1', [driverId]);
      return rows[0] ?? null;
    },

    // S3 ReleaseDriver: chỉ nhả khi đang giữ đúng booking này. Trả true nếu đã nhả.
    async release(driverId, bookingId) {
      const { rowCount } = await pool.query(
        `UPDATE drivers SET availability = 'ONLINE', current_booking_id = NULL, updated_at = now()
         WHERE driver_id = $1 AND current_booking_id = $2
         RETURNING driver_id`,
        [driverId, bookingId],
      );
      return rowCount > 0;
    },

    // A18: một lệnh UPDATE, ở mọi trạng thái nhận chuyến (TX9). Không có dòng → null (chưa nộp hồ sơ).
    async updateLocation({ driverId, lat, lng }) {
      const { rows } = await pool.query(
        `UPDATE drivers
         SET current_lat = $2, current_lng = $3, location_updated_at = now(), updated_at = now()
         WHERE driver_id = $1
         RETURNING driver_id, current_lat, current_lng`,
        [driverId, lat, lng],
      );
      return rows[0] ?? null;
    },
  };
}
