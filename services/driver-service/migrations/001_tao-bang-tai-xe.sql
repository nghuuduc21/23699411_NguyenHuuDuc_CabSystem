-- Hồ sơ tài xế, xe, loại xe (spec 12-13-21-23 mục 7.2; 03 mục 5). FR02–FR04, FR13, FR28, FR29, FR38, FR39.
-- Một file vì ba bảng ra đời cùng lúc và `vehicles` có khóa ngoại tới hai bảng kia.
-- Cùng một database nên CÓ khóa ngoại (khác tham chiếu chéo giữa các service, chỉ bằng mã).

-- Danh mục loại xe. Chèn ngay trong migration (không phải seed): hệ thống chạy thật cũng cần,
-- và A11 / A12 kiểm tra loại xe dựa vào bảng này.
CREATE TABLE vehicle_types (
  code  text PRIMARY KEY,
  name  text NOT NULL,
  seats smallint NOT NULL CHECK (seats > 0)
);
INSERT INTO vehicle_types (code, name, seats) VALUES
  ('MOTORBIKE', 'Xe máy', 1),
  ('CAR_4', 'Ô tô 4 chỗ', 4),
  ('CAR_7', 'Ô tô 7 chỗ', 7);

CREATE TABLE drivers (
  -- = account_id trong token (Gateway chuyển qua x-account-id), nên KHÔNG identity, KHÔNG DEFAULT.
  -- Là khóa chính nên nộp hồ sơ lần hai vi phạm PK → 409 DRIVER_ALREADY_EXISTS (D4).
  driver_id           bigint CONSTRAINT drivers_pkey PRIMARY KEY,
  -- Họ tên tài xế để rõ: khách cần thấy tên tài xế (FR14) và không dùng để tìm kiếm riêng tư.
  full_name           text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  -- Số giấy phép lái xe mã hóa AES-256-GCM: IV 12 byte ‖ bản mã ‖ tag 16 byte (ADR-012; mục chấm 24).
  -- Không UNIQUE (03 D9): bản mã mỗi lần một khác nên UNIQUE vô nghĩa; admin tự xem khi duyệt.
  license_number_enc  bytea NOT NULL,
  -- Trạng thái DUYỆT hồ sơ (admin đổi) — độc lập với trạng thái NHẬN CHUYẾN bên dưới (tài xế đổi).
  approval_status     text NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by         bigint,       -- account_id của admin (FR34: biết ai duyệt); không khóa ngoại sang auth
  reviewed_at         timestamptz,
  reject_reason       text CHECK (char_length(reject_reason) <= 255),
  -- Trạng thái nhận chuyến; API gọi là `status`. BUSY chỉ hệ thống đặt khi tài xế nhận chuyến (D8).
  availability        text NOT NULL DEFAULT 'OFFLINE' CHECK (availability IN ('OFFLINE', 'ONLINE', 'BUSY')),
  current_booking_id  bigint,       -- mã booking đang chạy (booking-service), không khóa ngoại
  -- Vị trí mới nhất. double precision: đủ chính xác cho tọa độ, tính Haversine trực tiếp (ADR-011).
  current_lat         double precision CHECK (current_lat BETWEEN -90 AND 90),
  current_lng         double precision CHECK (current_lng BETWEEN -180 AND 180),
  location_updated_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Các quy tắc database tự giữ, kể cả khi code có lỗi:
  -- D8: BUSY khi và chỉ khi đang giữ một booking.
  CONSTRAINT drivers_busy_check CHECK ((availability = 'BUSY') = (current_booking_id IS NOT NULL)),
  -- D6: chưa duyệt thì chỉ được OFFLINE.
  CONSTRAINT drivers_approved_check CHECK (availability = 'OFFLINE' OR approval_status = 'APPROVED'),
  -- Đang nhận chuyến thì phải có vị trí (để tìm quanh tọa độ).
  CONSTRAINT drivers_location_check CHECK (availability = 'OFFLINE' OR current_lat IS NOT NULL),
  -- Tọa độ đủ cặp.
  CONSTRAINT drivers_latlng_check CHECK ((current_lat IS NULL) = (current_lng IS NULL)),
  -- Đã xét thì phải biết lúc nào; chưa xét thì chưa có (BA TX6).
  CONSTRAINT drivers_reviewed_check CHECK ((approval_status = 'PENDING') = (reviewed_at IS NULL)),
  -- Chỉ hồ sơ bị từ chối có lý do (BA TX6).
  CONSTRAINT drivers_reason_check CHECK (reject_reason IS NULL OR approval_status = 'REJECTED')
);

-- Index một phần cho A12 / S2: chỉ chứa tài xế ONLINE đã duyệt, nên nhỏ và đúng thứ cần tìm
-- (bước lọc khung chữ nhật trước khi tính Haversine).
CREATE INDEX drivers_tim_idx ON drivers (current_lat, current_lng)
  WHERE availability = 'ONLINE' AND approval_status = 'APPROVED';
-- A13: lọc theo trạng thái duyệt, cũ nhất trước.
CREATE INDEX drivers_duyet_idx ON drivers (approval_status, created_at);

-- Mỗi tài xế đúng một xe (driver_id UNIQUE): chỉ tách bảng xe ra khi khách được tự chọn xe (CLAUDE.md).
CREATE TABLE vehicles (
  vehicle_id    bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  driver_id     bigint NOT NULL CONSTRAINT vehicles_driver_id_key UNIQUE
                CONSTRAINT vehicles_driver_id_fkey REFERENCES drivers (driver_id),
  -- Khóa ngoại tới danh mục: loại xe lạ bị database từ chối → 400 INVALID_INPUT.
  vehicle_type  text NOT NULL CONSTRAINT vehicles_vehicle_type_fkey REFERENCES vehicle_types (code),
  -- Biển số đã chuẩn hóa (chữ hoa, bỏ khoảng trắng, giữ `-` `.`); UNIQUE → 409 LICENSE_PLATE_ALREADY_EXISTS.
  license_plate text NOT NULL CONSTRAINT vehicles_license_plate_key UNIQUE
                CHECK (license_plate ~ '^[A-Z0-9.-]{5,15}$'),
  brand         text CHECK (char_length(brand) <= 50),
  model         text CHECK (char_length(model) <= 50),
  color         text CHECK (char_length(color) <= 50),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
