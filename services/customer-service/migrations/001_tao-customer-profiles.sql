-- Hồ sơ khách hàng (spec 11 mục 7.1; 03 mục 4.1). FR27, BRULE18; mục chấm 11, 24, 26.
-- Chỉ có dòng khi khách tự tạo hồ sơ sau khi đăng nhập (ADR-013); chưa có dòng = "chưa có hồ sơ" → 404.
CREATE TABLE customer_profiles (
  -- Bằng account_id trong token (Gateway chuyển qua metadata x-account-id), nên KHÔNG identity,
  -- KHÔNG DEFAULT. Là khóa chính nên tạo hồ sơ lần hai vi phạm PK → 409 (C1, BRULE18).
  -- Không có khóa ngoại sang auth: mỗi service một database, tham chiếu chéo chỉ bằng mã.
  customer_id       bigint PRIMARY KEY,
  -- Họ tên mã hóa AES-256-GCM: IV 12 byte ‖ bản mã ‖ tag 16 byte (03 mục 11.4; mục chấm 24).
  -- Bắt buộc (C6). Giới hạn 100 ký tự kiểm tra ở ứng dụng TRƯỚC khi mã hóa, vì bản mã không đọc được độ dài chữ.
  full_name_enc     bytea NOT NULL,
  -- Ngày sinh dạng chuỗi YYYY-MM-DD, mã hóa cùng cách. Tùy chọn nên cho NULL.
  date_of_birth_enc bytea,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Không có cột số điện thoại (Q58: số điện thoại chỉ nằm ở auth, tránh hai bản lệch nhau).
-- Không thêm index: mọi truy vấn đều theo customer_id, PK đã là index.
