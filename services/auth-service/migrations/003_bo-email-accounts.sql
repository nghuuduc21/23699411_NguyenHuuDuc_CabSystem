-- Bỏ email khỏi tài khoản (ADR-019; spec 09-10 mục 7.1a). Mục chấm 9, 10.
-- Vì sao: email là thông tin liên hệ của khách nên chuyển sang hồ sơ ở customer-service;
-- tài khoản chỉ còn số điện thoại + mật khẩu, đăng nhập chỉ bằng số. Mỗi thông tin lưu một nơi.
-- Vì sao file mới thay vì sửa 001: database đang chạy đã ghi 001 vào schema_migrations nên sửa 001
-- sẽ không bao giờ chạy lại; migration mới mới đổi được database cũ và database dựng mới giống nhau.
-- DROP COLUMN kéo theo ràng buộc UNIQUE accounts_email_key. IF EXISTS để chạy an toàn trên mọi database.
-- Không chuyển email cũ sang customer: hai database tách rời, dữ liệu email chỉ là dữ liệu demo.
ALTER TABLE accounts DROP COLUMN IF EXISTS email;
