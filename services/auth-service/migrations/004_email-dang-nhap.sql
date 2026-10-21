-- Email là định danh đăng nhập của khách và admin; tài xế giữ số điện thoại (ADR-021; spec 09-10 mục 7.1b).
-- Mục chấm 9, 10, 21, 24, 25.
-- Vì sao file mới thay vì sửa 001 / 003: database đang chạy đã ghi các file đó vào schema_migrations nên sửa
-- chúng sẽ không bao giờ chạy lại. Database dựng mới: 001 tạo bảng → 003 bỏ email → 004 thêm lại email khi
-- bảng còn rỗng (seed chạy SAU migration).
-- Cả file chạy trong MỘT giao dịch (migrate.js): lệnh nào lỗi thì rollback hết, bảng không bị nửa chừng.

-- 1. Định danh đăng nhập của customer, admin. NULL với tài xế.
ALTER TABLE accounts ADD COLUMN email text;

-- 2. Không trùng email (A2). PostgreSQL cho nhiều dòng NULL trong cột UNIQUE (các tài xế).
--    Đặt tên ràng buộc để code đổi lỗi 23505 thành đúng mã EMAIL_ALREADY_EXISTS.
ALTER TABLE accounts ADD CONSTRAINT accounts_email_key UNIQUE (email);

-- 3. Database tự chặn email chưa chuẩn hóa (chữ hoa) và quá dài; định dạng chi tiết kiểm ở ứng dụng.
--    Vì sao bắt chữ thường: so trùng và tra đăng nhập bằng `=` thì "KH1@cab.vn" và "kh1@cab.vn" phải là một.
ALTER TABLE accounts ADD CONSTRAINT accounts_email_format CHECK (email = lower(email) AND char_length(email) <= 254);

-- 4. Khách, admin không còn số điện thoại ở tài khoản (số liên hệ của khách nằm ở hồ sơ, customer-service).
--    UNIQUE accounts_phone_key và CHECK định dạng ^0[0-9]{9}$ của 001 giữ nguyên (NULL vẫn qua CHECK).
ALTER TABLE accounts ALTER COLUMN phone DROP NOT NULL;

-- 5. Đúng MỘT định danh theo role (A9, BRULE19): tài xế có số, không email; khách / admin có email, không số.
--    Nhờ vậy tra `WHERE phone = $1` chỉ có thể ra tài xế, `WHERE email = $1` chỉ ra khách / admin:
--    code đăng nhập không cần kiểm role.
--    Database còn dữ liệu cũ (khách có số, không email) → lệnh này lỗi → cả file rollback → service thoát 1.
--    Không tự sinh email cho dòng cũ: đoán dữ liệu cá nhân là sai. Đặt lại bằng `docker compose down -v`.
ALTER TABLE accounts ADD CONSTRAINT accounts_identity_by_role CHECK (
  (role = 'driver' AND phone IS NOT NULL AND email IS NULL)
  OR (role IN ('customer', 'admin') AND email IS NOT NULL AND phone IS NULL)
);
