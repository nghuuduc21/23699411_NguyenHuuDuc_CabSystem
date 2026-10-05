// Truy cập collection `notifications` của MongoDB (spec 17-18 mục 5.4, 7; 03 mục 9).
// Repo chỉ đọc / ghi; bảng "event nào sinh thông báo nào" ở src/domain/notifications.js.
// Giá trị luôn đi trong đối tượng truy vấn (không ghép chuỗi), nên không có kiểu "tiêm" lệnh như SQL.
import { Long } from 'mongodb';

export const COLLECTION = 'notifications';

export function createNotificationsRepo(db) {
  const col = () => db.collection(COLLECTION);
  return {
    // Chống trùng (N4, CD7): MỘT lệnh upsert theo (event_id, recipient_id) với $setOnInsert — đã có thì không đổi gì,
    // chưa có thì tạo. Không phải bắt lỗi trùng khóa. Index UNIQUE cùng hai trường chặn cả khi hai bản chạy cùng lúc.
    // recipient_id lưu kiểu Long (int64) như mã tài khoản ở các service khác (03 mục 9).
    // Trả true nếu vừa tạo mới.
    async insertOnce(doc) {
      const recipient = Long.fromNumber(doc.recipient_id);
      const result = await col().updateOne(
        { event_id: doc.event_id, recipient_id: recipient },
        { $setOnInsert: { ...doc, recipient_id: recipient } },
        { upsert: true },
      );
      return result.upsertedCount === 1;
    },

    // A33: của một người, mới nhất trước (index recipient_id + created_at), rồi _id giảm dần để thứ tự cố định.
    async listByRecipient(recipientId, { skip, limit }) {
      const filter = { recipient_id: Long.fromNumber(recipientId) };
      const [rows, total] = await Promise.all([
        col().find(filter, { projection: { _id: 0, type: 1, title: 1, body: 1, data: 1, created_at: 1 } })
          .sort({ created_at: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
        col().countDocuments(filter),
      ]);
      return { rows, total };
    },
  };
}
