# Spec 00 — Hạ tầng: cấu trúc mã nguồn, Compose, Kafka, Gateway health

> Vòng 2, viết 2026-10-03. Mục chấm **1, 2, 5, 6, 7, 8**.
> Đầu vào: `CLAUDE.md` (Quy tắc kiến trúc, Quyết định kỹ thuật, Ràng buộc khi chấm, Cấu trúc thư mục, Quy ước code); `docs/design/02` mục 2, 6, 7; `docs/design/03` mục 1, 11.3, 12, 13, 14; `docs/design/04` mục 1, 2.1; ADR-005, ADR-010, ADR-012, ADR-014.
> Phạm vi: dựng khung **chạy được, chưa có nghiệp vụ**. Mỗi service: khởi động → nối database của mình → chạy migration → trả lời health gRPC. Gateway: ba endpoint health, header bảo vệ, mã request, log, bảng đổi lỗi gRPC → HTTP dùng chung cho các spec sau.
> Ký hiệu: **[ĐC]** đã chốt trong `CLAUDE.md` / design; **[BA]** BA chọn trong spec này, chưa ai xác nhận (gom ở mục 9).

## 1. Truy vết

| Mục chấm | Nội dung phiếu | BG | BR | FR / BRULE | NFR | Thiết kế |
|---|---|---|---|---|---|---|
| 1 | Mô tả kiến trúc tổ chức source code | BG05 | BR16 | — | NFR11, NFR03 | Cấu trúc thư mục `CLAUDE.md`; mục 3.1 dưới |
| 2 | `.gitignore`, `.env` trên GitHub | BG05 | BR15 | — | NFR08 | 03 mục 11.4 "Quản lý khóa" |
| 5 | Compose hệ thống, liệt kê container | BG05 | BR16 | — | NFR03, NFR04 | 02 mục 2.1; 03 mục 1.1, 1.2 |
| 6 | `/health`, `/ready`, `/health/services` | BG05 | BR16 | — | NFR04, NFR15 | 04 A01–A03; 02 G9 |
| 7 | Kafka | BG05 | BR16 | — | NFR05 | 02 mục 6, 7 (K1–K7) |
| 8 | Mọi request đi qua Gateway | BG05 | BR15 | BRULE12 | NFR06, NFR08 | 02 mục 2.1; `CLAUDE.md` |

Không có UC: đây là phần nền mà mọi UC dựa vào.

## 2. Luồng

### 2.1 Khởi động hệ thống (người chạy demo)

| | Nội dung |
|---|---|
| Tác nhân | Người chạy demo (sinh viên), người chấm |
| Tiền điều kiện | Docker Desktop chạy, máy 16 GB RAM; đã có `.env` (tạo từ `.env.example`, mục 4.4) |
| Luồng chính | 1. `docker compose up -d --build`. 2. Database, Redis, Kafka lên và healthy. 3. `kafka-init` tạo 7 topic rồi thoát mã 0. 4. Mỗi service: đọc biến môi trường → nối database (thử lại) → chạy migration → chạy seed nếu `SEED_ON_START=true` → mở gRPC `0.0.0.0:50051` → health `SERVING`. 5. Gateway: nối Redis, tạo 8 kênh gRPC, mở HTTP `0.0.0.0:3000`. 6. Kafka UI mở `:8080` |
| Ngoại lệ | Thiếu biến bắt buộc hoặc khóa sai độ dài → service ghi một dòng lỗi nêu **tên biến** (không ghi giá trị) và thoát mã 1. Database chưa sẵn sau hết lượt thử → thoát mã 1, Compose khởi động lại (`restart: unless-stopped`). Migration lỗi → thoát mã 1, không mở gRPC |
| Hậu điều kiện | 21 container: 20 đang chạy (healthy), `kafka-init` đã thoát mã 0. Chỉ `gateway` và `kafka-ui` có cổng ra máy chủ |

### 2.2 Kiểm tra sức khỏe (mục 6)

| | Nội dung |
|---|---|
| Tác nhân | Người chấm qua Postman (không token) |
| Luồng chính | A01 → 200; A02 → 200 khi Redis trả lời; A03 → Gateway gọi song song `grpc.health.v1.Health/Check` tới 8 service, deadline `HEALTH_CHECK_DEADLINE_MS` → 200 khi cả 8 `SERVING` |
| Ngoại lệ | Redis dừng → A02 trả 503 (A01 vẫn 200). Một service dừng, quá deadline, hoặc mất database → A03 trả 503, body ghi rõ service nào |

## 3. Thành phần tham gia

### 3.1 Cây thư mục (mục 1)

```
cab-system-project/
├─ proto/
│  └─ health.proto              grpc.health.v1 chuẩn (bản sao của gRPC); proto nghiệp vụ thêm ở spec sau:
│                               auth.proto (spec 09-10), customer.proto (spec 11), driver.proto, …
├─ services/
│  ├─ gateway/                  REST → gRPC, JWT, role, rate limit, health
│  ├─ auth-service/
│  ├─ customer-service/
│  ├─ driver-service/
│  ├─ booking-service/
│  ├─ trip-service/
│  ├─ payment-service/
│  ├─ notification-service/
│  └─ rating-service/
├─ scripts/
│  └─ tao-env.mjs               [BA] sinh .env từ .env.example (mục 4.4); chỉ dùng node:crypto
├─ tests/                       test tích hợp, end-to-end (test-agent)
├─ postman/                     collection chia thư mục theo số mục chấm
├─ docs/                        srs, design, specs, decisions, test-reports
├─ compose.yaml
├─ .env.example                 có commit
├─ .env                         KHÔNG commit
├─ .gitignore
├─ .dockerignore
└─ README.md                    cây thư mục này + cách chạy + bảng container (mục 1, 5)
```

Bên trong **mỗi service Node** (gateway giống, trừ `migrations/`):

```
services/<tên>/
├─ package.json          riêng; dependency ghi phiên bản chính xác; "type": "module"; engines node >= 20
├─ package-lock.json
├─ Dockerfile
├─ migrations/           001_*.sql, 002_*.sql … (MongoDB: không có; index tạo lúc khởi động)
├─ src/
│  ├─ index.js           ghép các phần, khởi động, tắt êm khi SIGTERM
│  ├─ config.js          đọc + kiểm tra biến môi trường; thiếu → thoát 1
│  ├─ db.js              kết nối database, thử lại
│  ├─ migrate.js         chạy migration (mục 7.2)
│  ├─ seed.js            seed của service (spec sau điền dữ liệu)
│  ├─ health.js          trạng thái health (mục 5)
│  ├─ healthcheck.js     script cho healthcheck của Docker: gọi Health/Check ở localhost
│  ├─ grpc/              server gRPC, đổi lỗi nghiệp vụ → gRPC status
│  └─ domain/            logic nghiệp vụ, không import gRPC / pg (CLAUDE.md: tách logic, truyền dependency)
└─ test/                 unit test node:test của service
```

| Quyết định | Lý do | Đánh đổi |
|---|---|---|
| Mỗi service một `package.json`, một `Dockerfile`, một `migrations/` [ĐC] | Build, chạy, đổi phiên bản độc lập; khớp database-per-service | Lặp lại vài module nhỏ (config, migrate, health, mã hóa) ở nhiều service |
| **Không** có thư mục code dùng chung giữa service [BA] | Thư viện chung làm các service phải build lại cùng nhau, trái tinh thần độc lập | Sửa một lỗi trong module lặp phải sửa nhiều nơi |
| `proto/` ở gốc, build context của mọi image là **thư mục gốc** | Gateway cần proto của cả 8 service; một nguồn hợp đồng duy nhất | Dockerfile phải ghi đường dẫn từ gốc (`COPY services/auth-service/ …`, `COPY proto/ …`) |

### 3.2 Service sở hữu gì ở spec này

| Thành phần | Sở hữu | Chỉ tham gia |
|---|---|---|
| `gateway` | Ba endpoint health, header bảo vệ, `X-Request-Id`, log truy cập, bảng đổi lỗi | Đọc Redis (ping) |
| 8 service | Health gRPC của chính mình, database của mình, migration của mình | — |
| `kafka-init` | Danh sách 7 topic | — |
| `kafka-ui` | — | Đọc Kafka |

## 4. Compose, biến môi trường, Git

### 4.1 Danh sách container (mục 5) — 21 container

Không container nào ngoài `gateway`, `kafka-ui` có khóa `ports`. Mọi container cùng một mạng `cab-net` (bridge). Phiên bản image: ghi đúng tag dưới (dev được nâng bản vá nếu tag không còn, phải ghi lại trong README).

| # | Container | Image / build | Cổng trong mạng | Cổng ra máy chủ | Healthcheck | Phụ thuộc khởi động (`depends_on`) | Volume | `mem_limit` |
|---|---|---|---|---|---|---|---|---|
| 1 | `gateway` | build `services/gateway/Dockerfile` | 3000 | **`${GATEWAY_PORT:-3000}:3000`** | `wget -qO- http://localhost:3000/health` | `redis`: healthy; 8 service: `service_started` | — | 256m |
| 2 | `auth-service` | build `services/auth-service/Dockerfile` | 50051 | — | `node src/healthcheck.js` | `auth-db`: healthy | — | 256m |
| 3 | `customer-service` | build tương tự | 50051 | — | như trên | `customer-db`: healthy | — | 256m |
| 4 | `driver-service` | build tương tự | 50051 | — | như trên | `driver-db`: healthy; `kafka-init`: completed | — | 256m |
| 5 | `booking-service` | build tương tự | 50051 | — | như trên | `booking-db`: healthy; `kafka-init`: completed | — | 256m |
| 6 | `trip-service` | build tương tự | 50051 | — | như trên | `trip-db`: healthy; `kafka-init`: completed | — | 256m |
| 7 | `payment-service` | build tương tự | 50051 | — | như trên | `payment-db`: healthy; `kafka-init`: completed | — | 256m |
| 8 | `notification-service` | build tương tự | 50051 | — | như trên | `notification-db`: healthy; `kafka-init`: completed | — | 256m |
| 9 | `rating-service` | build tương tự | 50051 | — | như trên | `rating-db`: healthy | — | 256m |
| 10–16 | `auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` | `postgres:16-alpine` | 5432 | — | `pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB` | — | `<tên>-data:/var/lib/postgresql/data` | 256m |
| 17 | `notification-db` | `mongo:7.0`, lệnh `--wiredTigerCacheSizeGB 0.25` | 27017 | — | `mongosh --quiet --eval "db.adminCommand('ping').ok"` | — | `notification-db-data:/data/db` | 512m |
| 18 | `redis` | `redis:7.4-alpine`, lệnh `redis-server --requirepass $${REDIS_PASSWORD} --appendonly yes --maxmemory 64mb --maxmemory-policy noeviction` | 6379 | — | `redis-cli ping` (env `REDISCLI_AUTH`) | — | `redis-data:/data` | 128m |
| 19 | `kafka` | `apache/kafka:3.8.0` (KRaft, một node vừa broker vừa controller) | 9092 (client), 9093 (controller) | — | `/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list` | — | `kafka-data:/var/lib/kafka/data` | **1g** |
| 20 | `kafka-init` | `apache/kafka:3.8.0`, chạy một lần (`restart: "no"`) | — | — | — (thoát mã 0 là xong) | `kafka`: healthy | — | 512m |
| 21 | `kafka-ui` | `provectuslabs/kafka-ui:v0.7.2` | 8080 | **`${KAFKA_UI_PORT:-8080}:8080`** | `wget -qO- http://localhost:8080/actuator/health` | `kafka-init`: completed | — | 512m |

Thông số healthcheck chung [BA]: `interval: 10s`, `timeout: 5s`, `retries: 10`, `start_period: 20s` (Kafka, Kafka UI: `start_period: 40s`). `restart: unless-stopped` cho mọi container trừ `kafka-init`.

Vì sao phụ thuộc như vậy:

| Điểm | Lý do |
|---|---|
| `gateway` chỉ chờ `redis` healthy, với service thì `service_started` | Nếu chờ cả 8 healthy, một service hỏng làm Gateway không lên, và `/health/services` không còn ai để báo lỗi |
| Chỉ 5 service chờ `kafka-init` | Đúng 5 service dùng Kafka (02 mục 1: driver, booking, trip, payment, notification). `auth`, `customer`, `rating` không dùng Kafka nên không phụ thuộc — thể hiện NFR05 |
| Service chờ database **healthy** | Migration chạy ngay khi khởi động |

Cấu hình Kafka (môi trường của container `kafka`):

| Biến | Giá trị | Vì sao |
|---|---|---|
| `KAFKA_NODE_ID` | `1` | Một node |
| `KAFKA_PROCESS_ROLES` | `broker,controller` | KRaft, không cần ZooKeeper (bớt một container) |
| `KAFKA_LISTENERS` | `PLAINTEXT://:9092,CONTROLLER://:9093` | |
| `KAFKA_ADVERTISED_LISTENERS` | `PLAINTEXT://kafka:9092` | Service gọi bằng tên Compose |
| `KAFKA_CONTROLLER_LISTENER_NAMES` | `CONTROLLER` | |
| `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP` | `CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT` | Mạng nội bộ, không mở ra ngoài |
| `KAFKA_CONTROLLER_QUORUM_VOTERS` | `1@kafka:9093` | |
| `CLUSTER_ID` | `${KAFKA_CLUSTER_ID}` | KRaft cần mã cụm cố định để volume dùng lại được |
| `KAFKA_LOG_DIRS` | `/var/lib/kafka/data` | Trùng với volume |
| `KAFKA_AUTO_CREATE_TOPICS_ENABLE` | **`false`** | Mục 7: topic phải được đăng ký rõ; gửi nhầm tên topic là lỗi ngay (02 mục 6.1) |
| `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR`, `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR`, `KAFKA_TRANSACTION_STATE_LOG_MIN_ISR` | `1` | Một broker |
| `KAFKA_HEAP_OPTS` | `-Xms256m -Xmx512m` | Vừa máy 16 GB; `mem_limit: 1g` chặn trên |

`kafka-init` chạy `kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic <tên> --partitions 3 --replication-factor 1` cho đúng 7 topic dưới, rồi `--list` ra log và thoát 0. Lỗi ở bất kỳ topic nào → thoát khác 0 (5 service phụ thuộc sẽ không khởi động, lỗi lộ ngay).

| Mã | Topic | Publish | Subscribe |
|---|---|---|---|
| K1 | `booking.created` | booking | notification |
| K2 | `booking.offer-created` | booking | notification |
| K3 | `booking.no-driver-found` | booking | payment, notification |
| K4 | `booking.canceled` | booking | payment, notification |
| K5 | `trip.status-changed` | trip | driver, payment, notification |
| K6 | `payment.status-changed` | payment | booking, notification |
| K7 | `driver.application-reviewed` | driver | notification |

| Quyết định | Lý do | Đánh đổi |
|---|---|---|
| 3 partition mỗi topic [BA] | Kafka giữ thứ tự theo key trong một partition (02 mục 6.1); nhiều partition cho phép chạy nhiều bản consumer sau này (NFR03) | Message của một topic nằm rải ở 3 partition trên Kafka UI; xem theo key |
| Kafka UI chế độ chỉ đọc: `KAFKA_CLUSTERS_0_READONLY=true`; `KAFKA_CLUSTERS_0_NAME=cab`; `KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS=kafka:9092`; `JAVA_OPTS=-Xmx256m` | Kafka UI là công cụ xem (02 mục 2.1), không được xóa topic hay gửi message giả | Không gửi thử message từ UI được |

Ước lượng RAM tối đa (tổng `mem_limit`): 9 × 256m (Node) + 7 × 256m (PostgreSQL) + 512m (Mongo) + 128m (Redis) + 1g (Kafka) + 512m (Kafka UI) ≈ **6,2 GB**; thực tế lúc rảnh thấp hơn nhiều. `kafka-init` chỉ sống vài giây.

### 4.2 Dockerfile của service Node

| Bước | Nội dung | Lý do |
|---|---|---|
| Image gốc | `node:20-alpine` | Nhỏ; Node ≥ 20 [ĐC] |
| Cài đặt | Copy `package.json`, `package-lock.json` trước → `npm ci --omit=dev` → rồi mới copy `src/`, `migrations/`, `proto/` vào `/app/proto` | Tận dụng cache layer; image không có dev dependency |
| Người chạy | `USER node` | Không chạy bằng root |
| Lệnh | `CMD ["node", "src/index.js"]` | |
| Biến | `PROTO_DIR=/app/proto` | Code tìm proto theo biến, chạy được cả ngoài Docker khi test |

`.dockerignore` ở gốc: `**/node_modules`, `.env`, `.env.*` (trừ `.env.example`), `.git`, `docs`, `tests`, `postman`, `**/coverage`.

### 4.3 Biến môi trường (`.env.example`)

Nguyên tắc: `.env.example` có **đủ tên biến**, giá trị mẫu là **giả rõ ràng** hoặc chỗ đánh dấu để `scripts/tao-env.mjs` thay. Biến chỉ là tên nội bộ (địa chỉ gRPC, URL database) đặt thẳng trong `compose.yaml`, ghép từ biến bí mật, không cần trong `.env`.

**a) Cổng và hạ tầng**

| Biến | Container dùng | Ý nghĩa | Giá trị trong `.env.example` |
|---|---|---|---|
| `GATEWAY_PORT` | gateway (ánh xạ cổng) | Cổng máy chủ của Gateway | `3000` |
| `KAFKA_UI_PORT` | kafka-ui (ánh xạ cổng) | Cổng máy chủ của Kafka UI | `8080` |
| `KAFKA_CLUSTER_ID` | kafka | Mã cụm KRaft (chuỗi base64 22 ký tự) | `__KAFKA_CLUSTER_ID__` |
| `REDIS_PASSWORD` | redis, gateway | Mật khẩu Redis | `__RANDOM_HEX_24__` |
| `AUTH_DB_PASSWORD` | auth-db, auth-service | Mật khẩu user `auth` của `auth-db` | `__RANDOM_HEX_24__` |
| `CUSTOMER_DB_PASSWORD` | customer-db, customer-service | Như trên cho `customer` | `__RANDOM_HEX_24__` |
| `DRIVER_DB_PASSWORD` | driver-db, driver-service | | `__RANDOM_HEX_24__` |
| `BOOKING_DB_PASSWORD` | booking-db, booking-service | | `__RANDOM_HEX_24__` |
| `TRIP_DB_PASSWORD` | trip-db, trip-service | | `__RANDOM_HEX_24__` |
| `PAYMENT_DB_PASSWORD` | payment-db, payment-service | | `__RANDOM_HEX_24__` |
| `RATING_DB_PASSWORD` | rating-db, rating-service | | `__RANDOM_HEX_24__` |
| `NOTIFICATION_DB_PASSWORD` | notification-db, notification-service | Mật khẩu root MongoDB (user `notification`) | `__RANDOM_HEX_24__` |
| `LOG_LEVEL` | gateway, 8 service | `debug` / `info` / `warn` / `error` | `info` |

**b) JWT và khóa mã hóa** (mỗi khóa 32 byte ngẫu nhiên dạng base64; khóa RSA dạng PEM mã base64 một dòng để nằm gọn trong `.env`)

| Biến | Container dùng | Ý nghĩa | Giá trị trong `.env.example` |
|---|---|---|---|
| `JWT_PRIVATE_KEY_B64` | **chỉ** auth-service | Khóa riêng RSA 2048 bit (PKCS#8 PEM → base64) để **ký** JWT | `__RSA_PRIVATE_B64__` |
| `JWT_PUBLIC_KEY_B64` | **chỉ** gateway | Khóa công khai tương ứng (SPKI PEM → base64) để **kiểm tra** JWT | `__RSA_PUBLIC_B64__` |
| `JWT_ISSUER` | auth-service, gateway | Giá trị claim `iss` | `cab-auth-service` |
| `JWT_TTL_SECONDS` | auth-service | Thời sống token | `3600` |
| `AUTH_DATA_KEY` | auth-service | AES-256-GCM cho `phone_enc`, `email_enc` | `__RANDOM_B64_32__` |
| `AUTH_BLIND_INDEX_KEY` | auth-service | HMAC chỉ mục mù số điện thoại, email | `__RANDOM_B64_32__` |
| `AUTH_OTP_HMAC_KEY` | auth-service | HMAC mã OTP (spec 21) | `__RANDOM_B64_32__` |
| `CUSTOMER_DATA_KEY` | customer-service | AES-256-GCM cho họ tên, ngày sinh | `__RANDOM_B64_32__` |
| `DRIVER_DATA_KEY` | driver-service | AES-256-GCM số giấy phép (spec 21) | `__RANDOM_B64_32__` |
| `DRIVER_BLIND_INDEX_KEY` | driver-service | Chỉ mục mù số giấy phép | `__RANDOM_B64_32__` |
| `PAYMENT_CALLBACK_SECRET` | payment-service | Khóa bí mật cố định trong header `X-Callback-Secret` của A32 (ADR-014), ≥ 32 ký tự | `__RANDOM_HEX_32__` |

**c) Giả lập, seed, giới hạn thời gian** (giới hạn thời gian là **giới hạn trên**, hạ xuống khi demo trường hợp hết hạn)

| Biến | Container dùng | Ý nghĩa | Giá trị trong `.env.example` |
|---|---|---|---|
| `SIMULATION_MODE` | auth-service, payment-service | `true`: OTP trả trong response A07; A31 nhận `simulate_result`. **Phải `false` khi chạy thật** | `true` |
| `SEED_ON_START` | 8 service | `true`: chạy seed (không ghi đè) sau migration mỗi lần khởi động | `true` |
| `SEED_PASSWORD` | auth-service | Mật khẩu chung của tài khoản seed (spec 09-10 mục 7.3) | `__SEED_PASSWORD__` (script sinh 16 ký tự) |
| `PAYMENT_TIMEOUT_SECONDS` | payment-service | Hạn thanh toán điện tử (BRULE17) | `600` |
| `PAYMENT_MAX_ATTEMPTS` | payment-service | Số lần thử tối đa (BRULE17) | `3` |
| `OFFER_TIMEOUT_SECONDS` | booking-service | Hạn tài xế trả lời Offer (BRULE04) | `20` |
| `SEARCH_RADIUS_M` | booking-service | Bán kính tìm tài xế (FR02) | `1000` |
| `FARE_DISTANCE_FACTOR` | booking-service | Hệ số quãng đường ước tính | `1.3` |
| `OTP_TTL_SECONDS` | auth-service | Hạn OTP | `300` |
| `OTP_MAX_ATTEMPTS` | auth-service | Số lần nhập sai OTP tối đa | `5` |
| `RATE_LIMIT_WINDOW_SECONDS` | gateway | Cửa sổ rate limit | `60` |
| `RATE_LIMIT_PUBLIC_MAX` | gateway | Ngưỡng route công khai theo IP | `30` |
| `RATE_LIMIT_ACCOUNT_MAX` | gateway | Ngưỡng route có token theo tài khoản | `120` |
| `OUTBOX_POLL_INTERVAL_MS` | driver, booking, trip, payment | Chu kỳ quét outbox (lưới an toàn) | `200` |
| `GATEWAY_GRPC_DEADLINE_MS` | gateway | Deadline Gateway → service (Q25) | `3000` |
| `SERVICE_GRPC_DEADLINE_MS` | booking, trip, rating | Deadline service → service (Q25) | `1000` |
| `HEALTH_CHECK_DEADLINE_MS` | gateway | Deadline mỗi lời hỏi health ở A03 | `1000` |

Biến **đặt trong `compose.yaml`** (không bí mật, không cần trong `.env`):

| Biến | Container | Giá trị |
|---|---|---|
| `GRPC_PORT` | 8 service | `50051` |
| `HTTP_PORT` | gateway | `3000` |
| `DATABASE_URL` | 7 service PostgreSQL | `postgres://<tên>:${<TÊN>_DB_PASSWORD}@<tên>-db:5432/<tên>` (ví dụ `postgres://auth:${AUTH_DB_PASSWORD}@auth-db:5432/auth`) |
| `MONGODB_URI` | notification-service | `mongodb://notification:${NOTIFICATION_DB_PASSWORD}@notification-db:27017/notification?authSource=admin` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | 7 database | `<tên>`, `<tên>`, `${<TÊN>_DB_PASSWORD}` |
| `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD` | notification-db | `notification`, `${NOTIFICATION_DB_PASSWORD}` |
| `REDIS_URL` | gateway | `redis://:${REDIS_PASSWORD}@redis:6379` |
| `KAFKA_BROKERS` | 5 service dùng Kafka | `kafka:9092` |
| `AUTH_GRPC_ADDR` … `RATING_GRPC_ADDR` | gateway (8 biến); booking (`DRIVER_`, `PAYMENT_`, `TRIP_GRPC_ADDR`); trip (`DRIVER_GRPC_ADDR`); rating (`TRIP_GRPC_ADDR`) | `<tên-service>:50051`. Mỗi service **chỉ** nhận địa chỉ của service nó được phép gọi theo 02 mục 4.3 |
| `SERVICE_NAME` | gateway, 8 service | Tên container, ghi vào log |

Quy tắc kiểm tra khi khởi động (`config.js`): biến bắt buộc thiếu → thoát 1; khóa `*_KEY` giải base64 không ra đúng 32 byte → thoát 1; số nguyên không hợp lệ hoặc ≤ 0 → thoát 1; `SIMULATION_MODE=true` → ghi log mức `warn` "đang chạy chế độ giả lập". Log chỉ nêu tên biến, không bao giờ nêu giá trị.

### 4.4 Tạo `.env` [BA]

`node scripts/tao-env.mjs` đọc `.env.example`, thay mọi chỗ đánh dấu bằng giá trị sinh từ `node:crypto` (`randomBytes`, `generateKeyPairSync('rsa', { modulusLength: 2048 })`), ghi ra `.env`. Đã có `.env` thì **không ghi đè** (in thông báo, thoát 0).

| Đánh dấu | Thay bằng |
|---|---|
| `__RANDOM_B64_32__` | 32 byte ngẫu nhiên, base64 (mỗi chỗ một giá trị khác nhau) |
| `__RANDOM_HEX_24__`, `__RANDOM_HEX_32__` | 24 / 32 byte ngẫu nhiên, hex |
| `__RSA_PRIVATE_B64__`, `__RSA_PUBLIC_B64__` | Một cặp khóa RSA 2048, PEM → base64 |
| `__KAFKA_CLUSTER_ID__` | 16 byte ngẫu nhiên, base64url không đệm (22 ký tự) |
| `__SEED_PASSWORD__` | 16 ký tự chữ + số ngẫu nhiên |

Lý do: người chấm chạy được ngay một lệnh; không có khóa nào nằm trong Git. Đánh đổi: thêm thư mục `scripts/` ngoài cấu trúc mục tiêu (câu hỏi H-Q1).

### 4.5 `.gitignore` (mục 2)

Giữ nội dung hiện có, thêm các dòng đánh dấu `+`:

```
# Dependencies: cài lại bằng npm install.
node_modules/

# Cấu hình thật có mật khẩu và khóa. Chỉ commit .env.example.
.env
.env.*
!.env.example
+ *.pem
+ *.key

# Log và file tạm.
*.log
npm-debug.log*
coverage/

# Hệ điều hành và editor.
.DS_Store
Thumbs.db
.vscode/
.idea/

# Cấu hình Claude Code riêng của từng máy.
.claude/settings.local.json
```

Kiểm tra trước khi push: `git ls-files | grep -E '(^|/)\.env'` chỉ ra `.env.example`; `git log --all --format=%H -- .env` rỗng (nếu không rỗng: `.env` từng bị commit → phải đổi mọi khóa, ghi vào báo cáo).

## 5. API REST tại Gateway

Áp dụng cho **mọi** route, kể cả route của spec sau [ĐC 04 mục 1]:

| Điểm | Quy định |
|---|---|
| Header mọi response | `X-Content-Type-Options: nosniff`; `Content-Security-Policy: default-src 'none'`; `Cache-Control: no-store`; `X-Request-Id` |
| `X-Request-Id` | Gateway luôn sinh UUID mới (không lấy từ client), trả trong response, chuyển cho service qua metadata `x-request-id` |
| Route không tồn tại | 404 `{ "error": "ROUTE_NOT_FOUND" }` |
| Lỗi không lường trước trong Gateway | 503 `{ "error": "SERVICE_UNAVAILABLE" }`, không stack trace; log mức `error` kèm `request_id` |
| Log truy cập (một dòng JSON / request) | `time`, `level`, `service`, `request_id`, `method`, `path` (**không** kèm query string), `status`, `duration_ms`, `account_id` (nếu có). **Không** ghi header `Authorization`, body, mật khẩu, số điện thoại, email |
| Lắng nghe | `0.0.0.0:${HTTP_PORT}` |

### A01 `GET /health` — Gateway còn sống

| | |
|---|---|
| Token / role | Không / — |
| Response 200 | `{ "status": "UP" }` |
| Lỗi | Không có (tiến trình chết thì không có response — healthcheck Docker thấy) |

### A02 `GET /ready` — Gateway đủ phụ thuộc của chính nó

| | |
|---|---|
| Token / role | Không / — |
| Kiểm tra | (1) Redis `PING` trả `PONG` trong 500 ms; (2) đã tạo xong 8 client gRPC |
| Response 200 | `{ "status": "READY", "checks": { "redis": "UP", "grpc_clients": "UP" } }` |
| Response 503 | `{ "status": "NOT_READY", "checks": { "redis": "DOWN", "grpc_clients": "UP" } }` — Redis dừng (P5 của file 04: Gateway **vẫn phục vụ** request khác, chỉ báo chưa đủ) |

### A03 `GET /health/services` — tám service phía sau

| | |
|---|---|
| Token / role | Không / — |
| Cách làm | Gọi **song song** `grpc.health.v1.Health/Check` với `service: ""` tới 8 service, mỗi lời gọi deadline `HEALTH_CHECK_DEADLINE_MS`. Tổng thời gian ≤ deadline + vài chục ms |
| Giá trị mỗi service | `SERVING`; `NOT_SERVING` (service trả lời nhưng mất database); `UNREACHABLE` (không kết nối được hoặc quá deadline) |
| Response 200 | Cả 8 `SERVING`: `{ "status": "UP", "services": { "auth-service": "SERVING", "customer-service": "SERVING", "driver-service": "SERVING", "booking-service": "SERVING", "trip-service": "SERVING", "payment-service": "SERVING", "notification-service": "SERVING", "rating-service": "SERVING" } }` |
| Response 503 | Có ít nhất một service khác `SERVING`: `{ "status": "DEGRADED", "services": { …, "rating-service": "UNREACHABLE" } }` |

Ba endpoint health không có tiền tố `/api/v1`, không cần token, không bị rate limit [ĐC 04 mục 1, 1.5]. Body của chúng **không** theo dạng `{ "error": … }` vì là báo cáo trạng thái, không phải lỗi của request.

### 5.1 Bảng đổi lỗi gRPC → HTTP (dùng cho mọi spec sau) [ĐC]

**Quy ước hợp đồng lỗi [BA]:** service trả lỗi nghiệp vụ bằng gRPC status kèm `details` (chuỗi message của status) **đúng bằng mã lỗi**, ví dụ `status: NOT_FOUND, details: "CUSTOMER_NOT_FOUND"`. Gateway trả `{ "error": "<details>" }` với HTTP theo bảng:

| gRPC status | HTTP | Body |
|---|---|---|
| `INVALID_ARGUMENT` | 400 | `{ "error": details }` |
| `UNAUTHENTICATED` | 401 | như trên |
| `PERMISSION_DENIED` | 403 | như trên |
| `NOT_FOUND` | 404 | như trên |
| `ALREADY_EXISTS` | 409 | như trên |
| `FAILED_PRECONDITION` | 409 | như trên |
| Mọi status khác (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, `UNKNOWN`, …) | 503 | `{ "error": "SERVICE_UNAVAILABLE" }` — **bỏ** `details` để không lộ lỗi nội bộ |

Nếu `details` không khớp mẫu `^[A-Z][A-Z0-9_]{2,63}$` thì Gateway coi là lỗi nội bộ → 503. Mọi lời gọi gRPC có deadline [ĐC].

## 6. Hợp đồng gRPC

Chỉ có health ở spec này. File `proto/health.proto`: bản sao nguyên văn `grpc.health.v1` của gRPC.

| rpc | Vào | Ra | Ai gọi | Lỗi |
|---|---|---|---|---|
| `grpc.health.v1.Health/Check` | `HealthCheckRequest { string service = 1; }` — gửi `""` | `HealthCheckResponse { ServingStatus status = 1; }` | Gateway (A03, đường G9); `src/healthcheck.js` của chính container | `service` khác `""` và khác tên đã đăng ký → `NOT_FOUND` |

Service trả `SERVING` khi **đồng thời**: đã chạy xong migration, và lần kiểm tra database gần nhất thành công. Kiểm tra database: PostgreSQL `SELECT 1`, MongoDB `ping`, thời hạn 500 ms, chạy mỗi lần nhận `Check` (không cache) [BA]. Sai → `NOT_SERVING`. Kafka **không** nằm trong điều kiện health ở spec này (chưa có producer / consumer).

Không cài `Health/Watch` (Gateway không dùng).

## 7. Giao tiếp giữa service, dữ liệu, migration, seed

### 7.1 Giao tiếp

| Đường | Kiểu | Lý do |
|---|---|---|
| Gateway → 8 service: `Health/Check` | gRPC (G9) | Mục 6: Gateway phải trả lời ngay trạng thái từng service |
| Gateway → Redis: `PING` | Redis | A02 |
| `kafka-init` → Kafka: tạo topic | Kafka admin | Mục 7: topic đăng ký rõ |

Chưa có lời gọi service → service và chưa có event ở spec này.

### 7.2 Cơ chế migration (7 service PostgreSQL)

| Bước | Làm gì |
|---|---|
| 1 | Lấy khóa `SELECT pg_advisory_lock(<hằng số của service>)` — hai bản service khởi động cùng lúc không chạy migration hai lần |
| 2 | `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())` |
| 3 | Đọc file `migrations/*.sql`, sắp xếp theo tên; bỏ qua file đã có trong `schema_migrations` |
| 4 | Mỗi file chạy trong **một giao dịch** cùng lệnh `INSERT INTO schema_migrations(version) VALUES ($1)`; lỗi → rollback, nhả khóa, thoát 1 |
| 5 | Nhả khóa |

Quy ước tên: `NNN_mo-ta.sql` (ba chữ số, ví dụ `001_tao-accounts.sql`). Không sửa file đã chạy; đổi schema bằng file mới [ĐC]. `gen_random_uuid()` có sẵn từ PostgreSQL 13, **không** cần extension.

Ở spec này: thư mục `migrations/` của mỗi service chỉ có `.gitkeep`; bảng duy nhất là `schema_migrations`. Spec sau thêm `001_…`.

`notification-service` (MongoDB): không có migration; khi khởi động gọi `createIndex` cho index của collection (spec sau định nghĩa) — lệnh này chạy lặp không sao.

### 7.3 Cơ chế seed (dữ liệu cụ thể ở spec từng mục)

| Điểm | Quy định | Lý do |
|---|---|---|
| Ở đâu | `src/seed.js` của **từng** service, dùng chính module mã hóa / băm của service | Dữ liệu mã hóa bằng khóa trong `.env`; SQL tay không làm được (03 mục 14) |
| Khi nào | Sau migration, nếu `SEED_ON_START=true` | Người chấm không phải tạo tay (`CLAUDE.md` Ràng buộc khi chấm) |
| Chạy lặp | Mọi lệnh ghi dùng `ON CONFLICT DO NOTHING` (MongoDB: `updateOne … upsert` với `$setOnInsert`) | Khởi động lại không nhân đôi, không ghi đè dữ liệu đã đổi khi demo |
| Đặt lại | `docker compose exec <service> node src/seed.js --reset`: xóa đúng các dòng có ID seed rồi chèn lại | Demo đổi trạng thái (tài xế bận, chuyến hủy); chấm lại phải về điểm đầu |
| ID | Cố định dạng `00000000-0000-4000-8000-0000000000NN` | Nhiều database phải khớp ID; Postman đặt sẵn biến |
| Ở spec này | `seed.js` tồn tại, chưa chèn gì, ghi log "seed: 0 dòng" | Khung cho spec sau |

## 8. Tiêu chí chấp nhận

Tiền điều kiện chung: `.env` tạo bằng `node scripts/tao-env.mjs`; `docker compose up -d --build` đã chạy xong.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-HT-01 | 1 | Repo ở nhánh hiện tại | Mở `README.md` | Có cây thư mục như mục 3.1, mô tả vai trò từng thư mục, bảng container, các lệnh chạy; 9 thư mục trong `services/` mỗi thư mục có `package.json`, `package-lock.json`, `Dockerfile` riêng; `proto/health.proto` tồn tại |
| AC-HT-02 | 2 | Repo đã push | `git ls-files` | Có `.gitignore`, `.env.example`; **không** có `.env`, file `*.pem`, `*.key`, `node_modules` |
| AC-HT-03 | 2 | `.env.example` | Đọc file | Có đủ mọi biến ở mục 4.3 a, b, c; không giá trị nào giống giá trị trong `.env` thật; khóa chỉ là chỗ đánh dấu `__…__` |
| AC-HT-04 | 2 (lỗi) | `.env` thiếu `CUSTOMER_DATA_KEY` hoặc khóa chỉ 16 byte | `docker compose up customer-service` | Container thoát mã 1; log có tên biến `CUSTOMER_DATA_KEY`, **không** có giá trị khóa |
| AC-HT-05 | 5 | Compose đã lên | `docker compose ps -a` | Đủ 21 container ở mục 4.1; 20 container `running (healthy)`; `kafka-init` `exited (0)` |
| AC-HT-06 | 5 | Compose đã lên | `docker compose config` | Mỗi service nghiệp vụ trỏ đúng database riêng của nó (`DATABASE_URL` / `MONGODB_URI` khác nhau, host khác nhau); 8 database là 8 container khác nhau |
| AC-HT-07 | 5 | Compose đang chạy | `docker compose restart auth-service` | `auth-service` healthy lại; `schema_migrations` không có dòng trùng; seed không nhân đôi |
| AC-HT-08 | 6 | Mọi thứ healthy | Postman `GET http://localhost:3000/health` | 200 `{ "status": "UP" }`; có header `X-Request-Id`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` |
| AC-HT-09 | 6 | Mọi thứ healthy | `GET /ready` | 200, `checks.redis = "UP"` |
| AC-HT-10 | 6 | Mọi thứ healthy | `GET /health/services` | 200, `status = "UP"`, đủ 8 khóa đúng tên service, tất cả `SERVING` |
| AC-HT-11 | 6 (lỗi) | `docker compose stop rating-service` | `GET /health/services` | 503, `status = "DEGRADED"`, `rating-service = "UNREACHABLE"`, 7 service còn lại `SERVING`; phản hồi trong ≤ 1,5 giây |
| AC-HT-12 | 6 (lỗi) | `docker compose stop customer-db` | `GET /health/services` | 503, `customer-service = "NOT_SERVING"` |
| AC-HT-13 | 6 (lỗi) | `docker compose stop redis` | `GET /ready` rồi `GET /health` | `/ready` 503, `checks.redis = "DOWN"`; `/health` vẫn 200 |
| AC-HT-14 | 6 | Bất kỳ | `GET /khong-ton-tai` | 404 `{ "error": "ROUTE_NOT_FOUND" }` |
| AC-HT-15 | 7 | Compose đã lên | Mở `http://localhost:8080` → cluster `cab` → Topics | Thấy **đủ 7 topic** ở mục 4.1, mỗi topic 3 partition; không có topic nghiệp vụ nào khác (topic nội bộ bắt đầu bằng `__` được phép) |
| AC-HT-16 | 7 | Compose đã lên | `docker compose logs kafka-init` | Log liệt kê 7 topic; container thoát 0 |
| AC-HT-17 | 7 (lỗi) | Compose đã lên | `docker compose exec kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic topic.khong-dang-ky` rồi gửi một dòng | Báo lỗi không có topic (`UNKNOWN_TOPIC_OR_PARTITION`); Kafka UI không xuất hiện topic mới — chứng minh broker tắt tự tạo topic |
| AC-HT-18 | 7 | Kafka UI | Thử xóa topic hoặc gửi message trên UI | Không có nút / bị từ chối (chế độ chỉ đọc) |
| AC-HT-19 | 8 | Compose đã lên | `docker compose ps --format "{{.Name}} {{.Ports}}"` | Chỉ `gateway` có `0.0.0.0:3000->3000/tcp` và `kafka-ui` có `0.0.0.0:8080->8080/tcp`; mọi container khác chỉ có cổng nội bộ (không có `->`) |
| AC-HT-20 | 8 (lỗi) | Compose đã lên; máy chủ không tự cài PostgreSQL / Redis / Kafka chạy sẵn trên các cổng này | Từ máy chủ: `curl -m 3 http://localhost:50051`; `psql -h localhost -p 5432 -U auth` (hoặc `Test-NetConnection localhost -Port 5432`); `redis-cli -h localhost -p 6379 ping`; kết nối `localhost:9092`; `localhost:27017` | **Mọi lệnh đều thất bại** (connection refused / timeout) |
| AC-HT-21 | 8 | Compose đã lên | `docker compose exec gateway node -e "require('net').connect(50051,'auth-service').on('connect',()=>{console.log('OK');process.exit(0)}).on('error',()=>process.exit(1))"` | In `OK`: kết nối được từ **bên trong** mạng `cab-net` — service vẫn chạy, chỉ là không mở ra máy chủ |
| AC-HT-22 | 8 | Compose đã lên | `docker compose logs gateway` sau AC-HT-08 … 14 | Mỗi request một dòng JSON có `request_id`, `method`, `path`, `status`, `duration_ms`; không có header `Authorization` |
| AC-HT-23 | Quy ước | Unit test Gateway (không cần Docker) | Giả lập service trả `NOT_FOUND` + `"CUSTOMER_NOT_FOUND"`; trả `INTERNAL` + `"lỗi gì đó"`; trả `FAILED_PRECONDITION` + `"X"` (sai mẫu) | Lần lượt 404 `{error:"CUSTOMER_NOT_FOUND"}`; 503 `SERVICE_UNAVAILABLE`; 503 `SERVICE_UNAVAILABLE` |
| AC-HT-24 | Quy ước | Unit test `migrate.js` với database giả | Chạy hai lần | Lần hai không chạy lại file nào; một file lỗi thì không có dòng `schema_migrations` cho file đó |

Kết quả mong đợi theo phiếu chấm: mục 5 — liệt kê được 21 container và vai trò; mục 6 — ba request đều 200; mục 7 — Kafka UI thấy 7 topic (message xuất hiện sau khi làm spec 15); mục 8 — chỉ hai cổng, gọi thẳng thất bại.

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn trong spec này

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| H1 | Mọi service nghe cùng cổng nội bộ 50051 (phân biệt bằng tên host) | `GRPC_PORT`, `*_GRPC_ADDR` |
| H2 | Healthcheck Docker của service bằng `node src/healthcheck.js` thay cho tải `grpc_health_probe` | Dockerfile |
| H3 | Gateway không chờ service healthy (`service_started`) | `depends_on` |
| H4 | 3 partition mỗi topic; Kafka UI chỉ đọc | `kafka-init`, env Kafka UI |
| H5 | Redis có mật khẩu và AOF (`--appendonly yes`), `noeviction` | Lệnh Redis — danh sách thu hồi không được bị xóa ngầm khi đầy bộ nhớ |
| H6 | Quy ước lỗi: `details` của gRPC status = mã lỗi | Mọi service và Gateway |
| H7 | Không có thư mục code dùng chung giữa service | Cấu trúc |
| H8 | JWT ký RS256, khóa PEM dạng base64 trong biến môi trường (theo đề xuất Q19 (a) của file 02) | Spec 09-10 |
| H9 | `X-Request-Id` luôn do Gateway sinh, bỏ qua giá trị client gửi | Mục 5 |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| H-Q1 | Thêm `scripts/tao-env.mjs` (ngoài cấu trúc thư mục mục tiêu trong `CLAUDE.md`) có được không? | (a) Có; (b) không — README hướng dẫn tự sinh khóa bằng lệnh `node -e …` và `openssl` | (a): một lệnh, không sai độ dài khóa | SV |
| H-Q2 | Q19 (JWT bất đối xứng) vẫn đang mở ở file 02. Spec này đã chọn RS256 theo đề xuất (a) | (a) RS256; (b) HS256 khóa chung | (a): Gateway không tự tạo được token, lộ cấu hình Gateway không giả được token | SV |
| H-Q3 | Q25 (deadline) đang mở; spec dùng 3000 ms (Gateway → service), 1000 ms (service → service), 1000 ms (health) | Giữ / đổi | Giữ, là biến môi trường | SV |
| H-Q4 | Máy chấm có thể có PostgreSQL / Redis cài sẵn trên 5432 / 6379, làm AC-HT-20 "thành công nhầm" | (a) Ghi chú trong README: chứng minh bằng `docker compose ps` + `docker port <container>` (rỗng); (b) không làm gì | (a) | SV |
| H-Q5 | `mem_limit` 256m cho mỗi PostgreSQL có đủ không (03 mục 1.2 chưa đo) | Đo sau khi chạy | Test-agent đo bằng `docker stats` và ghi báo cáo | Test |
