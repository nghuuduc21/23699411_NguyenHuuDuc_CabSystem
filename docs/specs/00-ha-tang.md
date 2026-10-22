# Spec 00 — Hạ tầng: cấu trúc mã nguồn, Compose, Kafka, Gateway health

> Vòng 2, viết 2026-10-03; **sửa 2026-10-03 theo luật thi** (gõ tay mọi request và lệnh, không mở tài liệu): bỏ `scripts/`, `.env.example` có sẵn giá trị dùng được, biến môi trường còn 14, user database `cab`, Redis không mật khẩu, bỏ outbox, đặt lại dữ liệu bằng `down -v`, rút gọn tiêu chí chấp nhận. **Đồng bộ với 04 lần 3:** Gateway đọc body JSON bất kể `Content-Type`, lệnh `psql` dạng `table <bảng>`, tạo `.env` bằng `cp`. **Đồng bộ với 04 lần 4 (ADR-018):** route nghiệp vụ dưới `/api/v1/`; ba endpoint health ở ngoài tiền tố; `GET` bỏ qua body; đóng H-Q4 (giảng viên cho phép khóa mẫu trong `.env.example`). **Sửa 2026-10-04 theo phản hồi dev-agent sau khi dựng thật:** healthcheck gọi `127.0.0.1`; H-Q1 thêm trường hợp MongoDB của Windows; ghi nhận chi tiết code đã chọn (H10–H12, mục 3.2, 3.5, 4).
> **Sửa 2026-10-05 (sinh viên chốt, sửa lỗi L3) — ADR-020:** mỗi service một **cổng gRPC riêng**: auth 50051, customer 50052, driver 50053, booking 50054, trip 50055, payment 50056, notification 50057, rating 50058 (mục 2.1, 3.1, 3.2, 3.5, H1). Ghi rõ quy ước chống lặp event (mục 3.3). AC mới: AC-HT-14, AC-HT-15; AC đổi: AC-HT-11.
> **Sửa 2026-10-14 (theo yêu cầu giảng viên, sinh viên chốt):** giá trị trả về của ba endpoint health phải **đúng chữ**: `/health` → `{"status":"healthy"}`; `/ready` → `{"status":"ready","checks":…}` / 503 `{"status":"not_ready",…}`; `/health/services` → `{"status":"healthy","services":{…:"healthy"}}` / 503 `{"status":"unhealthy","services":{…,"rating-service":"unhealthy"}}`. Mục sửa: 2.2, A01–A03, AC-HT-05/06/07 (đổi), AC-HT-16, AC-HT-17 (mới), H13. Code Gateway phải đổi (`src/health.js`); `healthcheck.js` của Docker không đổi (chỉ xét mã HTTP).
> **Sửa 2026-10-21 (sinh viên chốt L2 của báo cáo `docs/test-reports/2026-10-21-hoi-quy-gop-y-giang-vien.md`):** **mọi lời gọi gRPC** (Gateway → service, gồm health; service → service) bật **`waitForReady`**, giữ nguyên deadline (mục 3.5 "Client gRPC", H14). Hệ quả: request đầu sau khi service chạy lại không còn 503; service dừng hẳn thì 503 đến **sau khi hết deadline** (≤ 3 s; `/health/services` ≈ 1 s), không ngay. Cùng đợt: `trip-service` không còn gọi `driver-service` (S6 bỏ, spec 17-18 CD10) nên không cần `DRIVER_GRPC_ADDR`. Mục sửa: 2.2, 3.5, A03, 4.1, 8, 9.1. AC đổi: AC-HT-06, AC-HT-14, AC-HT-15; AC mới: AC-HT-18, AC-HT-19.
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
| Luồng chính | 1. `docker compose up -d --build`. 2. Database, Redis, Kafka lên và healthy. 3. `kafka-init` tạo 7 topic rồi thoát mã 0. 4. Mỗi service: đọc biến môi trường → nối database (thử lại) → chạy migration → chạy seed nếu `SIMULATION_MODE=true` → mở gRPC `0.0.0.0:<cổng của service>` (50051–50058, mục 3.2) → health `SERVING`. 5. Gateway: nối Redis, tạo 8 kênh gRPC, mở HTTP `0.0.0.0:3000`. 6. Kafka UI mở `:8080` |
| Ngoại lệ | Thiếu biến bắt buộc hoặc khóa sai độ dài → service ghi một dòng lỗi nêu **tên biến** (không ghi giá trị), thoát mã 1. Database chưa sẵn sau hết lượt thử, hoặc migration lỗi → thoát mã 1, Compose khởi động lại (`restart: unless-stopped`) |
| Hậu điều kiện | 21 container: 20 đang chạy (healthy), `kafka-init` đã thoát mã 0. Chỉ `gateway` (3000) và `kafka-ui` (8080) có cổng ra máy |

### 2.2 Kiểm tra sức khỏe (mục 6)

| | Nội dung |
|---|---|
| Tác nhân | Người chấm qua Postman (không token) |
| Luồng chính | A01 → 200 `healthy`; A02 → 200 `ready` khi Redis trả lời; A03 → Gateway gọi song song `Health/Check` tới 8 service (deadline 1 000 ms, hằng số) → 200 `healthy` khi cả 8 trả `SERVING` |
| Ngoại lệ | Redis dừng → A02 trả 503 `not_ready` (A01 vẫn 200). Một service dừng hoặc mất database → A03 trả 503 `unhealthy`, body ghi rõ service nào `unhealthy`. Service dừng hẳn: A03 trả sau ≈ 1 s (hết deadline health, vì `waitForReady` — H14) |

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
│  ├─ healthcheck.js     cho healthcheck của Docker: gọi Health/Check ở 127.0.0.1:<cổng của service> (cùng hằng số với server)
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
| 1 | `gateway` | build `services/gateway` | 3000 | **`3000:3000`** | `wget -qO- http://127.0.0.1:3000/health` | `redis`: healthy; 8 service: `service_started` | 256m |
| 2–3 | `auth-service`, `customer-service` | build | **50051**, **50052** | — | `node src/healthcheck.js` | database của mình: healthy | 256m |
| 4–8 | `driver-service`, `booking-service`, `trip-service`, `payment-service`, `notification-service` | build | **50053**, **50054**, **50055**, **50056**, **50057** | — | như trên | database của mình: healthy; `kafka-init`: completed | 256m |
| 9 | `rating-service` | build | **50058** | — | như trên | `rating-db`: healthy | 256m |

Cổng gRPC (sửa 2026-10-05, ADR-020) theo thứ tự 8 service trong `CLAUDE.md`: auth **1**, customer **2**, driver **3**, booking **4**, trip **5**, payment **6**, notification **7**, rating **8** → `5005n`. Lý do: lỗi L3 — sau khi restart một container, Docker có thể cấp IP cũ của nó cho container khác; khi mọi service cùng nghe 50051, kênh gRPC đã phân giải tên thành IP sẽ nối **nhầm service** mà vẫn thành công. Cổng khác nhau thì nối nhầm IP bị từ chối kết nối → kênh tự phân giải lại tên. Đánh đổi: thêm một con số mỗi service phải nhớ và cấu hình đúng ở bên gọi.
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

Healthcheck của gateway và 8 service gọi **`127.0.0.1`**, không gọi `localhost` (sửa 2026-10-04 sau khi dựng thật): trong image alpine `localhost` phân giải sang `::1` (IPv6) trước, còn Node chỉ nghe IPv4 `0.0.0.0` nên bị từ chối và container kẹt `starting`.

Compose [BA, khớp code]: `name: cab` ở đầu `compose.yaml` → project tên `cab`, mạng `cab-net`, volume có tiền tố `cab_` (ví dụ `cab_auth-data`), không phụ thuộc tên thư mục máy chấm.

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

Quy ước chống lặp ở bên nghe (sinh viên xác nhận 2026-10-05, 02 mục 6.4, 03 mục 11.3): **không có bảng event đã xử lý**. Payment, Driver, Booking chống lặp bằng **trạng thái** (bước chuyển có điều kiện, event lặp gặp trạng thái đã đổi thì bỏ qua) và không lưu `event_id`; Notification bằng UNIQUE (`event_id`, `recipient_id`) vì thông báo không có trạng thái để so. Đánh đổi: không có nơi tra "event này đã xử lý chưa"; handler phải viết điều kiện cẩn thận.

### 3.4 Dockerfile của service Node

| Bước | Nội dung | Lý do |
|---|---|---|
| Image gốc | `node:20-alpine` | Nhỏ; Node ≥ 20 [ĐC] |
| Cài đặt | Copy `package.json`, `package-lock.json` → `npm ci --omit=dev` → copy `src/`, `migrations/`, `proto/` vào `/app/proto` | Tận dụng cache layer |
| Người chạy | `USER node` | Không chạy bằng root |
| Lệnh | `CMD ["node", "src/index.js"]`; `PROTO_DIR=/app/proto` | Code tìm proto theo biến, chạy được ngoài Docker khi test |

`.dockerignore`: `**/node_modules`, `.env`, `.git`, `docs`, `tests`, `postman`, `**/coverage`.

### 3.5 Biến môi trường — 14 biến (theo 03 mục 13) [ĐC]

> **Sửa 2026-10-22 (ADR-022):** 5 biến bí mật trong `.env.example` để trống, mỗi máy tự sinh trong `.env`; phần dưới giữ để truy vết.

`.env.example` có **sẵn giá trị dùng được**: sao chép thành `.env` là chạy. Khóa trong file là **khóa mẫu chỉ cho máy demo**; chạy thật phải thay trong `.env`. Đánh đổi phải nói khi thi: khóa mẫu nằm trên Git nên dữ liệu demo không thật sự bí mật.

| # | Biến | Container nhận | Giá trị trong `.env.example` |
|---|---|---|---|
| 1 | `DB_PASSWORD` | 8 database; service **không** nhận riêng, chỉ nhận qua `DATABASE_URL` / `MONGODB_URI` (bảng dưới) | `cab123` |
| 2 | `JWT_SECRET` | **chỉ** auth-service (ký), gateway (kiểm tra) | `demo-jwt-secret-chi-dung-cho-may-demo-32b` (≥ 32 ký tự) |
| 3 | `JWT_TTL_SECONDS` | auth-service | `3600` |
| 4 | `CUSTOMER_DATA_KEY` | **chỉ** customer-service | 32 byte base64 cố định (44 ký tự) |
| 5 | `DRIVER_DATA_KEY` | **chỉ** driver-service | 32 byte base64 cố định, khác biến 4 |
| 6 | `PAYMENT_CALLBACK_SECRET` | payment-service | để trống (bí mật, tự đặt trong `.env`; 2026-10-22) |
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
| `AUTH_GRPC_ADDR` … `RATING_GRPC_ADDR` | gateway (8 biến); booking (`DRIVER_`, `PAYMENT_`, `TRIP_GRPC_ADDR`); rating (`TRIP_GRPC_ADDR`). Trip **không** có (S6 bỏ 2026-10-21 — còn trong `compose.yaml` thì bỏ) | `<tên-service>:<cổng của service đó>`: `auth-service:50051`, `customer-service:50052`, `driver-service:50053`, `booking-service:50054`, `trip-service:50055`, `payment-service:50056`, `notification-service:50057`, `rating-service:50058`. Mỗi service chỉ có địa chỉ của service nó được gọi (02 mục 4.3) |
| `SERVICE_NAME` | gateway, 8 service | Tên container, ghi vào log |

Cổng gRPC của chính service (50051–50058, mỗi service một số) và cổng `3000` của Gateway, cùng deadline gRPC (Gateway → service 3 000 ms, service → service 1 000 ms, health 1 000 ms) là **hằng số trong code** (03 mục 13).

Mật khẩu database đi vào service **chỉ** qua chuỗi kết nối `DATABASE_URL` / `MONGODB_URI` (Compose ghép `${DB_PASSWORD}` vào): service đọc một biến thay vì ráp năm phần, ít chỗ lệch.

Hành vi chạy [BA, khớp code đã dựng]:

| Điểm | Quy định | Lý do |
|---|---|---|
| Nối database | Thử lại **15 lần, cách 2 giây** (hằng số); hết lượt → thoát 1 | Database có thể chậm vài giây dù đã healthy; 30 giây đủ, quá thì để Compose khởi động lại |
| Dừng | Service và Gateway bắt `SIGTERM` (và `SIGINT`), đóng kết nối rồi thoát ngay | `docker compose stop` (mục 6) xong ngay, không chờ hết 10 giây rồi bị `SIGKILL` |
| Gateway nối lại gRPC | Kênh gRPC thử nối lại nhanh: chờ ban đầu 0,5 giây, tối đa 2 giây | Sau `docker compose start rating-service`, `/health/services` về `healthy` trong 1–2 giây, không phải chờ mặc định tới 2 phút |
| **Client gRPC: `waitForReady`** (thêm 2026-10-21, H14) | **Mọi** lời gọi gRPC — Gateway → 8 service (nghiệp vụ và `Health/Check`), booking → driver / payment / trip, rating → trip — gửi metadata tạo bằng **`new grpc.Metadata({ waitForReady: true })`** (cách `@grpc/grpc-js` đọc tùy chọn này; `x-role`, `x-account-id`, `x-request-id`… đặt vào chính đối tượng đó) **và** giữ deadline: Gateway → service 3 000 ms, health 1 000 ms, service → service 1 000 ms. Không đổi bảng lỗi mục 4.1 | Lỗi L2: service vừa chạy lại, Docker đổi IP; kênh cũ đang ở trạng thái lỗi nên lời gọi đầu bị từ chối ngay (3–8 ms) → 503 dù service đã `healthy`. Có `waitForReady`, lời gọi **chờ kênh tự phân giải lại tên và nối xong** rồi mới gửi, trong hạn deadline. Đánh đổi: service dừng hẳn thì 503 đến sau khi hết deadline (≤ 3 s) thay vì ngay; `/health/services` khi có service dừng mất ≈ 1 s; lời gọi nội bộ chờ tối đa 1 s mỗi lần (bộ ghép thử S2 ba lần nên `NO_DRIVER_FOUND` khi Driver dừng đến chậm hơn, ≈ 5–6 s) |

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
| Đường dẫn | Route nghiệp vụ: **`/api/v1/{resource}/{id}?{query}`** (04 mục 1.9, ADR-018). Ngoài tiền tố chỉ có A01–A03 |
| Bảng route | Một bảng khai báo trong Gateway (ví dụ `src/routes.js`): method, đường dẫn, role, rpc; route có biến thể thêm cột "chọn theo" (04 mục 1.10). Spec này chỉ đăng ký A01–A03 |
| Body | Đọc là JSON **bất kể `Content-Type`** (Postman chọn "Text" vẫn chạy); body rỗng = `{}`; **mọi** lỗi đọc body (JSON sai cú pháp, body không phải object, quá kích thước, đứt kết nối giữa chừng) → 400 `INVALID_JSON`. Request `GET`: **bỏ qua body** |
| Route không tồn tại | 404 `{ "error": "ROUTE_NOT_FOUND" }` (gồm đường dẫn nghiệp vụ thiếu `/api/v1`) |
| Lỗi không lường trước trong Gateway | 503 `{ "error": "SERVICE_UNAVAILABLE" }`, không stack trace |
| Log | Một dòng mỗi request: method, path, status, thời gian, `request_id`. **Không** ghi header `Authorization`, body |

### A01 `GET /health`

| Token | Response |
|---|---|
| Không | 200 `{ "status": "healthy" }` (sửa 2026-10-14; trước: `UP`) |

### A02 `GET /ready`

| Token | Kiểm tra | 200 | 503 |
|---|---|---|---|
| Không | Redis `PING` trong 500 ms; đã tạo 8 client gRPC | `{ "status": "ready", "checks": { "redis": "healthy", "grpc_clients": "healthy" } }` | `{ "status": "not_ready", "checks": { "redis": "unhealthy", "grpc_clients": "healthy" } }` — Gateway vẫn phục vụ request khác |

Giá trị trong `checks` dùng cùng hai chữ `healthy` / `unhealthy` như A03 [BA H13] (trước: `UP` / `DOWN`).

### A03 `GET /health/services`

| | |
|---|---|
| Token | Không |
| Cách làm | Gọi **song song** `grpc.health.v1.Health/Check` (`service: ""`) tới 8 service, deadline 1 000 ms mỗi lời, có `waitForReady` (H14): service vừa bật lại kịp nối trong 1 s thì báo `healthy`; dừng hẳn thì `unhealthy` sau ≈ 1 s (`DEADLINE_EXCEEDED`, ghi log) |
| Giá trị mỗi service (sửa 2026-10-14) | **`healthy`** khi service trả `SERVING`; **`unhealthy`** khi trả `NOT_SERVING` (mất database), không kết nối được, hoặc quá deadline. Lý do cụ thể (`NOT_SERVING` / `UNREACHABLE` / `DEADLINE_EXCEEDED`) ghi vào log `warn` của Gateway kèm tên service, **không** trả ra ngoài [BA H13] |
| 200 | Cả 8 `healthy`: `{ "status": "healthy", "services": { "auth-service": "healthy", "customer-service": "healthy", "driver-service": "healthy", "booking-service": "healthy", "trip-service": "healthy", "payment-service": "healthy", "notification-service": "healthy", "rating-service": "healthy" } }` |
| 503 | Có ít nhất một `unhealthy`: `{ "status": "unhealthy", "services": { …7 dòng "healthy", "rating-service": "unhealthy" } }` |
| Thứ tự key | Theo thứ tự 8 service trong `CLAUDE.md` (auth … rating) để người chấm đọc nhanh |

Ba endpoint health **nằm ngoài `/api/v1`** (04 mục 1.9: không phải tài nguyên nghiệp vụ; healthcheck Docker gọi `/health` cố định), không token, không rate limit; body không theo dạng `{ "error": … }` vì là báo cáo trạng thái.

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

`details` không khớp `^[A-Z][A-Z0-9_]{2,63}$` → coi là lỗi nội bộ → 503. Mọi lời gọi gRPC có deadline [ĐC] **và `waitForReady`** (mục 3.5, H14): service dừng → `DEADLINE_EXCEEDED` sau đúng hạn deadline → 503 `SERVICE_UNAVAILABLE` (không còn `UNAVAILABLE` trả ngay).

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
| AC-HT-05 (**đổi 2026-10-14**) | 6 | Mọi thứ healthy | `GET /health`; `GET /ready`; `GET /health/services` | 200 body **đúng** `{"status":"healthy"}`; 200 `{"status":"ready","checks":{"redis":"healthy","grpc_clients":"healthy"}}`; 200 `"status":"healthy"` và đủ 8 key `auth-service` … `rating-service` đều `"healthy"` |
| AC-HT-06 (**đổi 2026-10-14**) | 6 (503) | `docker compose stop rating-service` | `GET /health/services` | 503 `{"status":"unhealthy","services":{…}}`, `rating-service = "unhealthy"`, 7 service còn lại `"healthy"`; log Gateway có dòng `warn` nêu `rating-service` và lý do; thời gian trả lời ≈ 1 s, **≤ 1,5 s** (hết deadline health do `waitForReady` — đổi 2026-10-21) |
| AC-HT-07 (**đổi 2026-10-14**) | 6 (503) | `docker compose stop redis` | `GET /ready` rồi `GET /health` | `/ready` 503 `{"status":"not_ready","checks":{"redis":"unhealthy",…}}`; `/health` vẫn 200 `{"status":"healthy"}` |
| AC-HT-16 (mới 2026-10-14) | 6 (503) | `docker compose stop customer-db` (service còn chạy, mất database) | `GET /health/services` | 503 `"status":"unhealthy"`, `customer-service = "unhealthy"` (cùng chữ với service dừng hẳn); body **không** có `NOT_SERVING`, `UNREACHABLE`, `SERVING`, `UP`, `DOWN`, `DEGRADED`. `start customer-db` → sau vài giây lại 200 `healthy` |
| AC-HT-17 (mới 2026-10-14) | 6 | Mọi thứ healthy | Ba endpoint health | Mọi giá trị trạng thái là **chữ thường** đúng một trong `healthy`, `unhealthy`, `ready`, `not_ready`; không còn chữ cũ `UP`, `READY`, `SERVING`, `DEGRADED` |
| AC-HT-08 | 404 | — | `GET /api/v1/khong-co`; `GET /api/health` | 404 `{ "error": "ROUTE_NOT_FOUND" }` cả hai (health chỉ có ở `/health`) |
| AC-HT-09 | 7 | Compose đã lên | Mở `http://localhost:8080` → cluster `cab` → Topics | Đủ 7 topic mục 3.3, không topic nghiệp vụ nào khác (topic nội bộ `__…` được phép) |
| AC-HT-10 | 8 | Compose đã lên | `docker compose ps -a` | Chỉ `gateway` có `0.0.0.0:3000->3000` và `kafka-ui` có `0.0.0.0:8080->8080`; container khác không có `->` |
| AC-HT-11 (**đổi 2026-10-05**) | 8 (lỗi) | Compose đã lên | Postman gọi thẳng `http://localhost:50051`, `http://localhost:50058`, `http://localhost:5432` | Lỗi kết nối (không có response) với **mọi** cổng gRPC 50051–50058 (trước đây chỉ thử 50051) |
| AC-HT-12 | Đặt lại | Đã demo, dữ liệu đổi | `docker compose down -v` rồi `docker compose up -d --build` | Hệ thống lên lại healthy; seed về trạng thái đầu; `docker compose restart auth-service` sau đó không nhân đôi seed |
| AC-HT-14 (mới 2026-10-05) | 5, 6 | Compose đã lên | `docker compose logs <service>` từng service (dòng khởi động); `docker exec gateway printenv` lọc `_GRPC_ADDR` | Mỗi service log nghe đúng cổng của mình (auth 50051 … rating 50058); 8 biến `*_GRPC_ADDR` ở Gateway mang đúng `<tên>:<cổng>`; booking có `DRIVER_`, `PAYMENT_`, `TRIP_GRPC_ADDR`, rating có `TRIP_GRPC_ADDR` đúng cổng; trip **không** có `*_GRPC_ADDR` (đổi 2026-10-21, S6 bỏ); `GET /health/services` 200 với 8 `healthy` (chữ đổi 2026-10-14) |
| AC-HT-15 (mới 2026-10-05, lỗi L3) | 6 | Mọi thứ healthy | `docker compose restart customer-service rating-service` (hoặc dừng / bật lần lượt vài service để Docker cấp lại IP), chờ healthy, rồi `GET /health/services` và gọi một API của từng service bị restart (ví dụ A09 `customers/1` `[KH1]`, A36 `ratings?driver_id=11`) | 200 với 8 `healthy` (chữ đổi 2026-10-14); mỗi API trả dữ liệu của **đúng** service **ngay lần gọi đầu** (không có lỗi `UNIMPLEMENTED` / 503 do kênh nối nhầm service hoặc kênh cũ chưa nối lại). **Đổi 2026-10-21 (L2):** lặp cả chuỗi restart → gọi **≥ 8 lần**, kể cả lần Docker đổi IP hai service cho nhau (cách tái hiện ở báo cáo 2026-10-21 L2, với booking, payment, trip, rating: `trips/5`, `bookings/5`, `payments/5`, `ratings?driver_id=11` `[KH1]`) → **mọi** lần đều 200; lời gọi đầu có thể chậm hơn (≤ 3 s) nhưng không lỗi |
| AC-HT-18 (mới 2026-10-21, L2) | 6, 8 (503) | `docker compose stop rating-service` | A36 `GET /api/v1/ratings?driver_id=11` `[KH1]`, đo thời gian; `GET /health/services`; `start rating-service`, chờ `healthy`, A36 lại | 503 `{"error":"SERVICE_UNAVAILABLE"}` sau **≈ 3 s (2,5–3,5 s)** — hết deadline Gateway, không phải trong vài ms; `/health/services` 503 sau ≤ 1,5 s; sau khi bật lại, A36 **lần đầu** 200. Đối chứng NFR05: trong lúc dừng, A05 đăng nhập vẫn 200 bình thường |
| AC-HT-19 (mới 2026-10-21, L2) | Quy ước | Unit test Gateway và service gọi service (booking, rating) | Gọi client gRPC với server giả; đọc `metadata.getOptions()` của lời gọi | Mọi lời gọi (mọi rpc Gateway, `Health/Check`, S2, S3, S4, S5, S7) có `waitForReady === true` và deadline đúng hằng số (3 000 / 1 000 / 1 000 ms); metadata vẫn mang `x-role`, `x-request-id` (và `x-account-id` khi có) |
| AC-HT-13 | Quy ước | Unit test Gateway | Service giả trả `NOT_FOUND` + `"CUSTOMER_NOT_FOUND"`; `INVALID_ARGUMENT` + `"INVALID_INPUT"`; `INTERNAL` + `"lỗi gì đó"` | 404 `CUSTOMER_NOT_FOUND`; 400 `INVALID_INPUT`; 503 `SERVICE_UNAVAILABLE` |

Kết quả mong đợi theo phiếu chấm: mục 1 — nói được cây thư mục; mục 2 — `.env` không có trên Git; mục 5 — 21 container và vai trò; mục 6 — ba request đều 200 với đúng chữ `healthy` / `ready` / `healthy` (8 service `healthy`), service dừng → 503 `unhealthy`; mục 7 — Kafka UI thấy 7 topic (message có sau spec 15); mục 8 — chỉ hai cổng, gọi thẳng thất bại.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Gửi vào topic chưa đăng ký bằng `kafka-console-producer.sh` → `UNKNOWN_TOPIC_OR_PARTITION` | Lệnh dài; cấu hình `AUTO_CREATE=false` đã đủ để giải thích |
| Kafka UI chỉ đọc: không xóa topic, không gửi message | Không thuộc mục chấm |
| ~~`docker compose stop customer-db` → `customer-service = NOT_SERVING`~~ | Đã đưa vào AC-HT-16 (2026-10-14) với chữ `unhealthy` |
| Kiểm tra từng header bảo vệ, log JSON từng trường | Header đã là quy định ở mục 4; kiểm tra chi tiết ở spec 11 (mục 26) nếu cần |
| `docker compose config` so `DATABASE_URL` từng service; `printenv` từng service | AC-HT-04 đã cho thấy database riêng |
| Kết nối từ bên trong mạng `cab-net` tới `auth-service:50051` (… `rating-service:50058`) | Không thuộc mục chấm |
| Unit test `migrate.js` chạy hai lần | Test-agent làm khi rảnh |
| Đo thời gian A03 ≤ 1,5 giây khi một service dừng | Deadline đã là hằng số |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| ~~H1~~ | **Đổi 2026-10-05 (ADR-020):** trước đây mọi service nghe cùng 50051; nay mỗi service một cổng 50051–50058 vì lỗi L3 (kênh gRPC nối nhầm service sau khi Docker cấp lại IP) | Hằng số cổng ở từng service, `healthcheck.js`, `*_GRPC_ADDR` trong `compose.yaml` |
| H2 | Healthcheck Docker bằng `node src/healthcheck.js` thay cho `grpc_health_probe` | Dockerfile |
| H13 (2026-10-14) | Chữ ra ngoài chỉ có `healthy` / `unhealthy` (từng service, `checks` của `/ready`, tổng của `/health/services`) và `ready` / `not_ready` (tổng của `/ready`); gộp `NOT_SERVING` / `UNREACHABLE` thành `unhealthy`, lý do ghi log. Vì sao: giảng viên yêu cầu đúng chữ; người gọi chỉ cần biết dùng được hay không. Đánh đổi: muốn biết vì sao hỏng phải xem `docker compose logs gateway` | Mục A01–A03; `gateway/src/health.js` |
| H3 | Gateway không chờ service healthy (`service_started`) | `depends_on` |
| H4 | 3 partition mỗi topic; Kafka UI chỉ đọc | `kafka-init`, env Kafka UI |
| H5 | Redis không mật khẩu, không volume, `noeviction` (03 mục 13 đã bỏ `REDIS_PASSWORD`) | Lệnh Redis |
| H6 | `details` của gRPC status = mã lỗi | Mọi service và Gateway |
| H7 | Không có thư mục code dùng chung | Cấu trúc |
| H8 | `CLUSTER_ID` của Kafka ghi cố định trong Compose | `compose.yaml` |
| H9 | Biến truyền từng service qua `environment:`, không `env_file` chung | `compose.yaml` |
| H10 | Healthcheck gọi `127.0.0.1`, không `localhost` (tránh `::1`) | `compose.yaml`, `healthcheck.js` |
| H11 | Nối database thử 15 lần × 2 giây; bắt `SIGTERM`; Gateway nối lại gRPC 0,5–2 giây | `db.js`, `index.js`, client gRPC Gateway |
| H12 | Project Compose `cab`, mạng `cab-net`, volume `cab_*` | `compose.yaml` |
| H14 (2026-10-21, sinh viên chốt) | Mọi lời gọi gRPC bật `waitForReady` (qua `new grpc.Metadata({ waitForReady: true })`), giữ deadline 3 s / 1 s / 1 s. Vì sao: kênh đang lỗi sau khi service đổi IP sẽ chờ nối lại thay vì từ chối ngay (L2). Đánh đổi: service dừng hẳn → 503 sau ≤ 3 s thay vì ngay; `/health/services` ≈ 1 s khi có service dừng. Lựa chọn khác đã cân nhắc: tự gọi lại một lần khi `UNAVAILABLE` (thêm vòng lặp, có thể gửi lặp thao tác ghi); tạo lại kênh khi lỗi (phức tạp) | Module client gRPC của gateway, booking, rating; ADR-020 mục Hệ quả |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| H-Q1 | Máy chấm có dịch vụ cài sẵn trên cùng cổng (PostgreSQL 5432, MongoDB 27017), làm AC-HT-11 "kết nối được" nhầm. **Đã gặp thật (2026-10-04):** máy sinh viên có MongoDB cài trên Windows nghe 27017; gọi thẳng 27017 có trả lời nhưng không phải container của project | (a) Tắt dịch vụ MongoDB / PostgreSQL của Windows trước buổi thi (`services.msc`); (b) chứng minh bằng `docker compose ps -a`: cột cổng của `notification-db` không có `->`; (c) không làm gì | (a) trước buổi thi, (b) khi bị hỏi | SV |
| H-Q2 | `mem_limit` 256m cho PostgreSQL và tổng RAM (~6 GB) có vừa máy demo không | Đo sau khi chạy | Test-agent đo bằng `docker stats` | Test |
| ~~H-Q3~~ | Đã đóng: dùng `cp .env.example .env` (mục 3.7, 06) | — | — | — |
| ~~H-Q4~~ | Đã đóng 2026-10-03: giảng viên cho phép khóa mẫu trong `.env.example`, miễn `.env` thật không đưa lên công khai | — | — | — |
