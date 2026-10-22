# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Client gọi **REST/JSON** vào **Gateway**; Gateway gọi 8 service bằng **gRPC**; các service báo sự kiện cho nhau qua **Kafka** khi nghiệp vụ bắt buộc bất đồng bộ.
Thiết kế: `docs/design/`; đặc tả từng phần: `docs/specs/`; quyết định kèm lý do: `docs/decisions/`.

## Chạy hệ thống

Cần Docker Desktop. Gõ ở thư mục gốc repo (PowerShell, Git Bash hay Linux đều được):

```
cp .env.example .env      # rồi điền 5 biến bí mật (xem đầu file)
docker compose up -d --build
docker compose ps -a
```

Khoảng 1 phút sau, cả 20 container ở trạng thái `healthy`, `kafka-init` ở `Exited (0)`.

| Việc | Lệnh |
|---|---|
| Kiểm tra Gateway | `curl http://localhost:3000/health`, `/ready`, `/health/services` |
| Xem topic Kafka | Trình duyệt `http://localhost:8080` → cluster `cab` → Topics |
| Xem bảng trong database | `docker exec auth-db psql -U cab -d auth -c "table accounts"` |
| Dừng / bật một service | `docker compose stop rating-service` / `docker compose start rating-service` |
| Xem log | `docker compose logs gateway` |
| Đặt lại dữ liệu về seed | `docker compose down -v` rồi `docker compose up -d --build` |
| Chạy unit test một service | `cd services/gateway` → `npm install` → `npm test` |

`.env` chứa mật khẩu và khóa nên **không commit** (`.gitignore` đã có dòng `.env`). `.env.example` chỉ có tên biến: 5 biến bí mật (`DB_PASSWORD`, `JWT_SECRET`, `CUSTOMER_DATA_KEY`, `DRIVER_DATA_KEY`, `PAYMENT_CALLBACK_SECRET`) để trống, mỗi máy tự sinh trong `.env`. Sinh khóa 32 byte: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Cây thư mục

```
cab-system-project/
├─ proto/                  hợp đồng gRPC: health.proto (grpc.health.v1 chuẩn), auth.proto
├─ services/
│  ├─ gateway/             REST → gRPC, JWT, role, rate limit, health
│  ├─ auth-service/        customer-service/   driver-service/        booking-service/
│  └─ trip-service/        payment-service/    notification-service/  rating-service/
├─ tests/                  test tích hợp, end-to-end (test-agent)
├─ postman/                collection theo số mục chấm (chỉ để luyện tập và kiểm thử)
├─ docs/                   thiết kế, đặc tả, quyết định, báo cáo kiểm thử
├─ compose.yaml            toàn hệ thống: 21 container
├─ .env.example            mẫu biến môi trường (có commit, biến bí mật để trống)
├─ .env                    cấu hình thật (KHÔNG commit)
├─ .gitignore
└─ .dockerignore
```

Bên trong mỗi service (mỗi service build và chạy độc lập, không có thư mục code dùng chung):

```
services/<tên>/
├─ package.json, package-lock.json   dependency riêng, phiên bản chính xác
├─ Dockerfile                        build context là thư mục gốc (để copy proto/)
├─ migrations/                       NNN_mo-ta.sql (notification dùng MongoDB: không có)
├─ src/
│  ├─ index.js        ghép các phần, khởi động
│  ├─ config.js       đọc + kiểm tra biến môi trường; thiếu → thoát 1, log tên biến
│  ├─ db.js           kết nối database của riêng service, thử lại khi database lên chậm
│  ├─ migrate.js      chạy migration (notification: tạo index MongoDB)
│  ├─ seed.js         dữ liệu demo, chỉ chạy khi SIMULATION_MODE=true
│  ├─ health.js       SERVING khi đã migration xong và database trả lời
│  ├─ healthcheck.js  healthcheck của Docker: gọi Health/Check ở chính container
│  ├─ log.js          log JSON một dòng
│  ├─ grpc/           server gRPC
│  └─ domain/         logic nghiệp vụ, không phụ thuộc gRPC / database
└─ test/                             unit test node:test
```

Gateway không có `migrations/`, `seed.js`, `domain/`: Gateway không có database và không chứa nghiệp vụ.

## Container

Chỉ `gateway` và `kafka-ui` mở cổng ra máy. Mọi container khác chỉ nằm trong mạng nội bộ `cab-net`, gọi nhau bằng tên.

| Container | Vai trò | Cổng trong mạng | Cổng ra máy |
|---|---|---|---|
| `gateway` | Cổng vào duy nhất cho nghiệp vụ | 3000 | **3000** |
| `auth-service` … `rating-service` (8) | Service nghiệp vụ, gRPC. Mỗi service một cổng riêng (lỗi L3: Docker cấp lại IP khi container khởi động lại, cùng cổng thì kênh gRPC cũ có thể nối nhầm sang service khác) | auth 50051, customer 50052, driver 50053, booking 50054, trip 50055, payment 50056, notification 50057, rating 50058 | — |
| `auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` | PostgreSQL 16, mỗi service một database (database `auth`, `customer`, …; user `cab`) | 5432 | — |
| `notification-db` | MongoDB 7 của notification-service | 27017 | — |
| `redis` | Chỉ Gateway dùng: bộ đếm rate limit, token đã thu hồi | 6379 | — |
| `kafka` | Kafka KRaft một node | 9092 | — |
| `kafka-init` | Tạo 7 topic rồi thoát | — | — |
| `kafka-ui` | Giao diện xem topic và event (chỉ đọc) | 8080 | **8080** |

7 topic Kafka: `booking.created`, `booking.offer-created`, `booking.no-driver-found`, `booking.canceled`, `trip.status-changed`, `payment.status-changed`, `driver.application-reviewed` (bảng bên phát, bên nghe, lý do: `docs/design/02-kien-truc-giao-tiep.md` mục 6).

## Endpoint hiện có

| Request | Kết quả |
|---|---|
| `GET /health` | 200 `{"status":"healthy"}` — Gateway còn sống |
| `GET /ready` | 200 `{"status":"ready","checks":{"redis":"healthy","grpc_clients":"healthy"}}`; Redis dừng → 503 `not_ready`, `redis` `unhealthy` |
| `GET /health/services` | 200 `{"status":"healthy","services":{…8 service "healthy"}}`; có service dừng / mất database → 503 `unhealthy`, service đó `unhealthy` (lý do ở `docker compose logs gateway`) |
| `POST /api/v1/auth/register` `{"email":"new1@cab.vn","password":"12345678"}` | 201 `{"account_id":1000,"role":"customer"}` — đăng ký khách bằng email (A04); trùng email → 409 `EMAIL_ALREADY_EXISTS` |
| `POST /api/v1/auth/login` `{"email":"kh1@cab.vn","password":"12345678"}` (khách, admin) hoặc `{"phone":"0910000001","password":"12345678"}` (tài xế) | 200 `{"token","account_id","role","expires_in"}` (A05); đúng một trong `email` / `phone`, có cả hai hoặc thiếu cả hai → 400; sai → 401, tài khoản khóa → 403 |
| `POST /api/v1/auth/otp` `{"phone":"0911111111"}` → `POST /api/v1/auth/driver-register` `{"phone","otp","password"}` | Tài xế xin OTP (A07, giả lập trả `otp`) rồi tạo tài khoản, nhận luôn `token` (A08, mục 21) |
| `POST /api/v1/customers` `{"name":"Pham Duc","phone":"0901234567"}` (token khách) | 201 hồ sơ (A37); `GET /api/v1/customers/1` (token KH1) → `{customer_id, name, phone, dob}` (A09, mục 11); mã khác → 403 `NOT_OWNER` |
| `GET /api/v1/drivers/11` (token admin hoặc TX1) | 200 hồ sơ tài xế đầy đủ (A14, mục 12); khách → 403 `FORBIDDEN`; tài xế xem mã khác → 403 `NOT_OWNER` |
| `POST /api/v1/auth/logout` + `Authorization: Bearer <token>` | 200 `{"status":"LOGGED_OUT"}` (A06); dùng lại token → 401 `TOKEN_REVOKED` |
| `POST /api/v1/bookings` `{"from":[10.82,106.68],"to":[10.83,106.69]}` (token khách) | 201 `SEARCHING`, `CAR_4`, `CASH`, `fare` 45000 (A19, mục 15); `"pay":"online"` → `PENDING_PAYMENT` |
| `GET /api/v1/customers/1/bookings?limit=2&page=2` (token KH1 hoặc admin) | Booking theo mã khách, mới nhất trước (A20, mục 14); khách xem mã khác → 403 `NOT_OWNER` |
| `GET /api/v1/offers` (token tài xế) → `PATCH /api/v1/offers/{id}` `{"status":"ACCEPTED"}` | Lời mời đang chờ (A23); nhận → `DRIVER_ASSIGNED` + `trip_id` (A24, mục 16) |
| `POST /api/v1/payments/7/transactions` + `Idempotency-Key: k1` `{"simulate_result":"MANUAL"}` | 200 `PENDING`, `txn_id` `SIM-7-1` (A31, mục 19); gửi lại → header `Idempotency-Replayed: true` (mục 30) |
| `POST /api/v1/payment-callbacks` + `X-Callback-Secret:<khóa trong .env>` `{"txn_id":"SIM-7-1"}` (không token) | 200 `COMPLETED` (A32, mục 19) |
| `GET /api/v1/notifications` (token bất kỳ) | Thông báo của chính mình, mới nhất trước (A33); sau mục 16: `TRIP_ACCEPTED`, `BOOKING_CREATED` |
| `PATCH /api/v1/trips/1000` `{"status":"ARRIVED"}` (token tài xế của chuyến) | 200 kèm `history` (A28, mục 17); nhảy cóc → 409 `INVALID_STATUS_TRANSITION`; `COMPLETED` → tài xế về `ONLINE`, tiền mặt `COMPLETED` |
| `PATCH /api/v1/trips/5` `{"status":"CANCELED","reason":"ban viec"}` (token KH1) | 200 `CANCELED` (A29, mục 18); ≈ 1 s sau Payment 5 `REFUNDED`, TX6 `ONLINE`, thông báo `PAYMENT_REFUNDED`, `TRIP_CANCELED` |
| `PATCH /api/v1/bookings/{id}` `{"status":"CANCELED","reason":"doi y"}` (token khách) | 200 (A22); chỉ khi chưa có tài xế, đã có → 409 `BOOKING_ALREADY_ASSIGNED` |
| `GET /api/v1/trips/{id}` | Chuyến + lịch sử (A27): khách / tài xế của chuyến, admin |
| `POST /api/v1/ratings` `{"trip_id":4,"score":5}` (token KH1) | 201 kèm `driver_avg`, `driver_count` (A34, mục 20); gửi lại → 409 `RATING_ALREADY_EXISTS`; chuyến chưa xong → 409 `TRIP_NOT_COMPLETED` |
| `GET /api/v1/ratings?trip_id=4` / `?driver_id=11` (token bất kỳ) | Đánh giá của chuyến (A35) / điểm tài xế `{"driver_id":11,"avg":5,"count":1}` (A36) |
| Gửi liên tục `POST /api/v1/auth/login` | Lần 6 trong 10 giây → 429 `RATE_LIMITED` + `Retry-After` (mục 29). Bốn route công khai `auth/register`, `auth/login`, `auth/otp`, `auth/driver-register` chung một bộ đếm theo IP (5), route có token theo tài khoản (30); chạy bộ test tự động thì đặt `RATE_LIMIT_PUBLIC_MAX=1000 RATE_LIMIT_ACCOUNT_MAX=1000 docker compose up -d gateway` |
| Đường dẫn khác | 404 `{"error":"ROUTE_NOT_FOUND"}` |

API nghiệp vụ nằm dưới `/api/v1/…` (`docs/design/04-api.md`) và được thêm theo từng đặc tả.

Tài khoản seed (mật khẩu chung `SEED_PASSWORD` = `12345678`) — **tài xế dùng số điện thoại, mọi người khác dùng email** (ADR-021): khách `khn@cab.vn` ↔ mã `n` (1, 2, 3; mã 9 bị khóa), tài xế `091000000n` ↔ mã `10 + n` (11–18), admin `admin@cab.vn` ↔ mã 99. Hồ sơ khách seed (KH1, KH2, KH9) có số liên hệ `090000000n`; KH3 chưa có hồ sơ. Tài khoản tạo qua API có mã từ 1000.

Booking seed của KH1: mã booking = mã payment = mã trip = 1…7, tuyến P0 (10.82, 106.68) → D0 (10.83, 106.69); B7 (`CAR_7`, `ONLINE`, chờ thanh toán, hạn 1 ngày) dành cho mục 19, 30. Booking, payment, trip, offer tạo qua API có mã từ 1000.
