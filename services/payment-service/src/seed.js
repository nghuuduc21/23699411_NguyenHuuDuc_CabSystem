// Seed dữ liệu demo của payment-service (03 mục 14).
// Chỉ chạy khi SIMULATION_MODE=true (index.js quyết định). Mọi lệnh ghi ở spec sau
// phải có ON CONFLICT DO NOTHING để khởi động lại không nhân đôi, không ghi đè dữ liệu đã đổi khi demo.
// Spec 00 chỉ dựng khung: chưa có bảng nghiệp vụ nên chưa chèn gì.

export async function runSeed({ log }) {
  const rows = 0;
  log.info(`seed: ${rows} dòng`, { rows });
  return rows;
}
