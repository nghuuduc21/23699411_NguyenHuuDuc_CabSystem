-- Đặt xe, lời mời tài xế, phân công (spec 14-15-16-19-30 mục 7.1; 03 mục 6). FR01–FR11, FR16, FR35–FR37.
-- customer_id, driver_id, payment_id, trip_id là mã của service khác: chỉ lưu số, KHÔNG khóa ngoại
-- (database-per-service). Ba bảng cùng database nên giữa chúng CÓ khóa ngoại.

CREATE TABLE bookings (
  -- Số booking lấy TRƯỚC bằng nextval rồi mới gọi Payment (S4), vì payment_id, fare_amount là NOT NULL;
  -- sau đó INSERT … OVERRIDING SYSTEM VALUE với số đó (03 mục 6.1). S4 lỗi thì số bị bỏ qua — vô hại.
  booking_id           bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  customer_id          bigint NOT NULL,   -- lấy từ token
  -- Không CHECK danh sách: loại xe hợp lệ hay không do Payment trả lời (không có giá thì từ chối) — thêm loại xe
  -- mới không phải sửa Booking (NFR12).
  vehicle_type         text NOT NULL,
  pickup_lat           double precision NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng           double precision NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  destination_lat      double precision NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
  destination_lng      double precision NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
  -- Địa chỉ tùy chọn để body đặt xe ngắn (luật thi); tọa độ đủ để tìm tài xế và tính cước.
  pickup_address       text CHECK (char_length(pickup_address) <= 255),
  destination_address  text CHECK (char_length(destination_address) <= 255),
  payment_method       text NOT NULL CHECK (payment_method IN ('CASH', 'ONLINE')),
  estimated_distance_m integer NOT NULL CHECK (estimated_distance_m > 0),  -- Haversine × 1,3, làm tròn đến mét
  fare_amount          integer NOT NULL CHECK (fare_amount > 0),           -- bản chụp số tiền Payment trả về (BRULE08)
  payment_id           bigint NOT NULL CONSTRAINT bookings_payment_id_key UNIQUE,
  status               text NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'SEARCHING', 'DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELED')),
  cancel_reason        text CHECK (char_length(cancel_reason) <= 255),
  canceled_by          text CHECK (canceled_by IN ('customer', 'system')),
  canceled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Đã hủy thì phải biết lúc nào và ai hủy; chưa hủy thì chưa có (DX12).
  CONSTRAINT bookings_huy_luc_check CHECK ((status = 'CANCELED') = (canceled_at IS NOT NULL)),
  CONSTRAINT bookings_huy_boi_check CHECK ((status = 'CANCELED') = (canceled_by IS NOT NULL))
);

-- Mục 14: booking của một khách, mới nhất trước, phân trang.
CREATE INDEX bookings_khach_idx ON bookings (customer_id, created_at DESC);
-- Khởi động lại: tìm booking đang SEARCHING để ghép tiếp (NFR15). Index một phần nên rất nhỏ.
CREATE INDEX bookings_tim_idx ON bookings (created_at) WHERE status = 'SEARCHING';

CREATE TABLE driver_offers (
  offer_id     bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  booking_id   bigint NOT NULL REFERENCES bookings (booking_id),
  driver_id    bigint NOT NULL,
  distance_m   integer NOT NULL CHECK (distance_m >= 0),  -- tài xế → điểm đón lúc mời (FR04, AC05)
  status       text NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'VOIDED')),
  expires_at   timestamptz NOT NULL,                       -- now() + OFFER_TIMEOUT_SECONDS (BRULE04)
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Database tự giữ các quy tắc ghép tài xế, kể cả khi hai tiến trình chạy cùng lúc:
-- B6: tài xế đã được mời (kể cả đã từ chối / hết hạn) không được mời lại cho cùng booking.
CREATE UNIQUE INDEX driver_offers_booking_driver_key ON driver_offers (booking_id, driver_id);
-- B10: mỗi booking một Offer đang chờ; mỗi tài xế một Offer đang chờ (cũng phục vụ A23).
CREATE UNIQUE INDEX driver_offers_booking_cho_key ON driver_offers (booking_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX driver_offers_tai_xe_cho_key ON driver_offers (driver_id) WHERE status = 'PENDING';
-- B8: mỗi booking nhiều nhất một Offer được nhận.
CREATE UNIQUE INDEX driver_offers_booking_nhan_key ON driver_offers (booking_id) WHERE status = 'ACCEPTED';
-- Tiến trình nền tìm Offer hết giờ (FR09).
CREATE INDEX driver_offers_het_han_idx ON driver_offers (expires_at) WHERE status = 'PENDING';
-- A23 với trạng thái khác PENDING (DX13).
CREATE INDEX driver_offers_tai_xe_idx ON driver_offers (driver_id, created_at DESC);

CREATE TABLE driver_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  booking_id    bigint NOT NULL UNIQUE REFERENCES bookings (booking_id),      -- một booking một phân công
  offer_id      bigint NOT NULL UNIQUE REFERENCES driver_offers (offer_id),
  driver_id     bigint NOT NULL,
  trip_id       bigint NOT NULL UNIQUE,                                       -- do Trip trả về ở S5 (B17)
  assigned_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
