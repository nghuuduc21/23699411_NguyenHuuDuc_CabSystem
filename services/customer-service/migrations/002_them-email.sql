-- Thêm email vào hồ sơ khách (ADR-019; spec 11 mục 7.1a). FR27; mục chấm 11.
-- Vì sao email nằm ở đây: email là thông tin LIÊN HỆ của khách (cùng loại họ tên, ngày sinh), không phải
-- danh tính đăng nhập; auth-service đã bỏ cột email ở migration 003 của nó. Mỗi thông tin chỉ lưu một nơi.
-- Vì sao file mới thay vì sửa 001: database đang chạy đã ghi 001 vào schema_migrations; chỉ migration mới
-- mới đổi được database cũ, và database dựng mới chạy 001 rồi 002 nên ra cùng một schema.
--   - NULL: email tùy chọn; hồ sơ cũ tự có email = NULL.
--   - CHECK <= 254: giới hạn độ dài địa chỉ email (RFC 5321). Định dạng kiểm ở ứng dụng (dễ đổi, dễ báo lỗi rõ).
--   - KHÔNG UNIQUE: email không dùng để đăng nhập; hai khách dùng chung email gia đình vẫn hợp lệ.
--   - KHÔNG mã hóa: chỉ họ tên, ngày sinh mã hóa (quyết định đã chốt "không mã hóa số điện thoại, email").
--   - Không index: không API nào tìm theo email.
-- IF NOT EXISTS để chạy lại an toàn.
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS email text NULL
  CONSTRAINT customer_profiles_email_len CHECK (char_length(email) <= 254);
