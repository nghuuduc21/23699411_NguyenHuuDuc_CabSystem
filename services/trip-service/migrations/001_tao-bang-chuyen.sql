-- Chuyến đi và lịch sử trạng thái (spec 14-15-16-19-30 mục 7.3; 03 mục 7.1, 7.2). FR11, FR12, FR14, FR34, FR36, FR41.
-- Tạo ĐỦ cột của spec 17, 18 (bắt đầu, kết thúc, hủy) ngay bây giờ (DX18): một bảng một migration,
-- spec sau chỉ thêm code, không phải migration thứ hai.
-- customer_id, driver_id, booking_id là mã của service khác: chỉ lưu số, KHÔNG khóa ngoại (database-per-service).

CREATE TABLE trips (
  trip_id             bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  -- T1: mỗi booking nhiều nhất một Trip. CreateTrip gọi lặp gặp UNIQUE này → trả Trip cũ.
  booking_id          bigint NOT NULL CONSTRAINT trips_booking_id_key UNIQUE,
  customer_id         bigint NOT NULL,   -- kiểm tra quyền sở hữu (T3, T5, T7)
  driver_id           bigint NOT NULL,
  -- Bản chụp từ booking lúc tài xế nhận (03 mục 11.2): không phải gọi lại booking khi xem chuyến.
  vehicle_type        text NOT NULL,
  pickup_lat          double precision NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng          double precision NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  destination_lat     double precision NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
  destination_lng     double precision NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
  pickup_address      text CHECK (char_length(pickup_address) <= 255),
  destination_address text CHECK (char_length(destination_address) <= 255),
  -- Tài xế biết có phải thu tiền mặt không và bao nhiêu (FR17).
  payment_method      text NOT NULL CHECK (payment_method IN ('CASH', 'ONLINE')),
  fare_amount         integer NOT NULL CHECK (fare_amount > 0),
  status              text NOT NULL CHECK (status IN ('ACCEPTED', 'ARRIVED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED', 'CANCELED')),
  started_at          timestamptz,       -- lúc đón khách = "chuyến bắt đầu" (BRULE16)
  ended_at            timestamptz,       -- lúc COMPLETED hoặc CANCELED
  cancel_reason       text CHECK (char_length(cancel_reason) <= 255),
  canceled_by         text CHECK (canceled_by IN ('customer', 'driver')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Khách / tài xế xem chuyến của mình, mới nhất trước (UC18); admin lọc theo trạng thái (FR30).
CREATE INDEX trips_khach_idx ON trips (customer_id, created_at DESC);
CREATE INDEX trips_tai_xe_idx ON trips (driver_id, created_at DESC);
CREATE INDEX trips_trang_thai_idx ON trips (status, created_at DESC);

-- Chỉ ghi thêm, không sửa, không xóa (FR34, NFR10): ai đổi trạng thái gì, lúc nào.
CREATE TABLE trip_status_history (
  history_id      bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  trip_id         bigint NOT NULL REFERENCES trips (trip_id),  -- cùng database nên CÓ khóa ngoại
  from_status     text,                  -- NULL ở dòng đầu (chuyến vừa được tạo)
  to_status       text NOT NULL,
  changed_by      bigint NOT NULL,       -- account_id người thao tác
  changed_by_role text NOT NULL CHECK (changed_by_role IN ('customer', 'driver')),
  reason          text CHECK (char_length(reason) <= 255),
  changed_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_status_history_trip_idx ON trip_status_history (trip_id, changed_at);
