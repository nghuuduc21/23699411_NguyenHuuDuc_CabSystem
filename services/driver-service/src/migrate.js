// Chạy migration SQL theo thứ tự tên file (spec 00 mục 7.1).
// Vì sao tự viết thay vì dùng thư viện migration: chỉ cần ba bước, đọc là hiểu,
// không thêm một công cụ phải giải thích khi vấn đáp.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Tên file dạng NNN_mo-ta.sql; sắp theo tên là đúng thứ tự vì có 3 chữ số đầu.
const MIGRATION_FILE = /^\d{3}_.+\.sql$/;

export async function runMigrations({ pool, dir, log }) {
  // Bước 1: bảng ghi lại migration nào đã chạy.
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );

  // Bước 2: đọc danh sách file, bỏ qua file đã chạy (không bao giờ chạy lại, không sửa file đã chạy).
  const files = (await readdir(dir)).filter((name) => MIGRATION_FILE.test(name)).sort();
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((row) => row.version));

  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');

    // Bước 3: mỗi file một giao dịch, cùng với dòng ghi nhận. Lỗi giữa chừng thì rollback
    // để database không bị nửa chừng, rồi ném lỗi để service thoát mã 1.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
      log.info('migration: đã chạy', { file });
    } catch (err) {
      await client.query('ROLLBACK');
      log.error('migration: lỗi, đã rollback', { file, code: err.code });
      throw err;
    } finally {
      client.release();
    }
  }

  log.info('migration: xong', { applied: applied.length, total: files.length });
  return applied;
}
