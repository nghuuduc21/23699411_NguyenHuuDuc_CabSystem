# Spec 14-15-16-19-30 — Đặt xe trả trước, ghép tài xế, nhận chuyến, thanh toán, chống lặp

> Vòng 2, viết 2026-10-04. Mục chấm **14, 15, 16, 19, 30**; nền cho **17, 18** (chuyến, hủy, hoàn tiền), bổ trợ **7** (message K1, K2, K5, K6 trên Kafka UI), **28** (tài xế đặt xe → 403). FR01–FR11, FR16, FR18–FR20, FR35, FR37.
> Đầu vào: `CLAUDE.md` (Quyết định nghiệp vụ "Cước", "Thanh toán", "Ghép tài xế", "Điều kiện đặt xe"; Quyết định kỹ thuật "Tài xế nhận chuyến", "Đặt xe → cước và thanh toán", "Kết quả thanh toán", "Tính cước", "Khóa chính", "Phát event Kafka", "Hệ thống ngoài", "Lỗi sai trạng thái"; Ràng buộc khi thi); `srs.md` (FR01–FR11, FR16, FR18–FR20, FR35, FR37, BRULE01–08, BRULE13, BRULE17, UC04–UC09, UC13–UC15, UC18, UC24, AC01–AC09, AC12, AC13, AC17, AC21, AC25, AC26, RTM01–RTM08, RTM11, RTM13, RTM14, RTM17, RTM19, RTM22, RTM25); `docs/design/01` B1–B18, M1–M13, T1, T4, T8, D8, D9; `docs/design/02` G4, G6, S2–S5, K1–K6, mục 4.6, 6, 8.2, 8.3; `docs/design/03` mục 6, 7, 8, 11.3, 13, 14; `docs/design/04` A19–A25, A30–A32, mục 1, 1.4, 1.8, 1.10, 2.7, 3, 4, 5; `docs/design/06` mục 14, 15, 16, 19, 30; ADR-008, ADR-009, ADR-014, ADR-015, ADR-017, ADR-018.
> **Sửa 2026-10-14 (theo yêu cầu giảng viên, sinh viên chốt) — chỉ phần A20 (mục 14):** danh sách booking **theo mã khách**: **`GET /api/v1/customers/{id}/bookings?status&page&limit`**, thay `GET /api/v1/bookings` (bỏ route cũ để chỉ còn một cách). Khách chỉ xem mã của mình (mã khác → 403 `NOT_OWNER`, so trước khi đọc database); admin xem mọi mã; tài xế → 403 `FORBIDDEN`. Vẫn do `booking-service` xử lý (Gateway định tuyến theo bảng route). Proto: `ListBookingsRequest` thêm `int64 customer_id = 4`. Token khách lấy bằng A05 `{"email":"kh1@cab.vn",…}` (spec 09-10). Mục sửa: 1, 2.6, 4.3, 5.1, 8, 9. AC đổi: AC-DX-01, 02, 03; AC mới: AC-DX-26 … AC-DX-28. Phần còn lại của spec không đổi.
> **Sửa 2026-10-21 (sinh viên chốt sau báo cáo `docs/test-reports/2026-10-21-hoi-quy-gop-y-giang-vien.md`, M1 / L1):** S3 `ReserveDriver` trả thêm `driver_name`, `plate`; S5 `CreateTrip` nhận thêm `driver_name`, `driver_plate` và Trip lưu lại (DX25). Mục sửa: 2.3, 3, 5.3, 5.4, 6, 9.1; AC đổi: AC-DX-23, AC-DX-24. Phần A27 ở spec 17-18.
> Phụ thuộc: **spec 00**, **spec 09-10** (token, xác thực Gateway mục 4.1, seed tài khoản), **spec 12-13-21-23** (`driver.proto`, bảng `drivers`, `FindNearbyDrivers`, seed TX1–TX8).
> Ngoài phạm vi (spec sau): A22 hủy booking, A26–A29 chuyến (mục 17, 18); `payment-service` nghe K3 / K4 / K5 để hoàn tiền, ghi nhận tiền mặt; `driver-service` nghe K5; `notification-service` nghe K1–K6, A33; seed `ratings` (mục 20). `GetDriverSummary` (S6) **không làm** (2026-10-21, DX25).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 14 Booking của khách theo mã, limit + paging, seed ≥ 5 | BG03 | BR03 | FR37 | B14, BRULE12 | UC18 | AC17 / RTM19 | NFR07, NFR08 |
| 15 Đặt xe → tìm tài xế → gửi Offer | BG01 | BR01, BR02 | FR01–FR06, FR16, FR35 | BRULE01–04, BRULE08, BRULE13; B1–B5, B10, B15; M1 | UC04, UC05, UC06, UC07 | AC01–AC05, AC26 / RTM01–RTM05, RTM11, RTM17 | NFR01, NFR02 |
| 15 (phụ) Từ chối, hết hạn, không có tài xế | BG01 | BR02 | FR08, FR09, FR10 | BRULE05–07, BRULE15; B6, B7 | UC06, UC09 | AC07–AC09, AC23 / RTM06–RTM08 | NFR05 |
| 16 Tài xế nhận chuyến | BG01, BG03 | BR02 | FR07, FR11 | B8, B9, B11, B12, B17; D8; T1, T8 | UC08 | AC06 / RTM05 | NFR14 |
| 19 Thanh toán online + callback → COMPLETED | BG04 | BR04 | FR18, FR19, FR20 | BRULE09, BRULE10, BRULE13, BRULE17; B16, B18; M2–M7, M11–M13 | UC14, UC15, UC24 | AC12, AC13, AC21, AC25 / RTM13, RTM14, RTM22, RTM25 | NFR09, NFR13 |
| 30 Replay thanh toán → response cũ | BG04 | BR04 | FR18 | M5, M6 | UC14 | — | NFR14 |

## 2. Luồng nghiệp vụ

### 2.1 UC04, UC05 — Đặt xe (A19)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (role `customer`) |
| Tiền điều kiện | Đã đăng nhập. **Không** cần hồ sơ khách (Q56 [ĐC]) |
| Luồng chính | 1. Gửi `from`, `to` (+ `vehicle` mặc định `CAR_4`, `pay` mặc định `CASH`). 2. Booking tính `estimated_distance_m = round(Haversine(from, to) × 1,3)`. 3. Lấy `booking_id` từ dãy số (`nextval`). 4. Gọi **S4 `CreatePayment`** → Payment tính cước, tạo Payment `PENDING` → trả `payment_id`, `amount`, `expires_at`. 5. Lưu Booking: `CASH` → `SEARCHING`, `ONLINE` → `PENDING_PAYMENT` (BRULE13). 6. Commit → phát **K1** → trả 201. 7. `SEARCHING` thì **bộ ghép chạy nền** (mục 5.6) — khách không chờ (B2) |
| Ngoại lệ | Sai dữ liệu → 400 (mục 4.2). Điểm đón trùng điểm đến → 400 `SAME_PICKUP_AND_DESTINATION`. Loại xe không có giá → 400 `INVALID_INPUT`. Payment dừng / quá deadline → 503, **không tạo booking** (đánh đổi ADR-009) |
| Hậu điều kiện | Một Booking + một Payment (`PENDING`, cùng `booking_id`); cước không đổi về sau (BRULE08) |

### 2.2 UC06, UC07 — Ghép tài xế (bộ ghép trong `booking-service`)

| | Nội dung |
|---|---|
| Kích hoạt | (a) Booking tiền mặt vừa tạo; (b) K6 `COMPLETED` đưa Booking `PENDING_PAYMENT` → `SEARCHING`; (c) tài xế từ chối (A25); (d) Offer hết hạn; (e) service khởi động lại: mọi Booking `SEARCHING` chưa có Offer `PENDING` (NFR15) |
| Mỗi vòng | 1. Gọi **S2 `FindNearbyDrivers`** (tọa độ đón, loại xe, `page=1`, `limit=50`) — danh sách **mới nhất** mỗi vòng. 2. Bỏ tài xế đã được mời cho booking này (B6) và tài xế đang có Offer `PENDING` của booking khác (B10). 3. Còn người → tạo Offer `PENDING` cho người **gần nhất** (B4), `expires_at = now() + OFFER_TIMEOUT_SECONDS` → commit → phát **K2**. 4. Hết người → Booking `NO_DRIVER_FOUND` → commit → phát **K3** |
| Ngoại lệ | S2 lỗi → thử lại tối đa 3 lần, cách 1 giây; vẫn lỗi → `NO_DRIVER_FOUND` + K3 (Q24, [BA DX7]) |
| Hậu điều kiện | Mỗi booking nhiều nhất một Offer `PENDING`; mỗi tài xế nhiều nhất một Offer `PENDING` (B10) |

### 2.3 UC08 — Tài xế nhận chuyến (A24)

| | Nội dung |
|---|---|
| Tác nhân | Tài xế được mời |
| Luồng chính | 1. Mở giao dịch; khóa Booking (`FOR UPDATE`) rồi khóa Offer. 2. Kiểm tra Offer của mình, còn `PENDING`, còn hạn; Booking còn `SEARCHING`. 3. Gọi **S3 `ReserveDriver`** (D8) → nhận thêm họ tên, biển số tài xế (DX25). 4. Gọi **S5 `CreateTrip`** (bản chụp booking + họ tên, biển số vừa nhận) → `trip_id`. 5. Offer `ACCEPTED`; Booking `DRIVER_ASSIGNED`; ghi `driver_assignments`. 6. Commit → 200 kèm `trip_id` (B17). Trip tự phát **K5** `ACCEPTED` |
| Ngoại lệ | Không có Offer → 404. Offer của tài xế khác → 403 `NOT_OWNER`. Offer đã trả lời / Booking không còn `SEARCHING` → 409 `INVALID_STATUS_TRANSITION`. Quá hạn → 409 `OFFER_EXPIRED`. Tài xế không còn rảnh (S3) → 409 `DRIVER_NOT_AVAILABLE`. S3 / S5 lỗi → rollback, gọi `ReleaseDriver` (nếu đã giữ), 503; Offer vẫn chờ, tài xế bấm lại được (Q35) |
| Hậu điều kiện | Booking `DRIVER_ASSIGNED`; tài xế `BUSY` với `current_booking_id`; Trip `ACCEPTED` + một dòng lịch sử |

Vì sao giữ khóa Booking trong lúc gọi S3, S5 [BA DX1]: hủy (spec 18) và nhận cùng khóa một dòng → bên đến sau chờ rồi thấy trạng thái mới (B12), không cần trạng thái trung gian "đang nhận". Đánh đổi: giữ một kết nối database tối đa ~2 giây (hai deadline 1 giây).

### 2.4 UC09 — Từ chối (A25) và hết hạn

| Sự kiện | Xử lý | Không làm |
|---|---|---|
| Tài xế từ chối | Offer `REJECTED`, `responded_at` → commit → 200 → bộ ghép hỏi người kế tiếp | Không hủy booking, không event, không báo Payment → không hoàn tiền (BRULE15) |
| Hết hạn | Tiến trình nền mỗi 1 giây: Offer `PENDING` có `expires_at <= now()` → `EXPIRED` → gọi `ReleaseDriver` (phòng khi nhận dở dang — Q35) → bộ ghép hỏi người kế tiếp (BRULE06) | Như trên |

### 2.5 UC14, UC15 — Thanh toán điện tử trả trước (A31, A32)

| | Nội dung |
|---|---|
| Tác nhân | Khách (A31); cổng thanh toán — khi thi Postman đóng vai (A32) |
| Tiền điều kiện | Payment `ONLINE` đang `PENDING` / `FAILED`, còn hạn, còn lượt |
| Luồng chính | 1. A31 kèm `Idempotency-Key` → Payment ghi khóa, tạo giao dịch `CHARGE` `PENDING` lần thử n, `txn_id = SIM-<payment_id>-<n>`. 2. Mặc định adapter **gọi ngay hàm xử lý callback** `SUCCESS` → giao dịch `SUCCEEDED`, Payment `COMPLETED` → phát **K6**. `MANUAL`: dừng ở `PENDING`, chờ A32. 3. A32 (khóa bí mật đúng) → cùng hàm xử lý → `COMPLETED` → K6. 4. Booking nghe K6 → `SEARCHING` → bộ ghép chạy (BRULE13) |
| Ngoại lệ | `FAILED` → giao dịch và Payment `FAILED`, K6 `FAILED`, Booking vẫn chờ, khách thử lại bằng khóa mới (FR19). Lần thử thứ 3 thất bại → Payment `CANCELED` (`ATTEMPTS_EXHAUSTED`). Quá hạn → tiến trình nền đặt `CANCELED` (`PAYMENT_EXPIRED`). Cả hai phát K6 `CANCELED` → Booking `CANCELED` (người hủy `system`) → K4 (BRULE17, B18). Callback thành công đến sau khi đã `CANCELED` → ghi nhận rồi hoàn ngay (M11) |
| Chống lặp (mục 30) | Cùng khóa, cùng body → response lần đầu + `Idempotency-Replayed: true`. Callback gửi lại cho giao dịch đã có kết quả → response đã lưu, không đổi gì, không phát lại K6 |
| Hậu điều kiện | Mỗi Payment nhiều nhất một lần thu thành công (M6); mọi lần thử đều lưu (BRULE10); không lưu thông tin thẻ (BRULE09) |

### 2.6 UC18, UC24 — Xem danh sách booking (A20), booking (A21), thanh toán (A30), Offer (A23)

Chỉ đọc. A20 (sửa 2026-10-14): danh sách theo mã khách — khách chỉ mã của mình, admin mọi mã (B14). Admin xem được A21, A30; tài xế chỉ thấy Offer của mình.

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `booking-service` | **Sở hữu** Booking, Offer, phân công; tính quãng đường; bộ ghép; nghe K6; phát K1–K4 | `booking-db` → `bookings`, `driver_offers`, `driver_assignments` |
| `payment-service` | **Sở hữu** bảng giá, cước, thanh toán, giao dịch, khóa chống lặp; adapter cổng thanh toán giả lập; hạn 10 phút / 3 lần; phát K6 | `payment-db` → `fare_rates`, `fares`, `payments`, `payment_transactions`, `idempotency_keys` |
| `trip-service` | **Sở hữu** Trip — ở spec này chỉ `CreateTrip`; phát K5 | `trip-db` → `trips` (thêm `driver_name`, `driver_plate` — migration `002`, spec 17-18 mục 7), `trip_status_history` |
| `driver-service` | **Sở hữu** trạng thái nhận chuyến; trả ứng viên (S2); giữ / nhả tài xế (S3, trả kèm họ tên, biển số) | `driver-db` → `drivers`, `vehicles` (không đổi schema) |
| `gateway` | Token, role, hình thức; chọn biến thể A24 / A25; chuyển `Idempotency-Key`, `X-Callback-Secret` vào metadata; dựng header `Idempotency-Replayed` | — |
| `kafka` | Topic K1–K6 (đã tạo ở spec 00) | — |

`customer-service`, `auth-service`, `rating-service`, `notification-service` không đổi ở spec này.

## 4. API REST tại Gateway

Route có token: xác thực theo spec 09-10 mục 4.1. Thứ tự lỗi theo 04 mục 1. Thứ tự so khớp: `/api/v1/payments/{id}/transactions` trước `/api/v1/payments/{id}`.

### 4.1 Quy tắc chung của phần này

Như spec 12-13-21-23 mục 4.1 (field / query lạ → 400 `INVALID_INPUT`; enum không phân biệt hoa thường; mã trong đường dẫn `^[1-9][0-9]{0,15}$` → sai 400 `INVALID_ID`; phân trang `page` ≥ 1, `limit` 1–50 → sai 400 `INVALID_PAGINATION`; văn bản có `<` / `>` → 400 `TEXT_CONTAINS_HTML` ở Gateway **và** service; field `optional` rỗng thì không có key). Thêm:

| Điểm | Quy định |
|---|---|
| Tọa độ dạng mảng (`from`, `to`) | Mảng **đúng 2 số JSON** `[lat, lng]`; khác (chuỗi, 1 hay 3 phần tử, phần tử là chuỗi) → 400 `INVALID_INPUT`; ngoài khoảng → 400 `INVALID_COORDINATES` |
| Mặc định A19 | Gateway điền `vehicle = "CAR_4"`, `pay = "CASH"` khi client không gửi (04 mục 1.8) |
| Mặc định A23 | Không gửi `status` → service lọc `PENDING` |
| Header `Idempotency-Key` (A31) | Bắt buộc, 1–100 ký tự sau khi cắt khoảng trắng; thiếu / rỗng / quá dài → 400 `IDEMPOTENCY_KEY_REQUIRED`. Chuyển vào metadata `idempotency-key` |
| Header `X-Callback-Secret` (A32) | Gateway **không** kiểm (không giữ khóa); chuyển vào metadata `x-callback-secret`. Không có header thì không có metadata → payment trả 401 |
| `replayed` trong response gRPC (A31, A32) | `true` → Gateway thêm header `Idempotency-Replayed: true` và **bỏ** field `replayed` khỏi body. Body còn lại y hệt lần đầu |

### 4.2 A19 `POST /api/v1/bookings` — đặt xe (mục 15)

| | |
|---|---|
| Token / role | Có / `customer` (role kiểm **trước** body — mục 28) |
| rpc | `booking-service` — `CreateBooking` |
| Request | `{ "from": [10.82, 106.68], "to": [10.83, 106.69] }` (+ `vehicle`, `pay`, `from_address`, `to_address`) |
| Response **201** | `{ "booking_id": 1000, "status": "SEARCHING", "vehicle": "CAR_4", "pay": "CASH", "distance_m": 2026, "fare": 45000, "payment_id": 1000 }`. `pay: ONLINE` → `"status": "PENDING_PAYMENT"` và thêm `"payment_expires_at": "…Z"` |

| Field | Bắt buộc | Gateway | `booking-service` |
|---|---|---|---|
| `from`, `to` | Có | Mảng 2 số, khoảng hợp lệ | Kiểm lại; quãng đường ước tính = 0 → `SAME_PICKUP_AND_DESTINATION` |
| `vehicle` | Không (`CAR_4`) | Chuỗi 1–20, đổi chữ hoa | Chuyển cho Payment; Payment không có giá → `INVALID_INPUT` |
| `pay` | Không (`CASH`) | `CASH` / `ONLINE` | Kiểm lại |
| `from_address`, `to_address` | Không | Chuỗi, không `<` `>` | Cắt khoảng trắng; 1–255 ký tự |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` | Gateway |
| Role `driver`, `admin` | 403 | `FORBIDDEN` | Gateway |
| Body không phải JSON | 400 | `INVALID_JSON` | Gateway |
| Thiếu `from` / `to`, sai kiểu, `pay` lạ, field lạ (gồm `customer_id`, `fare`) | 400 | `INVALID_INPUT` | Gateway |
| Tọa độ ngoài khoảng | 400 | `INVALID_COORDINATES` | Gateway + service |
| Địa chỉ có `<` / `>` | 400 | `TEXT_CONTAINS_HTML` | Gateway + service |
| Điểm đón trùng điểm đến | 400 | `SAME_PICKUP_AND_DESTINATION` | Service |
| Loại xe không có trong `fare_rates` | 400 | `INVALID_INPUT` | Payment (qua Booking) |
| `booking-service` hoặc `payment-service` dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

"Trùng", "không tìm thấy" không áp dụng (tạo mới, khách đặt nhiều booking được).

### 4.3 A20 `GET /api/v1/customers/{customer_id}/bookings?status&page&limit` — booking theo mã khách (mục 14) — sửa 2026-10-14

| | |
|---|---|
| Vì sao đường dẫn này | Giảng viên yêu cầu xem booking **theo mã khách** (2026-10-14). Danh sách booking của một khách là **tài nguyên con** của khách đó (04 R2: `/{resource}/{id}/{sub-resource}`). Đường dẫn bắt đầu bằng `customers` nhưng **dữ liệu thuộc Booking** → bảng route của Gateway trỏ sang `booking-service` (`customer-service` không tham gia, không có lời gọi mới giữa service). Bỏ `GET /api/v1/bookings` để chỉ còn một cách |
| Token / role | Có / `customer` (chỉ mã của mình), `admin` (mọi mã) |
| rpc | `ListBookings` với `customer_id` = mã trong đường dẫn |
| Kiểm tra ở Gateway | Mã khớp `^[1-9][0-9]{0,15}$`, sai (`abc`, `me`, `1 OR 1=1`) → 400 `INVALID_ID`; role `driver` → 403 `FORBIDDEN` |
| Kiểm tra ở `booking-service` | `x-role = customer` và `customer_id` ≠ `x-account-id` → 403 `NOT_OWNER` **ngay, không đọc database** (như A09 — B14) [BA DX23]; `admin` bỏ qua; sau đó `SELECT … WHERE customer_id = $1 …` |
| Query cho phép | `status` (một trong 5 trạng thái Booking), `page`, `limit` |
| Thứ tự | `created_at` giảm dần, rồi `booking_id` giảm dần |
| Response 200 | `{ "data": [ { "booking_id": 7, "status": "PENDING_PAYMENT", "vehicle": "CAR_7", "pay": "ONLINE", "fare": 56000, "created_at": "…" }, { "booking_id": 6, … } ], "pagination": { "page": 1, "limit": 2, "total": 7, "total_pages": 4 } }` (không đổi) |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A19 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã khách sai định dạng | 400 | `INVALID_ID` | Gateway |
| Khách gọi mã **khác** mã của mình | 403 | `NOT_OWNER` | Service |
| `status` lạ; query lạ | 400 | `INVALID_INPUT` | Gateway |
| `page` / `limit` sai (`limit=abc`, `0`, `51`) | 400 | `INVALID_PAGINATION` | Gateway |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

"Không tìm thấy": mã không có booking (kể cả mã khách không tồn tại, khi admin gọi) → 200 `data: []`, `total: 0` — **không có 404** vì `booking-service` không biết khách nào tồn tại và không gọi `customer-service` (Q56) [BA DX24]. "Trùng" không áp dụng. Đường cũ `GET /api/v1/bookings` → 404 `ROUTE_NOT_FOUND` (`POST /api/v1/bookings` — A19 — giữ nguyên).

### 4.4 A21 `GET /api/v1/bookings/{booking_id}` — xem booking

| | |
|---|---|
| Token / role | Có / `customer` (chủ), `admin` |
| rpc | `GetBooking` |
| Response 200 | Như A19 **trừ `payment_expires_at`** (DX19), thêm `from`, `to`, `from_address`, `to_address` (nếu có), `created_at`; khi đã phân công thêm `driver_id`, `trip_id`; khi hủy thêm `canceled_by`, `cancel_reason` |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A19 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã sai định dạng | 400 | `INVALID_ID` | Gateway |
| Không có booking | 404 | `BOOKING_NOT_FOUND` | Service |
| Khách không phải chủ | 403 | `NOT_OWNER` | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

### 4.5 A23 `GET /api/v1/offers?status&page&limit` — lời mời của tôi (mục 15)

| | |
|---|---|
| Token / role | Có / `driver` |
| rpc | `ListOffers` (lọc `driver_id = x-account-id`; mặc định `status = PENDING`) |
| Query cho phép | `status` (`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `VOIDED`), `page`, `limit` |
| Thứ tự | `created_at` giảm dần, rồi `offer_id` giảm dần |
| Response 200 | `{ "data": [ { "offer_id": 1000, "booking_id": 1000, "distance_m": 111, "status": "PENDING", "expires_at": "…", "from": [10.82, 106.68], "to": [10.83, 106.69], "pay": "CASH", "fare": 45000 } ], "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 } }` |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại / role `customer`, `admin` | 401 / 403 | như A19 / `FORBIDDEN` |
| `status` lạ; query lạ | 400 | `INVALID_INPUT` |
| `page` / `limit` sai | 400 | `INVALID_PAGINATION` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

`from`, `to` của booking hiển thị cho **tài xế được mời** (để quyết định nhận); không có tên, số điện thoại khách.

### 4.6 `PATCH /api/v1/offers/{offer_id}` — A24 nhận (mục 16), A25 từ chối

Role của đường dẫn: chỉ `driver` (role kiểm trước body). Gateway chọn theo `status`:

| Body | Biến thể → rpc | Response 200 |
|---|---|---|
| `{"status":"ACCEPTED"}` | A24 → `AcceptOffer` | `{ "offer_id": 1000, "status": "ACCEPTED", "booking_id": 1000, "booking_status": "DRIVER_ASSIGNED", "trip_id": 1000, "trip_status": "ACCEPTED" }` |
| `{"status":"REJECTED"}` | A25 → `RejectOffer` | `{ "offer_id": 1000, "status": "REJECTED" }` |
| Thiếu `status`, giá trị khác (`PENDING`, `EXPIRED`…), field lạ, body rỗng | — | 400 `INVALID_INPUT` |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A19 | Gateway |
| Role `customer`, `admin` | 403 | `FORBIDDEN` | Gateway |
| Mã sai định dạng; body không phải JSON | 400 | `INVALID_ID` / `INVALID_JSON` | Gateway |
| Không có Offer | 404 | `OFFER_NOT_FOUND` | Service |
| Offer của tài xế khác | 403 | `NOT_OWNER` | Service |
| Offer không còn `PENDING`; Booking không còn `SEARCHING` | 409 | `INVALID_STATUS_TRANSITION` | Service |
| Offer quá hạn (`expires_at <= now()`) | 409 | `OFFER_EXPIRED` | Service |
| A24: tài xế không còn rảnh (S3) | 409 | `DRIVER_NOT_AVAILABLE` | Service (từ driver) |
| `booking-service`, hoặc (A24) `driver-service` / `trip-service` dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

"Trùng" không áp dụng (đổi trạng thái; nhận lần hai là sai trạng thái → 409).

### 4.7 A30 `GET /api/v1/payments/{payment_id}` — xem thanh toán (mục 30)

| | |
|---|---|
| Token / role | Có / `customer` (chủ), `admin` |
| rpc | `GetPayment` |
| Response 200 | `{ "payment_id": 7, "booking_id": 7, "method": "ONLINE", "status": "COMPLETED", "amount": 56000, "fare": { "distance_m": 2026, "base_fare": 25000, "per_km_rate": 15000, "min_fare": 40000 }, "expires_at": "…", "paid_at": "…", "transactions": [ { "txn_id": "SIM-7-1", "type": "CHARGE", "attempt_no": 1, "status": "SUCCEEDED", "amount": 56000 } ] }`. Có `status_reason`, `refunded_at` khi có giá trị. `transactions` theo thứ tự tạo |
| Không trả | Số thẻ, tài khoản (không lưu — BRULE09); `callback_response`; `customer_id` |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A19 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã sai định dạng | 400 | `INVALID_ID` | Gateway |
| Không có | 404 | `PAYMENT_NOT_FOUND` | Service |
| Khách không phải chủ | 403 | `NOT_OWNER` | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

### 4.8 A31 `POST /api/v1/payments/{payment_id}/transactions` — thanh toán (mục 19, 30)

| | |
|---|---|
| Token / role | Có / `customer` (chủ) |
| rpc | `PayPayment` |
| Header | `Idempotency-Key: k1` (bắt buộc) |
| Request | Body rỗng, hoặc `{ "simulate_result": "MANUAL" }` (`SUCCESS` mặc định / `FAILED` / `MANUAL`) |
| Response **200** | `{ "payment_id": 7, "status": "PENDING", "txn_id": "SIM-7-1", "txn_status": "PENDING", "attempt_no": 1, "attempts_left": 2, "expires_at": "…" }` (`MANUAL`). Mặc định: `"status": "COMPLETED"`, `"txn_status": "SUCCEEDED"`. `FAILED`: `"status": "FAILED"` (lần 3: `"CANCELED"`, `attempts_left` 0), `"txn_status": "FAILED"` |

`attempts_left` = số lần thử còn lại nếu lần này thất bại (`3 − attempt_no`). `simulate_result` chỉ có hiệu lực khi `SIMULATION_MODE=true`; tắt thì bị bỏ qua (coi như mặc định).

Thứ tự trong `payment-service` (một giao dịch):

| # | Bước | Lỗi |
|---|---|---|
| 1 | Đọc metadata; `x-role = customer`; có `idempotency-key` | `IDENTITY_MISSING` / `FORBIDDEN` / 400 `IDEMPOTENCY_KEY_REQUIRED` |
| 2 | `SELECT … FROM payments WHERE payment_id = $1 FOR UPDATE` | Không có → 404 `PAYMENT_NOT_FOUND`; `customer_id ≠ x-account-id` → 403 `NOT_OWNER` |
| 3 | Tính `request_hash` = SHA-256 của body chuẩn hóa (`{}` hoặc `{"simulate_result":"<CHỮ HOA>"}`); tra `idempotency_keys (payment_id, key)` | Có, khác hash → 409 `IDEMPOTENCY_KEY_REUSED`. Có, cùng hash, có `response` → **trả response đã lưu**, `replayed = true`, dừng. Có, `response` NULL (đang xử lý) → 409 `PAYMENT_IN_PROGRESS` |
| 4 | Kiểm tra trạng thái theo thứ tự | `method = CASH` → 409 `PAYMENT_NOT_ONLINE`; `COMPLETED` / `REFUNDED` → 409 `PAYMENT_ALREADY_COMPLETED`; `CANCELED` + `PAYMENT_EXPIRED`, hoặc `expires_at <= now()` → 409 `PAYMENT_EXPIRED`; `CANCELED` + `ATTEMPTS_EXHAUSTED` → 409 `PAYMENT_ATTEMPTS_EXHAUSTED`; `CANCELED` lý do khác → 409 `PAYMENT_CANCELED` [BA DX11]; có giao dịch `CHARGE` `PENDING` → 409 `PAYMENT_IN_PROGRESS` |
| 5 | `attempt_no` = số giao dịch `CHARGE` + 1; `INSERT idempotency_keys (…, response NULL)`; `INSERT payment_transactions (CHARGE, attempt_no, 'SIM-<id>-<n>', amount, PENDING)`; Payment `FAILED` → `PENDING` | Trùng PK khóa do request song song → 409 `PAYMENT_IN_PROGRESS` |
| 6 | `MANUAL` → bỏ qua. Còn lại → adapter gọi **`applyProviderResult(tx, txn, SUCCESS / FAILED)`** (mục 5.7) | — |
| 7 | Dựng response; `UPDATE idempotency_keys SET response = $3`; commit; phát K6 nếu bước 6 sinh event | — |

Lỗi ở bất kỳ bước nào → rollback cả khóa: **chỉ response thành công được lưu** [BA DX9]; client sửa lỗi rồi dùng lại khóa được.

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A19 | Gateway |
| Role `driver`, `admin` | 403 | `FORBIDDEN` | Gateway |
| Mã sai định dạng | 400 | `INVALID_ID` | Gateway |
| Thiếu / rỗng header `Idempotency-Key` | 400 | `IDEMPOTENCY_KEY_REQUIRED` | Gateway + service |
| Body không phải JSON | 400 | `INVALID_JSON` | Gateway |
| `simulate_result` lạ, sai kiểu; field lạ | 400 | `INVALID_INPUT` | Gateway |
| Không có / không phải chủ | 404 / 403 | `PAYMENT_NOT_FOUND` / `NOT_OWNER` | Service |
| Cùng khóa khác body | 409 | `IDEMPOTENCY_KEY_REUSED` | Service |
| Sai trạng thái (bước 4) | 409 | như bảng trên | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

### 4.9 A32 `POST /api/v1/payment-callbacks` — callback cổng thanh toán (mục 19, 30)

| | |
|---|---|
| Token / role | **Không** token, không role, **không rate limit** (04 mục 1.5); xác thực bằng header `X-Callback-Secret:<khóa trong .env>` (`PAYMENT_CALLBACK_SECRET`) |
| rpc | `HandleProviderCallback` |
| Request | `{ "txn_id": "SIM-7-1" }` (+ `result` `SUCCESS` mặc định / `FAILED`; `amount` số nguyên > 0) |
| Response 200 | `{ "txn_id": "SIM-7-1", "txn_status": "SUCCEEDED", "payment_id": 7, "status": "COMPLETED" }` |

| # | Bước ở `payment-service` (một giao dịch) | Lỗi |
|---|---|---|
| 1 | So `x-callback-secret` với `PAYMENT_CALLBACK_SECRET` bằng `timingSafeEqual` (độ dài khác → sai) | Thiếu / sai → 401 `INVALID_CALLBACK_SECRET` |
| 2 | `SELECT … FROM payment_transactions WHERE provider_transaction_id = $1 FOR UPDATE` | Không có → 404 `TRANSACTION_NOT_FOUND` |
| 3 | Có `amount` mà khác `amount` của giao dịch | 400 `INVALID_INPUT` |
| 4 | Giao dịch không còn `PENDING` → trả `callback_response`, `replayed = true`; **không** đổi gì, **không** phát K6 | — |
| 5 | Khóa Payment `FOR UPDATE`; `applyProviderResult` (mục 5.7); lưu `callback_response`; commit; phát K6 nếu có | — |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| Body không phải JSON | 400 | `INVALID_JSON` |
| Thiếu `txn_id`, sai kiểu, `result` lạ, `amount` không phải số nguyên dương, field lạ | 400 | `INVALID_INPUT` |
| Khóa bí mật thiếu / sai | 401 | `INVALID_CALLBACK_SECRET` |
| `txn_id` không có | 404 | `TRANSACTION_NOT_FOUND` |
| `amount` lệch | 400 | `INVALID_INPUT` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

"Sai quyền (403)" không áp dụng: không có role, chỉ có khóa (401). "Trùng" = replay, trả 200 response cũ (mục 30). Gửi kèm token Bearer không ảnh hưởng (Gateway bỏ qua ở route này).

## 5. Hợp đồng gRPC

Gateway nạp proto với `longs: Number`, `defaults: false`, `oneofs: true` (field rỗng / mảng rỗng / `false` không xuất hiện trong JSON). Tên field proto trùng tên JSON để Gateway chuyển thẳng. Service **tự kiểm tra lại** mọi điều Gateway đã kiểm. Lỗi trả theo spec 00 mục 4.1 (`details` = mã lỗi).

### 5.1 `proto/booking.proto` (mới) — `package cab.booking.v1; service BookingService`

| Message | Field |
|---|---|
| `Booking` | `int64 booking_id = 1; string status = 2; string vehicle = 3; string pay = 4; int32 distance_m = 5; int32 fare = 6; int64 payment_id = 7; optional string payment_expires_at = 8; repeated double from = 9; repeated double to = 10; optional string from_address = 11; optional string to_address = 12; optional int64 driver_id = 13; optional int64 trip_id = 14; optional string canceled_by = 15; optional string cancel_reason = 16; optional string created_at = 17;` — mỗi rpc chỉ điền field của response tương ứng (mục 4); `payment_expires_at` chỉ có ở A19 (DX19) |
| `Pagination` | `int32 page = 1; int32 limit = 2; int32 total = 3; int32 total_pages = 4;` |
| `CreateBookingRequest` | `repeated double from = 1; repeated double to = 2; string vehicle = 3; string pay = 4; optional string from_address = 5; optional string to_address = 6;` |
| `ListBookingsRequest` → `ListBookingsResponse` | `optional string status = 1; int32 page = 2; int32 limit = 3; int64 customer_id = 4;` (**thêm `customer_id` 2026-10-14** — mã trong đường dẫn; số mới, không đổi số cũ) → `repeated Booking data = 1; Pagination pagination = 2;` |
| `GetBookingRequest` | `int64 booking_id = 1;` |
| `Offer` | `int64 offer_id = 1; int64 booking_id = 2; int32 distance_m = 3; string status = 4; string expires_at = 5; repeated double from = 6; repeated double to = 7; string pay = 8; int32 fare = 9;` |
| `ListOffersRequest` → `ListOffersResponse` | `optional string status = 1; int32 page = 2; int32 limit = 3;` → `repeated Offer data = 1; Pagination pagination = 2;` |
| `OfferIdRequest` | `int64 offer_id = 1;` (dùng cho cả `AcceptOffer`, `RejectOffer`) |
| `AcceptOfferResponse` | `int64 offer_id = 1; string status = 2; int64 booking_id = 3; string booking_status = 4; int64 trip_id = 5; string trip_status = 6;` |
| `RejectOfferResponse` | `int64 offer_id = 1; string status = 2;` |

| rpc | Ai gọi | Role (`x-role`) | Lỗi (status → `details`) |
|---|---|---|---|
| `CreateBooking` | GW (A19) | `customer` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_COORDINATES` / `TEXT_CONTAINS_HTML` / `SAME_PICKUP_AND_DESTINATION`; `UNAVAILABLE` (S4 lỗi); `INTERNAL` |
| `ListBookings` | GW (A20) | `customer`, **`admin`** (sửa 2026-10-14) | `IDENTITY_MISSING`; `FORBIDDEN` (`driver`); `PERMISSION_DENIED` → **`NOT_OWNER`** (`customer`, `customer_id` ≠ `x-account-id`); `INVALID_ARGUMENT` → `INVALID_INPUT` (gồm `customer_id` ≤ 0) / `INVALID_PAGINATION`; `INTERNAL` |
| `GetBooking` | GW (A21) | `customer`, `admin` | `IDENTITY_MISSING`; `FORBIDDEN`; `NOT_FOUND` → `BOOKING_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER`; `INTERNAL` |
| `ListOffers` | GW (A23) | `driver` | `IDENTITY_MISSING`; `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_PAGINATION`; `INTERNAL` |
| `AcceptOffer` | GW (A24) | `driver` | `IDENTITY_MISSING`; `FORBIDDEN`; `NOT_FOUND` → `OFFER_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER`; `FAILED_PRECONDITION` → `INVALID_STATUS_TRANSITION` / `OFFER_EXPIRED` / `DRIVER_NOT_AVAILABLE`; `UNAVAILABLE` (S3 / S5 lỗi); `INTERNAL` |
| `RejectOffer` | GW (A25) | `driver` | Như `AcceptOffer`, trừ `DRIVER_NOT_AVAILABLE`, `UNAVAILABLE` |
| `CancelBooking` | GW (A22) | — | **Spec 18**; không khai báo ở spec này |

### 5.2 `proto/payment.proto` (mới) — `package cab.payment.v1; service PaymentService`

| Message | Field |
|---|---|
| `CreatePaymentRequest` → `CreatePaymentResponse` | `int64 booking_id = 1; int64 customer_id = 2; string vehicle_type = 3; int32 distance_m = 4; string method = 5;` → `int64 payment_id = 1; int32 amount = 2; string status = 3; optional string expires_at = 4;` |
| `GetPaymentRequest` | `int64 payment_id = 1;` |
| `Fare` | `int32 distance_m = 1; int32 base_fare = 2; int32 per_km_rate = 3; int32 min_fare = 4;` |
| `Transaction` | `string txn_id = 1; string type = 2; optional int32 attempt_no = 3; string status = 4; int32 amount = 5;` |
| `Payment` | `int64 payment_id = 1; int64 booking_id = 2; string method = 3; string status = 4; int32 amount = 5; Fare fare = 6; optional string status_reason = 7; optional string expires_at = 8; optional string paid_at = 9; optional string refunded_at = 10; repeated Transaction transactions = 11;` |
| `PayPaymentRequest` → `PayPaymentResponse` | `int64 payment_id = 1; optional string simulate_result = 2;` → `int64 payment_id = 1; string status = 2; string txn_id = 3; string txn_status = 4; int32 attempt_no = 5; int32 attempts_left = 6; string expires_at = 7; bool replayed = 15;` |
| `ProviderCallbackRequest` → `ProviderCallbackResponse` | `string txn_id = 1; optional string result = 2; optional int32 amount = 3;` → `string txn_id = 1; string txn_status = 2; int64 payment_id = 3; string status = 4; bool replayed = 15;` |

| rpc | Ai gọi | Danh tính | Lỗi (status → `details`) |
|---|---|---|---|
| `CreatePayment` | **booking (S4)** | `x-role = system` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu `x-role` — DX22); `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` (loại xe không có giá, `distance_m ≤ 0`, `method` lạ); `INTERNAL`. Gọi lặp cùng `booking_id` → trả Payment cũ (M1) |
| `GetPayment` | GW (A30) | `customer`, `admin` | `IDENTITY_MISSING`; `FORBIDDEN`; `NOT_FOUND` → `PAYMENT_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER`; `INTERNAL` |
| `PayPayment` | GW (A31) | `customer` | Mục 4.8; `FAILED_PRECONDITION` → `IDEMPOTENCY_KEY_REUSED` / `PAYMENT_IN_PROGRESS` / `PAYMENT_NOT_ONLINE` / `PAYMENT_ALREADY_COMPLETED` / `PAYMENT_EXPIRED` / `PAYMENT_ATTEMPTS_EXHAUSTED` / `PAYMENT_CANCELED` |
| `HandleProviderCallback` | GW (A32) | `x-callback-secret` | `UNAUTHENTICATED` → `INVALID_CALLBACK_SECRET`; `NOT_FOUND` → `TRANSACTION_NOT_FOUND`; `INVALID_ARGUMENT` → `INVALID_INPUT`; `INTERNAL` |

### 5.3 `proto/trip.proto` (mới) — `package cab.trip.v1; service TripService`; spec này chỉ một rpc

| rpc | Vào | Ra | Ai gọi / danh tính | Lỗi |
|---|---|---|---|---|
| `CreateTrip` | `int64 booking_id = 1; int64 customer_id = 2; int64 driver_id = 3; string vehicle_type = 4; double pickup_lat = 5; double pickup_lng = 6; double destination_lat = 7; double destination_lng = 8; optional string pickup_address = 9; optional string destination_address = 10; string payment_method = 11; int32 fare_amount = 12; string driver_name = 13; string driver_plate = 14;` — **thêm 13, 14 ngày 2026-10-21** (DX25): Booking chép nguyên từ kết quả S3; rỗng → `INVALID_ARGUMENT` | `int64 trip_id = 1; string status = 2; bool created = 3;` | booking (S5) / `x-role = system` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu `x-role` — DX22); `PERMISSION_DENIED` → `FORBIDDEN` (`x-role` khác `system`); `INVALID_ARGUMENT` → `INVALID_INPUT`; `FAILED_PRECONDITION` → `BOOKING_ALREADY_ASSIGNED` (đã có Trip cho booking này với **tài xế khác**); `INTERNAL` |

Cài đặt: một giao dịch `INSERT INTO trips (…, driver_name, driver_plate, status) VALUES (…, 'ACCEPTED') ON CONFLICT (booking_id) DO NOTHING RETURNING trip_id` + `INSERT trip_status_history (from_status NULL, to_status 'ACCEPTED', changed_by = driver_id, changed_by_role 'driver', changed_at = now())` → commit → phát **K5** → `created = true`. Không có dòng trả về → đọc Trip theo `booking_id`: cùng `driver_id` → trả Trip cũ, `created = false`, **không** phát lại K5 (T1); khác → `BOOKING_ALREADY_ASSIGNED`. Log `trip_created` kèm `trip_id`, `booking_id`.

`ListTrips`, `GetTrip`, `UpdateTripStatus`, `CancelTrip`, `GetTripForRating`: spec 17, 18, 20.

### 5.4 `proto/driver.proto` — thêm hai rpc vào `DriverService`; mở `FindNearbyDrivers` cho `system`

| rpc | Vào | Ra | Danh tính | Lỗi |
|---|---|---|---|---|
| `ReserveDriver` | `int64 driver_id = 1; int64 booking_id = 2;` | `Reservation { int64 driver_id = 1; int64 booking_id = 2; string status = 3; string driver_name = 4; string plate = 5; }` — **thêm `driver_name`, `plate` 2026-10-21** (DX25): họ tên và biển số xe đang dùng, để Booking chuyển vào S5 | `x-role = system` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu `x-role` — DX22); `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT`; `NOT_FOUND` → `DRIVER_NOT_FOUND`; `FAILED_PRECONDITION` → `DRIVER_NOT_AVAILABLE`; `INTERNAL` |
| `ReleaseDriver` | `int64 driver_id = 1; int64 booking_id = 2;` | `ReleaseResult { int64 driver_id = 1; bool released = 2; }` | `x-role = system` | `IDENTITY_MISSING`; `FORBIDDEN`; `INVALID_INPUT`; `INTERNAL` |
| `FindNearbyDrivers` (đã có — spec 12-13-21-23) | Không đổi | Không đổi | **Thêm `system`** vào danh sách role chấp nhận (TX-Q3) | Không đổi |

Hành vi (D8, D9):

| rpc | Câu lệnh | Kết quả |
|---|---|---|
| `ReserveDriver` | `UPDATE drivers SET availability = 'BUSY', current_booking_id = $2, updated_at = now() WHERE driver_id = $1 AND availability = 'ONLINE' RETURNING driver_id` — **một lệnh, nguyên tử**. Sau đó `SELECT d.full_name, v.license_plate FROM drivers d JOIN vehicles v ON v.driver_id = d.driver_id WHERE d.driver_id = $1` để điền `driver_name`, `plate` (DX25) | Có dòng → `status = BUSY` + `driver_name`, `plate`. Không dòng → `SELECT availability, current_booking_id`: không có tài xế → `DRIVER_NOT_FOUND`; `current_booking_id = $2` → **trả như lần đầu, kể cả `driver_name`, `plate`** (gọi lặp an toàn); còn lại (`OFFLINE`, bận booking khác) → `DRIVER_NOT_AVAILABLE` |
| `ReleaseDriver` | `UPDATE drivers SET availability = 'ONLINE', current_booking_id = NULL, updated_at = now() WHERE driver_id = $1 AND current_booking_id = $2 RETURNING driver_id` | Có dòng → `released = true` (về `ONLINE` vì trước khi giữ tài xế đang `ONLINE`). Không dòng (không giữ, hoặc giữ cho booking khác, hoặc không có tài xế) → `released = false`, **không lỗi** (gọi lặp an toàn) |

Cả hai không phát event (không context nào khác cần biết). Log `driver_reserved` / `driver_released` kèm `driver_id`, `booking_id`. `SetAvailability` (spec 12) đã `SELECT … FOR UPDATE` nên không đè lên `ReserveDriver`; CHECK D8 trong database chặn trạng thái lệch.

### 5.5 Danh tính của lời gọi service → service (chốt TX-Q3)

| Lựa chọn | Ưu | Nhược |
|---|---|---|
| **(a) Bên gọi gửi metadata `x-role: system`** (chọn) | Một quy tắc cho mọi rpc: rpc nào cũng kiểm `x-role`; rpc nội bộ chỉ nhận `system`. Không thêm rpc trùng chức năng | Ai vào được mạng nội bộ thì tự đặt được `system` — cùng mức tin cậy với `x-account-id` hiện nay |
| (b) rpc nội bộ riêng `FindCandidates` không kiểm role | Tách rõ đường công khai / nội bộ | Hai rpc cùng một truy vấn; thêm thứ phải giải thích |
| (c) Không kiểm role ở rpc này | Đơn giản nhất | Mất lớp kiểm thứ hai mà mọi rpc khác đều có |

Quy định:

| Điểm | Nội dung |
|---|---|
| Bên gửi | `booking-service` khi gọi S2, S3, S4, S5: metadata `x-role: system`, `x-request-id` (lấy của request đang xử lý; tiến trình nền tự sinh UUID). **Không** gửi `x-account-id` |
| Bên nhận | `CreatePayment`, `CreateTrip`, `ReserveDriver`, `ReleaseDriver`: **chỉ** nhận `system`. `FindNearbyDrivers`: `customer`, `admin`, `system` |
| Thiếu / sai `x-role` (DX22) | **Thiếu** `x-role` → `UNAUTHENTICATED` `IDENTITY_MISSING` (không biết ai gọi); **có** nhưng không thuộc danh sách → `PERMISSION_DENIED` `FORBIDDEN`. Cùng một quy tắc với rpc Gateway gọi (AC-DX-23) |
| Vì sao client không giả được | Gateway **tự dựng** metadata từ token, bỏ header cùng tên của client (spec 09-10 mục 4.1); token chỉ mang 3 role (CHECK `accounts.role`), Gateway từ chối role khác; chỉ Gateway mở cổng ra ngoài (mục 8) |
| Đánh đổi | Không xác thực service với nhau (mTLS) — ngoài phạm vi môn; ghi rõ khi vấn đáp |

### 5.6 Cài đặt trong `booking-service`

| Việc | Cách làm | Truy vết |
|---|---|---|
| Quãng đường | `domain/distance.js`: Haversine `R = 6 371 000 m` (cùng công thức với driver — 03 mục 5.4); `estimated_distance_m = Math.round(d × 1.3)`; = 0 → `SAME_PICKUP_AND_DESTINATION`. P0 → D0 ≈ 1 559 m → **2 026 m** | FR16; [ĐC] |
| Tạo booking | `SELECT nextval(pg_get_serial_sequence('bookings','booking_id'))` → S4 (deadline 1 000 ms) → `INSERT … OVERRIDING SYSTEM VALUE` → commit → K1 → 201 → (nếu `SEARCHING`) `setImmediate(dispatch)` | B2, B15; 03 mục 6.1 |
| S4 trả lỗi | `INVALID_ARGUMENT` → trả nguyên `INVALID_ARGUMENT` + `details`; lỗi khác / quá deadline → `UNAVAILABLE` (Gateway 503). S4 thành công mà `INSERT` lỗi → Payment mồ côi, log `error` `BOOKING_INSERT_FAILED` kèm `booking_id` (chấp nhận, như ADR-017) | ADR-009 |
| Khóa | **Luôn khóa `bookings` trước, `driver_offers` sau** (ở mọi luồng: ghép, nhận, từ chối, hết hạn, nghe K6, hủy ở spec 18) — tránh deadlock | B12 |
| `dispatch(booking_id)` | (1) Đọc booking (không khóa); không `SEARCHING` → dừng. (2) S2 (`page=1`, `limit=50`, `vehicle`); lỗi → thử lại ≤ 3 lần cách 1 giây. (3) Giao dịch: khóa booking; không còn `SEARCHING` hoặc đã có Offer `PENDING` → dừng; loại `driver_id` đã có trong `driver_offers` của booking (B6) và `driver_id` đang có Offer `PENDING` (B10); người đầu tiên còn lại → `INSERT driver_offers (… 'PENDING', expires_at = now() + OFFER_TIMEOUT_SECONDS)`; vi phạm UNIQUE `(driver_id) WHERE PENDING` (tranh chấp) → thử người kế tiếp. (4) Không còn ai → `UPDATE bookings SET status = 'NO_DRIVER_FOUND'`. (5) Commit → K2 hoặc K3 | B3–B7, B10 |
| Tiến trình hết hạn | Mỗi 1 giây (hằng số): `SELECT offer_id, booking_id, driver_id FROM driver_offers WHERE status = 'PENDING' AND expires_at <= now()`; với từng dòng: giao dịch khóa booking, `UPDATE driver_offers SET status = 'EXPIRED', responded_at = now() WHERE offer_id = $1 AND status = 'PENDING'` → commit → `ReleaseDriver(driver_id, booking_id)` (lỗi chỉ log) → `dispatch` | B5, FR09; Q35 |
| `AcceptOffer` | Mục 2.3. S3 thành công, S5 lỗi → `ReleaseDriver` (lỗi chỉ log) → rollback → `UNAVAILABLE`. S5 thành công mà commit lỗi → log `error` `ACCEPT_COMMIT_FAILED` kèm `booking_id`, `trip_id` (rủi ro chấp nhận — DX-Q4) | B8, B11, B17; ADR-008 |
| `RejectOffer` | Đọc Offer → 404 / 403; giao dịch khóa booking rồi Offer; không `PENDING` → `INVALID_STATUS_TRANSITION`; quá hạn → `OFFER_EXPIRED`; `UPDATE … 'REJECTED', responded_at = now()` → commit → 200 → `setImmediate(dispatch)` | B6, BRULE05, BRULE15 |
| Nghe K6 | Consumer group `booking-service`, topic `payment.status-changed`, `fromBeginning: true` (không mất event phát trước khi group có lần đầu). Bảng dưới. Xử lý lỗi → ném lỗi để Kafka giao lại (bước chuyển có điều kiện nên lặp an toàn) | B16, B18 |
| Khởi động | Sau migration và seed: `dispatch` mọi booking `SEARCHING` chưa có Offer `PENDING` (index `(created_at) WHERE status = 'SEARCHING'`) | NFR15 |
| Phát event | Sau commit (ADR-017): thử lại ≤ 3 lần trong ≤ 1 giây; lỗi → log `EVENT_PUBLISH_FAILED` kèm topic, key; vẫn trả kết quả | 02 mục 6.3 |
| Log | `booking_created`, `offer_created`, `offer_rejected`, `offer_expired`, `offer_accepted`, `no_driver_found` kèm mã. **Không** ghi tọa độ, địa chỉ | NFR08, NFR10 |

Booking nghe K6:

| `data.status` | Booking đang `PENDING_PAYMENT` | Trạng thái khác |
|---|---|---|
| `COMPLETED` | `UPDATE bookings SET status = 'SEARCHING' WHERE booking_id = $1 AND status = 'PENDING_PAYMENT' RETURNING` → commit → `dispatch` | Bỏ qua |
| `CANCELED` (`reason` = `PAYMENT_EXPIRED` / `ATTEMPTS_EXHAUSTED`) | `UPDATE … SET status = 'CANCELED', canceled_by = 'system', cancel_reason = <reason>, canceled_at = now() WHERE … AND status = 'PENDING_PAYMENT'` → commit → phát **K4** | Bỏ qua |
| `FAILED`, `REFUNDED` | Bỏ qua (Booking vẫn chờ thanh toán lại — B16) | Bỏ qua |

### 5.7 Cài đặt trong `payment-service`

| Việc | Cách làm | Truy vết |
|---|---|---|
| `CreatePayment` | Kiểm `x-role = system`, dữ liệu. Giao dịch: đã có Payment cho `booking_id` → trả nó (M1). Không có → tra `fare_rates` (không có → `INVALID_INPUT`) → tính cước → `INSERT fares` (bản chụp giá) → `INSERT payments (status 'PENDING', expires_at = ONLINE ? now() + PAYMENT_TIMEOUT_SECONDS : NULL)` → commit. Không phát event | M1, M7; B15 |
| Tính cước (số nguyên) | `tho = base_fare × 1000 + per_km_rate × distance_m` (đơn vị: đồng × 1000); `lam_tron = ceil(tho / 1 000 000) × 1000` (làm tròn **lên** bội 1 000 đ); `total = max(lam_tron, min_fare)`. P0 → D0: `CAR_4` 45 000, `MOTORBIKE` 21 000, `CAR_7` 56 000 (03 mục 6.3). Đặt trong `domain/fare.js`, unit test 6 ví dụ của 03 mục 6.3 | FR16, AC26 |
| `applyProviderResult(tx, txn, result)` — **một hàm** cho adapter (A31) và A32 | `CHARGE` + `SUCCESS`: giao dịch `SUCCEEDED`, `processed_at`. Payment `PENDING` → `COMPLETED`, `paid_at` → event K6 `COMPLETED`. Payment `CANCELED` (callback đến muộn — M11) → `paid_at`, adapter hoàn ngay: `INSERT` giao dịch `REFUND` `SIM-R-<payment_id>` `SUCCEEDED`, Payment → `REFUNDED`, `refunded_at` (giữ `status_reason`) → K6 `REFUNDED`. `CHARGE` + `FAILED`: giao dịch `FAILED`; Payment `PENDING` → `FAILED` → K6 `FAILED`; nếu `attempt_no = 3` → Payment `CANCELED`, `status_reason = 'ATTEMPTS_EXHAUSTED'` → **một** K6 `CANCELED` [BA DX10]; Payment đã `CANCELED` → chỉ ghi giao dịch, không event. Luôn lưu `callback_response = { txn_id, txn_status, payment_id, status }`. Trả về event cần phát (bên gọi phát **sau commit**) | M3, M6, M11–M13, BRULE10 |
| Tiến trình hết hạn | Mỗi 1 giây: `UPDATE payments SET status = 'CANCELED', status_reason = 'PAYMENT_EXPIRED', updated_at = now() WHERE method = 'ONLINE' AND status IN ('PENDING','FAILED') AND expires_at <= now() RETURNING …` → K6 `CANCELED` cho từng dòng. Giao dịch `MANUAL` đang `PENDING` giữ nguyên (callback muộn xử lý theo M11) | BRULE17, M13 |
| Adapter giả lập | `src/adapters/provider-sim.js`: sinh `txn_id`; với `SUCCESS` / `FAILED` gọi `applyProviderResult` ngay; `MANUAL` không gọi. `SIMULATION_MODE=false` → bỏ qua `simulate_result`, dùng `SUCCESS` (chưa có Provider thật) | ADR-014, NFR13 |
| So khóa callback | `crypto.timingSafeEqual` trên Buffer; độ dài khác → sai ngay | 04 mục 2.7 |
| Log | `payment_created`, `payment_attempt` (kèm `payment_id`, `attempt_no`, `simulate_result`), `payment_callback` (kèm `txn_id`, kết quả, `replayed`), `payment_expired`. **Không** ghi khóa bí mật, `Idempotency-Key` | NFR09, NFR10 |
| Không làm ở spec này | Nghe K3 / K4 / K5 (hoàn tiền, tiền mặt `COMPLETED`) — spec 18 / 17. Khi làm, consumer group `payment-service` đặt `fromBeginning: true` để xử lý cả K3 phát từ spec này | — |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `booking-service` 6 rpc (G4) | gRPC | Khách / tài xế chờ kết quả ngay |
| Gateway → `payment-service` `GetPayment`, `PayPayment`, `HandleProviderCallback` (G6) | gRPC | Khách / cổng thanh toán chờ kết quả ngay |
| `booking` → `driver` **S2** `FindNearbyDrivers` | gRPC | Cần danh sách ứng viên **mới nhất** mới gửi được Offer (FR02–FR05, BRULE01–03) |
| `booking` → `payment` **S4** `CreatePayment` | gRPC | Khách phải thấy **ngay** cước và mã thanh toán (B15, FR16); [ĐC] "Đặt xe → cước và thanh toán" |
| `booking` → `driver` **S3** `ReserveDriver` / `ReleaseDriver` | gRPC | Chỉ xác nhận phân công khi tài xế **còn rảnh** — Driver là nơi duy nhất giữ trạng thái đó (D8, B11); tài xế đang chờ câu trả lời |
| `booking` → `trip` **S5** `CreateTrip` | gRPC | Tài xế cần **ngay** mã chuyến (B17); [ĐC] "Tài xế nhận chuyến". Mang theo họ tên, biển số lấy từ S3 để khách xem tài xế của chuyến ở A27 (FR14, DX25) — **không thêm đường mới** |
| `booking` → Kafka **K1** `booking.created` → notification | Kafka | L2: Notification lỗi không được làm hỏng đặt xe (NFR05). Phần nghe: spec Notification |
| `booking` → Kafka **K2** `booking.offer-created` → notification | Kafka | L1: bộ ghép chạy nền, không ai chờ; L2 |
| `booking` → Kafka **K3** `booking.no-driver-found` → payment, notification | Kafka | L1, L2, L3: hoàn tiền (spec 18) và báo khách (BRULE07, BRULE14) |
| `booking` → Kafka **K4** `booking.canceled` → payment, notification | Kafka | Spec này chỉ phát K4 khi **hệ thống** hủy do K6 `CANCELED` (B18); L2, L3. Hủy bởi khách: spec 18 |
| `trip` → Kafka **K5** `trip.status-changed` (`ACCEPTED`) → notification (driver, payment lọc bỏ) | Kafka | T8, FR22: báo khách "tài xế đã nhận"; L2 |
| `payment` → Kafka **K6** `payment.status-changed` → **booking**, notification | Kafka | L1: kết quả đến lúc không biết trước; L2: tiền đã thu phải ghi xong dù Booking lỗi (NFR14); L3 |
| `trip` → `booking`, `payment` → `booking` bằng gRPC | **Không có** | Không có gRPC nào đi **vào** booking (02 mục 4.3) |
| Tài xế từ chối / Offer hết hạn → event | **Không có** | Không context nào khác cần biết; Payment không được báo nên không hoàn nhầm (BRULE15) |
| `booking` ↔ `customer` | **Không có** | Đặt xe không cần hồ sơ (Q56) |

Phong bì chung (02 mục 6.1, TX5): `{ "event_id": "<UUID>", "event_type": "<tên topic>", "occurred_at": "<ISO UTC>", "data": { … } }`. Không họ tên, số điện thoại, tọa độ, địa chỉ, lý do do người dùng nhập.

| Mã | Topic / key | `data` |
|---|---|---|
| K1 | `booking.created` / `booking_id` | `booking_id`, `customer_id`, `vehicle_type`, `payment_method`, `status` |
| K2 | `booking.offer-created` / `booking_id` | `offer_id`, `booking_id`, `driver_id`, `expires_at` |
| K3 | `booking.no-driver-found` / `booking_id` | `booking_id`, `customer_id`, `offers_tried` (số Offer đã gửi) |
| K4 | `booking.canceled` / `booking_id` | `booking_id`, `customer_id`, `canceled_by` (`system`), `previous_status` (`PENDING_PAYMENT`), `pending_offer_driver_id` (`null`), `reason` (`PAYMENT_EXPIRED` / `ATTEMPTS_EXHAUSTED` — mã hệ thống, không phải văn bản người dùng) |
| K5 | `trip.status-changed` / `trip_id` | `trip_id`, `booking_id`, `customer_id`, `driver_id`, `status` (`ACCEPTED`), `previous_status` (`null`) |
| K6 | `payment.status-changed` / `booking_id` | `payment_id`, `booking_id`, `customer_id`, `method`, `amount`, `status` (`COMPLETED` / `FAILED` / `REFUNDED` / `CANCELED`), `previous_status`, `reason` (chỉ khi `CANCELED`) |

## 7. Dữ liệu

Quy ước chung: khóa chính `bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000)`; mọi bảng có `created_at timestamptz NOT NULL DEFAULT now()`, bảng có sửa thêm `updated_at`; tọa độ `double precision` + CHECK khoảng; tiền, mét `integer` (03 mục 2). Không khóa ngoại giữa service.

### 7.1 Migration `services/booking-service/migrations/001_tao-bang-dat-xe.sql`

`bookings` (03 mục 6.1):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `booking_id` | `bigint` | identity, `PRIMARY KEY` |
| `customer_id` | `bigint` | `NOT NULL` |
| `vehicle_type` | `text` | `NOT NULL` (không CHECK danh sách — Payment quyết) |
| `pickup_lat`, `destination_lat` | `double precision` | `NOT NULL`, `CHECK (… BETWEEN -90 AND 90)` |
| `pickup_lng`, `destination_lng` | `double precision` | `NOT NULL`, `CHECK (… BETWEEN -180 AND 180)` |
| `pickup_address`, `destination_address` | `text` | NULL, `CHECK (char_length(…) <= 255)` |
| `payment_method` | `text` | `NOT NULL`, `CHECK (payment_method IN ('CASH','ONLINE'))` |
| `estimated_distance_m` | `integer` | `NOT NULL`, `CHECK (> 0)` |
| `fare_amount` | `integer` | `NOT NULL`, `CHECK (> 0)` |
| `payment_id` | `bigint` | `NOT NULL`, `UNIQUE` |
| `status` | `text` | `NOT NULL`, `CHECK (status IN ('PENDING_PAYMENT','SEARCHING','DRIVER_ASSIGNED','NO_DRIVER_FOUND','CANCELED'))` |
| `cancel_reason` | `text` | NULL, `CHECK (char_length(cancel_reason) <= 255)` |
| `canceled_by` | `text` | NULL, `CHECK (canceled_by IN ('customer','system'))` |
| `canceled_at` | `timestamptz` | NULL |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

CHECK mức bảng: `(status = 'CANCELED') = (canceled_at IS NOT NULL)`; **thêm** `(status = 'CANCELED') = (canceled_by IS NOT NULL)` [BA DX12]. Index: `bookings_khach_idx (customer_id, created_at DESC)` (A20, mục 14); `bookings_tim_idx (created_at) WHERE status = 'SEARCHING'` (khởi động lại).

`driver_offers` (03 mục 6.2):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `offer_id` | `bigint` | identity, `PRIMARY KEY` |
| `booking_id` | `bigint` | `NOT NULL REFERENCES bookings` |
| `driver_id` | `bigint` | `NOT NULL` |
| `distance_m` | `integer` | `NOT NULL`, `CHECK (>= 0)` |
| `status` | `text` | `NOT NULL`, `CHECK (status IN ('PENDING','ACCEPTED','REJECTED','EXPIRED','VOIDED'))` |
| `expires_at` | `timestamptz` | `NOT NULL` |
| `responded_at` | `timestamptz` | NULL |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

| Index | Quy tắc |
|---|---|
| UNIQUE `(booking_id, driver_id)` | B6: không mời lại người đã bị loại |
| UNIQUE `(booking_id) WHERE status = 'PENDING'` | B10 |
| UNIQUE `(driver_id) WHERE status = 'PENDING'` | B10; phục vụ A23 |
| UNIQUE `(booking_id) WHERE status = 'ACCEPTED'` | B8 |
| `(expires_at) WHERE status = 'PENDING'` | Tiến trình hết hạn |
| `(driver_id, created_at DESC)` | A23 với `status` khác `PENDING` [BA DX13] |

`driver_assignments` (03 mục 6.3): `assignment_id` identity PK; `booking_id` `bigint NOT NULL UNIQUE REFERENCES bookings`; `offer_id` `bigint NOT NULL UNIQUE REFERENCES driver_offers`; `driver_id` `bigint NOT NULL`; `trip_id` `bigint NOT NULL UNIQUE`; `assigned_at` `timestamptz NOT NULL`; `created_at`.

### 7.2 Migration `services/payment-service/migrations/001_tao-bang-thanh-toan.sql`

| Bảng | Cột và ràng buộc (03 mục 8) |
|---|---|
| `fare_rates` | `vehicle_type text PRIMARY KEY`; `base_fare`, `per_km_rate`, `min_fare` `integer NOT NULL CHECK (>= 0)`. Chèn **trong migration**: `MOTORBIKE` (10000, 5000, 15000), `CAR_4` (20000, 12000, 30000), `CAR_7` (25000, 15000, 40000) |
| `fares` | `fare_id` identity PK; `booking_id bigint NOT NULL UNIQUE`; `vehicle_type text NOT NULL`; `distance_m integer NOT NULL CHECK (> 0)`; `base_fare`, `per_km_rate`, `min_fare integer NOT NULL`; `total_amount integer NOT NULL CHECK (total_amount >= min_fare AND total_amount % 1000 = 0)`; `calculated_at timestamptz NOT NULL`; `created_at` |
| `payments` | `payment_id` identity PK; `booking_id bigint NOT NULL UNIQUE`; `fare_id bigint NOT NULL UNIQUE REFERENCES fares`; `customer_id bigint NOT NULL`; `method text NOT NULL CHECK IN ('CASH','ONLINE')`; `amount integer NOT NULL CHECK (> 0)`; `status text NOT NULL CHECK IN ('PENDING','COMPLETED','FAILED','REFUNDED','CANCELED')`; `status_reason text NULL CHECK IN ('PAYMENT_EXPIRED','ATTEMPTS_EXHAUSTED','BOOKING_CANCELED','NO_DRIVER_FOUND','TRIP_CANCELED')`; `expires_at`, `paid_at`, `refunded_at timestamptz NULL`; `created_at`, `updated_at` |
| CHECK `payments` | `(method = 'ONLINE') = (expires_at IS NOT NULL)` (03); **thêm** [BA DX12]: `status NOT IN ('COMPLETED','REFUNDED') OR paid_at IS NOT NULL`; `(status = 'REFUNDED') = (refunded_at IS NOT NULL)`; `status_reason IS NULL OR status IN ('CANCELED','REFUNDED')` |
| Index `payments` | `payments_het_han_idx (expires_at) WHERE method = 'ONLINE' AND status IN ('PENDING','FAILED')` |
| `payment_transactions` | `transaction_id` identity PK; `payment_id bigint NOT NULL REFERENCES payments`; `type text NOT NULL CHECK IN ('CHARGE','REFUND')`; `attempt_no smallint NULL CHECK (>= 1)`; `provider_transaction_id text NOT NULL UNIQUE`; `amount integer NOT NULL CHECK (> 0)`; `status text NOT NULL CHECK IN ('PENDING','SUCCEEDED','FAILED')`; `callback_response jsonb NULL`; `processed_at timestamptz NULL`; `created_at` |
| Ràng buộc `payment_transactions` | CHECK `(type = 'CHARGE') = (attempt_no IS NOT NULL)`; UNIQUE `(payment_id, attempt_no)`; UNIQUE `(payment_id) WHERE type = 'CHARGE' AND status = 'SUCCEEDED'` (M6); UNIQUE `(payment_id) WHERE type = 'CHARGE' AND status = 'PENDING'`; UNIQUE `(payment_id) WHERE type = 'REFUND'` (M8); **thêm** CHECK `(status = 'PENDING') = (callback_response IS NULL)` [BA DX12] |
| `idempotency_keys` | `payment_id bigint NOT NULL REFERENCES payments`; `idempotency_key text NOT NULL CHECK (char_length BETWEEN 1 AND 100)`; `request_hash text NOT NULL`; `response jsonb NULL`; `created_at`; `PRIMARY KEY (payment_id, idempotency_key)` |

### 7.3 Migration `services/trip-service/migrations/001_tao-bang-chuyen.sql`

Hai bảng theo đúng 03 mục 7.1, 7.2 (`trips` với `booking_id` UNIQUE, bản chụp, `status` CHECK 6 giá trị, `started_at`, `ended_at`, `cancel_reason`, `canceled_by` CHECK IN (`customer`, `driver`); `trip_status_history` chỉ ghi thêm, `changed_by_role` CHECK IN (`customer`, `driver`)). Tạo đủ cột của spec 17, 18 ngay bây giờ để không phải migration thứ hai. Index: `(customer_id, created_at DESC)`, `(driver_id, created_at DESC)`, `(status, created_at DESC)`, `trip_status_history (trip_id, changed_at)`.

**Thêm 2026-10-21 (DX25):** migration `002_ten-bien-so-tai-xe.sql` thêm `driver_name`, `driver_plate` — chi tiết ở spec 17-18 mục 7 (không sửa `001` đã chạy).

`driver-db`: **không** đổi schema.

### 7.4 Seed (03 mục 14) [ĐC]

Quy luật: **booking = payment = fare = trip = offer = assignment = 1…7** (nếu có); khách KH1 (`customer_id = 1`); P0 (10.82, 106.68) → D0 (10.83, 106.69); `estimated_distance_m` tính bằng **chính hàm** `domain/distance.js` (≈ 2 026); cước `CAR_4` 45 000, `CAR_7` 56 000 tính bằng `domain/fare.js`. `created_at` của Bn = lúc seed − (8 − n) giờ (B7 mới nhất → mục 14 ra 7, 6 rồi 5, 4). `OVERRIDING SYSTEM VALUE`; `ON CONFLICT DO NOTHING`. Không gọi service khác.

| Mã | Xe | `pay` | `bookings.status` | Offer / phân công (cùng mã) | `payments` | Giao dịch | Trip (cùng mã) |
|---|---|---|---|---|---|---|---|
| B1 | CAR_4 | CASH | `CANCELED`, `canceled_by customer`, lý do "doi y" | — | `CANCELED` (`BOOKING_CANCELED`) | — | — |
| B2 | CAR_4 | ONLINE | `NO_DRIVER_FOUND` | — | `REFUNDED` (`NO_DRIVER_FOUND`), `paid_at`, `refunded_at` | `SIM-2-1` CHARGE lần 1 `SUCCEEDED`; `SIM-R-2` REFUND `SUCCEEDED` | — |
| B3 | CAR_4 | CASH | `DRIVER_ASSIGNED` | TX1 (11), 111 m, `ACCEPTED` | `COMPLETED`, `paid_at` | — | T3 `COMPLETED` |
| B4 | CAR_4 | ONLINE | `DRIVER_ASSIGNED` | TX3 (13), 334 m | `COMPLETED` | `SIM-4-1` `SUCCEEDED` | T4 `COMPLETED` |
| B5 | CAR_4 | ONLINE | `DRIVER_ASSIGNED` | TX6 (16), 667 m | `COMPLETED` | `SIM-5-1` `SUCCEEDED` | T5 `ACCEPTED` |
| B6 | CAR_4 | ONLINE | `CANCELED`, `canceled_by system`, lý do `PAYMENT_EXPIRED` | — | `CANCELED` (`PAYMENT_EXPIRED`) | — | — |
| B7 | **CAR_7** | ONLINE | **`PENDING_PAYMENT`** | — | **`PENDING`**, 56 000 đ, `expires_at` = lúc seed + **1 ngày** | Chưa có | — |

Chi tiết: Payment `ONLINE` khác B7 có `expires_at = created_at + 600 s` (đã qua — không bị tiến trình hết hạn chạm vì không còn `PENDING` / `FAILED`). Giao dịch seed có `callback_response` đúng dạng mục 4.9; `transaction_id` để identity cấp (không lộ ra API); chạy lặp an toàn nhờ UNIQUE `provider_transaction_id`. Offer seed: `expires_at = created_at + 300 s`, `responded_at` có giá trị. Trip seed: bản chụp từ booking cùng mã, **kèm `driver_name`, `driver_plate` theo seed tài xế** (2026-10-21, DX25): T3 `Tài Xế 1` / `59A-00001`, T4 `Tài Xế 3` / `59A-00003`, T5 `Tài Xế 6` / `59A-00006`; T3, T4 có `started_at` (lúc `PICKED_UP`), `ended_at`; `trip_status_history` T3, T4 đủ 5 dòng `ACCEPTED → … → COMPLETED` (cách nhau 1 phút, `changed_by` = tài xế, role `driver`), T5 một dòng `ACCEPTED`. **Chỉ chèn lịch sử khi `INSERT trips` vừa tạo dòng** (lịch sử không có khóa tự nhiên để `ON CONFLICT`). TX6 `BUSY` với `current_booking_id = 5` đã có ở seed driver (spec 12-13-21-23 mục 7.4). Đánh giá của T3: spec 20.

## 8. Tiêu chí chấp nhận

Tiền điều kiện: spec 00, 09-10, 12-13-21-23 đạt; `docker compose down -v` rồi `up -d --build`; `SIMULATION_MODE=true`. Token lấy bằng A05 (`[KH1]`, `[KH2]`, `[KH3]`, `[TX1]`, `[TX3]`, `[TX4]`, `[AD1]`). "≈ 1 s" = kiểm sau tối đa 2 giây. AC chạy theo thứ tự trong cùng nhóm; mã do API tạo ghi `≥ 1000`, chỉ AC-DX-01 / 05 / 19 đúng là 1000 khi chạy trên dữ liệu vừa đặt lại.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-DX-01 (**đổi 2026-10-14**) | 14 | Seed | A20 `GET /api/v1/customers/1/bookings?limit=2` `[KH1]`; thêm `&page=2` | 200 booking 7, 6; `pagination` `{1, 2, 7, 4}`; trang 2: 5, 4 (AC17) |
| AC-DX-02 (**đổi 2026-10-14**) | 14 | Seed | `customers/1/bookings?status=canceled` `[KH1]`; `customers/2/bookings` `[KH2]` | `total = 2` (B6 rồi B1); `data: []`, `total = 0` (B14) |
| AC-DX-03 (**đổi 2026-10-14**) | 14 (400/401/403) | — | `customers/1/bookings` với `?limit=abc`; `?limit=51`; `?page=0`; `?status=XYZ`; `?sort=asc` `[KH1]`; không token; `[TX1]` | 400 `INVALID_PAGINATION` ×3; 400 `INVALID_INPUT` ×2; 401 `TOKEN_MISSING`; 403 `FORBIDDEN` (admin **không** còn 403 — xem AC-DX-27) |
| AC-DX-26 (mới 2026-10-14) | 14 (403) | Seed | `customers/2/bookings?limit=2` `[KH1]`; `customers/999/bookings` `[KH1]` | 403 `NOT_OWNER` cả hai (so mã trước khi đọc database — không lộ khách 999 có tồn tại không) (AC17) |
| AC-DX-27 (mới 2026-10-14) | 14 | Seed | `customers/1/bookings?limit=2` `[AD1]`; `customers/999/bookings` `[AD1]` | 200 như AC-DX-01; 200 `data: []`, `total = 0` (không 404) |
| AC-DX-28 (mới 2026-10-14) | 14 (400/404) | — | `customers/abc/bookings` `[KH1]`; `customers/me/bookings` `[KH1]`; `GET /api/v1/bookings?limit=2` `[KH1]` (đường cũ) | 400 `INVALID_ID`; 400 `INVALID_ID`; 404 `ROUTE_NOT_FOUND` |
| AC-DX-04 | 14 | Seed | `docker exec booking-db psql -U cab -d booking -c "table bookings"`; tương tự `payments` ở `payment-db`, `trips` ở `trip-db`; `docker compose restart booking-service payment-service trip-service` rồi đếm lại | 7, 7, 3 dòng; sau restart vẫn 7, 7, 3; `trip_status_history` 11 dòng (không nhân đôi) |
| AC-DX-05 | 15 | Seed, chưa đặt xe | A19 `{"from":[10.82,106.68],"to":[10.83,106.69]}` `[KH1]` | 201 `booking_id` 1000, `SEARCHING`, `vehicle` `CAR_4`, `pay` `CASH`, `distance_m` 2026 (± 3), **`fare` 45000**, `payment_id` 1000; Kafka UI `booking.created` có message key `1000`, không có tọa độ (AC01) |
| AC-DX-06 | 15 | Sau AC-DX-05, ≈ 1 s | A23 `GET /api/v1/offers` `[TX1]` | 200 một Offer `offer_id` 1000, `booking_id` 1000, `distance_m` 111, `PENDING`, `expires_at` ≈ +300 s, `pay` `CASH`, `fare` 45000; Kafka `booking.offer-created` có `driver_id` 11 (AC03, AC05; TX2 xe máy, TX5 Offline, TX6 bận, TX8 xa đều bị loại) |
| AC-DX-07 | 15 (AC26) | — | A30 `payments/1000` `[KH1]`; A19 thêm `"vehicle":"motorbike"`; thêm `"vehicle":"CAR_7"` | 200 `CASH`, `PENDING`, `amount` 45000, `fare` `{2026, 20000, 12000, 30000}`, không `expires_at`; 201 `fare` 21000; 201 `fare` 56000 |
| AC-DX-08 | 15 (AC21) | — | A19 thêm `"pay":"online","vehicle":"CAR_7"` `[KH2]`; ≈ 2 s sau A23 `[TX4]` | 201 `PENDING_PAYMENT`, `payment_expires_at` ≈ +600 s; A23 TX4 **không** có Offer cho booking đó (BRULE13) |
| AC-DX-09 | 15 (400) | — | A19 thiếu `to`; `from: [10.82]`; `from: "10.82,106.68"`; `from: [91,106.68]`; `to` = `from`; `vehicle: "BUS"`; `pay: "CARD"`; thêm `"customer_id":2`; `"from_address":"<b>x</b>"` | 400 `INVALID_INPUT`; `INVALID_INPUT`; `INVALID_INPUT`; `INVALID_COORDINATES`; `SAME_PICKUP_AND_DESTINATION`; `INVALID_INPUT`; `INVALID_INPUT`; `INVALID_INPUT`; `TEXT_CONTAINS_HTML` (AC02); số dòng `bookings` không tăng |
| AC-DX-10 | 15, 28 (401/403) | — | A19 không token; `[TX1]` **không body**; `[AD1]` | 401 `TOKEN_MISSING`; 403 `FORBIDDEN` (role trước body); 403 `FORBIDDEN` |
| AC-DX-11 | 15 (Q56) | Token KH3 (chưa có hồ sơ) | A19 tuyến mẫu | 201 `SEARCHING` |
| AC-DX-12 | 15 (503) | `docker compose stop payment-service` | A19 `[KH1]` | 503 `SERVICE_UNAVAILABLE`; `bookings` không có dòng mới. `start` lại → A19 → 201 |
| AC-DX-13 | 15 (AC07, AC23) | Booking CASH mới của KH1, Offer `PENDING` cho TX1 | A25 `PATCH /api/v1/offers/{id}` `{"status":"REJECTED"}` `[TX1]`; ≈ 1 s sau A23 `[TX3]`; A23 `[TX1]`; A30 thanh toán của booking | 200 `REJECTED`; TX3 có Offer cùng booking, `distance_m` 334; TX1 `data: []`; Payment vẫn `PENDING` (không hoàn — BRULE15); topic `booking.no-driver-found` không có message mới |
| AC-DX-14 | 15 (B10) | TX1, TX3 rảnh, không Offer chờ | A19 `[KH1]` rồi A19 `[KH2]` (tuyến mẫu, `CAR_4`) | Booking thứ nhất mời TX1, thứ hai mời TX3 (TX1 đã có Offer chờ) |
| AC-DX-15 | 15 (AC09) | — | A19 `{"from":[10.90,106.68],"to":[10.91,106.69]}` `[KH1]`; ≈ 1 s sau A21 booking đó | 201 `SEARCHING`; 200 `NO_DRIVER_FOUND`; Kafka `booking.no-driver-found` `offers_tried` 0 |
| AC-DX-16 | 15 (AC08) | `.env`: `OFFER_TIMEOUT_SECONDS=5`, `docker compose up -d` | A19 tuyến mẫu; chờ 7 s; A23 `?status=EXPIRED` `[TX1]`; A23 `[TX3]`; A24 Offer cũ của TX1 | Offer TX1 `EXPIRED`; TX3 có Offer mới; 409 `INVALID_STATUS_TRANSITION`. (Trước khi tiến trình kịp chạy, A24 Offer quá hạn → 409 `OFFER_EXPIRED`.) Trả `.env` về 300 |
| AC-DX-17 | 15 (Q24) | `docker compose stop driver-service` | A19 tuyến mẫu; chờ **8 s** (đổi 2026-10-21: mỗi lần S2 chờ tới hết deadline 1 s do `waitForReady`, spec 00 H14); A21 | 201 `SEARCHING`; `NO_DRIVER_FOUND`; Kafka K3. `start` lại |
| AC-DX-18 | 15 (NFR15) | Booking `SEARCHING` có Offer `PENDING` (AC-DX-05) | `docker compose restart booking-service`; A23 `[TX1]` | Offer cũ vẫn `PENDING`; không có Offer thứ hai cho booking đó |
| AC-DX-19 | 16 (AC06) | Sau AC-DX-06 (trong 300 s) | A24 `PATCH /api/v1/offers/1000` `{"status":"ACCEPTED"}` `[TX1]` | 200 `{ offer_id: 1000, status: ACCEPTED, booking_id: 1000, booking_status: DRIVER_ASSIGNED, trip_id: 1000, trip_status: ACCEPTED }`; A21 1000 có `driver_id` 11, `trip_id` 1000; A14 `drivers/11` `[AD1]` `status` `BUSY`; `table trips` ở `trip-db` có trip 1000 `ACCEPTED`, `fare_amount` 45000, `payment_method` `CASH`; `trip_status_history` 1 dòng; Kafka `trip.status-changed` key `1000`, `status` `ACCEPTED` |
| AC-DX-20 | 16 (409/403/404/400) | Sau AC-DX-19 | A24 lại; A24 Offer của TX1 bằng `[TX3]`; `offers/999`; `offers/abc`; `{"status":"PENDING"}`; body rỗng; `[KH1]` | 409 `INVALID_STATUS_TRANSITION`; 403 `NOT_OWNER`; 404 `OFFER_NOT_FOUND`; 400 `INVALID_ID`; 400 `INVALID_INPUT` ×2; 403 `FORBIDDEN` |
| AC-DX-21 | 16 (Q35) | Offer `PENDING` của TX1; `docker compose stop trip-service` | A24 `[TX1]`; A14 `drivers/11` `[AD1]`; `start trip-service`; A24 lại | 503; TX1 `ONLINE` (đã nhả), Offer vẫn `PENDING`, booking `SEARCHING`; lần hai 200 có `trip_id` |
| AC-DX-22 | 16 (D8) | Offer `PENDING` của TX1 | A39 `PATCH /api/v1/drivers/me` `{"status":"OFFLINE"}` `[TX1]`; A24 | 200 `OFFLINE`; 409 `DRIVER_NOT_AVAILABLE`; Offer vẫn `PENDING` (DX-Q6). Bật lại `ONLINE` |
| AC-DX-23 | 16 (gRPC nội bộ) | Test gọi thẳng `driver-service:50053` trong mạng Compose (cổng riêng từ 2026-10-05, ADR-020) | `ReserveDriver(11, B)` hai lần; `ReserveDriver(11, B2)`; `ReleaseDriver(11, B2)`; `ReleaseDriver(11, B)`; gọi không có `x-role` / với `x-role: customer` | `BUSY` cả hai lần, **cả hai lần có `driver_name: "Tài Xế 1"`, `plate: "59A-00001"`** (đổi 2026-10-21, DX25); `DRIVER_NOT_AVAILABLE`; `released: false`; `released: true`, TX1 `ONLINE`; `IDENTITY_MISSING` / `FORBIDDEN` |
| AC-DX-24 | 16 (T1) | Gọi thẳng `trip-service` | `CreateTrip` hai lần cùng `booking_id`, cùng `driver_id`; lần ba khác `driver_id`; gọi không có `x-role`; với `x-role: customer`; (thêm 2026-10-21) thiếu hoặc rỗng `driver_name` / `driver_plate` | Cùng `trip_id`, `created` true rồi false, Kafka chỉ **một** message `ACCEPTED`; `FAILED_PRECONDITION` `BOOKING_ALREADY_ASSIGNED`; `UNAUTHENTICATED` `IDENTITY_MISSING`; `PERMISSION_DENIED` `FORBIDDEN` (DX22); `INVALID_ARGUMENT` `INVALID_INPUT`, không tạo Trip. Dòng `trips` đã tạo có `driver_name`, `driver_plate` đúng giá trị gửi (DX25) |
| AC-DX-25 | 12 / 21 | A21 | `bookings/7` `[KH1]`; `bookings/3` `[KH1]`; `bookings/7` `[AD1]`; `bookings/7` `[KH2]`; `bookings/999` `[KH1]`; `bookings/abc`; `[TX1]` | 200 `PENDING_PAYMENT`, `CAR_7`, `ONLINE`, `fare` 56000, `payment_id` 7, **không** có `payment_expires_at` (DX19); 200 `DRIVER_ASSIGNED`, `driver_id` 11, `trip_id` 3; 200; 403 `NOT_OWNER`; 404 `BOOKING_NOT_FOUND`; 400 `INVALID_ID`; 403 `FORBIDDEN` |
| AC-TT-01 | 19 | Seed B7 | A31 `POST /api/v1/payments/7/transactions` `[KH1]`, `Idempotency-Key: k1`, `{"simulate_result":"MANUAL"}` | 200 `{ payment_id: 7, status: PENDING, txn_id: "SIM-7-1", txn_status: PENDING, attempt_no: 1, attempts_left: 2, expires_at }`; topic `payment.status-changed` **không** có message mới; A21 `bookings/7` vẫn `PENDING_PAYMENT` |
| AC-TT-02 | 19 (AC12, AC21) | Sau AC-TT-01 | A32 `POST /api/v1/payment-callbacks`, không token, `X-Callback-Secret:<khóa trong .env>`, `{"txn_id":"SIM-7-1"}`; ≈ 1 s sau A21 `bookings/7`, A23 `[TX4]` | 200 `{ txn_id: "SIM-7-1", txn_status: SUCCEEDED, payment_id: 7, status: COMPLETED }`; Kafka K6 key `7` `COMPLETED`, `previous_status` `PENDING`; booking 7 `SEARCHING`; TX4 có Offer cho booking 7, `distance_m` 445 |
| AC-TT-03 | 30 | Sau AC-TT-02 | Gửi lại **y hệt** AC-TT-01 | 200 body **y hệt** AC-TT-01 (`PENDING`), header `Idempotency-Replayed: true`; `payment_transactions` của payment 7 vẫn 1 dòng |
| AC-TT-04 | 30 | Sau AC-TT-03 | Gửi lại y hệt AC-TT-02 | 200 body y hệt, `Idempotency-Replayed: true`; số message ở `payment.status-changed` **không** tăng |
| AC-TT-05 | 30 | Sau AC-TT-04 | A30 `payments/7` `[KH1]` | 200 `COMPLETED`, `amount` 56000, `fare` `{2026, 25000, 15000, 40000}`, `paid_at`; `transactions` đúng **một** `{SIM-7-1, CHARGE, 1, SUCCEEDED, 56000}`; không field thẻ |
| AC-TT-06 | 30 (409/400) | Sau AC-TT-05 | A31 `k1` với `{"simulate_result":"FAILED"}`; A31 `k1` với `{"simulate_result":"manual"}`; A31 `k2` body rỗng; A31 không header | 409 `IDEMPOTENCY_KEY_REUSED`; 200 replay (chữ thường chuẩn hóa thành `MANUAL` — cùng nội dung); 409 `PAYMENT_ALREADY_COMPLETED`; 400 `IDEMPOTENCY_KEY_REQUIRED` |
| AC-TT-07 | 19 (mặc định) | Booking `ONLINE` `CAR_4` mới của KH1 (payment P) | A31 `payments/P/transactions`, `k1`, body rỗng | 200 `COMPLETED`, `txn_id` `SIM-P-1`, `SUCCEEDED`; ≈ 1 s sau booking `SEARCHING` và có Offer |
| AC-TT-08 | 19 (AC13, AC25) | Booking `ONLINE` mới (payment Q) | A31 `k1` `FAILED`; `k2` `FAILED`; `k3` `FAILED`; ≈ 1 s sau A21; A31 `k4` | 200 `FAILED` (`attempts_left` 2); 200 `FAILED` (1); 200 **`CANCELED`** (0); Kafka K6 `FAILED`, `FAILED`, `CANCELED` (`ATTEMPTS_EXHAUSTED`) và `booking.canceled` (`canceled_by` `system`); booking `CANCELED`, `cancel_reason` `ATTEMPTS_EXHAUSTED`; 409 `PAYMENT_ATTEMPTS_EXHAUSTED`. Giữa lần 1 và 2: booking vẫn `PENDING_PAYMENT` (B16) |
| AC-TT-09 | 19 | Booking `ONLINE` mới (payment R) | A31 `k1` `MANUAL`; A31 `k2` body rỗng; A32 `{"txn_id":"SIM-R-1","result":"FAILED"}` (thay R bằng số); A31 `k2` body rỗng | 200 `PENDING`; 409 `PAYMENT_IN_PROGRESS`; 200 `txn_status` `FAILED`, `status` `FAILED`; 200 `COMPLETED`, `attempt_no` 2 (khóa `k2` bị từ chối trước đó không được lưu — DX9) |
| AC-TT-10 | 19 (AC25, M11) | `.env`: `PAYMENT_TIMEOUT_SECONDS=5`, `up -d`; booking `ONLINE` mới (payment S) | A31 `k1` `MANUAL`; chờ 7 s; A30; A21; A31 `k2`; A32 `{"txn_id":"SIM-S-1"}`; A30 | 200 `PENDING`; `CANCELED` `status_reason` `PAYMENT_EXPIRED`; booking `CANCELED` (`system`); 409 `PAYMENT_EXPIRED`; 200 `txn_status` `SUCCEEDED`, `status` **`REFUNDED`**; `transactions` có `SIM-S-1` `SUCCEEDED` và `SIM-R-S` `REFUND`. Trả `.env` về 600 |
| AC-TT-11 | 19 (401/404/400) | — | A32 `X-Callback-Secret: sai`; không header; `{"txn_id":"SIM-999-1"}`; `{}`; `{"txn_id":"SIM-7-1","result":"OK"}`; `{"txn_id":"SIM-7-1","amount":1}` | 401 `INVALID_CALLBACK_SECRET` ×2; 404 `TRANSACTION_NOT_FOUND`; 400 `INVALID_INPUT` ×3 |
| AC-TT-12 | 19, 30 (403/404/409) | — | A30, A31 `payments/7` `[KH2]`; `payments/999` `[KH1]`; `payments/abc`; A30 `[TX1]`; A30 `[AD1]`; A31 `[AD1]`; A31 thanh toán `CASH` của AC-DX-05; A31 `{"simulate_result":"X"}` | 403 `NOT_OWNER` ×2; 404 `PAYMENT_NOT_FOUND`; 400 `INVALID_ID`; 403 `FORBIDDEN`; 200; 403 `FORBIDDEN`; 409 `PAYMENT_NOT_ONLINE`; 400 `INVALID_INPUT` |
| AC-TT-13 | 30 (NFR05) | `docker compose stop booking-service` | A31 trên một payment `ONLINE` `PENDING` (khóa mới); `start booking-service`; ≈ 2 s sau A21 | 200 `COMPLETED` (Payment không lỗi theo Booking); booking `SEARCHING` (K6 được xử lý khi Booking chạy lại) |
| AC-TT-14 | 7 | Sau các AC trên | Kafka UI xem một message mỗi topic K1–K6 | Đúng phong bì `event_id`, `event_type` = tên topic, `occurred_at`, `data` theo mục 6; không họ tên, số điện thoại, tọa độ, địa chỉ |

Tổng: **42 tiêu chí** (28 AC-DX, 14 AC-TT) — thêm AC-DX-26 … 28 ngày 2026-10-14.

Chuỗi gõ tay khi thi (khớp 06 mục 14, 15, 16, 19, 30 và 04 mục 5; dùng lại tab; `(…)` = tùy chọn; thời gian gồm cả giải thích theo 06 mục 5):

| Mục | Request | Kết quả | Thời gian |
|---|---|---|---|
| 14 (**đổi 2026-10-14**) | Tab GET (mục 13, `[KH1]`): `drivers?…` → `customers/1/bookings?limit=2` → thêm `&page=2` → sửa `customers/1` thành `customers/2` → (tab admin `[AD1]`: `customers/1/bookings?limit=2`) | 7, 6; `total` 7, `total_pages` 4; 5, 4; 403 `NOT_OWNER`; (200 như request 1) | ~22 s, Ổn |
| 15 | `POST localhost:3000/api/v1/bookings` `[KH1]` `{"from":[10.82,106.68],"to":[10.83,106.69]}` (**tab đặt xe**) → nhân bản tab: `GET`, URL `offers`, `[TX1]` (**tab chuyến**) | 201 `SEARCHING`, `CAR_4`, `CASH`, **`fare` 45000**, `booking_id` 1000; 200 Offer 1000 `PENDING`, `distance_m` 111 | ~32 s, **Sát** |
| 16 | Tab chuyến: `PATCH`, URL `offers/1000`, body `{"status":"ACCEPTED"}` → (tab GET `notifications` — spec Notification) | 200 `ACCEPTED`, `DRIVER_ASSIGNED`, **`trip_id` 1000** | ~18 s, Ổn |
| 19 | `POST localhost:3000/api/v1/payments/7/transactions` `[KH1]`, `Idempotency-Key:k1`, `{"simulate_result":"MANUAL"}` → nhân bản: URL `payment-callbacks`, **No Auth**, `X-Callback-Secret:<khóa trong .env>`, `{"txn_id":"SIM-7-1"}` → (tab GET `bookings/7`) | 200 `PENDING`, `SIM-7-1`; 200 `SUCCEEDED`, **`COMPLETED`**; (`SEARCHING`) | ~42 s, **Vượt** (Q64); dự phòng: chỉ request 1, bỏ body → 200 `COMPLETED` ~25 s |
| 30 | Tab 1 mục 19 → Send; tab 2 → Send; sửa tab 1: `GET`, bỏ `/transactions` | Body y hệt + `Idempotency-Replayed: true` (hai lần); `COMPLETED`, đúng một `SIM-7-1` | ~22 s, Ổn |

Ràng buộc thứ tự: 13, 14 trước 15 (TX1 rảnh, `total` 7); 16 trong 300 s sau 15; **19 → 30 liền nhau** (sau 300 s không ai nhận B7 thì `NO_DRIVER_FOUND`, Payment 7 sẽ `REFUNDED` khi spec 18 xong); 15 dùng TX1 (`CAR_4`), 19 dùng TX4 (`CAR_7`) nên không tranh nhau.

Kết quả mong đợi theo phiếu chấm: **14** — booking theo mã khách (`customers/{id}/bookings`), khách chỉ mã của mình (mã khác 403), admin mọi mã, `limit` + `page` + `total`, seed 7 booking; **15** — đặt xe trả cước cố định ngay, tài xế rảnh gần nhất đúng loại xe nhận Offer (thấy bằng A23 và trên Kafka UI); **16** — tài xế nhận → booking `DRIVER_ASSIGNED`, có `trip_id`, Trip `ACCEPTED`, event K5; **19** — thanh toán online, callback từ ngoài → Payment `COMPLETED`, booking chuyển sang tìm tài xế; **30** — gửi lại thanh toán hoặc callback → response cũ, không giao dịch / event mới.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Hai A24 đồng thời cho hai Offer khác nhau của cùng tài xế | B10 không cho tồn tại; `ReserveDriver` một lệnh đã chặn |
| Hai A31 đồng thời cùng khóa → một 200, một 409 | PK `idempotency_keys` bảo đảm |
| Hai callback đồng thời cùng `txn_id` → một xử lý, một replay | `FOR UPDATE` trên giao dịch |
| Kafka dừng lúc callback → 200, log `EVENT_PUBLISH_FAILED`; booking kẹt `PENDING_PAYMENT` | Rủi ro đã chấp nhận (ADR-017); không demo |
| `SIMULATION_MODE=false` → `simulate_result` bị bỏ qua | Chế độ chạy thật; không chấm |
| Booking nhận K6 lặp (gửi tay message trùng) → không đổi gì | Bước chuyển có điều kiện `WHERE status = 'PENDING_PAYMENT'` |
| Unit test `domain/fare.js` (6 ví dụ 03 mục 6.3) và `domain/distance.js` (P0 → D0 ≈ 1 559 m → 2 026 m) | Test-agent làm ở unit test |
| Hơn 50 ứng viên trong 1 km | Không có ở seed |
| Payment mồ côi khi `INSERT bookings` lỗi sau S4 | Chỉ khi database Booking hỏng đúng lúc; log là đủ |
| Notification lưu thông báo từ K1–K6; Payment hoàn tiền khi nhận K3; tiền mặt `COMPLETED` khi chuyến xong | Spec Notification, 17, 18 |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| DX1 | `AcceptOffer` giữ khóa dòng Booking trong lúc gọi S3, S5 | Tranh chấp hủy — nhận giải bằng một khóa (B12), không thêm trạng thái trung gian | Mục 2.3, 5.6; thêm trạng thái `ACCEPTING` |
| DX2 | Danh tính nội bộ `x-role: system` (chốt TX-Q3 theo (a)) | Một quy tắc kiểm `x-role` cho mọi rpc | Mục 5.5; driver, payment, trip |
| DX3 | Bộ ghép gọi S2 `page=1`, `limit=50` mỗi vòng, tự loại người đã mời | Danh sách mới nhất mỗi vòng (BRULE01); Driver không cần biết lịch sử Offer | Mục 5.6 |
| DX4 | Tiến trình nền (hết hạn Offer, hết hạn thanh toán) chạy mỗi 1 giây (hằng số) | Event "hết hạn" đến trong ~1 giây như mọi thứ khác | Mục 5.6, 5.7 |
| DX5 | Offer hết hạn → luôn gọi `ReleaseDriver` (lặp an toàn) | Dọn trường hợp nhận dở dang (S3 xong, S5 lỗi, nhả lỗi) mà không cần `GetTripByBooking` | Mục 5.6 |
| DX6 | `ReleaseDriver` trả tài xế về `ONLINE`; không có / không khớp → `released: false`, không lỗi | Trước khi giữ tài xế đang `ONLINE`; gọi lặp không được lỗi (D9) | Mục 5.4 |
| DX7 | S2 lỗi → thử 3 lần cách 1 giây rồi `NO_DRIVER_FOUND` + K3 | Đề xuất của Q24; booking không treo, khách được hoàn tiền | Mục 2.2, 5.6 |
| DX8 | Kiểm chủ (404 → 403) **trước** tra khóa chống lặp | Khóa có phạm vi theo thanh toán; người khác không đọc được response đã lưu bằng cách đoán khóa | Mục 4.8 |
| DX9 | Chỉ lưu response **thành công** vào `idempotency_keys`; lỗi thì rollback cả khóa | Không phải nhớ mã HTTP lỗi; client sửa lỗi rồi dùng lại khóa | Mục 4.8 |
| DX10 | Lần thử thứ 3 thất bại phát **một** K6 `CANCELED` (`ATTEMPTS_EXHAUSTED`), không kèm K6 `FAILED` | Booking chỉ cần `CANCELED`; Notification báo "hết lượt" một lần | Mục 5.7 |
| DX11 | Mã lỗi mới `PAYMENT_CANCELED` (409): trả cho thanh toán bị hủy vì booking hủy / không có tài xế / chuyến hủy | 04 mục 1.1 chưa có mã cho trường hợp này | Mục 4.8; 04 mục 1.1 |
| DX12 | Thêm CHECK: `canceled_by` đi cùng `CANCELED`; `paid_at` / `refunded_at` theo trạng thái; `status_reason` chỉ khi `CANCELED` / `REFUNDED`; `callback_response` NULL đúng khi `PENDING` | Database tự chặn dữ liệu mâu thuẫn, như TX6 | Mục 7.1, 7.2 |
| DX13 | Thêm index `driver_offers (driver_id, created_at DESC)` | A23 lọc trạng thái khác `PENDING` | Mục 7.1 |
| DX14 | `replayed` là field trong response gRPC, Gateway đổi thành header | Dễ cài và giải thích hơn metadata gRPC phản hồi | Mục 4.1, 5.2 |
| DX15 | `amount` lệch ở callback → `INVALID_INPUT` (không thêm mã) | Ít mã lỗi; đường lỗi hiếm | Mục 4.9 |
| DX16 | Seed `created_at` của Bn = lúc seed − (8 − n) giờ | Thứ tự mục 14 cố định 7, 6, 5, 4 | Mục 7.4 |
| DX17 | `CreateTrip` ghi lịch sử đầu với `changed_by` = tài xế, role `driver` | Người khiến chuyến ra đời là tài xế bấm nhận; CHECK chỉ có `customer` / `driver` | Mục 5.3 |
| DX18 | Migration `trips` tạo đủ cột của spec 17, 18 ngay | Một bảng một migration; spec sau chỉ thêm code | Mục 7.3 |
| DX19 | **A21 không trả `payment_expires_at`** (sinh viên chốt 2026-10-05). Hạn thanh toán xem ở A19 (lúc đặt) và A30 (`expires_at`) | Booking không lưu hạn thanh toán; muốn trả ở A21 thì phải lưu trùng cột của Payment hoặc gọi thêm S4 mỗi lần xem | Mục 4.4, 5.1, AC-DX-25 |
| DX20 | **A24 khi S3 lỗi** (sinh viên chốt 2026-10-05): S3 trả `FAILED_PRECONDITION` **hoặc `NOT_FOUND`** → 409 `DRIVER_NOT_AVAILABLE`. S3 lỗi hạ tầng / quá deadline → gọi `ReleaseDriver` phòng khi (không biết đã giữ hay chưa) rồi 503 `SERVICE_UNAVAILABLE`; Offer vẫn `PENDING` | `ReleaseDriver` lặp an toàn (DX6) nên gọi thừa không hại; tài xế không bị kẹt `BUSY` nếu lần giữ thực ra đã thành công | Mục 2.3, 5.6 |
| DX21 | **Chống lặp A31 so đúng body đã gửi** (sinh viên chốt 2026-10-05): body rỗng (hash của `{}`) và `{"simulate_result":"SUCCESS"}` là **hai nội dung khác nhau** → cùng khóa thì 409 `IDEMPOTENCY_KEY_REUSED`. Chỉ chuẩn hóa chữ hoa / thứ tự khóa / khoảng trắng, **không** điền giá trị mặc định trước khi băm | Đúng định nghĩa "cùng request" của 04 mục 1.4; không phải đoán ý client | Mục 4.8 bước 3 |
| DX23 (2026-10-14) | A20: khách gọi mã khác → 403 `NOT_OWNER` **trước khi đọc database** | Mã khách dễ đoán; không lộ "khách này có booking không" — cùng quy tắc A09, A14 | Mục 4.3 |
| DX24 (2026-10-14) | A20: admin hỏi mã không có booking → 200 rỗng, **không 404** | Booking không biết khách nào tồn tại; gọi Customer để kiểm thì thêm một đường giao tiếp không FR nào cần (Q56) | Mục 4.3 |
| DX25 (2026-10-21, sinh viên chốt) | **Chụp họ tên, biển số tài xế lúc nhận chuyến:** S3 `ReserveDriver` trả `driver_name`, `plate`; Booking chép vào S5 `CreateTrip`; Trip lưu ở `trips.driver_name`, `driver_plate` và trả ở A27 (spec 17-18 CD10) | Khách cần biết ai tới đón (FR14) mà không được xem A14 (góp ý 2026-10-14). Biển số của xe đã chạy chuyến là dữ liệu lịch sử. Không thêm đường giao tiếp, không gọi Driver mỗi lần xem chuyến (bỏ S6) | Đánh đổi: tài xế đổi tên / xe sau đó thì chuyến cũ giữ giá trị cũ (đúng nghĩa lịch sử); họ tên tài xế nằm thêm ở `trip-db` (lưu rõ, như ở `driver-db`). Mục 2.3, 5.3, 5.4, 6 |
| DX22 | **rpc nội bộ gọi thiếu `x-role`** (`CreatePayment`, `CreateTrip`, `ReserveDriver`, `ReleaseDriver`) → `UNAUTHENTICATED` `IDENTITY_MISSING`; `x-role` sai → `PERMISSION_DENIED` `FORBIDDEN` (sinh viên chốt 2026-10-05, đồng nhất với AC-DX-23 và code) | Một quy tắc cho mọi rpc: thiếu danh tính khác sai quyền, như 401 / 403 ở Gateway | Mục 5.2–5.5, AC-DX-23, AC-DX-24 |

### 9.2 Chỗ thiết kế chưa khớp hoặc thiếu (ghi lại, không tự sửa design)

| # | Chỗ | Ghi chú | Spec theo |
|---|---|---|---|
| DX-M1 | Spec 12-13-21-23 (đang code song song) ghi `FindNearbyDrivers` chỉ nhận `customer`, `admin` | Spec này thêm `system` (mục 5.4) — **dev-agent phải sửa danh sách role ở `driver-service`** khi làm spec này | Mục 5.4 |
| DX-M2 | 04 mục 1.1 thiếu mã cho "thanh toán đã bị hủy vì booking / chuyến" | Thêm `PAYMENT_CANCELED` (DX11) | Mục 4.8 |
| DX-M3 | 04 A31, A32 trả **200** trong khi R7 coi mỗi lần thanh toán / callback là tài nguyên được tạo, và A07 đã chốt 201 theo cùng lý do | Spec giữ 200 theo 04, 06 (đã học thuộc) — xem DX-Q2 | 200 |
| DX-M4 | 04 mục 1.4 "trả đúng response lần đầu (cùng mã HTTP)" không nói response **lỗi** có được lưu không | DX9: chỉ lưu thành công | Mục 4.8 |
| DX-M5 | 02 Q35 đề xuất Booking hỏi Trip theo `booking_id` (`GetTripByBooking`) khi Offer hết hạn | Spec **không** thêm rpc; dùng `CreateTrip` lặp an toàn + `ReleaseDriver` khi hết hạn (DX5). Còn rủi ro Trip mồ côi khi commit Booking lỗi sau S5 (DX-Q4) | Mục 5.6 |
| DX-M6 | 01 M12 không nói lần thử cuối thất bại phát `FAILED` rồi `CANCELED` hay chỉ `CANCELED` | DX10 | Mục 5.7 |
| DX-M7 | 02 S2 có tham số "bán kính" (đã ghi TX-M2) | Không có | — |
| DX-M8 | 03 mục 14 không nói `created_at` của seed booking | DX16 | Mục 7.4 |
| DX-M9 | 02 K4 thiếu field `reason` khi hệ thống hủy | Thêm `reason` mang **mã** hệ thống (không phải văn bản người dùng) | Mục 6 |

### 9.3 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| DX-Q1 | Chốt TX-Q3: lời gọi service → service mang danh tính gì? | (a) `x-role: system`; (b) rpc nội bộ riêng; (c) không kiểm | **Đã chốt (a)** (sinh viên 2026-10-04) | SV |
| DX-Q2 | A31, A32 trả 200 hay 201? | (a) Giữ 200 (response mô tả **trạng thái thanh toán**, không phải bản ghi giao dịch; 06 đã học thuộc); (b) 201 cho đồng bộ với A07 | **Đã chốt (a)** (sinh viên 2026-10-04) | SV |
| DX-Q3 | S2 lỗi bao nhiêu lần thì kết luận không tìm được tài xế (Q24)? | (a) 3 lần cách 1 giây rồi `NO_DRIVER_FOUND`; (b) chờ đến khi Driver chạy lại | **Đã chốt (a)** (sinh viên 2026-10-04) | SV |
| DX-Q4 | Booking chết / database lỗi **sau** khi Trip đã tạo mà chưa ghi phân công (Q35 (b)) | (a) Chấp nhận, log `ACCEPT_COMMIT_FAILED` — cùng mức rủi ro với ADR-017; (b) thêm `GetTripByBooking` để tiến trình hết hạn ghi nốt phân công | **Đã chốt (a)** (sinh viên 2026-10-04) — không xảy ra khi demo, bớt một rpc | SV |
| DX-Q5 | Mục 19 ~42 s vượt 30 giây (Q64) | (a) Chạy đủ, nói trong lúc gõ; (b) dự phòng 1 request (không `MANUAL`) | (a) giữ chuỗi đầy đủ, dự phòng (b) — **vẫn chờ hỏi giảng viên (Q64)** | GV |
| DX-Q6 | Tài xế nhận Offer nhưng không còn rảnh (đã tắt Online) | (a) 409, Offer giữ `PENDING` đến hết hạn; (b) 409 và đánh dấu Offer `REJECTED`, hỏi ngay người kế tiếp | **Đã chốt (a)** (sinh viên 2026-10-04) — đơn giản; tài xế bật lại là nhận được | SV |
| DX-Q7 | `OFFER_TIMEOUT_SECONDS` 300 s (demo) so với giá trị nghiệp vụ 20 s (Q12) | Giữ 300 trong `.env.example` | **Đã chốt: giữ 300** (sinh viên 2026-10-04) — đổi bằng `.env` khi cần | SV |
