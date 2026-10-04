-- Mã OTP đăng ký tài xế (spec 12-13-21-23 mục 7.1; 03 mục 3.2). FR39, UC29; mục chấm 21, 24.
-- Mỗi lần xin OTP là MỘT DÒNG MỚI: A08 chỉ xét dòng mới nhất nên mã cũ tự mất hiệu lực,
-- không phải sửa hay xóa dòng cũ.
CREATE TABLE otp_verifications (
  -- START WITH 1000 cho đồng bộ với các bảng khác (ADR-015); bảng này không có seed.
  otp_id        bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  -- Số đã chuẩn hóa. KHÔNG có khóa ngoại tới accounts: lúc xin OTP chưa có tài khoản.
  phone         text NOT NULL CHECK (phone ~ '^0[0-9]{9}$'),
  -- Chỉ lưu bản băm scrypt, như mật khẩu: ai đọc được database cũng không thấy mã đang còn hiệu lực.
  otp_hash      text NOT NULL CHECK (otp_hash LIKE 'scrypt$%'),
  -- Một mục đích duy nhất hiện nay; giữ cột để sau này thêm mục đích khác không phải đổi bảng.
  purpose       text NOT NULL CHECK (purpose IN ('DRIVER_REGISTRATION')),
  expires_at    timestamptz NOT NULL,
  -- Đếm lần nhập sai; đủ 5 thì mã hết hiệu lực (chặn dò 1 triệu tổ hợp).
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  -- Khác NULL = đã dùng để tạo tài khoản; không dùng lại được.
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Phục vụ đúng một truy vấn: "dòng mới nhất của số này cho mục đích này".
CREATE INDEX otp_verifications_phone_idx ON otp_verifications (phone, purpose, created_at DESC);
