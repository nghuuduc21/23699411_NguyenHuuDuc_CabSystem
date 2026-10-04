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
├─ proto/                  hợp đồng gRPC; hiện có health.proto (grpc.health.v1 chuẩn)
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
| Đường dẫn khác | 404 `{"error":"ROUTE_NOT_FOUND"}` |

API nghiệp vụ nằm dưới `/api/v1/…` (`docs/design/04-api.md`) và được thêm theo từng đặc tả.
