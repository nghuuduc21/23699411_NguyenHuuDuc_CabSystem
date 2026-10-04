-- Bảng tài khoản đăng nhập (spec 09-10 mục 7.1; 03 mục 3.1). FR26, FR32; mục chấm 9, 10, 24, 25.
CREATE TABLE accounts (
  -- Số nguyên gõ tay được (ADR-015). START WITH 1000: mã tạo qua API luôn ≥ 1000,
  -- mã seed là số nhỏ (1–99) ghi bằng OVERRIDING SYSTEM VALUE nên không bao giờ trùng.
  account_id    bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  -- Lưu rõ, đã chuẩn hóa về 0 + 9 chữ số: cần tra khi đăng nhập và chặn trùng (ADR-012 sửa).
  -- Đặt tên ràng buộc để code đổi lỗi 23505 thành đúng mã PHONE_/EMAIL_ALREADY_EXISTS.
  phone         text NOT NULL CONSTRAINT accounts_phone_key UNIQUE CHECK (phone ~ '^0[0-9]{9}$'),
  -- Tùy chọn; PostgreSQL cho nhiều dòng NULL trong cột UNIQUE.
  email         text CONSTRAINT accounts_email_key UNIQUE,
  -- Chỉ nhận chuỗi băm scrypt: lỡ có code ghi mật khẩu rõ thì database từ chối (mục chấm 24).
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  -- Ba role cố định, không có bảng ROLE / PERMISSION (CLAUDE.md).
  role          text NOT NULL CHECK (role IN ('customer', 'driver', 'admin')),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Không thêm index: hai UNIQUE ở trên đã là index cho đăng nhập theo phone hoặc email.
