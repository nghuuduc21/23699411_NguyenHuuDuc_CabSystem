-- Đánh giá chuyến và điểm tổng hợp của tài xế (spec 20-29 mục 7.1; 03 mục 10.1, 10.2). FR25, BRULE11, V1–V5.
-- trip_id, customer_id, driver_id là mã của service khác: chỉ lưu số, KHÔNG khóa ngoại (database-per-service).
-- Không tạo index (driver_id, created_at DESC) của 03 mục 10.1: không API nào liệt kê đánh giá theo tài xế (DG-M1).

CREATE TABLE ratings (
  rating_id   bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  -- V3: mỗi chuyến một đánh giá. Hai request cùng lúc thì database chặn một (không cần khóa trong code).
  -- Đây cũng là chỗ "liên kết với chuyến đi" của mục chấm 20.
  trip_id     bigint NOT NULL CONSTRAINT ratings_trip_id_key UNIQUE,
  -- Lấy từ Trip (S7), không lấy từ client; dùng để kiểm chủ khi xem (A35).
  customer_id bigint NOT NULL,
  driver_id   bigint NOT NULL,
  -- V4: thang 1–5 (DG1). Số nhỏ nên smallint.
  score       smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  -- Văn bản tự do (mục 26); NULL = không nhận xét. Không chấp nhận chuỗi rỗng.
  comment     text CHECK (char_length(comment) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- V5: điểm tổng hợp lưu dạng TỔNG + SỐ LƯỢNG (không lưu trung bình): cộng dồn không trôi sai số; trung bình tính khi đọc.
CREATE TABLE driver_ratings (
  driver_id    bigint PRIMARY KEY,   -- bằng mã tài xế, không identity
  -- Dòng chỉ được tạo cùng đánh giá đầu tiên nên luôn ≥ 1.
  rating_count integer NOT NULL CHECK (rating_count >= 1),
  -- DG6: mỗi điểm 1–5 nên tổng phải nằm giữa count và 5 × count; database tự chặn số liệu lệch.
  rating_sum   integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_ratings_sum_check CHECK (rating_sum BETWEEN rating_count AND 5 * rating_count)
);
