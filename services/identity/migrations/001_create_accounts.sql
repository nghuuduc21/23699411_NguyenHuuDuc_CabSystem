-- Identity sở hữu bảng tài khoản.
-- Các service khác sẽ tham chiếu account_id thông qua API/event.
CREATE TABLE accounts (
    -- PostgreSQL tự sinh mã số tài khoản.
    account_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Tên hiển thị của người dùng.
    full_name VARCHAR(100) NOT NULL,

    -- Email có thể chưa có khi người dùng đăng ký bằng điện thoại.
    -- UNIQUE ngăn hai tài khoản dùng cùng email.
    email VARCHAR(254) UNIQUE,

    -- Lưu số điện thoại bằng chuỗi để giữ số 0 đầu hoặc dấu +.
    phone VARCHAR(20) NOT NULL UNIQUE,

    -- Chỉ lưu kết quả băm mật khẩu, không lưu mật khẩu nguyên văn.
    password_hash TEXT NOT NULL,

    -- Vai trò xác định nhóm quyền của tài khoản.
    role VARCHAR(20) NOT NULL DEFAULT 'customer',

    -- Trạng thái tài khoản khác với trạng thái Online/Offline của Driver.
    status VARCHAR(20) NOT NULL DEFAULT 'active',

    -- TIMESTAMPTZ lưu thời điểm, hỗ trợ xử lý múi giờ.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_name_not_blank
        CHECK (char_length(trim(full_name)) >= 2),

    CONSTRAINT accounts_role_valid
        CHECK (role IN ('customer', 'driver', 'operator')),

    CONSTRAINT accounts_status_valid
        CHECK (status IN ('active', 'locked', 'inactive'))
);