# Spec 00 — Hạ tầng: cấu trúc mã nguồn, Compose, Kafka, Gateway health

> Vòng 2, viết 2026-10-03; **sửa 2026-10-03 theo luật thi** (gõ tay mọi request và lệnh, không mở tài liệu): bỏ `scripts/`, `.env.example` có sẵn giá trị dùng được, biến môi trường còn 14, user database `cab`, Redis không mật khẩu, bỏ outbox, đặt lại dữ liệu bằng `down -v`, rút gọn tiêu chí chấp nhận. **Đồng bộ với 04 lần 3:** không tiền tố đường dẫn, Gateway đọc body JSON bất kể `Content-Type`, lệnh `psql` dạng `table <bảng>`, tạo `.env` bằng `cp`.
> Mục chấm **1, 2, 5, 6, 7, 8**.
> Đầu vào: `CLAUDE.md` (Quy tắc kiến trúc, Quyết định kỹ thuật, Ràng buộc khi chấm, Ràng buộc khi thi, Cấu trúc thư mục, Quy ước code); `docs/design/02` mục 2, 6, 7; `docs/design/03` mục 1.1, 1.3, 11.3, 12, **13**, **14**; `docs/design/04` mục 1, 2.1; ADR-010, ADR-014, ADR-015, ADR-016, ADR-017.
> Phạm vi: khung **chạy được, chưa có nghiệp vụ**. Mỗi service: khởi động → nối database của mình → chạy migration → chạy seed (nếu bật) → trả lời health gRPC. Gateway: ba endpoint health và bảng đổi lỗi gRPC → HTTP dùng chung cho các spec sau.
> Ký hiệu: **[ĐC]** đã chốt trong `CLAUDE.md` / design; **[BA]** BA chọn trong spec này (gom ở mục 9).

## 1. Truy vết

| Mục chấm | Nội dung phiếu | BG | BR | FR / BRULE | NFR | Thiết kế |
|---|---|---|---|---|---|---|
| 1 | Mô tả kiến trúc tổ chức source code | BG05 | BR16 | — | NFR11, NFR03 | Cấu trúc thư mục `CLAUDE.md`; mục 3.1 |
| 2 | `.gitignore`, `.env` trên GitHub | BG05 | BR15 | — | NFR08 | 03 mục 11.4, 13; mục 3.5, 3.6 |
| 5 | Compose hệ thống, liệt kê container | BG05 | BR16 | — | NFR03, NFR04 | 03 mục 1.1, 1.3; mục 3.2 |
| 6 | `/health`, `/ready`, `/health/services` | BG05 | BR16 | — | NFR04, NFR15 | 04 A01–A03; 02 G9 |
| 7 | Kafka | BG05 | BR16 | — | NFR05 | 02 mục 6, 7 (K1–K7); mục 3.3 |
| 8 | Mọi request đi qua Gateway | BG05 | BR15 | BRULE12 | NFR06, NFR08 | 02 mục 2.1; `CLAUDE.md` |

Không có UC: đây là phần nền mà mọi UC dựa vào.

## 2. Luồng

### 2.1 Khởi động hệ thống

| | Nội dung |
|---|---|
| Tác nhân | Sinh viên chạy demo, người chấm |
| Tiền điều kiện | Docker Desktop chạy; đã sao chép `.env.example` thành `.env` (mục 3.7) |
| Luồng chính | 1. `docker compose up -d --build`. 2. Database, Redis, Kafka lên và healthy. 3. `kafka-init` tạo 7 topic rồi thoát mã 0. 4. Mỗi service: đọc biến môi trường → nối database (thử lại) → chạy migration → chạy seed nếu `SIMULATION_MODE=true` → mở gRPC `0.0.0.0:50051` → health `SERVING`. 5. Gateway: nối Redis, tạo 8 kênh gRPC, mở HTTP `0.0.0.0:3000`. 6. Kafka UI mở `:8080` |
| Ngoại lệ | Thiếu biến bắt buộc hoặc khóa sai độ dài → service ghi một dòng lỗi nêu **tên biến** (không ghi giá trị), thoát mã 1. Database chưa sẵn sau hết lượt thử, hoặc migration lỗi → thoát mã 1, Compose khởi động lại (`restart: unless-stopped`) |
| Hậu điều kiện | 21 container: 20 đang chạy (healthy), `kafka-init` đã thoát mã 0. Chỉ `gateway` (3000) và `kafka-ui` (8080) có cổng ra máy |

### 2.2 Kiểm tra sức khỏe (mục 6)

| | Nội dung |
|---|---|
| Tác nhân | Người chấm qua Postman (không token) |
| Luồng chính | A01 → 200; A02 → 200 khi Redis trả lời; A03 → Gateway gọi song song `Health/Check` tới 8 service (deadline 1 000 ms, hằng số) → 200 khi cả 8 `SERVING` |
| Ngoại lệ | Redis dừng → A02 trả 503 (A01 vẫn 200). Một service dừng hoặc mất database → A03 trả 503, body ghi rõ service nào |

## 3. Thành phần tham gia và hạ tầng

### 3.1 Cây thư mục (mục 1)

```
cab-system-project/
├─ proto/                  health.proto (grpc.health.v1 chuẩn); spec sau thêm auth.proto, customer.proto, …
├─ services/
│  ├─ gateway/             REST → gRPC, JWT, role, rate limit, health
│  ├─ auth-service/   customer-service/   driver-service/   booking-service/
│  └─ trip-service/   payment-service/    notification-service/   rating-service/
├─ tests/                  test tích hợp, end-to-end (test-agent)
├─ postman/                collection theo số mục chấm (chỉ để luyện tập và kiểm thử)
├─ docs/
├─ compose.yaml
├─ .env.example            có commit, có sẵn giá trị dùng được cho máy demo
├─ .env                    KHÔNG commit (sao chép từ .env.example)
├─ .gitignore
├─ .dockerignore
└─ README.md               cây thư mục + lệnh chạy + bảng container
```

**Không có thư mục `scripts/`** [ĐC luật thi: không chạy script soạn sẵn].

Bên trong **mỗi service** (gateway giống, trừ `migrations/`, `seed.js`):

```
services/<tên>/
├─ package.json          riêng; phiên bản chính xác; "type": "module"; engines node >= 20
├─ package-lock.json
├─ Dockerfile
├─ migrations/           001_*.sql, 002_*.sql … (notification: không có, index tạo khi khởi động)
├─ src/
│  ├─ index.js           ghép các phần, khởi động
│  ├─ config.js          đọc + kiểm tra biến môi trường; thiếu → thoát 1
│  ├─ db.js              kết nối database, thử lại
│  ├─ migrate.js         chạy migration (mục 7.1)
│  ├─ seed.js            seed của service (mục 7.2)
│  ├─ health.js          trạng thái health
│  ├─ healthcheck.js     cho healthcheck của Docker: gọi Health/Check ở localhost
│  ├─ grpc/              server gRPC, đổi lỗi nghiệp vụ → gRPC status
│  └─ domain/            logic nghiệp vụ, không import gRPC / pg
└─ test/                 unit test node:test
```

| Quyết định | Lý do | Đánh đổi |
|---|---|---|
| Mỗi service một `package.json`, `Dockerfile`, `migrations/` [ĐC] | Build, chạy độc lập; khớp database-per-service | Lặp vài module nhỏ (config, migrate, health, mã hóa) |
| **Không** có thư mục code dùng chung [BA] | Thư viện chung buộc các service build lại cùng nhau | Sửa lỗi module lặp phải sửa nhiều nơi |
| `proto/` ở gốc; build context của mọi image là **thư mục gốc** | Gateway cần proto của cả 8 service; một nguồn hợp đồng | Dockerfile ghi đường dẫn từ gốc (`COPY services/auth-service/ …`, `COPY proto/ …`) |

### 3.2 Container (mục 5) — 21 container

Tên container = tên service trong Compose, đặt bằng `container_name` để `docker exec <tên>` dùng thẳng [ĐC 03 mục 1.3]. Chỉ `gateway` và `kafka-ui` có `ports`. Một mạng `cab-net`.

| # | Container | Image / build | Cổng trong mạng | Cổng ra máy | Healthcheck | `depends_on` | `mem_limit` |
|---|---|---|---|---|---|---|---|
| 1 | `gateway` | build `services/gateway` | 3000 | **`3000:3000`** | `wget -qO- http://localhost:3000/health` | `redis`: healthy; 8 service: `service_started` | 256m |
| 2–3 | `auth-service`, `customer-service` | build | 50051 | — | `node src/healthcheck.js` | database của mình: healthy | 256m |
| 4–8 | `driver-service`, `booking-service`, `trip-service`, `payment-service`, `notification-service` | build | 50051 | — | như trên | database của mình: healthy; `kafka-init`: completed | 256m |
| 9 | `rating-service` | build | 50051 | — | như trên | `rating-db`: healthy | 256m |
| 10–16 | `auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` | `postgres:16-alpine` | 5432 | — | `pg_isready -U cab -d <database>` | — | 256m |
| 17 | `notification-db` | `mongo:7.0`, `--wiredTigerCacheSizeGB 0.25` | 27017 | — | `mongosh --quiet --eval "db.adminCommand('ping').ok"` | — | 512m |
| 18 | `redis` | `redis:7.4-alpine`, `redis-server --maxmemory 64mb --maxmemory-policy noeviction` | 6379 | — | `redis-cli ping` | — | 128m |
| 19 | `kafka` | `apache/kafka:3.8.0` (KRaft, một node) | 9092, 9093 | — | `/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list` | — | 1g |
| 20 | `kafka-init` | `apache/kafka:3.8.0`, chạy một lần (`restart: "no"`) | — | — | — (thoát 0 là xong) | `kafka`: healthy | 512m |
| 21 | `kafka-ui` | `provectuslabs/kafka-ui:v0.7.2` | 8080 | **`8080:8080`** | `wget -qO- http://localhost:8080/actuator/health` | `kafka-init`: completed | 512m |

Database, user (03 mục 1.3) [ĐC]:

| Container | Database | User / mật khẩu |
|---|---|---|
| `auth-db` … `rating-db` | `auth`, `customer`, `driver`, `booking`, `trip`, `payment`, `rating` | `cab` / `${DB_PASSWORD}` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) |
| `notification-db` | `notification` | `cab` / `${DB_PASSWORD}` (`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`) |

Volume: mỗi database một volume có tên (`auth-data`, …, `notification-data`) để `docker compose down -v` xóa sạch. Redis, Kafka **không** có volume [BA]: dữ liệu của chúng (bộ đếm, token thu hồi, event demo) không cần giữ qua lần dựng lại.

Healthcheck chung [BA]: `interval: 10s`, `timeout: 5s`, `retries: 10`, `start_period: 20s` (Kafka, Kafka UI: 40s). `restart: unless-stopped` cho mọi container trừ `kafka-init`.

| Điểm | Lý do |
|---|---|
| `gateway` chỉ chờ `service_started` | Chờ cả 8 healthy thì một service hỏng làm Gateway không lên, `/health/services` không còn ai báo lỗi |
| Chỉ 5 service chờ `kafka-init` | Đúng 5 service dùng Kafka (02 mục 1). Auth, customer, rating không phụ thuộc Kafka — thể hiện NFR05 |
| Mật khẩu chung `DB_PASSWORD` [ĐC 03 mục 1.3] | Một thứ phải nhớ; đánh đổi: lộ một mật khẩu là vào mọi database — chấp nhận vì không database nào mở cổng |

### 3.3 Kafka (mục 7)

Môi trường container `kafka` (đặt thẳng trong `compose.yaml`, không qua `.env`):

| Biến | Giá trị | Vì sao |
|---|---|---|
| `KAFKA_NODE_ID`, `KAFKA_PROCESS_ROLES` | `1`, `broker,controller` | KRaft một node, không ZooKeeper |
| `KAFKA_LISTENERS` / `KAFKA_ADVERTISED_LISTENERS` | `PLAINTEXT://:9092,CONTROLLER://:9093` / `PLAINTEXT://kafka:9092` | Service gọi bằng tên Compose |
| `KAFKA_CONTROLLER_LISTENER_NAMES`, `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP`, `KAFKA_CONTROLLER_QUORUM_VOTERS` | `CONTROLLER`; `CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT`; `1@kafka:9093` | Bắt buộc của KRaft |
| `CLUSTER_ID` | Chuỗi cố định 22 ký tự ghi thẳng trong Compose [BA] | Không phải bí mật; bỏ biến `KAFKA_CLUSTER_ID` (03 mục 13) |
| `KAFKA_AUTO_CREATE_TOPICS_ENABLE` | **`false`** | Topic phải đăng ký rõ (mục 7) |
| `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR`, `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR`, `KAFKA_TRANSACTION_STATE_LOG_MIN_ISR` | `1` | Một broker |
| `KAFKA_HEAP_OPTS` | `-Xms256m -Xmx512m` | Vừa máy 16 GB |

`kafka-init` chạy `kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic <tên> --partitions 3 --replication-factor 1` cho đúng 7 topic, rồi `--list` ra log và thoát 0. Lỗi ở topic nào → thoát khác 0.

| Mã | Topic | Publish | Subscribe |
|---|---|---|---|
| K1 | `booking.created` | booking | notification |
| K2 | `booking.offer-created` | booking | notification |
| K3 | `booking.no-driver-found` | booking | payment, notification |
| K4 | `booking.canceled` | booking | payment, notification |
| K5 | `trip.status-changed` | trip | driver, payment, notification |
| K6 | `payment.status-changed` | payment | booking, notification |
| K7 | `driver.application-reviewed` | driver | notification |

Kafka UI: `KAFKA_CLUSTERS_0_NAME=cab`, `KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS=kafka:9092`, `KAFKA_CLUSTERS_0_READONLY=true`, `JAVA_OPTS=-Xmx256m`.

Quy ước gửi event cho các spec sau [ĐC ADR-017]: service **commit database xong rồi gửi Kafka ngay**, không có bảng outbox; producer thử lại tối đa 3 lần trong ≤ 1 giây (hằng số). Đánh đổi: service dừng đúng giữa commit và gửi thì mất event; bên nghe vẫn phải chịu được event lặp.

### 3.4 Dockerfile của service Node

| Bước | Nội dung | Lý do |
|---|---|---|
| Image gốc | `node:20-alpine` | Nhỏ; Node ≥ 20 [ĐC] |
| Cài đặt | Copy `package.json`, `package-lock.json` → `npm ci --omit=dev` → copy `src/`, `migrations/`, `proto/` vào `/app/proto` | Tận dụng cache layer |
| Người chạy | `USER node` | Không chạy bằng root |
| Lệnh | `CMD ["node", "src/index.js"]`; `PROTO_DIR=/app/proto` | Code tìm proto theo biến, chạy được ngoài Docker khi test |

`.dockerignore`: `**/node_modules`, `.env`, `.git`, `docs`, `tests`, `postman`, `**/coverage`.

### 3.5 Biến môi trường — 14 biến (theo 03 mục 13) [ĐC]

`.env.example` có **sẵn giá trị dùng được**: sao chép thành `.env` là chạy. Khóa trong file là **khóa mẫu chỉ cho máy demo**; chạy thật phải thay trong `.env`. Đánh đổi phải nói khi thi: khóa mẫu nằm trên Git nên dữ liệu demo không thật sự bí mật.

| # | Biến | Container nhận | Giá trị trong `.env.example` |
|---|---|---|---|
| 1 | `DB_PASSWORD` | 8 database + 8 service | `cab123` |
| 2 | `JWT_SECRET` | **chỉ** auth-service (ký), gateway (kiểm tra) | `demo-jwt-secret-chi-dung-cho-may-demo-32b` (≥ 32 ký tự) |
| 3 | `JWT_TTL_SECONDS` | auth-service | `3600` |
| 4 | `CUSTOMER_DATA_KEY` | **chỉ** customer-service | 32 byte base64 cố định (44 ký tự) |
| 5 | `DRIVER_DATA_KEY` | **chỉ** driver-service | 32 byte base64 cố định, khác biến 4 |
| 6 | `PAYMENT_CALLBACK_SECRET` | payment-service | `cab-secret` |
| 7 | `SIMULATION_MODE` | auth, payment, mọi service có seed | `true` (OTP trong response, `simulate_result`, chạy seed). **`false` khi chạy thật** |
| 8 | `SEED_PASSWORD` | auth-service | `12345678` |
| 9 | `PAYMENT_TIMEOUT_SECONDS` | payment-service | `600` |
| 10 | `OFFER_TIMEOUT_SECONDS` | booking-service | `300` |
| 11 | `OTP_TTL_SECONDS` | auth-service | `300` |
| 12 | `RATE_LIMIT_WINDOW_SECONDS` | gateway | `10` |
| 13 | `RATE_LIMIT_PUBLIC_MAX` | gateway | `5` |
| 14 | `RATE_LIMIT_ACCOUNT_MAX` | gateway | `30` |

Mỗi service **chỉ nhận biến của mình**: Compose ghi từng biến trong khối `environment:` của service, không dùng `env_file` chung (khóa của Customer không lọt sang Auth).

Đặt thẳng trong `compose.yaml` (không bí mật, không cần trong `.env`):

| Biến | Container | Giá trị |
|---|---|---|
| `DATABASE_URL` | 7 service PostgreSQL | `postgres://cab:${DB_PASSWORD}@<context>-db:5432/<context>` (ví dụ `postgres://cab:${DB_PASSWORD}@auth-db:5432/auth`) |
| `MONGODB_URI` | notification-service | `mongodb://cab:${DB_PASSWORD}@notification-db:27017/notification?authSource=admin` |
| `REDIS_URL` | gateway | `redis://redis:6379` |
| `KAFKA_BROKERS` | 5 service dùng Kafka | `kafka:9092` |
| `AUTH_GRPC_ADDR` … `RATING_GRPC_ADDR` | gateway (8 biến); booking (`DRIVER_`, `PAYMENT_`, `TRIP_GRPC_ADDR`); trip (`DRIVER_GRPC_ADDR`); rating (`TRIP_GRPC_ADDR`) | `<tên-service>:50051`. Mỗi service chỉ có địa chỉ của service nó được gọi (02 mục 4.3) |
| `SERVICE_NAME` | gateway, 8 service | Tên container, ghi vào log |

Cổng (`50051`, `3000`) và deadline gRPC (Gateway → service 3 000 ms, service → service 1 000 ms, health 1 000 ms) là **hằng số trong code** (03 mục 13).

Kiểm tra khi khởi động (`config.js`): thiếu biến bắt buộc → thoát 1; `*_DATA_KEY` giải base64 không ra đúng 32 byte → thoát 1; `JWT_SECRET` < 32 ký tự → thoát 1; `SIMULATION_MODE=true` → log `warn` "đang chạy chế độ giả lập". Log chỉ nêu tên biến, không nêu giá trị.

### 3.6 `.gitignore` (mục 2)

Giữ nội dung hiện có (`node_modules/`, `.env`, `.env.*`, `!.env.example`, `*.log`, `coverage/`, file hệ điều hành / editor, `.claude/settings.local.json`). Không thêm dòng mới: không còn file khóa `*.pem`.

### 3.7 Lệnh sinh viên gõ khi thi

| Việc | Lệnh | Mục chấm |
|---|---|---|
| Tạo `.env` (một lần) | `cp .env.example .env` (chạy được ở PowerShell, Git Bash, Linux — như 06) | 2 |
| Kiểm tra `.env` không lên Git | `git ls-files .env .env.example` → chỉ in `.env.example` | 2 |
| Dựng hệ thống | `docker compose up -d --build` | 5 |
| Xem container, cổng | `docker compose ps -a` | 5, 8 |
| Xem topic | Trình duyệt `http://localhost:8080` → Topics | 7 |
| Xem bảng hồ sơ khách | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | 24 |
| Xem bảng tài khoản | `docker exec auth-db psql -U cab -d auth -c "table accounts"` | 24 |
| Dừng / bật một service (demo 503) | `docker compose stop rating-service` / `docker compose start rating-service` | 6 |
| Đặt lại dữ liệu về seed | `docker compose down -v` rồi `docker compose up -d --build` | Chấm lại |

`table <tên bảng>` là cách viết ngắn của `select * from <tên bảng>` (04 mục 5.3, 06). `psql` hiển thị cột `bytea` dạng `\x…` (hex) nên không cần `encode()`.

### 3.8 Thành phần nào sở hữu gì ở spec này

| Thành phần | Sở hữu | Chỉ tham gia |
|---|---|---|
| `gateway` | Ba endpoint health, bảng đổi lỗi | Đọc Redis (ping) |
| 8 service | Health gRPC, database, migration, seed của mình | — |
| `kafka-init` | Danh sách 7 topic | — |
| `kafka-ui` | — | Đọc Kafka |

## 4. API REST tại Gateway

Áp dụng cho **mọi** route [ĐC 04 mục 1]:

| Điểm | Quy định |
|---|---|
| Header mọi response | `X-Content-Type-Options: nosniff`; `Content-Security-Policy: default-src 'none'`; `Cache-Control: no-store`; `X-Request-Id` (Gateway sinh, chuyển cho service qua metadata `x-request-id`) |
| Đường dẫn | **Không có tiền tố** phiên bản: `http://localhost:3000/<route>` |
| Body | Đọc là JSON **bất kể `Content-Type`** (Postman chọn "Text" vẫn chạy); body rỗng = `{}`; không phân tích được → 400 `INVALID_JSON` |
| Route không tồn tại | 404 `{ "error": "ROUTE_NOT_FOUND" }` |
| Lỗi không lường trước trong Gateway | 503 `{ "error": "SERVICE_UNAVAILABLE" }`, không stack trace |
| Log | Một dòng mỗi request: method, path, status, thời gian, `request_id`. **Không** ghi header `Authorization`, body |

### A01 `GET /health`

| Token | Response |
|---|---|
| Không | 200 `{ "status": "UP" }` |

### A02 `GET /ready`

| Token | Kiểm tra | 200 | 503 |
|---|---|---|---|
| Không | Redis `PING` trong 500 ms; đã tạo 8 client gRPC | `{ "status": "READY", "checks": { "redis": "UP", "grpc_clients": "UP" } }` | `{ "status": "NOT_READY", "checks": { "redis": "DOWN", … } }` — Gateway vẫn phục vụ request khác |

### A03 `GET /health/services`

| | |
|---|---|
| Token | Không |
| Cách làm | Gọi **song song** `grpc.health.v1.Health/Check` (`service: ""`) tới 8 service, deadline 1 000 ms mỗi lời |
| Giá trị mỗi service | `SERVING`; `NOT_SERVING` (trả lời nhưng mất database); `UNREACHABLE` (không kết nối được / quá deadline) |
| 200 | Cả 8 `SERVING`: `{ "status": "UP", "services": { "auth-service": "SERVING", …, "rating-service": "SERVING" } }` |
| 503 | Có service khác `SERVING`: `{ "status": "DEGRADED", "services": { …, "rating-service": "UNREACHABLE" } }` |

Ba endpoint health (như mọi route, không có tiền tố phiên bản — 04 mục 1) không token, không rate limit; body không theo dạng `{ "error": … }` vì là báo cáo trạng thái.

### 4.1 Bảng đổi lỗi gRPC → HTTP (dùng cho mọi spec sau) [ĐC]

Quy ước [BA]: service trả lỗi nghiệp vụ bằng gRPC status kèm `details` **đúng bằng mã lỗi**, ví dụ `NOT_FOUND` + `"CUSTOMER_NOT_FOUND"`. Gateway trả `{ "error": "<details>" }`:

| gRPC status | HTTP |
|---|---|
| `INVALID_ARGUMENT` | 400 |
| `UNAUTHENTICATED` | 401 |
| `PERMISSION_DENIED` | 403 |
| `NOT_FOUND` | 404 |
| `ALREADY_EXISTS`, `FAILED_PRECONDITION` | 409 |
| Còn lại (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, …) | 503 `{ "error": "SERVICE_UNAVAILABLE" }` — bỏ `details` để không lộ lỗi nội bộ |

`details` không khớp `^[A-Z][A-Z0-9_]{2,63}$` → coi là lỗi nội bộ → 503. Mọi lời gọi gRPC có deadline [ĐC].

## 5. Hợp đồng gRPC

Chỉ có health. `proto/health.proto`: bản sao nguyên văn `grpc.health.v1`.

| rpc | Vào | Ra | Ai gọi | Lỗi |
|---|---|---|---|---|
| `grpc.health.v1.Health/Check` | `HealthCheckRequest { string service = 1; }` (gửi `""`) | `HealthCheckResponse { ServingStatus status = 1; }` | Gateway (A03, G9); `healthcheck.js` của chính container | `service` lạ → `NOT_FOUND` |

`SERVING` khi đã chạy xong migration **và** database trả lời (PostgreSQL `SELECT 1`, MongoDB `ping`, 500 ms, chạy mỗi lần `Check`). Sai → `NOT_SERVING`. Kafka không nằm trong điều kiện health. Không cài `Health/Watch`.

## 6. Giao tiếp giữa service

| Đường | Kiểu | Lý do |
|---|---|---|
| Gateway → 8 service: `Health/Check` | gRPC (G9) | Mục 6: trả lời ngay trạng thái từng service |
| Gateway → Redis: `PING` | Redis | A02 |
| `kafka-init` → Kafka: tạo topic | Kafka admin | Mục 7: topic đăng ký rõ |

Chưa có lời gọi service → service và chưa có event ở spec này.

## 7. Dữ liệu

### 7.1 Migration (7 service PostgreSQL)

| Bước | Làm gì |
|---|---|
| 1 | `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())` |
| 2 | Đọc `migrations/*.sql` theo tên; bỏ qua file đã có trong `schema_migrations` |
| 3 | Mỗi file chạy trong **một giao dịch** cùng `INSERT INTO schema_migrations(version) VALUES ($1)`; lỗi → rollback, thoát 1 |

Tên file `NNN_mo-ta.sql`. Không sửa file đã chạy [ĐC]. Ở spec này `migrations/` chỉ có `.gitkeep`.

Quy ước khóa chính cho mọi spec sau [ĐC ADR-015, 03 mục 2]: `bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000)`; seed ghi mã nhỏ bằng `OVERRIDING SYSTEM VALUE`. Service đăng ký `types.setTypeParser(20, Number)` để `pg` trả `bigint` là số; proto dùng `int64` với `proto-loader` `longs: Number`; JSON trả **số**.

`notification-service` (MongoDB): không có migration; gọi `createIndex` khi khởi động.

### 7.2 Seed (dữ liệu cụ thể ở spec từng mục, theo 03 mục 14)

| Điểm | Quy định | Lý do |
|---|---|---|
| Ở đâu | `src/seed.js` của **từng** service, dùng chính module băm / mã hóa của service | Mật khẩu phải băm, họ tên phải mã hóa bằng khóa trong `.env` — SQL tay không làm được |
| Khi nào | Sau migration, nếu `SIMULATION_MODE=true` | Người chấm không tạo tay |
| Chạy lặp | Mọi lệnh ghi `ON CONFLICT DO NOTHING` (MongoDB: `$setOnInsert` + `upsert`) | Khởi động lại không nhân đôi, không ghi đè dữ liệu đã đổi khi demo |
| ID | Số nhỏ theo quy luật: khách `n`, tài xế `10 + n`, admin `99`; booking = payment = trip = 1…7 | Gõ tay và học thuộc được |
| Đặt lại | `docker compose down -v` rồi `up -d --build` | Hai lệnh ngắn; không cần script riêng |
| Ở spec này | `seed.js` có, chưa chèn gì, log "seed: 0 dòng" | Khung cho spec sau |

## 8. Tiêu chí chấp nhận

Tiền điều kiện chung: `.env` sao chép từ `.env.example`; `docker compose up -d --build` đã chạy xong.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-HT-01 | 1 | Repo | Mở `README.md` | Có cây thư mục mục 3.1, bảng container, lệnh chạy; 9 thư mục `services/*` mỗi thư mục có `package.json`, `Dockerfile` riêng; không có `scripts/` |
| AC-HT-02 | 2 | Repo đã push | `git ls-files .env .env.example` | Chỉ in `.env.example`; `.gitignore` có dòng `.env` |
| AC-HT-03 | 2 (lỗi) | `.env` thiếu `CUSTOMER_DATA_KEY` | `docker compose up -d customer-service` | Container thoát mã 1; `docker compose logs customer-service` có tên biến, không có giá trị khóa |
| AC-HT-04 | 5 | Compose đã lên | `docker compose ps -a` | Đủ 21 container mục 3.2; 20 `running (healthy)`; `kafka-init` `exited (0)`; 8 container database riêng |
| AC-HT-05 | 6 | Mọi thứ healthy | `GET /health`; `GET /ready`; `GET /health/services` | 200 `UP`; 200 `READY`; 200 `UP` với 8 service `SERVING` |
| AC-HT-06 | 6 (503) | `docker compose stop rating-service` | `GET /health/services` | 503 `DEGRADED`, `rating-service = "UNREACHABLE"`, 7 service còn lại `SERVING` |
| AC-HT-07 | 6 (503) | `docker compose stop redis` | `GET /ready` rồi `GET /health` | `/ready` 503, `redis = "DOWN"`; `/health` vẫn 200 |
| AC-HT-08 | 404 | — | `GET /khong-co` | 404 `{ "error": "ROUTE_NOT_FOUND" }` |
| AC-HT-09 | 7 | Compose đã lên | Mở `http://localhost:8080` → cluster `cab` → Topics | Đủ 7 topic mục 3.3, không topic nghiệp vụ nào khác (topic nội bộ `__…` được phép) |
| AC-HT-10 | 8 | Compose đã lên | `docker compose ps -a` | Chỉ `gateway` có `0.0.0.0:3000->3000` và `kafka-ui` có `0.0.0.0:8080->8080`; container khác không có `->` |
| AC-HT-11 | 8 (lỗi) | Compose đã lên | Postman gọi thẳng `http://localhost:50051`, `http://localhost:5432` | Lỗi kết nối (không có response) |
| AC-HT-12 | Đặt lại | Đã demo, dữ liệu đổi | `docker compose down -v` rồi `docker compose up -d --build` | Hệ thống lên lại healthy; seed về trạng thái đầu; `docker compose restart auth-service` sau đó không nhân đôi seed |
| AC-HT-13 | Quy ước | Unit test Gateway | Service giả trả `NOT_FOUND` + `"CUSTOMER_NOT_FOUND"`; `INVALID_ARGUMENT` + `"INVALID_INPUT"`; `INTERNAL` + `"lỗi gì đó"` | 404 `CUSTOMER_NOT_FOUND`; 400 `INVALID_INPUT`; 503 `SERVICE_UNAVAILABLE` |

Kết quả mong đợi theo phiếu chấm: mục 1 — nói được cây thư mục; mục 2 — `.env` không có trên Git; mục 5 — 21 container và vai trò; mục 6 — ba request đều 200; mục 7 — Kafka UI thấy 7 topic (message có sau spec 15); mục 8 — chỉ hai cổng, gọi thẳng thất bại.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Gửi vào topic chưa đăng ký bằng `kafka-console-producer.sh` → `UNKNOWN_TOPIC_OR_PARTITION` | Lệnh dài; cấu hình `AUTO_CREATE=false` đã đủ để giải thích |
| Kafka UI chỉ đọc: không xóa topic, không gửi message | Không thuộc mục chấm |
| `docker compose stop customer-db` → `customer-service = NOT_SERVING` | AC-HT-06 đã phủ đường 503 |
| Kiểm tra từng header bảo vệ, log JSON từng trường | Header đã là quy định ở mục 4; kiểm tra chi tiết ở spec 11 (mục 26) nếu cần |
| `docker compose config` so `DATABASE_URL` từng service; `printenv` từng service | AC-HT-04 đã cho thấy database riêng |
| Kết nối từ bên trong mạng `cab-net` tới `auth-service:50051` | Không thuộc mục chấm |
| Unit test `migrate.js` chạy hai lần | Test-agent làm khi rảnh |
| Đo thời gian A03 ≤ 1,5 giây khi một service dừng | Deadline đã là hằng số |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| H1 | Mọi service nghe cùng cổng nội bộ 50051 (phân biệt bằng tên host) | Hằng số, `*_GRPC_ADDR` |
| H2 | Healthcheck Docker bằng `node src/healthcheck.js` thay cho `grpc_health_probe` | Dockerfile |
| H3 | Gateway không chờ service healthy (`service_started`) | `depends_on` |
| H4 | 3 partition mỗi topic; Kafka UI chỉ đọc | `kafka-init`, env Kafka UI |
| H5 | Redis không mật khẩu, không volume, `noeviction` (03 mục 13 đã bỏ `REDIS_PASSWORD`) | Lệnh Redis |
| H6 | `details` của gRPC status = mã lỗi | Mọi service và Gateway |
| H7 | Không có thư mục code dùng chung | Cấu trúc |
| H8 | `CLUSTER_ID` của Kafka ghi cố định trong Compose | `compose.yaml` |
| H9 | Biến truyền từng service qua `environment:`, không `env_file` chung | `compose.yaml` |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| H-Q1 | Máy chấm có thể có PostgreSQL cài sẵn trên 5432, làm AC-HT-11 "kết nối được" nhầm | (a) Chứng minh bằng `docker compose ps -a` (không có `->`); (b) không làm gì | (a) | SV |
| H-Q2 | `mem_limit` 256m cho PostgreSQL và tổng RAM (~6 GB) có vừa máy demo không | Đo sau khi chạy | Test-agent đo bằng `docker stats` | Test |
| ~~H-Q3~~ | Đã đóng: dùng `cp .env.example .env` (mục 3.7, 06) | — | — | — |
| H-Q4 | Khóa mẫu trong `.env.example` nằm trên Git: giảng viên có coi là vi phạm mục 2 không | (a) Giữ, ghi rõ "chỉ cho máy demo"; (b) để trống, sinh viên tự điền khi thi | (a) — đã chốt ở 03 mục 11.4; cần nói được đánh đổi | GV |
