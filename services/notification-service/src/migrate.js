// migrate.js của notification-service: cùng tên file với các service PostgreSQL để dễ nhớ, nhưng việc làm là tạo index.
// MongoDB không có migration SQL: collection tự sinh khi ghi lần đầu, chỉ cần tạo index
// khi khởi động (spec 00 mục 7.1). `createIndex` gọi lại với cùng định nghĩa thì không làm gì,
// nên chạy mỗi lần khởi động vẫn an toàn.
//
// Spec 00 chỉ dựng khung nên danh sách còn rỗng. Spec của Notification sẽ thêm hai index ở 03 mục 9:
// UNIQUE (event_id, recipient_id) để chống event lặp, và (recipient_id, created_at: -1) để xem thông báo.
export const INDEXES = [];

export async function runMigrations({ db, log, indexes = INDEXES }) {
  for (const { collection, keys, options } of indexes) {
    await db.collection(collection).createIndex(keys, options);
  }
  log.info('index: xong', { total: indexes.length });
  return indexes.length;
}
