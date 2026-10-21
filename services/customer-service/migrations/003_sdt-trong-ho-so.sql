-- Số điện thoại liên hệ vào hồ sơ khách, email về tài khoản (ADR-021 thay ADR-019; spec 11 mục 7.1b).
-- FR27; mục chấm 11, 24.
-- Vì sao: theo yêu cầu giảng viên, email là định danh ĐĂNG NHẬP của khách nên nằm ở auth-service; số điện thoại
-- của khách là thông tin LIÊN HỆ nên nằm ở hồ sơ. Mỗi dữ liệu vẫn chỉ lưu một nơi.
-- Vì sao file mới thay vì sửa 001 / 002: database đang chạy đã ghi các file đó vào schema_migrations.
-- Cả file chạy trong MỘT giao dịch (migrate.js): lệnh nào lỗi thì rollback hết.

-- 1. Bỏ email (kéo theo CHECK customer_profiles_email_len).
ALTER TABLE customer_profiles DROP COLUMN IF EXISTS email;

-- 2. Số điện thoại bắt buộc (C6), đã chuẩn hóa về 0 + 9 chữ số.
--    - KHÔNG UNIQUE: không dùng để đăng nhập; người nhà dùng chung một số vẫn hợp lệ.
--    - KHÔNG mã hóa: quyết định đã chốt "không mã hóa số điện thoại, email" (chỉ họ tên, ngày sinh mã hóa).
--    - Không index: không API nào tìm theo số.
--    Database dựng mới: bảng còn rỗng (seed chạy SAU migration) → thành công. Database còn hồ sơ cũ
--    (không có số) → NOT NULL lỗi → rollback cả file → service thoát 1 → `docker compose down -v`.
--    Không tự điền số giả cho hồ sơ cũ: đoán dữ liệu cá nhân là sai.
ALTER TABLE customer_profiles
  ADD COLUMN phone text NOT NULL
  CONSTRAINT customer_profiles_phone_format CHECK (phone ~ '^0[0-9]{9}$');
