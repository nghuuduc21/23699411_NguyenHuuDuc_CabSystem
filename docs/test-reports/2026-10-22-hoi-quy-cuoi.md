# Báo cáo kiểm thử hồi quy cuối (2026-10-22)

> Người kiểm thử: test-agent. Đối tượng: nhánh `rebuild/agent-workflow`, code `751acd6`, đặc tả `7b7d381`.
> Phạm vi: thay đổi sau báo cáo 2026-10-21. (1) A27 `GET /api/v1/trips/{id}` có khối `driver` `{driver_id, name, plate}` **chụp lúc tài xế nhận** (spec 17-18 CD10, spec 14-15-16-19-30 DX25); S6 `GetDriverSummary` bỏ hẳn. (2) Mọi lời gọi gRPC bật `waitForReady`, giữ deadline (Gateway 3 s, health 1 s, service → service 1 s), bỏ `callWithRetry` (spec 00 H14, ADR-020 bổ sung). Hồi quy cả 30 mục chấm.
> Máy: Windows 11, Git Bash, Node v24, Docker Desktop. Hệ thống đã chạy sẵn, dữ liệu vừa về seed. Không `down -v`, không xóa volume, không đụng container của project khác (`product-api`, `nammongodb`, `cab-slide13-*` vẫn `Exited` như lúc đầu).

## 1. Tổng kết

| Nhóm | Lệnh | Số test | Đạt | Không đạt |
|---|---|---|---|---|
| Unit + tích hợp gRPC (9 thư mục `services/*`) | `npm test` từng service | 417 (auth 41, booking 39, customer 41, driver 50, gateway 124, notification 22, payment 37, rating 32, trip 31) | 417 | 0 |
| E2E hạ tầng (file 01–06), ngưỡng 1000 | `npm run test:ha-tang` | 56 | 56 | 0 |
| E2E nghiệp vụ (file 07–15), ngưỡng 1000 | `npm run test:nghiep-vu` | 208 | 208 | 0 |
| E2E dừng / restart service (file 90–92), ngưỡng 1000 | `npm run test:dung-service` | 21 | 21 | 0 |
| E2E rate limit, ngưỡng mẫu 10 s / 5 / 30 (file 95) | `npm run test:rate-limit` | 11 | 11 | 0 |
| Postman (newman) — mọi thư mục trừ 29, ngưỡng 1000 | `npx -y newman@6.2.1 run … --folder …` | 92 request / 198 assertion | 198 | 0 |
| Postman (newman) — thư mục 29, ngưỡng 5 / 10 s | `… --folder "29 Spam → 429"` | 6 request / 13 assertion | 13 | 0 |

| Kết quả | |
|---|---|
| **Mục chấm** | **30 / 30 đạt** |
| **AC mới / đổi đợt này** | 14 AC: **13 đạt bằng e2e**, AC-HT-19 đạt bằng unit test (ghi nhận) |
| **L1, L2 của báo cáo 2026-10-21** | **Đã hết cả hai** (mục 5) |
| **Lỗi mới** | **0** |
| **Không kiểm** | AC-DN-30, AC-HS-31 (như báo cáo 2026-10-21: cần volume dữ liệu bản ADR-019, trái ràng buộc không xóa / dựng lại volume). AC-CD-22 kiểm bằng database "cũ" **giả lập** (mục 3) |

Mỗi nhóm chạy **một lượt duy nhất, xanh ngay lượt đầu**; không chạy lại lượt nào, không sửa test sau khi chạy.

## 2. Lệnh đã chạy

```bash
# 0. Gateway ngưỡng cao cho nhóm thường
RATE_LIMIT_PUBLIC_MAX=1000 RATE_LIMIT_ACCOUNT_MAX=1000 docker compose up -d gateway

# 1. Unit test 9 service
for s in services/*; do (cd $s && npm test); done

# 2. E2E (thư mục tests/)
npm run test:ha-tang            # trên seed ban đầu
npm run test:nghiep-vu          # trên seed ban đầu (ha-tang không đổi dữ liệu nghiệp vụ)
<đặt lại dữ liệu>               # bước 5
npm run test:dung-service
<đặt lại dữ liệu>
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "06 Health check" … --folder "30 Replay thanh toán → trả response cũ" --reporters cli --color off

# 3. Gateway về .env (10 s / 5 / 30)
docker compose up -d gateway
npm run test:rate-limit
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "29 Spam → 429" --reporters cli --color off

# 4. Cuối cùng: đặt lại dữ liệu; kiểm tra docker compose ps -a, GET /health/services

# 5. Đặt lại dữ liệu về seed (không xóa volume)
for x in booking payment trip rating; do
  docker exec $x-db psql -U cab -d $x -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
done
docker exec notification-db mongosh -u cab -p cab123 --authenticationDatabase admin notification --eval "db.notifications.deleteMany({})"
docker exec driver-db psql -U cab -d driver -c "delete from vehicles where driver_id >= 1000; delete from drivers where driver_id >= 1000; …"
#   TX1–TX4, TX8 ONLINE không current_booking_id, tọa độ seed; TX5 OFFLINE (10.825, 106.68); TX6 BUSY / booking 5;
#   TX7 PENDING 'Tài Xế 7' (bỏ reject_reason, reviewed_*, license về bản seed), xe 59A-00007 CAR_4; biển số 59A-0000n
docker exec customer-db psql -U cab -d customer -c "delete from customer_profiles where customer_id >= 1000"
docker exec auth-db psql -U cab -d auth -c "delete from accounts where account_id >= 1000; delete from otp_verifications"
docker compose restart booking-service payment-service trip-service rating-service
```

Trạng thái sau cùng: 20 container `healthy` (`kafka-init` `Exited (0)` như thiết kế); `/health/services` 200, 8 `healthy`; Gateway `RATE_LIMIT_PUBLIC_MAX=5`, `RATE_LIMIT_ACCOUNT_MAX=30`; trips 3 dòng seed (T3, T4 `COMPLETED`, T5 `ACCEPTED` có `Tài Xế 6` / `59A-00006`); bookings 7; không còn mã ≥ 1000 ở auth, customer, driver; notifications 0; tài xế 11–14, 18 `ONLINE` không `current_booking_id`, 16 `BUSY`/5, 17 `PENDING`.

## 3. AC mới và AC đổi → test → kết quả

Ký hiệu file trong `tests/e2e/`: `02` = `02-compose.test.js`, `04` = `04-health-degraded.test.js`, `10` = `10-tai-xe-xem-tim-bat-tat.test.js`, `11` = `11-dat-xe.test.js`, `13` = `13-chuyen-di-thong-bao.test.js`, `90`, `91`, `92` = file dừng service. Postman ghi số request.

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-CD-20 (mới) | 12 (FR14), A27 | `trips/5` `[KH1]`, `[TX6]`, `[AD1]` → 200 cùng `driver` **đúng** `{"driver_id":16,"name":"Tài Xế 6","plate":"59A-00006"}`, không có `lat`, `lng`, `license`; `[KH2]`, `[TX1]` → 403 body chỉ `{"error":"NOT_OWNER"}`, không lộ tên / biển số; A14 `drivers/16` `[KH1]` → 403 `FORBIDDEN` | 13; 12.7 | Đạt |
| AC-CD-21 (mới) | 16 → A27 | Chuyến C1 (KH1 đặt CASH, TX1 nhận): A27 → `driver {11, "Tài Xế 1", "59A-00001"}`; đổi `vehicles.license_plate` của TX1 thành `59A-11111` ở driver-db → A27 **vẫn** `59A-00001` (bản chụp); trả biển số về; `trips` dòng C1 `Tài Xế 1 \| 59A-00001`; log `trip-service` trong lúc test không có `driver-service` / `:50053` | 13 | Đạt |
| AC-CD-22 (mới) | Migration | Giả lập trip-db "cũ": tạo chuyến mới (TX1), rồi `DROP` hai ràng buộc, hai cột `driver_name`, `driver_plate` và xóa dòng `002` trong `schema_migrations`; restart trip-service → log có `002_ten-bien-so-tai-xe.sql`; hai cột `text` nullable; có `trips_driver_name_len`, `trips_driver_plate_format`; T3 / T4 / T5 = `Tài Xế 1`/`59A-00001`, `Tài Xế 3`/`59A-00003`, `Tài Xế 6`/`59A-00006`; chuyến tạo trước → A27 `driver` **đúng** `{"driver_id":11}`. Restart lần hai: log không có `error`, không chạy lại 002, `schema_migrations` một dòng 002, T3–T5 không đổi | 92 | Đạt (database cũ giả lập, không phải volume cũ thật) |
| AC-CD-07 (đổi) | 17 (A27) | Như trước + `[KH1]`, `[TX1]`, `[AD1]` đều có `driver` **đúng** `{11, "Tài Xế 1", "59A-00001"}` | 13 | Đạt |
| AC-TX-42 (khớp lại) | 12 (FR14) | `[KH1]` `trips/5` → `driver` **đúng** `{16, "Tài Xế 6", "59A-00006"}` (so cả khối, không còn đọc biển số từ driver-db) | 10; 12.7 | Đạt |
| AC-DX-17 (đổi) | 15 (Q24) | Dừng driver-service → A19 201 `SEARCHING`; trong **8 s** kể từ A19 → `NO_DRIVER_FOUND`; K3 một message `offers_tried 0` | 91 | Đạt (`NO_DRIVER_FOUND` sau 5 344 ms) |
| AC-DX-23 (đổi) | 16 (gRPC nội bộ) | `ReserveDriver(11, B)` hai lần → `{driver_id 11, booking_id B, status BUSY, driver_name "Tài Xế 1", plate "59A-00001"}` **cả hai lần**; phần còn lại như trước | 11 | Đạt |
| AC-DX-24 (đổi) | 16 (T1) | `CreateTrip` gửi thêm `driver_name`, `driver_plate`; như trước (cùng `trip_id`, `created` true/false, một K5, `BOOKING_ALREADY_ASSIGNED`, `IDENTITY_MISSING`, `FORBIDDEN`); **mới:** dòng `trips` có `Tài Xế 1 \| 59A-00001`; 5 request thiếu / rỗng / toàn khoảng trắng `driver_name` hoặc `driver_plate` (booking mới) → `INVALID_ARGUMENT` `INVALID_INPUT`, không tạo Trip | 11 | Đạt |
| AC-HT-06 (đổi) | 6 (503) | Dừng rating-service → `/health/services` 503 `unhealthy`, `rating-service: unhealthy`, 7 `healthy`; log `warn`; **thời gian trả lời ≤ 1,5 s** | 04 | Đạt (1 085 ms) |
| AC-HT-14 (đổi) | 5, 6 | Log cổng đúng; Gateway 8 biến `*_GRPC_ADDR`; booking 3 biến; rating `TRIP_GRPC_ADDR`; **trip-service không có biến `*_GRPC_ADDR` nào** (`{}`); `/health/services` 200, đúng 8 key, đều `healthy` | 02 | Đạt |
| AC-HT-15 (đổi) | 6 | **8 lần** liên tiếp với customer, booking, payment, trip, rating: lần lẻ `restart` cả năm, lần chẵn `stop` cả năm rồi `start` ngược thứ tự. Sau mỗi lần (chờ container `healthy`, **không** chờ thêm): `/health/services` 200 8 `healthy`; `customers/1`, `trips/5`, `bookings/5`, `payments/5`, `ratings?driver_id=11` `[KH1]` đều 200 đúng dữ liệu **ngay lần gọi đầu**, ≤ 3 s | 92 | Đạt — 40 / 40 lời gọi 200 (14–33 ms). IP **đã đổi chỗ** giữa các service ở mọi lần (ví dụ lần 1: customer `.4 → .11`, trip `.11 → .4`; booking ↔ payment `.8 ↔ .5` ở lần 1, 2) |
| AC-HT-18 (mới) | 6, 8 (503) | Dừng rating-service → A36 `[KH1]` 503 `{"error":"SERVICE_UNAVAILABLE"}` sau 2,5–3,5 s; `/health/services` 503, `rating-service: unhealthy`, ≤ 1,5 s; A05 đăng nhập KH1 200; `start`, chờ `healthy` → A36 **lần đầu** 200 | 90 | Đạt (A36 503 sau 3 008 ms; health 1 004 ms) |
| AC-HT-19 (mới) | Quy ước | Unit test đọc tùy chọn lời gọi: mọi rpc Gateway (6 file route), `Health/Check`, booking S2–S5, rating S7 có `waitForReady === true`, deadline 3 000 / 1 000 / 1 000 ms, metadata giữ `x-role`, `x-request-id` | `services/gateway/test/*-routes.test.js`, `health.test.js`, `grpc-call-options.js`; `services/booking-service/test/clients.test.js`; `services/rating-service/test/clients.test.js` | Đạt (nằm trong 417 unit test; test-agent chỉ ghi nhận, không viết thêm) |

Test đã gỡ hoặc sửa vì dựa vào thiết kế cũ:

| Test | Trước | Nay |
|---|---|---|
| AC-HT-14 (02) | trip-service phải có `DRIVER_GRPC_ADDR` (S6) | trip-service không có biến nào |
| AC-TX-42 (10) | Đọc biển số TX6 hiện tại từ driver-db (ngầm định A27 hỏi Driver qua S6) | So cả khối với giá trị chụp cố định |
| AC-HT-15 (92) | Một lần restart + một lần dừng/bật ngược, hai API | 8 lần, năm API, ghi IP và thời gian từng lời gọi |
| AC-DX-17 (91) | Tên test "≈ 5 s" | Chờ tối đa 8 s kể từ A19 |
| Các test 503 khi dừng service (AC-DN-06, AC-HS-12, AC-TX-33, AC-DX-12, AC-DX-21, AC-CD-08, AC-DG-07, AC-TB-05) | Chỉ kiểm status / body, **không** kiểm "503 ngay" | Giữ nguyên (vẫn đúng với `waitForReady`: 503 sau deadline). Không còn test nào đòi 503 trong vài ms |

## 4. Bảng 30 mục chấm

| # | Mục | Test tự động (file / Postman) | Kết quả |
|---|---|---|---|
| 1 | Kiến trúc source code | 01 | Đạt |
| 2 | `.gitignore`, `.env` | 01, 06 | Đạt |
| 3 | Nhiệm vụ Gateway | 03, 07, 95, unit gateway 124 | Đạt |
| 4 | IPC | 05, 11 (AC-DX-23, 24), 13, 14 | Đạt |
| 5 | Compose, liệt kê container | 02 (AC-HT-14) | Đạt |
| 6 | `/health`, `/ready`, `/health/services` | 03, 04 (AC-HT-05/06/07/16/17), 92 (AC-HT-15), 90 (AC-HT-18); 06.1–06.3 | Đạt |
| 7 | Kafka | 05, 12, 13 | Đạt |
| 8 | Mọi request qua Gateway | 02 (AC-HT-10, 11), 90 (AC-HT-18) | Đạt |
| 9 | Đăng ký → đăng nhập | 07, 90; 09.1–09.4 | Đạt |
| 10 | Đăng nhập → token | 07; 10.1–10.7 | Đạt |
| 11 | Khách theo mã | 08, 90; 11.1–11.4 | Đạt |
| 12 | Tài xế theo mã | 09, 10 (AC-TX-26…28, 40…42), 13 (AC-CD-20); 12.1–12.7 | Đạt (L1 hết: khách thấy tài xế của chuyến mình qua A27) |
| 13 | Tài xế quanh 1 km, paging, seed ≥ 5 | 10; 13.1–13.3 | Đạt (seed 8 tài xế, 4 trong 1 km quanh (10.82, 106.68)) |
| 14 | Booking theo mã khách, paging, seed ≥ 5 | 11; 14.1–14.5 | Đạt (seed 7 booking của KH1) |
| 15 | Đặt xe → Offer | 11, 13, 91 (AC-DX-17); 15.1, 15.2 | Đạt |
| 16 | Tài xế nhận chuyến | 11 (AC-DX-19, 23, 24), 13 (AC-CD-21), 91; 16.1–16.4 | Đạt |
| 17 | Trạng thái chuyến đúng trình tự | 13 (AC-CD-07), 92; 17.1–17.7 | Đạt (newman 17.1 lần đầu sau restart không còn 503) |
| 18 | Hủy chuyến, các bên được báo | 13, 92; 18.1–18.7 | Đạt |
| 19 | Thanh toán online + callback | 12; 19.1–19.3 | Đạt |
| 20 | Đánh giá chuyến | 14, 92; 20.1–20.3 | Đạt |
| 21 | Đăng ký tài xế OTP | 09, 15, 95; 21.1–21.4, 2122.* | Đạt |
| 22 | Admin duyệt / từ chối | 09, 15, 90; 22.1–22.3 | Đạt |
| 23 | Bật / tắt nhận chuyến | 09, 10; 23.1, 23.2 | Đạt |
| 24 | Mã hóa at rest | 07, 08, 09; 24.1 | Đạt |
| 25 | SQL injection | 07, 08; 25.1–25.4 | Đạt |
| 26 | XSS | 08; 26.1, 26.2 | Đạt |
| 27 | JWT bị sửa → 401 | 07, 95; 27.1–27.5 | Đạt |
| 28 | Sai quyền → 403 | 08–15; 28.1, 28.2 | Đạt |
| 29 | Spam → 429 | 95; 29.1–29.6 | Đạt |
| 30 | Replay thanh toán | 12; 30.1–30.4 | Đạt |

Dữ liệu seed cho mục 13, 14 (quy tắc 6): đủ — 8 tài xế (TX1–TX4 trong 1 km quanh (10.82, 106.68)), KH1 có 7 booking; chuyến seed T5 (KH1, TX6) có bản chụp `Tài Xế 6` / `59A-00006` cho mục 12.

## 5. Lỗi

### 5.1 Lỗi của báo cáo 2026-10-21

| Lỗi | Trạng thái | Bằng chứng |
|---|---|---|
| **L1** — A27 không có khối `driver` (AC-TX-42) | **Đã hết** | AC-TX-42, AC-CD-07, AC-CD-20, AC-CD-21 đạt; Postman 12.7 đạt. Response thật: `{"trip_id":5,…,"driver_id":16,"driver":{"driver_id":16,"name":"Tài Xế 6","plate":"59A-00006"},"from":[10.82,106.68],…}`. Lấy từ bản chụp trong `trips` (đổi biển số ở driver-db không ảnh hưởng), trip-service không gọi driver-service và không có `DRIVER_GRPC_ADDR` |
| **L2** — lời gọi đầu sau khi service chạy lại trả 503 | **Đã hết** | AC-HT-15: 8 / 8 lần, 40 / 40 lời gọi đầu 200 dù IP đổi chỗ; AC-HT-18 bật lại → A36 lần đầu 200; mọi test "lần gọi đầu sau khi healthy" (AC-DX-12, AC-DX-21, AC-DG-07) đạt ở lượt duy nhất; newman chạy ngay sau khi bước đặt lại restart 4 service: 17.1 đạt (báo cáo trước 503). Đánh đổi đúng như spec: service dừng hẳn → 503 sau ≈ 3 s (3 008 ms), `/health/services` ≈ 1 s (1 004–1 085 ms) |
| **M1** — mâu thuẫn spec A27 có / không có `driver` | **Đã đóng** ở spec (CD-M2, `7b7d381`); code và test khớp | — |

### 5.2 Lỗi mới

Không có.

### 5.3 Ghi chú

- AC-CD-22 kiểm trên database "cũ" giả lập (bỏ cột, ràng buộc và dòng `schema_migrations` rồi cho migration chạy lại), vì không được xóa / dựng lại volume. Kết quả khớp đúng kỳ vọng của AC; chưa kiểm trên volume thật có từ trước `751acd6`.
- Trong lúc test-agent làm việc, `git status` có thay đổi ở `docs/study/02-cam-nang-he-thong.md`, `docs/study/03-luyen-tap-postman.md`, `postman/luyen-tap/*` — **không phải do test-agent** (test-agent không mở và không ghi các file này).

## 6. File test-agent đã sửa / tạo

| File | Thay đổi |
|---|---|
| `tests/e2e/02-compose.test.js` | AC-HT-14: trip không có `*_GRPC_ADDR`; thêm kiểm `/health/services` 8 `healthy` |
| `tests/e2e/04-health-degraded.test.js` | AC-HT-06: kiểm thời gian ≤ 1,5 s |
| `tests/e2e/10-tai-xe-xem-tim-bat-tat.test.js` | AC-TX-42: so cả khối `driver` |
| `tests/e2e/11-dat-xe.test.js` | AC-DX-23: `driver_name`, `plate` ở cả hai lần Reserve; AC-DX-24: gửi tên / biển số, kiểm dòng `trips`, 5 ca thiếu / rỗng → `INVALID_INPUT` |
| `tests/e2e/13-chuyen-di-thong-bao.test.js` | AC-CD-07 thêm `driver`; mới AC-CD-20, AC-CD-21 |
| `tests/e2e/90-dung-service.test.js` | Mới AC-HT-18 |
| `tests/e2e/91-dung-service-dat-xe.test.js` | AC-DX-17: chờ 8 s |
| `tests/e2e/92-dung-service-chuyen-di.test.js` | AC-HT-15 viết lại (8 lần, 5 service, 5 API); mới AC-CD-22 |
| `postman/cab.postman_collection.json` | Thêm 12.7 `[KH1] GET /api/v1/trips/5` kiểm khối `driver` (AC-TX-42, AC-CD-20) |
| `docs/test-reports/2026-10-22-hoi-quy-cuoi.md` | Báo cáo này |
