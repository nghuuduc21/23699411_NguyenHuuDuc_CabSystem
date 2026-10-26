# Lộ trình 3 ngày: đọc code và hiểu sâu hệ thống

> Viết 2026-10-26. Ba ngày 26, 27, 28/10, mỗi ngày **5 giờ** (tổng 15 giờ). Ngày 29/10 thi thử với Claude, trước khi gói Pro hết hạn 30/10.
> Nguyên tắc: **đọc code → chạy thử → tự nói lại không nhìn**. Không nói lại được thì chưa hiểu, đọc lại.
> Tài liệu đi kèm: `02-cam-nang-he-thong.md` (gọi tắt **CN**), `03-luyen-tap-postman.md`, `docs/design/06-kich-ban-thi.md`.

Mỗi khối có ba phần: **Đọc** (file:dòng), **Làm** (thao tác chứng minh), **Tự kiểm** (câu hỏi kiểu thầy, trả lời to thành tiếng).

---

## Ngày 1 — Khung hệ thống và đường đi của một request (5 giờ)

Mục chấm liên quan: 1–8, 9–10, 24–28.

### Khối 1.1 — Bức tranh và hạ tầng (1 giờ)

**Đọc:** CN mục 1–3; `compose.yaml` (lướt cả file, dừng ở `ports`, `depends_on`, `healthcheck`, `environment`); ảnh `docs/architecture/kien-truc.png`.

**Làm:**
- `docker compose ps -a` → đếm 21 container, nói vai trò từng nhóm (8 service, 7 PostgreSQL, 1 MongoDB, Redis, Kafka, kafka-init, Kafka UI, Gateway).
- `curl localhost:3000/health/services`; `curl localhost:50052` → bị từ chối (vì sao?).

**Tự kiểm:**
1. Vì sao chỉ `gateway` và `kafka-ui` có `ports`?
2. `depends_on: condition: service_healthy` để làm gì? Bỏ đi thì chuyện gì xảy ra lúc khởi động?
3. Vì sao Notification dùng MongoDB, các service khác dùng PostgreSQL?

### Khối 1.2 — Một service khởi động (1 giờ)

**Đọc:** CN mục 5; `services/customer-service/src/index.js` (từ trên xuống), `config.js`, `migrate.js`, `seed.js`, `health.js`.

**Làm:** `docker compose restart customer-service` rồi `docker compose logs customer-service --tail 20` → chỉ ra từng dòng log ứng với bước nào trong `index.js`.

**Tự kiểm:**
1. Thứ tự: đọc cấu hình → migrate → seed → mở gRPC. Vì sao migrate phải trước khi mở cổng?
2. Thiếu `CUSTOMER_DATA_KEY` thì sao? (thử: `docker compose run --rm --no-deps -e CUSTOMER_DATA_KEY= customer-service`)
3. Migration đã chạy rồi có chạy lại không? Nhìn bảng nào để biết?

### Khối 1.3 — Gateway: đường đi của request (1,5 giờ) ⭐ quan trọng nhất

**Đọc:**
- `services/gateway/src/app.js:96-137` — hàm `wrap()`, thứ tự kiểm tra.
- `routes.js` — bảng route (mỗi dòng: `code`, `method`, `path`, `roles`, `rpc`, `handler`).
- `token.js:14-60` — đọc `Bearer`, `jwt.verify` HS256, danh sách thu hồi.
- `rate-limit.js`, `redis.js:50-70`.
- `handlers/customers.js:20-44`, `grpc/clients.js:96-130` (`buildMetadata`, `callUnary`, deadline 3 s, `waitForReady`), `grpc/errors.js`.

**Làm (bài thực hành Buổi 1):** đoán trước status và **file:dòng** rồi mới Send:

| # | Request | Đáp án (che lại khi tự làm) |
|---|---|---|
| a | KH1 `GET /api/v1/customers/1` | 200 — `customers.js:60` (service) |
| b | KH1 `GET /api/v1/customers/2` | 403 `NOT_OWNER` — `customer-service/src/domain/customers.js:66` |
| c | KH1 `GET /api/v1/customers/abc` | 400 — `app.js:113` `validateParams`, **không** tới service |
| d | Không token | 401 `TOKEN_MISSING` — `token.js:15` |
| e | TX1 `GET /api/v1/customers/1` | 403 `FORBIDDEN` — `app.js:107` (Gateway, role) |
| f | Admin `GET /api/v1/customers/2` | 200 |

Thêm: copy `X-Request-Id` → `docker compose logs gateway | findstr <mã>`.

**Tự kiểm:**
1. Vì sao (b) và (e) đều 403 mà mã lỗi khác nhau, ở hai nơi khác nhau?
2. Vì sao service kiểm `NOT_OWNER` **trước** khi đọc database?
3. Vì sao 401 đứng trước 429 trên route có token?
4. Service biết ai đang gọi bằng cách nào (không đọc token)?
5. Customer-service dừng → Gateway trả gì, sau bao lâu, dòng nào quyết định?

### Khối 1.4 — Đăng ký, đăng nhập, bảo mật (1,5 giờ)

**Đọc:**
- `services/auth-service/src/domain/auth.js` (register, login, otp, driver-register), `domain/password.js` (scrypt + salt), `domain/token.js` (ký JWT).
- `services/auth-service/migrations/` — bảng `accounts`: email UNIQUE, phone UNIQUE, CHECK theo role.
- `services/auth-service/src/domain/rules.js:32-37` — kiểm dạng email → `INVALID_EMAIL` trước khi chạm database (mục 25). Gateway (`validate.js`) chỉ kiểm hình thức body.
- `services/customer-service/src/domain/crypto.js` — AES-256-GCM.
- CN mục 12; `docs/decisions/ADR-016`, `ADR-021`, `ADR-022`.

**Làm:**
- Mục 9, 10 bằng tab trống (gõ tay).
- `docker exec auth-db psql -U cab -d auth -c "select account_id,email,phone,role,left(password_hash,30) from accounts limit 5"` → chỉ mật khẩu đã băm.
- `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` → họ tên là chuỗi mã hóa, phone rõ.
- Mục 25: login `{"email":"' OR 1=1 --","password":"x"}` → 400 `INVALID_EMAIL`; email đúng, password `' OR 1=1 --` → 401.
- Mục 27: jwt.io, sửa `role` → `admin`, **không nhập khóa** → 401 `TOKEN_INVALID`.

**Tự kiểm:**
1. Băm khác mã hóa thế nào? Vì sao mật khẩu băm, họ tên mã hóa, số điện thoại để rõ?
2. Kể cả khi Gateway không chặn email lạ, vì sao SQL injection vẫn không chạy? (gợi ý: `$1` trong `accounts-repo.js`)
3. Vì sao sửa payload trên jwt.io thì 401? Ai có `JWT_SECRET` thì sao?
4. Đăng xuất làm gì với Redis? Redis chết thì token đã đăng xuất có dùng lại được không?

---

## Ngày 2 — Luồng nghiệp vụ: đặt xe → chuyến → thanh toán (5 giờ)

Mục chấm liên quan: 11–23, 30. Đọc CN mục 8, 9, 10 trước khi bắt đầu (30 phút, tính trong khối 2.1).

### Khối 2.1 — Hợp đồng gRPC và Kafka (1 giờ)

**Đọc:** `proto/*.proto` (lướt `booking`, `trip`, `payment`, `driver`); CN mục 8 (bảng S2–S7, K1–K7); `booking-service/src/clients.js`; `booking-service/src/events.js`.

**Làm:** mở Kafka UI `localhost:8080` → cluster `cab` → Topics → đếm 7 topic, mở một message, đọc `event_id`, `type`.

**Tự kiểm:**
1. Vì sao Booking → Payment là gRPC mà Payment → Booking là Kafka?
2. Vì sao Driver nghe `trip.status-changed` qua Kafka mà không để Trip gọi gRPC?
3. Event bị gửi lặp hai lần thì sao? Notification chống lặp bằng gì?
4. Không dùng outbox: rủi ro là gì?

### Khối 2.2 — Đặt xe và ghép tài xế (1,5 giờ)

**Đọc:**
- `booking-service/src/domain/bookings.js:61` `createBooking` → `distance.js` (× 1,3) → gọi `CreatePayment` (S4).
- `payment-service/src/domain/fare.js` (công thức cước, làm tròn 1.000 đ, tối thiểu).
- `bookings.js:298` `onPaymentStatusChanged` → `dispatcher.js` (S2 `FindNearbyDrivers`, bán kính 1 km, gần nhất trước) → tạo offer.
- `bookings.js:181` `acceptOffer` → S3 `ReserveDriver` → S5 `CreateTrip` (mang `driver_name`, `driver_plate`).
- `bookings.js:247` `rejectOffer`; `dispatcher.js:99` `expireOffers`.

**Làm:** mục 14 → 15 → 16 theo `03-luyen-tap-postman.md`. Sau mỗi bước: xem Kafka UI có event gì; `docker exec booking-db psql -U cab -d booking -c "select booking_id,status from bookings order by booking_id desc limit 3"`.

**Tự kiểm:**
1. Tính tay cước ô tô 4 chỗ, quãng đường thẳng 2 km.
2. Tài xế từ chối → hệ thống làm gì? Có hoàn tiền không? (BRULE15)
3. Hai tài xế cùng bấm nhận một offer cùng lúc → ai thắng, dòng nào bảo đảm?
4. Trip-service chết lúc tài xế nhận chuyến → kết quả? Vì sao chấp nhận đánh đổi đó?

### Khối 2.3 — Chuyến đi, hủy, hoàn tiền (1,5 giờ)

**Đọc:**
- `trip-service/src/domain/trips.js:144` `updateTripStatus` (máy trạng thái, `FAILED_PRECONDITION` → 409), `:170` `cancelTrip`, `:106` `getTrip` (khối `driver`).
- `booking-service` `cancelBooking` (`bookings.js:264`).
- `payment-service/src/domain/payments.js:143` `onBookingEvent` (hoàn tiền), `driver-service/src/consumer.js` (trả tài xế về ONLINE).
- `notification-service/src/domain/notifications.js`.
- CN mục 9 (máy trạng thái).

**Làm:** mục 17 (thử COMPLETED khi chưa STARTED → 409), mục 18 (hủy hai kiểu), xem thông báo `GET /api/v1/notifications`.

**Tự kiểm:**
1. Vẽ lại máy trạng thái Booking và Trip không nhìn tài liệu.
2. Khách hủy sau khi có tài xế: những service nào làm gì, theo thứ tự nào, qua gRPC hay Kafka?
3. Payment-service đang chết khi khách hủy → hủy có thành công không? Tiền hoàn lúc nào?

### Khối 2.4 — Thanh toán, đánh giá, tài xế (1 giờ)

**Đọc:**
- `payments.js:261` `payPayment`, `:342` `handleProviderCallback`, `adapters/provider-sim.js` (`MANUAL`, `FAILED`), `:370` `expireOverdue` (10 phút, 3 lần).
- `rating-service/src/domain/ratings.js` + `clients.js` (S7 `GetTripForRating`).
- `driver-service/src/domain/drivers.js` (đăng ký hồ sơ, duyệt/từ chối, nộp lại FR43, Online/Offline, tìm gần).

**Làm:** mục 19 (`MANUAL` → callback với `X-Callback-Secret`), mục 20, mục 21–23.

**Tự kiểm:**
1. `Idempotency-Key` để làm gì? Gửi lại cùng khóa thì sao?
2. "COMPLETED" ở mục 19 là trạng thái của cái gì?
3. Đánh giá chuyến chưa hoàn thành / chuyến của người khác → lỗi gì, ở đâu?

---

## Ngày 3 — Sự cố, vận hành, gõ tay theo giờ (5 giờ)

Mục chấm liên quan: 4–8, 29 và toàn bộ 30 mục.

### Khối 3.1 — Tình huống sự cố, góc nhìn DevOps (1,5 giờ)

**Đọc:** CN mục 13 và 14.

**Làm:** mỗi tình huống: **đoán → làm → xem log → giải thích**.

| Tình huống | Lệnh |
|---|---|
| Một service chết | `docker compose stop rating-service` → `/health/services`, `/ready`, gọi API của nó (503 sau ~3 s) → `start` |
| Payment chết lúc đặt xe | `stop payment-service` → đặt xe → 503; các API khác vẫn chạy |
| Payment chết lúc hủy | hủy booking đã trả tiền → 200; `start payment-service` → xem hoàn tiền được xử lý |
| Redis chết | `stop redis` → API vẫn chạy, không có header `RateLimit-*`, log cảnh báo |
| Kafka chết | `stop kafka` → đặt xe điện tử: chuyện gì xảy ra? |
| Rate limit | mục 29: gửi login liên tục → 429, đọc header `RateLimit-Remaining` |

**Tự kiểm:** với mỗi tình huống, trả lời "người dùng thấy gì, hệ thống tự phục hồi thế nào, dữ liệu có mất không".

### Khối 3.2 — Gõ tay có bấm giờ (2,5 giờ)

Theo **cấp 3** của `03-luyen-tap-postman.md`: xóa environment, tab trống, gõ tay, bấm giờ từng mục, vừa làm vừa nói. Ghi lại mục quá 30 giây và tập lại riêng.

### Khối 3.3 — Tổng ôn (1 giờ)

- Trả lời 15 câu ở CN mục 15, không nhìn.
- Mỗi mục chấm 1–30: nói một câu "code nào chạy" (file + hàm).
- Ghi danh sách câu còn yếu → mang sang buổi thi thử 29/10.

---

## Ngày 29/10 — Thi thử với Claude

Mở Claude Code, gõ: "thi thử cho tôi". Claude gọi ngẫu nhiên mục, bạn thao tác và giải thích, Claude hỏi vặn rồi chấm. Ưu tiên các câu yếu từ khối 3.3.

## Sau 30/10 (không còn Claude)

Mỗi ngày 2 giờ: 1 giờ gõ tay cấp 3, 1 giờ tự hỏi lại các khối "Tự kiểm" ở trên. Tối trước ngày thi: `docker compose down -v` → `up -d --build` → `/health/services` healthy; dừng `product-api` và dịch vụ MongoDB của Windows.
