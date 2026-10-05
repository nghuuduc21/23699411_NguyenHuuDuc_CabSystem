// migrate.js của notification-service: cùng tên file với các service PostgreSQL để dễ nhớ, nhưng việc làm là tạo index.
// MongoDB không có migration SQL: collection tự sinh khi ghi lần đầu, chỉ cần tạo index
// khi khởi động (spec 00 mục 7.1). `createIndex` gọi lại với cùng định nghĩa thì không làm gì,
// nên chạy mỗi lần khởi động vẫn an toàn.
//
// Hai index của spec 17-18 mục 7 (03 mục 9):
//   - UNIQUE (event_id, recipient_id): event lặp không tạo thêm thông báo (N4); một event vẫn cho được HAI người
//     (TRIP_CANCELED báo cả khách và tài xế) vì khóa gồm cả người nhận.
//   - (recipient_id, created_at giảm dần): A33 "thông báo của tôi, mới nhất trước" đọc thẳng theo index, có phân trang.
export const INDEXES = [
  { collection: 'notifications', keys: { event_id: 1, recipient_id: 1 }, options: { unique: true, name: 'notifications_event_recipient_uq' } },
  { collection: 'notifications', keys: { recipient_id: 1, created_at: -1 }, options: { name: 'notifications_recipient_created_idx' } },
];

export async function runMigrations({ db, log, indexes = INDEXES }) {
  for (const { collection, keys, options } of indexes) {
    await db.collection(collection).createIndex(keys, options);
  }
  log.info('index: xong', { total: indexes.length });
  return indexes.length;
}
