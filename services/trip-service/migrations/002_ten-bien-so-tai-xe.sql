-- Họ tên và biển số tài xế CHỤP LÚC NHẬN CHUYẾN (spec 17-18 mục 7, CD10; spec 14-15-16-19-30 DX25). FR14.
-- Vì sao chụp vào chuyến thay vì hỏi driver-service mỗi lần xem (S6 đã bỏ):
--   - Khách cần biết ai tới đón mà không được xem hồ sơ tài xế (A14 chỉ admin và chính tài xế).
--   - Biển số của xe đã chạy chuyến là dữ liệu lịch sử của chuyến; tài xế đổi xe sau đó thì chuyến cũ vẫn đúng.
--   - Xem chuyến không phụ thuộc driver-service: Driver dừng thì A27 vẫn đủ thông tin.
-- Vì sao NULL được (không NOT NULL): database đang chạy có thể còn chuyến tạo trước migration này mà không ai biết
-- tên, biển số lúc đó; NOT NULL làm migration lỗi. Chuyến mới luôn có giá trị vì CreateTrip từ chối khi thiếu.
-- Không sửa 001 (đã chạy): thay đổi schema luôn bằng file mới.

ALTER TABLE trips
  ADD COLUMN driver_name text,
  ADD COLUMN driver_plate text;

-- Cùng giới hạn với drivers.full_name / vehicles.license_plate ở driver-db (lưu rõ như ở đó; mục chấm 24 không mã hóa).
ALTER TABLE trips
  ADD CONSTRAINT trips_driver_name_len CHECK (driver_name IS NULL OR char_length(driver_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT trips_driver_plate_format CHECK (driver_plate IS NULL OR driver_plate ~ '^[A-Z0-9.-]{5,15}$');

-- Điền cho chuyến seed đã có (database chạy từ trước, không `down -v`). `driver_name IS NULL`: chạy trên database
-- mới (seed chưa có dòng) thì không làm gì, và không bao giờ ghi đè giá trị đã có.
UPDATE trips SET driver_name = 'Tài Xế 1', driver_plate = '59A-00001' WHERE trip_id = 3 AND driver_name IS NULL;
UPDATE trips SET driver_name = 'Tài Xế 3', driver_plate = '59A-00003' WHERE trip_id = 4 AND driver_name IS NULL;
UPDATE trips SET driver_name = 'Tài Xế 6', driver_plate = '59A-00006' WHERE trip_id = 5 AND driver_name IS NULL;
