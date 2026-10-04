# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Client gọi **REST/JSON** vào **Gateway**; Gateway gọi 8 service bằng **gRPC**; các service báo sự kiện cho nhau qua **Kafka** khi nghiệp vụ bắt buộc bất đồng bộ.
Thiết kế: `docs/design/`; đặc tả từng phần: `docs/specs/`; quyết định kèm lý do: `docs/decisions/`.

## Chạy hệ thống

Cần Docker Desktop. Gõ ở thư mục gốc repo (PowerShell, Git Bash hay Linux đều được):

```
cp .env.example .env
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

`.env` chứa mật khẩu và khóa nên **không commit** (`.gitignore` đã có dòng `.env`). `.env.example` có giá trị mẫu chỉ cho máy demo; chạy thật phải đổi khóa trong `.env`.

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
├─ .env.example            mẫu biến môi trường (có commit)
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
| `auth-service` … `rating-service` (8) | Service nghiệp vụ, gRPC | 50051 | — |
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
| `GET /health` | 200 `{"status":"UP"}` — Gateway còn sống |
| `GET /ready` | 200 `READY` khi Redis trả lời; 503 `NOT_READY` khi Redis dừng |
| `GET /health/services` | 200 `UP` khi cả 8 service `SERVING`; 503 `DEGRADED`, ghi rõ service nào `NOT_SERVING` / `UNREACHABLE` |
| `POST /api/v1/accounts` `{"phone":"0901234567","password":"12345678"}` | 201 `{"account_id":1000,"role":"customer"}` — đăng ký khách (A04); trùng số → 409 |
| `POST /api/v1/auth/login` `{"phone":"0900000001","password":"12345678"}` | 200 `{"token","account_id","role","expires_in"}` (A05); sai → 401, tài khoản khóa → 403 |
| `POST /api/v1/auth/logout` + `Authorization: Bearer <token>` | 200 `{"status":"LOGGED_OUT"}` (A06); dùng lại token → 401 `TOKEN_REVOKED` |
| `POST /api/v1/bookings` `{"from":[10.82,106.68],"to":[10.83,106.69]}` (token khách) | 201 `SEARCHING`, `CAR_4`, `CASH`, `fare` 45000 (A19, mục 15); `"pay":"online"` → `PENDING_PAYMENT` |
| `GET /api/v1/bookings?limit=2&page=2` (token khách) | Booking của chính khách, mới nhất trước (A20, mục 14) |
| `GET /api/v1/offers` (token tài xế) → `PATCH /api/v1/offers/{id}` `{"status":"ACCEPTED"}` | Lời mời đang chờ (A23); nhận → `DRIVER_ASSIGNED` + `trip_id` (A24, mục 16) |
| `POST /api/v1/payments/7/transactions` + `Idempotency-Key: k1` `{"simulate_result":"MANUAL"}` | 200 `PENDING`, `txn_id` `SIM-7-1` (A31, mục 19); gửi lại → header `Idempotency-Replayed: true` (mục 30) |
| `POST /api/v1/payment-callbacks` + `X-Callback-Secret: cab-secret` `{"txn_id":"SIM-7-1"}` (không token) | 200 `COMPLETED` (A32, mục 19) |
| Đường dẫn khác | 404 `{"error":"ROUTE_NOT_FOUND"}` |

API nghiệp vụ nằm dưới `/api/v1/…` (`docs/design/04-api.md`) và được thêm theo từng đặc tả.

Tài khoản seed (mật khẩu chung `SEED_PASSWORD` = `12345678`): khách `090000000n` ↔ mã `n` (1, 2, 3; mã 9 bị khóa), tài xế `091000000n` ↔ mã `10 + n` (11–18), admin `0999999999` ↔ mã 99. Tài khoản tạo qua API có mã từ 1000.

Booking seed của KH1: mã booking = mã payment = mã trip = 1…7, tuyến P0 (10.82, 106.68) → D0 (10.83, 106.69); B7 (`CAR_7`, `ONLINE`, chờ thanh toán, hạn 1 ngày) dành cho mục 19, 30. Booking, payment, trip, offer tạo qua API có mã từ 1000.
