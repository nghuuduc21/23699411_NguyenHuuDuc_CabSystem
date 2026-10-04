// Seed dữ liệu demo của notification-service (03 mục 14).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Thiết kế không seed thông báo nào;
// nếu spec sau cần thì ghi bằng `$setOnInsert` + `upsert` để khởi động lại không nhân đôi.

export async function runSeed({ log }) {
  const rows = 0;
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
