-- Bảng giá, cước, thanh toán, giao dịch, khóa chống lặp (spec 14-15-16-19-30 mục 7.2; 03 mục 8).
-- FR16–FR20, BRULE08–BRULE10, BRULE13, BRULE17; mục chấm 15, 19, 30.
-- booking_id, customer_id là mã của service khác: chỉ lưu số, KHÔNG khóa ngoại (database-per-service).
-- Tiền là `integer` (đồng): VND không có phần lẻ; số nguyên không có sai số làm tròn như số thực (03 mục 2).

-- Bảng giá theo loại xe. Chèn ngay trong migration (không phải seed): chạy thật cũng cần.
-- Đổi giá = sửa một dòng ở một nơi; cước đã tính không đổi vì `fares` giữ bản chụp.
CREATE TABLE fare_rates (
  vehicle_type text PRIMARY KEY,         -- cùng mã với vehicle_types.code của driver; không khóa ngoại
  base_fare    integer NOT NULL CHECK (base_fare >= 0),    -- giá mở cửa
  per_km_rate  integer NOT NULL CHECK (per_km_rate >= 0),  -- đơn giá mỗi km
  min_fare     integer NOT NULL CHECK (min_fare >= 0)      -- cước tối thiểu
);
INSERT INTO fare_rates (vehicle_type, base_fare, per_km_rate, min_fare) VALUES
  ('MOTORBIKE', 10000, 5000, 15000),
  ('CAR_4', 20000, 12000, 30000),
  ('CAR_7', 25000, 15000, 40000);

-- Cước của một booking, tính MỘT lần lúc đặt xe (BRULE08). Lưu từng thành phần (bản chụp bảng giá)
-- để giải thích được con số cuối.
CREATE TABLE fares (
  fare_id       bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  booking_id    bigint NOT NULL CONSTRAINT fares_booking_id_key UNIQUE,
  vehicle_type  text NOT NULL,
  distance_m    integer NOT NULL CHECK (distance_m > 0),
  base_fare     integer NOT NULL,
  per_km_rate   integer NOT NULL,
  min_fare      integer NOT NULL,
  -- Database tự chặn cước sai quy tắc: không dưới tối thiểu, là bội 1 000 đ (AC26).
  total_amount  integer NOT NULL CHECK (total_amount >= min_fare AND total_amount % 1000 = 0),
  calculated_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  payment_id    bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  -- Gắn với booking (lúc trả trước chưa có Trip). UNIQUE: CreatePayment gọi lặp trả Payment cũ (M1).
  booking_id    bigint NOT NULL CONSTRAINT payments_booking_id_key UNIQUE,
  fare_id       bigint NOT NULL UNIQUE REFERENCES fares (fare_id),
  customer_id   bigint NOT NULL,         -- kiểm tra quyền sở hữu
  method        text NOT NULL CHECK (method IN ('CASH', 'ONLINE')),
  amount        integer NOT NULL CHECK (amount > 0),
  status        text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELED')),
  status_reason text CHECK (status_reason IN ('PAYMENT_EXPIRED', 'ATTEMPTS_EXHAUSTED', 'BOOKING_CANCELED', 'NO_DRIVER_FOUND', 'TRIP_CANCELED')),
  expires_at    timestamptz,             -- hạn thanh toán (BRULE17), chỉ ONLINE
  paid_at       timestamptz,
  refunded_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Không có cột nào chứa số thẻ, số tài khoản (BRULE09).
  CONSTRAINT payments_expires_check CHECK ((method = 'ONLINE') = (expires_at IS NOT NULL)),
  -- DX12: database tự chặn dữ liệu mâu thuẫn, kể cả khi code có lỗi.
  CONSTRAINT payments_paid_check CHECK (status NOT IN ('COMPLETED', 'REFUNDED') OR paid_at IS NOT NULL),
  CONSTRAINT payments_refunded_check CHECK ((status = 'REFUNDED') = (refunded_at IS NOT NULL)),
  CONSTRAINT payments_reason_check CHECK (status_reason IS NULL OR status IN ('CANCELED', 'REFUNDED'))
);

-- Tiến trình nền tìm thanh toán quá hạn mỗi giây: index chỉ chứa dòng còn chờ tiền.
CREATE INDEX payments_het_han_idx ON payments (expires_at) WHERE method = 'ONLINE' AND status IN ('PENDING', 'FAILED');

-- Từng lần giao dịch với cổng thanh toán; lần thất bại vẫn được lưu (BRULE10).
CREATE TABLE payment_transactions (
  transaction_id          bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  payment_id              bigint NOT NULL REFERENCES payments (payment_id),
  type                    text NOT NULL CHECK (type IN ('CHARGE', 'REFUND')),
  attempt_no              smallint CHECK (attempt_no >= 1),  -- trần 3 lần là hằng số trong code
  -- Mã giao dịch phía cổng thanh toán (API gọi là `txn_id`): SIM-<payment_id>-<n> / SIM-R-<payment_id>.
  -- UNIQUE là khóa chống xử lý lặp callback (mục chấm 30).
  provider_transaction_id text NOT NULL CONSTRAINT payment_transactions_provider_key UNIQUE,
  amount                  integer NOT NULL CHECK (amount > 0),
  status                  text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  -- Response đã trả cho callback lần đầu; callback gửi lại thì trả đúng nội dung này.
  callback_response       jsonb,
  processed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_transactions_attempt_check CHECK ((type = 'CHARGE') = (attempt_no IS NOT NULL)),
  CONSTRAINT payment_transactions_attempt_key UNIQUE (payment_id, attempt_no),
  -- DX12: có kết quả thì có response đã lưu, và ngược lại.
  CONSTRAINT payment_transactions_callback_check CHECK ((status = 'PENDING') = (callback_response IS NULL))
);

-- M6: một thanh toán nhiều nhất MỘT lần thu thành công.
CREATE UNIQUE INDEX payment_transactions_mot_lan_thu_idx ON payment_transactions (payment_id)
  WHERE type = 'CHARGE' AND status = 'SUCCEEDED';
-- Không mở lần thử mới khi lần trước chưa có kết quả (MANUAL đang chờ callback).
CREATE UNIQUE INDEX payment_transactions_dang_cho_idx ON payment_transactions (payment_id)
  WHERE type = 'CHARGE' AND status = 'PENDING';
-- M8: mỗi thanh toán hoàn nhiều nhất một lần.
CREATE UNIQUE INDEX payment_transactions_mot_lan_hoan_idx ON payment_transactions (payment_id)
  WHERE type = 'REFUND';

-- Khóa chống lặp của A31 (mục chấm 30; M5). Phạm vi theo TỪNG thanh toán: gõ `k1` cho mọi thanh toán vẫn đúng.
CREATE TABLE idempotency_keys (
  payment_id      bigint NOT NULL REFERENCES payments (payment_id),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 100),
  request_hash    text NOT NULL,         -- SHA-256 của body đã chuẩn hóa: cùng khóa khác body → 409
  response        jsonb,                 -- response lần đầu; gặp lại khóa thì trả nguyên văn
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, idempotency_key)
);
