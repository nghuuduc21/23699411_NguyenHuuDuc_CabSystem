import { readdir, readFile } from 'node:fs/promises';
import { db } from './db.js';

// Đường dẫn tính từ file migrate.js, không phụ thuộc nơi gọi lệnh.
const migrationsDirectory = new URL('../migrations/', import.meta.url);

async function migrate() {
  // Giữ một kết nối cố định cho toàn bộ quá trình.
  // BEGIN và COMMIT phải chạy trên cùng kết nối.
  const connection = await db.connect();

  let locked = false;

  try {
    // Ngăn hai tiến trình migration cùng sửa schema đồng thời.
    // Khóa được giữ trên kết nối hiện tại.
    await connection.query('SELECT pg_advisory_lock(73001)');
    locked = true;

    // Bảng này ghi nhận những migration đã chạy thành công.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      // Dùng tham số $1 thay vì nối tên file vào câu SQL.
      const existing = await connection.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename],
      );

      if (existing.rowCount > 0) {
        console.log(`[Migration] Bỏ qua: ${filename}`);
        continue;
      }

      const sql = await readFile(
        new URL(filename, migrationsDirectory),
        'utf8',
      );

      // Tạo bảng và ghi nhận migration trong cùng transaction.
      await connection.query('BEGIN');

      try {
        await connection.query(sql);

        await connection.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );

        await connection.query('COMMIT');

        console.log(`[Migration] Thành công: ${filename}`);
      } catch (error) {
        // Nếu có lỗi, hủy thay đổi của migration đang chạy.
        await connection.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (locked) {
        await connection.query('SELECT pg_advisory_unlock(73001)');
      }
    } finally {
      // Trả kết nối về pool kể cả khi có lỗi.
      connection.release();
    }
  }
}

try {
  await migrate();
} catch (error) {
  console.error('[Migration] Thất bại:', error.message);

  // Báo cho terminal hoặc công cụ tự động biết lệnh thất bại.
  process.exitCode = 1;
} finally {
  // Script migration chạy xong thì đóng pool và kết thúc.
  await db.end();
}