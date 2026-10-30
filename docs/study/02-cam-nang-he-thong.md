# Cẩm nang hệ thống CAB: chức năng, API, code và vận hành

> Viết 2026-10-07 từ code thật ở commit `f0c996b`, sau đợt hồi quy cả 30 mục chấm đều đạt.
> **Sửa 2026-10-21 theo góp ý giảng viên 2026-10-14 (ADR-021):** health trả `healthy`/`ready`/`unhealthy`; khách và admin đăng ký/đăng nhập bằng **email** trong nhóm `/api/v1/auth/…`, tài xế bằng **số điện thoại**; số điện thoại khách nằm ở **hồ sơ**; `/drivers/{id}` chỉ admin và chính tài xế; booking theo mã khách `GET /api/v1/customers/{id}/bookings`.
> Tài liệu này dùng để **hiểu sâu**, chi tiết hơn bài thi. Cách gõ khi thi xem `docs/design/06-kich-ban-thi.md`.
> Mỗi khẳng định đều chỉ ra file code tương ứng để bạn mở ra đọc lại.

**Mục lục**

1. Bức tranh tổng thể
2. Công nghệ đang dùng
3. Cấu trúc source code
4. Một request đi qua hệ thống như thế nào
5. Một service khởi động như thế nào
6. Ai làm được gì: khách, tài xế, admin, công khai
7. Ma trận phân quyền đầy đủ
8. Service nói chuyện với nhau: gRPC và Kafka
9. Máy trạng thái
10. Luồng nghiệp vụ đầu-cuối, chỉ ra code
11. Dữ liệu: database, bảng, mã hóa, seed
12. Bảo mật: lớp nào chặn cái gì
13. Tình huống có thể xảy ra (góc nhìn DevOps)
14. Sổ tay lệnh vận hành
15. Tự kiểm tra

---

## 1. Bức tranh tổng thể

```
                       Postman / ứng dụng
                              │  REST/JSON  (chỉ cổng 3000 mở ra máy)
                              ▼
 ┌─────────────────────────── gateway :3000 ───────────────────────────┐
 │ JWT · role · rate limit · kiểm tra hình thức · REST→gRPC · log      │──── redis (rate limit, token đã đăng xuất)
 └──┬───────┬───────┬────────┬────────┬────────┬─────────┬─────────┬───┘
    │gRPC   │       │        │        │        │         │         │
 auth    customer driver  booking   trip   payment notification rating
 :50051  :50052   :50053  :50054   :50055  :50056   :50057     :50058
    │       │       │        │        │        │         │         │
 auth-db customer driver  booking  trip-db payment notification rating-db
 (PG)    -db(PG) -db(PG) -db(PG)   (PG)    -db(PG)  -db(Mongo)  (PG)

 gRPC giữa service:   booking → driver (S2 tìm, S3 giữ/nhả tài xế)
                      booking → payment (S4 tạo thanh toán)
                      booking → trip (S5 tạo chuyến)
                      rating  → trip (S7 kiểm chuyến để đánh giá)
 Kafka (7 topic):     K1–K4 booking phát · K5 trip phát · K6 payment phát · K7 driver phát
                      kafka-ui :8080 (chỉ đọc) để xem event
```

**21 container** (`docker compose ps -a`):

| Nhóm | Container | Ghi chú |
|---|---|---|
| Cổng vào | `gateway` | Duy nhất mở cổng 3000 |
| 8 service | `auth-service`, `customer-service`, `driver-service`, `booking-service`, `trip-service`, `payment-service`, `notification-service`, `rating-service` | Không mở cổng ra máy |
| 8 database | `auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` (PostgreSQL 16), `notification-db` (MongoDB 7) | Mỗi service một database riêng |
| Hạ tầng | `redis`, `kafka`, `kafka-init` (tạo 7 topic rồi thoát với mã 0), `kafka-ui` | `kafka-ui` mở cổng 8080 |

**Quy tắc nền tảng** (giải thích được là qua phần lớn vấn đáp):

- Bên ngoài chỉ thấy Gateway. Muốn gọi service phải đi qua Gateway (mục chấm 8).
- Service không đọc database của nhau. Cần dữ liệu của nhau thì gọi gRPC hoặc nghe Kafka.
- **gRPC** khi bên gọi *cần câu trả lời ngay*, chấp nhận lỗi theo bên nhận. **Kafka** khi bên phát *không được chờ, không được lỗi theo* bên nhận, hoặc nhiều bên cùng cần biết.

---

## 2. Công nghệ đang dùng

| Công nghệ | Phiên bản | Dùng ở đâu | Vì sao chọn |
|---|---|---|---|
| Node.js | 20 (image `node:20-alpine`) | Gateway + 8 service | Một ngôn ngữ cho cả hệ thống; ES Modules |
| Express | 5.2.1 | Gateway | Server HTTP nhỏ, quen thuộc; chỉ Gateway cần HTTP |
| `@grpc/grpc-js`, `@grpc/proto-loader` | 1.14.5, 0.8.1 | Gateway và mọi service | gRPC thuần JavaScript, nạp `.proto` lúc chạy, không cần bước sinh code |
| `jsonwebtoken` | 9.0.3 | auth (ký), Gateway (kiểm) | JWT HS256 (ADR-016) |
| `pg` | 8.23.1 | 7 service PostgreSQL | Driver PostgreSQL; câu SQL luôn dùng tham số `$1` |
| `mongodb` | 6.21.0 | notification-service | Thông báo là tài liệu có `data` khác nhau theo loại |
| `kafkajs` | 2.2.4 | booking, trip, payment, driver, notification | Client Kafka thuần JavaScript |
| `ioredis` | 5.11.1 | Gateway | Đếm rate limit, danh sách token đã thu hồi |
| PostgreSQL | 16-alpine | 7 database | Giao dịch ACID, khóa dòng `FOR UPDATE`, ràng buộc CHECK/UNIQUE |
| MongoDB | 7.0 | notification-db | Lưu thông báo dạng tài liệu, ghi nhiều, đọc theo người nhận |
| Redis | 7.4-alpine | Gateway | Bộ đếm có hạn (`EX`), tra nhanh |
| Apache Kafka | 3.8.0 (KRaft, không ZooKeeper) | Event giữa service | Giảng viên dạy ở slide 13; lưu event lâu, nhiều nhóm cùng đọc |
| Kafka UI | provectuslabs v0.7.2 | Xem topic, message, consumer group (mục 7) | Có giao diện web, cấu hình chỉ đọc |
| Docker Compose | — | Dựng 21 container bằng một lệnh | `docker compose up -d --build` |
| `node:test` | có sẵn trong Node | Unit test, e2e test | Không cần cài thêm thư viện test |
| Postman / newman | — | Luyện tập, test-agent chạy collection | Collection ở `postman/` |

Bảo mật dùng module `node:crypto` có sẵn: **scrypt** băm mật khẩu và OTP, **AES-256-GCM** mã hóa họ tên, ngày sinh, số giấy phép lái xe.

---

## 3. Cấu trúc source code

```
cab-system-project/
├── compose.yaml            21 container, mạng cab-net, 8 volume dữ liệu
├── .env.example            14 tên biến, 5 biến bí mật để trống (chép thành .env rồi sinh khóa; .env KHÔNG commit)
├── .gitignore              bỏ node_modules/, .env, .env.*, log
├── README.md               cách chạy, danh sách API
├── CLAUDE.md               quy tắc dự án cho agent
├── srs.md                  yêu cầu nghiệp vụ (FR, BRULE, NFR, UC, AC, RTM)
├── proto/                  hợp đồng gRPC, mỗi service một file
│   ├── health.proto        chuẩn grpc.health.v1, mọi service đều có
│   ├── auth.proto  customer.proto  driver.proto  booking.proto
│   └── trip.proto  payment.proto  notification.proto  rating.proto
├── services/
│   ├── gateway/            Express + Redis, KHÔNG có database
│   └── <8 service>/        cùng một bộ khung (xem bên dưới)
├── tests/                  test e2e chạy trên hệ thống thật (cd tests && npm run …)
│   └── e2e/01…15, 90…95    đánh số theo nhóm: 01–06 hạ tầng, 07–15 nghiệp vụ, 9x dừng service / rate limit
├── postman/                collection theo số mục chấm (chỉ để luyện, khi thi không dùng)
└── docs/
    ├── design/01–06        thiết kế; 06 = kịch bản thi
    ├── specs/              đặc tả từng phần (BA viết, Dev code theo)
    ├── decisions/          ADR-001 … ADR-020
    ├── architecture/       ảnh kiến trúc, ảnh database
    ├── test-reports/       báo cáo kiểm thử
    └── study/              tài liệu học (file này)
```

### 3.1 Bộ khung của một service (ví dụ `services/booking-service/`)

| File | Vai trò | Ghi nhớ |
|---|---|---|
| `Dockerfile` | `node:20-alpine`, `npm ci --omit=dev`, copy `src`, `migrations`, `proto`, chạy bằng user `node` (không phải root) | Build context là gốc repo để copy được `proto/` dùng chung |
| `package.json` | Dependency ghi phiên bản chính xác; `npm start`, `npm test` | |
| `migrations/NNN_*.sql` | Thay đổi schema, chạy theo thứ tự, ghi vào bảng `schema_migrations` | **Không sửa migration đã chạy**, muốn đổi thì thêm file mới (ví dụ `auth-service/migrations/003_bo-email-accounts.sql`) |
| `src/index.js` | Điểm khởi động: ghép mọi phần lại (mục 5) | Đọc file này đầu tiên khi tìm hiểu một service |
| `src/config.js` | Đọc và kiểm tra biến môi trường; thiếu hay sai thì dừng | Log chỉ nêu tên biến, không nêu giá trị |
| `src/db.js` | Pool kết nối, chờ database lên (thử lại) | |
| `src/migrate.js`, `src/seed.js` | Chạy migration; seed khi `SIMULATION_MODE=true` (`ON CONFLICT DO NOTHING`) | Khởi động lại không nhân đôi dữ liệu |
| `src/domain/*.js` | **Logic nghiệp vụ thuần**: quy tắc, máy trạng thái, kiểm tra | Không biết gRPC hay SQL là gì; nhận dependency từ ngoài vào nên test không cần database |
| `src/*-repo.js` | Câu SQL (luôn `$1`, `$2`), giao dịch, khóa dòng | Ví dụ `bookings-repo.js` |
| `src/grpc/server.js` | Mở cổng gRPC (`GRPC_PORT`), đọc metadata (`x-account-id`, `x-role`, `x-request-id`), gọi domain, đổi lỗi domain thành gRPC status | Tầng giao tiếp, mỏng |
| `src/clients.js` | Client gRPC sang service khác (chỉ booking và rating có) | Có deadline 1 giây, bật `waitForReady` (chờ kênh nối xong mới gửi) |
| `src/events.js` | Gửi event Kafka sau khi commit | Nối Kafka lúc gửi lần đầu, nên Kafka dừng không chặn service khởi động |
| `src/consumer.js` | Nghe topic Kafka (booking, driver, payment, notification) | Tự thử lại khi Kafka chưa sẵn sàng |
| `src/health.js`, `src/healthcheck.js` | Trả `SERVING` khi database trả lời; Docker gọi `healthcheck.js` | |
| `src/log.js` | Log JSON một dòng | Không ghi mật khẩu, token, dữ liệu cá nhân |
| `test/*.test.js` | Unit test của service | `npm test` trong thư mục service |

Tách **domain** (nghiệp vụ) khỏi **grpc/server.js** (giao tiếp) và **repo** (SQL) để đọc một quy tắc nghiệp vụ không phải lội qua code mạng hay SQL. Đây là tinh thần DDD: lõi nghiệp vụ ở giữa, hạ tầng bao bên ngoài.

### 3.2 Gateway (`services/gateway/src/`)

| File | Vai trò |
|---|---|
| `index.js` | Đọc cấu hình, tạo client gRPC cho 8 service, nối Redis, dựng app, nghe cổng 3000 |
| `routes.js` | **Bảng route duy nhất**: mỗi dòng gồm mã API (A01…A39), method, path, role được phép, rpc, hàm kiểm tra, handler, loại rate limit |
| `app.js` | Hàm `wrap()` áp **thứ tự kiểm tra chung** cho mọi route (mục 4) |
| `token.js` | Đọc `Authorization: Bearer`, kiểm chữ ký HS256, hạn, claim, danh sách thu hồi |
| `rate-limit.js` | Đếm bằng Redis `MULTI: SET NX EX → INCR → TTL` |
| `redis.js` | Kết nối Redis, ghi và tra `revoked:{jti}` |
| `validate.js` | Kiểm tra **hình thức** body và query (kiểu, độ dài, có `<` `>` không). Không kiểm tra nghiệp vụ |
| `handlers/*.js` | Mỗi nhóm API một file: dựng message gRPC, gọi service, lọc key trả về (`pick.js`), đổi lỗi |
| `grpc/clients.js` | Tạo kênh gRPC, gắn metadata, deadline 3 giây (health 1 giây) |
| `grpc/errors.js` | Bảng đổi gRPC status sang HTTP |
| `health.js` | `/health`, `/ready`, `/health/services` |

---

## 4. Một request đi qua hệ thống như thế nào

Ví dụ: KH1 gõ `GET http://localhost:3000/api/v1/customers/2`.

| Bước | Ở đâu | Làm gì | Nếu sai |
|---|---|---|---|
| 0 | Express (`app.js`) | Khớp route trong bảng `routes.js` | Không khớp → 404 `ROUTE_NOT_FOUND` |
| — | `requestContext` | Sinh `X-Request-Id`; khi xong ghi một dòng log (method, path, status, ms) | |
| — | `securityHeaders` | Gắn `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` | |
| 1 | `wrap()` | Route công khai có đếm (đăng ký, đăng nhập, OTP, đăng ký tài xế) → đếm theo IP | 429 `RATE_LIMITED` |
| 2–5 | `token.js` | Đọc Bearer → kiểm chữ ký HS256 → hạn → claim (`sub`, `role`, `jti`, `exp`) → tra `revoked:{jti}` trong Redis | 401 `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| 5a | `rate-limit.js` | Route có token → đếm theo mã tài khoản (sau khi đã xác thực); đặt xe `POST /bookings` dùng bộ đếm riêng `rl:bk:<mã>`, ngưỡng 5 | 429 |
| 6 | `wrap()` | Role trong token có nằm trong `roles` của route không | 403 `FORBIDDEN`, **trước cả khi đọc body** |
| 7 | `parseBody()` | Đọc body thành JSON, bất kể `Content-Type` | 400 `INVALID_JSON` |
| 8 | `validate.js` | Kiểm hình thức body, rồi tham số đường dẫn (`:id` phải là số nguyên dương) | 400 `INVALID_INPUT`, `INVALID_ID`, `TEXT_CONTAINS_HTML`… |
| 9 | `handlers/customers.js` | Dựng message gRPC, gắn metadata `x-request-id`, `x-account-id: 1`, `x-role: customer`; gọi `CustomerService/GetCustomer` với deadline 3 giây | |
| 10 | `customer-service/src/grpc/server.js` | Đọc metadata thành `identity`, gọi `customers.getCustomer()` | |
| 11 | `customer-service/src/domain/customers.js` | Là khách mà mã ≠ mã của mình → lỗi `NOT_OWNER` | gRPC `PERMISSION_DENIED` kèm details `NOT_OWNER` |
| 12 | `gateway/src/grpc/errors.js` | Đổi gRPC status sang HTTP | **403 `{"error":"NOT_OWNER"}`** |

Nếu KH1 xem `/customers/1` thì bước 11 qua: repo đọc dòng `customer_profiles`, giải mã họ tên và ngày sinh bằng `CUSTOMER_DATA_KEY`, trả `{customer_id, name, dob, email}`.

**Bảng đổi lỗi** (`grpc/errors.js`):

| gRPC status | HTTP | Ví dụ |
|---|---|---|
| `INVALID_ARGUMENT` | 400 | `INVALID_EMAIL`, `SAME_PICKUP_AND_DESTINATION` |
| `UNAUTHENTICATED` | 401 | `INVALID_CREDENTIALS`, `INVALID_CALLBACK_SECRET`, `IDENTITY_MISSING` |
| `PERMISSION_DENIED` | 403 | `NOT_OWNER`, `ACCOUNT_LOCKED`, `FORBIDDEN` |
| `NOT_FOUND` | 404 | `CUSTOMER_NOT_FOUND`, `TRIP_NOT_FOUND` |
| `ALREADY_EXISTS` | 409 | `PHONE_ALREADY_EXISTS`, `RATING_ALREADY_EXISTS` |
| `FAILED_PRECONDITION` | 409 | `INVALID_STATUS_TRANSITION`, `DRIVER_NOT_AVAILABLE`, `PAYMENT_EXPIRED` |
| Còn lại (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`) | 503 | `SERVICE_UNAVAILABLE`. Không lộ chi tiết bên trong |

Mã lỗi phải đúng dạng `CHỮ_HOA_GẠCH_DƯỚI`. Nếu `details` là câu chữ hay stack trace thì Gateway coi là lỗi nội bộ và trả 503, để không lộ thông tin ra ngoài.

**Một đường dẫn, nhiều API** (`select` trong `routes.js`). Ví dụ `PATCH /api/v1/trips/{id}`:

- `status` là `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED` → A28, chỉ tài xế;
- `status` là `CANCELED` → A29, khách hoặc tài xế.

Gateway chỉ **tra bảng** theo giá trị của `status`, không quyết định nghiệp vụ. Nhờ vậy đường dẫn không chứa động từ (`/trips/5/cancel` là sai chuẩn).

---

## 5. Một service khởi động như thế nào

Theo `services/booking-service/src/index.js` (các service khác giống, bớt phần không cần):

```
1. loadConfig(process.env)        thiếu/sai biến → log tên biến, exit(1)
2. createPool + waitForDatabase   database chưa lên thì chờ, thử lại
3. runMigrations                  chạy file .sql chưa chạy, ghi schema_migrations
4. runSeed (nếu SIMULATION_MODE)  ON CONFLICT DO NOTHING → chạy lại không nhân đôi
5. startGrpcServer(GRPC_PORT)     nghe 0.0.0.0:50054
6. health.markReady()             từ đây health trả SERVING → Docker đánh dấu healthy
7. startConsumer(...)             nghe Kafka trong nền; Kafka chưa lên thì tự thử lại
8. dispatcher.resume()            ghép tiếp booking đang SEARCHING bị bỏ dở (NFR15)
9. setInterval(expireOffers, 1s)  tiến trình nền: lời mời quá hạn → hỏi tài xế kế tiếp
```

- Lỗi ở bước 2–5 → `exit(1)` → Compose tự khởi động lại (`restart: unless-stopped`).
- Payment có thêm tiến trình nền mỗi giây: `expireOverdue()` hủy thanh toán quá hạn 10 phút (BRULE17).
- Gateway chỉ chờ các service ở trạng thái **đã chạy** (`service_started`), không chờ healthy. Một service hỏng không làm Gateway không lên được; `/health/services` vẫn báo ra service nào hỏng.

---

## 6. Ai làm được gì

Ký hiệu: `[KH1]` = token của khách 1, lấy từ response đăng nhập. Mọi đường dẫn bắt đầu bằng `http://localhost:3000`.

### 6.1 Công khai (không cần token)

| Chức năng | API | Body mẫu | Kết quả | Code xử lý |
|---|---|---|---|---|
| Xem Gateway còn sống | A01 `GET /health` | — | 200 `{"status":"healthy"}` | `gateway/src/health.js` `live` |
| Gateway đủ phụ thuộc chưa (Redis, client gRPC) | A02 `GET /ready` | — | 200 `ready` / 503 `not_ready` | `health.js` `ready` |
| Xem 8 service | A03 `GET /health/services` | — | `{"status":"healthy","services":{"auth-service":"healthy",…}}`; hỏng → 503 `unhealthy` | `health.js` `services`, gọi `grpc.health.v1.Health/Check` |
| Đăng ký khách | A04 `POST /api/v1/auth/register` | `{"email":"new1@cab.vn","password":"12345678"}` | 201 `account_id` (≥ 1000), `role: customer` | `auth-service/src/domain/auth.js` `registerCustomer` |
| Đăng nhập (mọi role) | A05 `POST /api/v1/auth/login` | Khách, admin: `{"email":"kh1@cab.vn","password":"12345678"}`; tài xế: `{"phone":"0910000001","password":"12345678"}` (đúng **một** định danh) | 200 `token`, `account_id`, `role`, `expires_in: 3600` | `auth.js` `login` → `token.js` ký JWT |
| Xin OTP đăng ký tài xế | A07 `POST /api/v1/auth/otp` | `{"phone":"0911111111"}` | 201, có `otp` khi `SIMULATION_MODE=true` | `auth.js` `requestDriverOtp` |
| Tạo tài khoản tài xế | A08 `POST /api/v1/auth/driver-register` | `{"phone":"0911111111","otp":"123456","password":"12345678"}` | 201 kèm token `role: driver` | `auth.js` `registerDriver` |
| Cổng thanh toán báo kết quả | A32 `POST /api/v1/payment-callbacks` | Header `X-Callback-Secret:<khóa trong .env>`, body `{"txn_id":"SIM-7-1"}` | 200 `status: COMPLETED` | `payment-service/src/domain/payments.js` `handleProviderCallback` |

Lỗi hay gặp:
- **Đăng ký:** gửi kèm `phone` → 400 `INVALID_INPUT` (số điện thoại khách ở hồ sơ, ADR-021); email đã có → 409 `EMAIL_ALREADY_EXISTS`; email sai dạng (kể cả `' OR 1=1 --`) → 400 `INVALID_EMAIL`.
- **Đăng nhập:** gửi cả `email` lẫn `phone`, hoặc không có cái nào → 400 `INVALID_INPUT`.
- **Đăng nhập:** sai mật khẩu → 401 `INVALID_CREDENTIALS`; KH9 bị khóa → 403 `ACCOUNT_LOCKED`.
- **OTP:** sai 5 lần thì mã hết hiệu lực → `OTP_EXPIRED`.

### 6.2 Khách hàng (`customer`)

| Chức năng | API | Body / query mẫu | Kết quả | Code xử lý |
|---|---|---|---|---|
| Tạo hồ sơ | A37 `POST /api/v1/customers` | `{"name":"An","phone":"0901234567","dob":"2000-01-01"}` (phone **bắt buộc**, dạng 0 + 9 số, không UNIQUE) | 201 | `customer-service/src/domain/customers.js` `createCustomer` |
| Xem hồ sơ của mình | A38 `GET /api/v1/customers/me` hoặc A09 `GET /api/v1/customers/1` | — | 200 `{customer_id, name, phone, dob}` | `getCustomer`; mã khác của mình → 403 `NOT_OWNER` |
| Sửa hồ sơ | A10 `PATCH /api/v1/customers/me` | `{"phone":"0907654321"}` (không xóa được phone: `null` → 400) | 200 | `updateCustomer` |
| Tìm tài xế quanh mình | A12 `GET /api/v1/drivers?lat=10.82&lng=106.68&limit=2&page=1` | Thêm `vehicle=car_4` để lọc | 200 danh sách gần nhất trước, `pagination` | `driver-service/src/domain/drivers.js` `findNearbyDrivers` |
| Đặt xe | A19 `POST /api/v1/bookings` | `{"from":[10.82,106.68],"to":[10.83,106.69]}` (mặc định `CAR_4`, `CASH`); thêm `"pay":"online"`, `"vehicle":"CAR_7"` | 201 `booking_id`, `status`, `fare`, `distance_m`, `payment_id` | `booking-service/src/domain/bookings.js` `createBooking` |
| Danh sách booking theo mã của mình | A20 `GET /api/v1/customers/1/bookings?limit=2&page=1&status=canceled` | | 200 mới nhất trước; mã khác → 403 `NOT_OWNER` | `listBookings` (nhận `customer_id`) |
| Xem một booking | A21 `GET /api/v1/bookings/7` | | 200 | `getBooking` (kiểm chủ) |
| Hủy booking (chưa có tài xế) | A22 `PATCH /api/v1/bookings/1000` | `{"status":"CANCELED","reason":"doi y"}` | 200; phát K4 → Payment hoàn tiền nếu đã trả | `cancelBooking` |
| Thanh toán online | A31 `POST /api/v1/payments/7/transactions` | Header `Idempotency-Key: k1`; body `{}` hoặc `{"simulate_result":"MANUAL"}` / `"FAILED"` | 200 `status`, `txn_id`, `attempts_left` | `payments.js` `payPayment` |
| Xem thanh toán | A30 `GET /api/v1/payments/7` | | 200 kèm các thành phần cước, danh sách giao dịch | `getPayment` |
| Xem chuyến | A27 `GET /api/v1/trips/5` | | 200 kèm `history` và khối `"driver":{"driver_id":16,"name":"Tài Xế 6","plate":"59A-00006"}`: đây là cách khách biết ai tới đón | `trip-service/src/domain/trips.js` `getTrip` |
| Hủy chuyến (trước khi đón) | A29 `PATCH /api/v1/trips/5` | `{"status":"CANCELED","reason":"ban viec"}` | 200; phát K5 → hoàn tiền, trả tài xế về rảnh, báo hai bên | `cancelTrip` |
| Đánh giá chuyến đã hoàn thành | A34 `POST /api/v1/ratings` | `{"trip_id":4,"score":5,"comment":"tot"}` | 201 kèm `driver_avg`, `driver_count` | `rating-service/src/domain/ratings.js` `createRating` |
| Xem đánh giá | A35 `GET /api/v1/ratings?trip_id=3`, A36 `GET /api/v1/ratings?driver_id=11` | | 200 | `getRatingByTrip`, `getDriverRating` |
| Xem thông báo của mình | A33 `GET /api/v1/notifications?limit=5` | | 200 mới nhất trước | `notification-service/src/domain/notifications.js` `listNotifications` |
| Đăng xuất | A06 `POST /api/v1/auth/logout` | | 200; token dùng lại → 401 `TOKEN_REVOKED` | `gateway/src/handlers/auth.js` ghi `revoked:{jti}` vào Redis |

Khách **không được**:
- xem hồ sơ tài xế theo mã (`/drivers/{id}` → 403 `FORBIDDEN` ở Gateway; khách biết tài xế của chuyến mình qua `GET /trips/{mã}`);
- xem danh sách tài xế chờ duyệt (A13);
- duyệt hồ sơ tài xế (A15, A16);
- đổi trạng thái chuyến sang đón hay trả khách (A28, chỉ tài xế);
- xem hồ sơ, booking, thanh toán, chuyến của người khác (403 `NOT_OWNER`).

### 6.3 Tài xế (`driver`)

| Chức năng | API | Body / query mẫu | Kết quả | Code xử lý |
|---|---|---|---|---|
| Đăng ký (công khai) | A07 → A08 | Mục 6.1 | Có token `driver`, chưa có hồ sơ | `auth.js` |
| Nộp hồ sơ | A11 `POST /api/v1/drivers` | `{"name":"Tai Xe Moi","license":"GPLX-9","vehicle":"CAR_4","plate":"59A-99999"}` | 201 `approval_status: PENDING` | `drivers.js` `submitApplication` |
| **Nộp lại khi bị từ chối** (FR43) | A11, cùng request | Như trên, đã sửa thông tin | **200** `PENDING`, `resubmitted: true` | `submitApplication` → `drivers-repo.js` `saveApplication` (khóa `FOR UPDATE`, ghi đè cùng dòng) |
| Xem hồ sơ của mình, lý do bị từ chối | A14 `GET /api/v1/drivers/{mã của mình}` | | Bản đầy đủ: `license`, vị trí, `approval_status`, `reason` | `getDriver` |
| Bật nhận chuyến | A17 `PATCH /api/v1/drivers/me` | `{"status":"ONLINE","lat":10.821,"lng":106.68}` | 200 | `setAvailability`; chưa duyệt → 409 `DRIVER_NOT_APPROVED` |
| Tắt nhận chuyến | A39 `PATCH /api/v1/drivers/me` | `{"status":"OFFLINE"}` | 200 | `setAvailability`; đang chở khách (`BUSY`) → 409 `DRIVER_NOT_AVAILABLE` |
| Cập nhật vị trí | A18 `PATCH /api/v1/drivers/me` | `{"lat":10.821,"lng":106.68}` | 200 | `updateLocation` |
| Xem lời mời | A23 `GET /api/v1/offers` | `?status=EXPIRED` để xem lời mời đã hết hạn | 200 lời mời `PENDING` kèm `distance_m`, `fare`, `expires_at` | `bookings.js` `listOffers` |
| Nhận lời mời | A24 `PATCH /api/v1/offers/1000` | `{"status":"ACCEPTED"}` | 200 `trip_id`, `booking_status: DRIVER_ASSIGNED` | `acceptOffer` (mục 10.3) |
| Từ chối lời mời | A25 `PATCH /api/v1/offers/1000` | `{"status":"REJECTED"}` | 200; hệ thống hỏi tài xế kế tiếp, **không hoàn tiền** | `rejectOffer` |
| Cập nhật chuyến | A28 `PATCH /api/v1/trips/1000` | `{"status":"ARRIVED"}` → `PICKED_UP` → `IN_PROGRESS` → `COMPLETED` | 200; nhảy cóc → 409 `INVALID_STATUS_TRANSITION` | `updateTripStatus`, bảng `NEXT` trong `trip-service/src/domain/rules.js` |
| Hủy chuyến đã nhận (FR41) | A29 `PATCH /api/v1/trips/1000` | `{"status":"CANCELED","reason":"xe hong"}` | 200; khách được hoàn tiền, không tự tìm tài xế khác | `cancelTrip` |
| Xem chuyến, thông báo, đánh giá | A27, A33, A35, A36 | | | |

Tài xế **không được**:
- đặt xe (`POST /bookings` → 403, kiểm tra trước cả khi đọc body; mục chấm 28);
- xem danh sách tài xế quanh một điểm (A12);
- xem hồ sơ khách;
- đánh giá.

### 6.4 Admin (`admin`, SRS gọi là Operator)

| Chức năng | API | Body / query mẫu | Kết quả | Code xử lý |
|---|---|---|---|---|
| Danh sách hồ sơ tài xế | A13 `GET /api/v1/drivers?approval_status=PENDING` | Không có `lat`/`lng` nên Gateway chọn A13 | 200 cũ nhất trước | `drivers.js` `listDrivers` |
| Xem chi tiết tài xế | A14 `GET /api/v1/drivers/17` | | Bản đầy đủ, có số giấy phép đã giải mã | `getDriver` |
| Duyệt | A15 `PATCH /api/v1/drivers/17` | `{"approval_status":"APPROVED"}` | 200; phát K7 | `approveDriver` |
| Từ chối | A16 `PATCH /api/v1/drivers/17` | `{"approval_status":"REJECTED","reason":"thieu giay to"}` | 200; phát K7 (không kèm lý do) | `rejectDriver` |
| Xem hồ sơ khách, booking, thanh toán, chuyến bất kỳ | A09, A21, A30, A27 | | 200 | Service bỏ qua kiểm chủ khi role là admin |
| Tìm tài xế quanh một điểm | A12 | | 200 | |

Admin **không được**:
- đặt xe, thanh toán, đánh giá;
- hủy chuyến (403, CD-Q7, vẫn cần hỏi lại thầy);
- sửa hồ sơ khách.

### 6.5 Cổng thanh toán (hệ thống ngoài, giả lập)

- Không có tài khoản, không có token. Xác thực bằng header `X-Callback-Secret` so với `PAYMENT_CALLBACK_SECRET`.
- Gateway **không giữ khóa** này, chỉ chuyển header sang metadata `x-callback-secret`. payment-service mới là nơi so khóa.
- Module giả lập: `payment-service/src/adapters/provider-sim.js`.
  - Mặc định nó "gọi lại" ngay, trong cùng giao dịch, nên thanh toán `COMPLETED` luôn trong response của A31.
  - `MANUAL` thì không tự gọi lại; người demo tự gửi A32.

---

## 7. Ma trận phân quyền đầy đủ

✓ = được; ✓* = được nhưng service kiểm thêm "của mình" (403 `NOT_OWNER`); — = 403 `FORBIDDEN` tại Gateway.

| Mã | Method, đường dẫn | Công khai | customer | driver | admin |
|---|---|---|---|---|---|
| A01–A03 | `GET /health`, `/ready`, `/health/services` | ✓ | ✓ | ✓ | ✓ |
| A04 | `POST /api/v1/auth/register` | ✓ | | | |
| A05 | `POST /api/v1/auth/login` | ✓ | | | |
| A06 | `POST /api/v1/auth/logout` | | ✓ | ✓ | ✓ |
| A07, A08 | `POST /api/v1/auth/otp`, `/api/v1/auth/driver-register` | ✓ | | | |
| A37 | `POST /api/v1/customers` | | ✓ | — | — |
| A38, A10 | `GET`, `PATCH /api/v1/customers/me` | | ✓ | — | — |
| A09 | `GET /api/v1/customers/{id}` | | ✓* | — | ✓ |
| A11 | `POST /api/v1/drivers` | | — | ✓ | — |
| A12 | `GET /api/v1/drivers?lat&lng` | | ✓ | — | ✓ |
| A13 | `GET /api/v1/drivers` (không tọa độ) | | — | — | ✓ |
| A14 | `GET /api/v1/drivers/{id}` | | — | ✓* (chỉ mã của mình) | ✓ |
| A17, A39, A18 | `PATCH /api/v1/drivers/me` | | — | ✓ | — |
| A15, A16 | `PATCH /api/v1/drivers/{id}` | | — | — | ✓ |
| A19 | `POST /api/v1/bookings` | | ✓ | — | — |
| A20 | `GET /api/v1/customers/{id}/bookings` | | ✓* | — | ✓ |
| A21 | `GET /api/v1/bookings/{id}` | | ✓* | — | ✓ |
| A22 | `PATCH /api/v1/bookings/{id}` | | ✓* | — | — |
| A23 | `GET /api/v1/offers` | | — | ✓ (của mình) | — |
| A24, A25 | `PATCH /api/v1/offers/{id}` | | — | ✓* | — |
| A27 | `GET /api/v1/trips/{id}` | | ✓* | ✓* | ✓ |
| A28 | `PATCH /api/v1/trips/{id}` đổi trạng thái | | — | ✓* | — |
| A29 | `PATCH /api/v1/trips/{id}` hủy | | ✓* | ✓* | — |
| A30 | `GET /api/v1/payments/{id}` | | ✓* | — | ✓ |
| A31 | `POST /api/v1/payments/{id}/transactions` | | ✓* | — | — |
| A32 | `POST /api/v1/payment-callbacks` | ✓ (khóa bí mật) | | | |
| A33 | `GET /api/v1/notifications` | | ✓ (của mình) | ✓ (của mình) | ✓ (của mình) |
| A34 | `POST /api/v1/ratings` | | ✓* | — | — |
| A35 | `GET /api/v1/ratings?trip_id=` | | ✓* | ✓* | ✓ |
| A36 | `GET /api/v1/ratings?driver_id=` | | ✓ | ✓ | ✓ |

**Hai lớp kiểm quyền:**
1. **Gateway** kiểm role, dựa vào token: "khách có được gọi API này không".
2. **Service** kiểm quyền sở hữu, dựa vào dữ liệu: "booking 7 có phải của khách 1 không".

Cần cả hai lớp vì mã là số nguyên dễ đoán (ADR-015): đổi `/bookings/7` thành `/bookings/8` là thử được dữ liệu người khác. Gateway không có database nên không thể biết ai sở hữu gì.

---

## 8. Service nói chuyện với nhau

### 8.1 Metadata Gateway gửi kèm mỗi lời gọi gRPC (`gateway/src/grpc/clients.js`)

| Metadata | Khi nào | Service dùng để |
|---|---|---|
| `x-request-id` | Luôn có | Lần theo một request qua log của nhiều service |
| `x-account-id`, `x-role` | Route có token | Biết ai đang gọi: kiểm chủ, kiểm role |
| `idempotency-key` | A31 | Chống thanh toán lặp |
| `x-callback-secret` | A32 | payment-service so khóa |

Service **tin** metadata này vì chỉ Gateway gọi được vào service: service không mở cổng ra máy, chỉ nằm trong mạng `cab-net`.

### 8.2 gRPC giữa service (đồng bộ)

| Mã | Bên gọi → bên nhận | rpc | Khi nào | Vì sao đồng bộ | Nếu bên nhận lỗi |
|---|---|---|---|---|---|
| S2 | booking → driver | `FindNearbyDrivers` | Mỗi vòng ghép tài xế | Cần danh sách mới nhất ngay | Thử 3 lần cách 1 giây, rồi `NO_DRIVER_FOUND` |
| S3 | booking → driver | `ReserveDriver`, `ReleaseDriver` | Tài xế bấm nhận / cần nhả | Driver là nơi duy nhất biết tài xế còn rảnh không | 409 hoặc 503; lời mời vẫn chờ, bấm lại được |
| S4 | booking → payment | `CreatePayment` | Đặt xe | Khách phải thấy ngay số tiền và mã thanh toán | 503, không tạo booking |
| S5 | booking → trip | `CreateTrip` | Tài xế nhận | Tài xế cần ngay `trip_id` để cập nhật chuyến | Nhả tài xế, 503 |
| S7 | rating → trip | `GetTripForRating` | Khách đánh giá | Phải biết chuyến có thật, của khách, đã xong | 503, không lưu đánh giá |

- Lời gọi giữa service mang `x-role: system`. Thiếu `x-role` → `IDENTITY_MISSING`; có `x-role` nhưng sai → `FORBIDDEN`.
- Mọi lời gọi gRPC (Gateway → service và service → service) bật **`waitForReady`** (`new grpc.Metadata({ waitForReady: true })`): kênh vừa mất kết nối (service vừa khởi động lại, Docker đổi IP) thì **chờ nối lại rồi mới gửi**, trong giới hạn deadline (Gateway 3 giây, health 1 giây, service → service 1 giây). Đánh đổi: service chết hẳn thì 503 đến sau khi hết deadline thay vì ngay (spec 00 H14, ADR-020).
- **S3 `ReserveDriver` trả thêm họ tên và biển số**; booking chép sang **S5 `CreateTrip`**, trip lưu vào cột `driver_name`, `driver_plate` (**chụp lúc nhận chuyến**, DX25). Vì vậy `GET /trips/{mã}` có khối `driver` mà không phải gọi driver-service, và **không có lời gọi trip → driver** (S6 đã bỏ). Giữa các service chỉ còn 6 rpc: S2, S3 (giữ, nhả), S4, S5, S7.

### 8.3 Kafka (bất đồng bộ)

Mỗi event có phong bì `{event_id (UUID), event_type (= tên topic), occurred_at, data}`. Key của message là mã đối tượng, nên các event của cùng một booking hay chuyến đi vào cùng partition và giữ đúng thứ tự.

| Mã | Topic | Bên phát | Bên nghe | Vì sao phải bất đồng bộ |
|---|---|---|---|---|
| K1 | `booking.created` | booking | notification | Báo khách không được làm chậm hay hỏng việc đặt xe |
| K2 | `booking.offer-created` | booking | notification | Báo tài xế có lời mời |
| K3 | `booking.no-driver-found` | booking | payment (hoàn tiền), notification | Hoàn tiền phải thành công dù Payment đang dừng (NFR05); hai bên cùng nghe |
| K4 | `booking.canceled` | booking | payment, notification | Như K3 |
| K5 | `trip.status-changed` | trip | driver (trả về rảnh), payment (hoàn tiền / ghi nhận tiền mặt), notification | Chuyến kết thúc ngoài đời thật thì phải ghi nhận được dù các bên khác đang lỗi; ba bên cùng nghe |
| K6 | `payment.status-changed` | payment | booking (bắt đầu tìm tài xế hoặc hủy), notification | Tiền đã trừ thì Payment phải ghi nhận xong dù Booking đang lỗi |
| K7 | `driver.application-reviewed` | driver | notification | Duyệt hồ sơ không được hỏng vì Notification lỗi |

**Consumer group** (Kafka UI → Consumers): `booking-service` (K6), `driver-service` (K5), `payment-service` (K3, K4, K5), `notification-service` (K1–K7).

**Gửi event sau khi commit** (ADR-017): service ghi database xong mới gửi.
- Đánh đổi: nếu service chết đúng giữa lúc commit xong và lúc gửi thì event mất. Bù lại không cần bảng outbox.
- Kafka dừng lúc gửi: thử 3 lần trong 1 giây rồi ghi log `EVENT_PUBLISH_FAILED`; request của người dùng vẫn thành công.

**Chống xử lý lặp:** Kafka giao "ít nhất một lần", nên một event có thể đến hai lần.
- Payment, Driver, Booking chỉ đổi trạng thái khi đang ở trạng thái trước đó, ví dụ `UPDATE … WHERE status = 'PENDING_PAYMENT'`. Event lặp không đổi được gì.
- Notification có UNIQUE (`event_id`, `recipient_id`).

**15 loại thông báo** (`notification-service/src/domain/notifications.js`, hàm thuần `toNotifications`):

| Nhóm | Loại thông báo |
|---|---|
| Booking | `BOOKING_CREATED`, `OFFER_CREATED`, `NO_DRIVER_FOUND`, `BOOKING_CANCELED`, `OFFER_VOIDED` |
| Chuyến | `TRIP_ACCEPTED`, `TRIP_ARRIVED`, `TRIP_COMPLETED`, `TRIP_CANCELED` (gửi cả khách và tài xế) |
| Thanh toán | `PAYMENT_COMPLETED`, `PAYMENT_FAILED`, `PAYMENT_REFUNDED`, `PAYMENT_CANCELED` |
| Hồ sơ tài xế | `APPLICATION_APPROVED`, `APPLICATION_REJECTED` |

`PICKED_UP` và `IN_PROGRESS` không sinh thông báo.

---

## 9. Máy trạng thái

**Booking** (`booking-service`, cột `bookings.status`):
```
            ┌── tiền mặt ──────────────────────┐
 đặt xe ────┤                                  ▼
            └── online → PENDING_PAYMENT ──(K6 COMPLETED)──→ SEARCHING ──(tài xế nhận)──→ DRIVER_ASSIGNED
                              │                                │
               (quá 10 phút / hết 3 lần, khách hủy)   (hết người mời)→ NO_DRIVER_FOUND
                              ▼                                │ (khách hủy)
                           CANCELED ◄──────────────────────────┘
```
Chuyến đã giao cho Trip mà bị hủy thì booking **vẫn `DRIVER_ASSIGNED`** (CD-Q4). Booking chỉ ghi lại việc ghép tài xế; trạng thái thật của chuyến xem ở Trip.

**Lời mời** (`driver_offers.status`):
- `PENDING` → `ACCEPTED`, `REJECTED`, `EXPIRED` (quá `OFFER_TIMEOUT_SECONDS`), hoặc `VOIDED` (booking bị hủy khi lời mời đang chờ).

**Chuyến** (`trip-service/src/domain/rules.js`):
```
ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED
    │          │
    └──────────┴──→ CANCELED   (chỉ hủy được ở ACCEPTED, ARRIVED — BRULE16)
```
`NEXT = {ACCEPTED: ARRIVED, ARRIVED: PICKED_UP, PICKED_UP: IN_PROGRESS, IN_PROGRESS: COMPLETED}`. Gửi trạng thái khác `NEXT[hiện tại]` → 409 `INVALID_STATUS_TRANSITION` (mục chấm 17).

**Thanh toán** (`payments.status`):
```
PENDING ──thành công──→ COMPLETED ──(chuyến không thực hiện)──→ REFUNDED
   │  ▲
 thất bại│ thử lại (tối đa 3 lần)
   ▼  │
 FAILED ──(lần 3 thất bại / quá 10 phút)──→ CANCELED
PENDING ──(booking hủy trước khi trả / quá hạn)──→ CANCELED
```
Tiền mặt: `PENDING` cho đến khi chuyến `COMPLETED` thì thành `COMPLETED`, không có giao dịch qua cổng.

**Tài xế** (`drivers`): hai trục độc lập.

| Trục | Các trạng thái |
|---|---|
| Duyệt | `PENDING` → `APPROVED` hoặc `REJECTED`; `REJECTED` → `PENDING` khi nộp lại (FR43) |
| Nhận chuyến | `OFFLINE` ⇄ `ONLINE` → `BUSY` (đã nhận chuyến) → `ONLINE` (chuyến xong hoặc hủy, qua K5) |

CHECK trong database: chưa `APPROVED` thì không thể khác `OFFLINE`.

---

## 10. Luồng nghiệp vụ đầu-cuối, chỉ ra code

### 10.1 Đặt xe tiền mặt (mục 15)

1. **Gateway** A19 → `parseCreateBooking` điền mặc định `CAR_4`, `CASH` → gọi `BookingService/CreateBooking`.
2. **booking** `createBooking` (`domain/bookings.js`):
   - `domain/distance.js` tính khoảng cách Haversine P0 → D0 ≈ 1.559 m, nhân 1,3 thành **2.026 m**;
   - gọi **S4** `CreatePayment(booking_id, distance_m, vehicle)`.
3. **payment** `createPayment` → `domain/fare.js`: 20.000 + 12.000 × 2,026 = 44.312 → làm tròn lên **45.000 đ** (≥ tối thiểu 30.000). Lưu `fares` (từng thành phần) và `payments` (`PENDING`). Trả `payment_id`.
4. **booking** lưu `bookings` `SEARCHING`, commit, phát **K1**, rồi gọi `dispatcher.dispatch()` chạy nền.
5. **dispatcher** (`domain/dispatcher.js`):
   - **S2** lấy tài xế `ONLINE`, `CAR_4`, trong 1 km, gần nhất trước;
   - bỏ người đã mời cho booking này và người đang có lời mời chờ ở booking khác;
   - tạo `driver_offers` cho **TX1 (111 m)**, hạn +300 giây; phát **K2**.
6. **notification** nghe K1, K2 → lưu `BOOKING_CREATED` cho khách, `OFFER_CREATED` cho TX1.

Response trả ngay sau bước 4. Lời mời có sau khoảng 70 ms, nên tab của tài xế gọi A23 là thấy.

### 10.2 Đặt xe online, thanh toán, callback (mục 19, 30)

1. A19 với `"pay":"online"` → booking `PENDING_PAYMENT`, payment `PENDING` hạn 10 phút. **Chưa tìm tài xế** (BRULE13).
2. A31 `payments/7/transactions`, `Idempotency-Key: k1`, `{"simulate_result":"MANUAL"}` → `payPayment`:
   1. khóa dòng payment (`FOR UPDATE`) → kiểm chủ;
   2. tra `idempotency_keys(payment_id, key)`: có rồi thì trả **response lần đầu** (mục 30). Khác body → 409 `IDEMPOTENCY_KEY_REUSED`;
   3. kiểm trạng thái: tiền mặt → `PAYMENT_NOT_ONLINE`, đã xong → `PAYMENT_ALREADY_COMPLETED`, quá hạn → `PAYMENT_EXPIRED`, lần trước còn chờ → `PAYMENT_IN_PROGRESS`;
   4. ghi khóa, tạo giao dịch `SIM-7-1`;
   5. `provider-sim.js` với `MANUAL` thì không gọi lại → response `PENDING`;
   6. lưu response vào khóa, commit.
3. A32 `{"txn_id":"SIM-7-1"}` + `X-Callback-Secret` → `handleProviderCallback`: so khóa → giao dịch `SUCCEEDED` → payment **`COMPLETED`** → commit → phát **K6**.
4. **booking** nghe K6 `COMPLETED` → `onPaymentStatusChanged`: `PENDING_PAYMENT` → `SEARCHING` → dispatcher mời **TX4** (`CAR_7`, 445 m).
5. Gửi lại A31 y hệt → 200 body y hệt lần đầu, header `Idempotency-Replayed: true`, không tạo giao dịch mới (mục 30).

Thanh toán thất bại 3 lần, hoặc quá 10 phút → payment `CANCELED` → K6 → booking `CANCELED` (BRULE17). Tiến trình nền `expireOverdue()` chạy mỗi giây.

### 10.3 Tài xế nhận chuyến (mục 16): `bookings.js` `acceptOffer`

Tất cả trong **một giao dịch** của booking-service:

1. Khóa dòng booking và lời mời. Lời mời phải `PENDING` và còn hạn; booking phải `SEARCHING`.
2. **S3** `ReserveDriver(11, booking)` → driver đổi `ONLINE` → `BUSY`.
   - Tài xế đã tắt Online → 409 `DRIVER_NOT_AVAILABLE`.
   - Lỗi mạng → nhả "phòng khi" rồi 503.
3. **S5** `CreateTrip(...)` gửi bản chụp booking (tọa độ, phương thức, cước) → trip-service tạo chuyến `ACCEPTED`, ghi lịch sử, phát **K5** `ACCEPTED`. Gọi lặp với cùng booking vẫn trả cùng `trip_id`.
   - Trip lỗi → nhả tài xế, rollback, 503. Lời mời vẫn chờ, tài xế bấm lại được.
4. Lời mời `ACCEPTED`, booking `DRIVER_ASSIGNED`, ghi `driver_assignments`, commit.
5. Response: `{trip_id, trip_status: ACCEPTED, booking_status: DRIVER_ASSIGNED}`. Notification nghe K5 → `TRIP_ACCEPTED` cho khách.

### 10.4 Chạy chuyến (mục 17): `trips.js` `updateTripStatus`

- Khóa dòng chuyến → phải là tài xế của chuyến → `status` phải bằng `NEXT[hiện tại]` → cập nhật, ghi `trip_status_history`, set `started_at` / `ended_at` → commit → **K5**.
- Khi `COMPLETED`, ba bên nghe K5:
  - **driver** `onTripStatusChanged` → `BUSY` → `ONLINE`;
  - **payment** → tiền mặt `PENDING` → `COMPLETED`;
  - **notification** → `TRIP_COMPLETED`, `PAYMENT_COMPLETED`.

### 10.5 Hủy (mục 18)

| Ai hủy, lúc nào | API | Kết quả |
|---|---|---|
| Khách, trước khi có tài xế | A22 `PATCH /bookings/{id}` | booking `CANCELED`, lời mời đang chờ `VOIDED`, nhả tài xế; **K4** → payment hoàn tiền nếu đã trả (hoặc hủy thanh toán chưa trả); thông báo |
| Khách, sau khi có tài xế, trước khi đón | A29 `PATCH /trips/{id}` | chuyến `CANCELED` (`canceled_by: customer`); **K5** → driver trả TX về rảnh, payment **REFUNDED** (giao dịch `SIM-R-5`), notification báo **cả hai bên** |
| Tài xế, chuyến đã nhận | A29 | Như trên, `canceled_by: driver`; hệ thống không tự tìm tài xế khác |
| Tài xế, chỉ là lời mời | A25 | Không hủy gì, **không hoàn tiền**; hỏi người kế tiếp |
| Đã `PICKED_UP` trở đi | A29 | 409 `TRIP_NOT_CANCELABLE` |

### 10.6 Đánh giá (mục 20): `ratings.js` `createRating`

1. **S7** `GetTripForRating(4)`.
2. Kiểm lần lượt:
   - chuyến không tồn tại → 404;
   - không phải khách của chuyến → 403;
   - chưa `COMPLETED` → 409 `TRIP_NOT_COMPLETED`.
3. Trong một giao dịch: chèn `ratings` (UNIQUE `trip_id`; trùng → 409 `RATING_ALREADY_EXISTS`) và cộng `driver_ratings` (`rating_count`, `rating_sum`).
4. Trả `driver_avg` làm tròn 1 chữ số thập phân.

### 10.7 Đăng ký tài xế, duyệt, từ chối, nộp lại (mục 21–23, FR43)

1. A07 → auth sinh OTP 6 số, **băm scrypt** rồi mới lưu `otp_verifications`; hạn `OTP_TTL_SECONDS`.
2. A08 → kiểm OTP (sai 5 lần thì hết hiệu lực) → tạo tài khoản `driver`, trả token.
3. A11 → driver-service mã hóa số giấy phép (AES-256-GCM, `DRIVER_DATA_KEY`), lưu `drivers` `PENDING` và `vehicles`.
4. A15 / A16 (admin) → `UPDATE … WHERE approval_status = 'PENDING'` → commit → **K7** → thông báo `APPLICATION_APPROVED` / `APPLICATION_REJECTED`.
5. Bị từ chối:
   - tài xế xem lý do ở A14;
   - gửi lại **A11** → `saveApplication` khóa dòng, thấy `REJECTED` thì ghi đè, về `PENDING`, xóa lý do → **200 `resubmitted: true`**;
   - nộp lại không phát event, admin thấy hồ sơ ở A13.
6. Đã duyệt → A17 bật `ONLINE` kèm vị trí → xuất hiện trong A12 nếu cách điểm tìm ≤ 1 km.

---

## 11. Dữ liệu

| Service | Database | Bảng chính | Ghi chú |
|---|---|---|---|
| auth | PostgreSQL `auth` | `accounts` (`email` UNIQUE, `phone` UNIQUE, `password_hash` scrypt, role, status; CHECK: khách/admin có email, tài xế có phone), `otp_verifications` | Migration 004 (ADR-021) |
| customer | PostgreSQL `customer` | `customer_profiles` (`full_name_enc`, `date_of_birth_enc` là bytea mã hóa; `phone` rõ, bắt buộc) | PK = `account_id` |
| driver | PostgreSQL `driver` | `drivers` (`license_number_enc`, `approval_status`, `availability`, `current_lat/lng`), `vehicles`, `vehicle_types` | Tìm trong 1 km bằng khung chữ nhật rồi Haversine (ADR-011, không PostGIS) |
| booking | PostgreSQL `booking` | `bookings`, `driver_offers`, `driver_assignments` | |
| trip | PostgreSQL `trip` | `trips`, `trip_status_history` | Bản chụp tọa độ, phương thức, cước từ booking; họ tên và biển số tài xế lúc nhận chuyến (`driver_name`, `driver_plate`, migration 002) |
| payment | PostgreSQL `payment` | `fare_rates`, `fares`, `payments`, `payment_transactions`, `idempotency_keys` | Tiền là `integer` đồng |
| rating | PostgreSQL `rating` | `ratings` (`trip_id` UNIQUE, score 1–5), `driver_ratings` | |
| notification | MongoDB `notification` | collection `notifications` | UNIQUE (`event_id`, `recipient_id`) |
| gateway | Redis | `rl:ip:{ip}`, `rl:acc:{account_id}`, `revoked:{jti}` | Mọi key đều tự hết hạn |

**Kiểu dữ liệu đáng nhớ:**
- Khóa chính `bigint GENERATED ALWAYS AS IDENTITY START WITH 1000`: seed dùng số nhỏ, mã tạo qua API từ 1000.
- Thời điểm dùng `timestamptz`; tọa độ dùng `double precision` có CHECK; tiền và mét là `integer`.
- Không có khóa ngoại giữa service: `bookings.customer_id` chỉ là con số, vì database của auth nằm ở chỗ khác.

**Seed** (chi tiết ở `docs/design/03-du-lieu.md` mục 14):

| Nhóm | Dữ liệu |
|---|---|
| Khách | KH1–3 `kh1@cab.vn`… (mã 1–3), KH9 `kh9@cab.vn` khóa (mã 9); hồ sơ KH1, KH2, KH9 có phone `090000000n` |
| Tài xế | TX1–8 `091000000n` (mã 11–18), đứng ở 10.82n |
| Admin | AD1 `admin@cab.vn` (mã 99) |
| Mật khẩu | `12345678` cho tất cả |
| Booking | B1–B7 của KH1; mã booking = mã thanh toán = mã chuyến |
| Điểm mẫu | P0 (10.82, 106.68), D0 (10.83, 106.69) |

---

## 12. Bảo mật: lớp nào chặn cái gì

| Mối đe dọa | Lớp chặn | Code | Mục chấm |
|---|---|---|---|
| Gọi thẳng service hay database | Chỉ `gateway` và `kafka-ui` có `ports`; còn lại chỉ trong `cab-net` | `compose.yaml` | 8 |
| Không đăng nhập | 401 `TOKEN_MISSING` | `token.js` `readBearer` | 27 |
| Sửa payload JWT (đổi `role` thành admin) | Chữ ký HS256 không khớp → 401 `TOKEN_INVALID` | `token.js` `verifyToken` | 27 |
| Token `alg: none` | `algorithms: ['HS256']` → 401 | `token.js` | 27 |
| Dùng token đã đăng xuất | `revoked:{jti}` → 401 `TOKEN_REVOKED` | `token.js`, `handlers/auth.js` | FR42 |
| Gọi API của role khác | 403 `FORBIDDEN` trước khi đọc body | `app.js` bước 6 | 28 |
| Xem dữ liệu người khác bằng cách đổi mã | 403 `NOT_OWNER` | Domain từng service | 28 |
| SQL injection (`' OR 1=1 --`) | Câu SQL luôn dùng tham số `$1`; dữ liệu không bao giờ ghép vào câu SQL | `*-repo.js` | 25 |
| XSS (`<script>`) | Chặn `<` `>` ở trường văn bản → 400 `TEXT_CONTAINS_HTML`; header `nosniff`, CSP `default-src 'none'`; API chỉ trả JSON | `validate.js`, `app.js` | 26 |
| Lộ mật khẩu khi database bị lấy | scrypt có salt; CHECK chỉ nhận chuỗi `scrypt$…` | `auth-service/src/domain/password.js`, migration 001 | 24 |
| Lộ dữ liệu cá nhân khi database bị lấy | AES-256-GCM; khóa riêng từng service, đọc từ `.env` | `domain/crypto.js` (customer, driver) | 24 |
| Spam đặt xe, dò mật khẩu, spam | Đặt xe 5 lần / 10 giây mỗi tài khoản (bộ đếm riêng); 5 request / 10 giây theo IP cho `auth/…`; 30 / 10 giây theo tài khoản cho route có token khác → 429 | `routes.js` (A19 `rateLimit: 'booking'`), `rate-limit.js` | 29 |
| Thanh toán bị gửi lặp | `Idempotency-Key` + khóa dòng | `payments.js` | 30 |
| Callback giả | `X-Callback-Secret` so khóa → 401 | `payments.js` | 19 |
| Lộ thông tin qua lỗi hay log | Lỗi chỉ là mã; không stack trace; log không ghi token, body, mật khẩu | `errors.js`, `app.js`, `log.js` | NFR |
| Chiếm quyền root container | `USER node` | `Dockerfile` | — |
| Lộ cấu hình thật lên GitHub | `.env` trong `.gitignore`, chưa từng bị commit | `.gitignore` | 2 |

---

## 13. Tình huống có thể xảy ra (góc nhìn DevOps)

### 13.1 Một thành phần dừng

| Tình huống | Hệ thống phản ứng | Vì sao | Kiểm tra / khắc phục |
|---|---|---|---|
| Một service dừng (ví dụ `rating-service`) | API của service đó → 503; mọi API khác vẫn chạy; `/health/services` báo service đó `unhealthy`, tổng `unhealthy` (503) | Database-per-service và gRPC có deadline, nên lỗi không lan | `docker compose start rating-service`; sau vài giây `/health/services` về `healthy` |
| `payment-service` dừng lúc khách đặt xe | A19 → 503, không tạo booking | S4 đồng bộ: trả trước cần mã thanh toán ngay (đánh đổi so với NFR05) | Bật lại; lời gọi đầu sau khi bật thành công nhờ `waitForReady` |
| `payment-service` dừng lúc khách hủy chuyến | Hủy vẫn 200; hoàn tiền xảy ra khi Payment chạy lại | K5 nằm trong Kafka chờ consumer group `payment-service` | Sau khi bật lại mất khoảng 4–5 giây để vào lại consumer group |
| `trip-service` dừng lúc tài xế nhận | 503, tài xế được nhả về `ONLINE`, lời mời vẫn `PENDING` | Một lần nhận chuyến mà không có Trip là vô nghĩa | Bật lại rồi bấm nhận lại |
| `driver-service` dừng lúc ghép | Dispatcher thử S2 3 lần rồi `NO_DRIVER_FOUND` → K3 → hoàn tiền | Booking không treo mãi | — |
| `notification-service` dừng | Mọi nghiệp vụ vẫn chạy; A33 → 503; bật lại thì thông báo đến đủ | Thông báo đi qua Kafka | — |
| Kafka dừng | Request vẫn 200; event mất, log `EVENT_PUBLISH_FAILED`; booking online có thể kẹt `PENDING_PAYMENT` | ADR-017: không có outbox | Rủi ro đã chấp nhận; nói rõ khi vấn đáp |
| Redis dừng | Request vẫn qua; không có header `RateLimit-*`; token đã đăng xuất tạm dùng lại được; log `rate_limit_skipped` | Hệ thống không dừng chỉ vì thiếu bộ đếm | `docker compose start redis` |
| Database của một service dừng | Service báo `NOT_SERVING`; API của nó → 503 | Health kiểm tra bằng ping database | Bật database; service tự nối lại |
| Service vừa khởi động lại, Docker cấp IP mới | Không gọi nhầm service vì mỗi service một cổng (50051–50058); kênh tự tìm lại địa chỉ | Lỗi L3, ADR-020 | — |

### 13.2 Nghiệp vụ và dữ liệu

| Tình huống | Phản ứng | Code |
|---|---|---|
| Hai tài xế cùng bấm nhận một booking | Khóa dòng booking: người sau thấy booking không còn `SEARCHING` → 409 | `acceptOffer` `lockBooking` |
| Khách hủy đúng lúc tài xế bấm nhận | Cùng khóa dòng booking, chạy lần lượt; người sau nhận 409 | `lockBooking` |
| Tài xế không trả lời lời mời | Sau `OFFER_TIMEOUT_SECONDS` lời mời thành `EXPIRED`, hỏi người kế tiếp | `dispatcher.expireOffers` (mỗi giây) |
| Tài xế tắt Online khi đang có lời mời rồi bấm nhận | 409 `DRIVER_NOT_AVAILABLE`, lời mời giữ đến hết hạn | `acceptOffer` → S3 |
| Không có tài xế trong 1 km | `NO_DRIVER_FOUND` → K3 → hoàn tiền (nếu đã trả), báo khách | `dispatcher` |
| Bấm thanh toán hai lần cùng khóa | Lần hai trả response cũ + `Idempotency-Replayed: true` | `payPayment` |
| Cùng khóa nhưng body khác | 409 `IDEMPOTENCY_KEY_REUSED` | `payPayment` |
| Callback đến sau khi thanh toán đã bị hủy vì quá hạn | Tiền đã trừ nên hệ thống **hoàn lại** → `REFUNDED` | `handleProviderCallback` |
| Event Kafka bị giao hai lần | Không đổi gì lần hai (đổi trạng thái có điều kiện, UNIQUE) | Các consumer |
| Booking-service chết khi đang ghép | Khởi động lại thì `dispatcher.resume()` ghép tiếp | `index.js` |
| Trip đã tạo nhưng booking commit lỗi | Log `ACCEPT_COMMIT_FAILED` để xử lý tay | `acceptOffer` (DX-Q4, rủi ro đã chấp nhận) |
| Nộp lại hồ sơ với biển số đã có người dùng | 409 `LICENSE_PLATE_ALREADY_EXISTS`, hồ sơ giữ `REJECTED` | `saveApplication` |

### 13.3 Môi trường và vận hành

| Tình huống | Dấu hiệu | Khắc phục |
|---|---|---|
| Cổng 3000 bị container khác chiếm (`product-api`) | `docker compose up` báo `port is already allocated`; gateway `Exited` | `docker stop product-api` rồi `docker compose up -d --force-recreate gateway` (tạo lại để gắn cổng) |
| Gateway healthy nhưng `localhost:3000` không trả lời | `docker compose ps` thấy `3000/tcp` mà không có `0.0.0.0:3000->` | Container được tạo lúc cổng bị chiếm: `docker compose up -d --force-recreate gateway` |
| Docker Desktop chưa bật | `failed to connect to the docker API … dockerDesktopLinuxEngine` | Mở Docker Desktop, chờ engine chạy |
| MongoDB của Windows chiếm 27017 | Test "không gọi thẳng database được" đạt giả | Dừng dịch vụ MongoDB của Windows trước khi thi (cần quyền admin) |
| Thiếu `.env` hoặc thiếu biến | Service `Exited (1)`, log `cấu hình sai, dừng service` kèm **tên biến** | `cp .env.example .env` rồi điền 5 biến bí mật (sinh khóa bằng `node -e …randomBytes(32)…`) |
| Dữ liệu đã bị đổi khi luyện (TX1 bận, chuyến 5 đã hủy, B7 đã trả) | Demo ra kết quả khác kịch bản | `docker compose down -v` rồi `docker compose up -d --build` |
| Đăng nhập liên tục bị 429 khi luyện | `Retry-After: n` | Chờ hết cửa sổ 10 giây |
| Lời mời hết hạn trước khi kịp nhận (mục 16) | A24 → 409 `OFFER_EXPIRED` | Đặt xe lại; hạn là 300 giây |
| Kafka UI không có nút Produce | Trả 405 "read-only" | Có chủ đích (M1); gửi message thử bằng `kafka-console-producer.sh` |

---

## 14. Sổ tay lệnh vận hành

```bash
# Dựng, xem, dừng (.env đã có sẵn trên máy; máy mới: cp .env.example .env rồi sinh 5 khóa)
docker compose up -d --build              # dựng 21 container
docker compose ps -a                      # trạng thái (healthy / Exited)
docker compose logs -f booking-service    # log một service (JSON một dòng)
docker compose stop payment-service       # dừng một service để thử lỗi
docker compose start payment-service
docker compose down -v                    # xóa container + volume → seed lại từ đầu

# Database
docker exec -it auth-db psql -U cab -d auth -c "table accounts"
docker exec -it customer-db psql -U cab -d customer -c "table customer_profiles"   # thấy \x… = đã mã hóa
docker exec -it driver-db psql -U cab -d driver -c "select driver_id, approval_status, availability from drivers"
docker exec -it notification-db mongosh -u cab -p <DB_PASSWORD trong .env> --authenticationDatabase admin notification --eval "db.notifications.find().limit(3)"

# Redis
docker exec -it redis redis-cli keys "*"          # rl:ip:…, rl:acc:…, revoked:…
docker exec -it redis redis-cli ttl rl:ip:172.22.0.1

# Kafka
#   Giao diện: http://localhost:8080 → Topics → trip.status-changed → Messages; Consumers xem group
docker exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

# Test (thư mục tests/)
npm run test:ha-tang       # Compose, health, Kafka, cấu hình
npm run test:nghiep-vu     # nghiệp vụ (cần ngưỡng rate limit cao)
npm run test:dung-service  # dừng / bật service
npm run test:rate-limit    # mục 29, ngưỡng thật 5/30/5
# Ngưỡng cao tạm thời cho test:
RATE_LIMIT_PUBLIC_MAX=1000 RATE_LIMIT_ACCOUNT_MAX=1000 RATE_LIMIT_BOOKING_MAX=1000 docker compose up -d gateway
docker compose up -d gateway                      # về lại 5/30/5
```

---

## 15. Tự kiểm tra

Trả lời không nhìn tài liệu, rồi mở lại mục tương ứng để so.

1. Request `GET /api/v1/customers/2` bằng token KH1 đi qua những bước nào, và bị chặn ở bước nào? (mục 4)
2. Vì sao tài xế gọi `POST /bookings` với body hỏng vẫn nhận 403 chứ không phải 400? (mục 4 bước 6)
3. Gateway có biết booking 7 thuộc khách nào không? Ai kiểm `NOT_OWNER`? (mục 7)
4. Kể 5 lời gọi gRPC giữa service, và với mỗi lời gọi, vì sao không dùng Kafka. (mục 8.2)
5. Topic `trip.status-changed` có những ai nghe, mỗi bên làm gì khi chuyến `COMPLETED`? (mục 8.3, 10.4)
6. Cước 45.000 đ của đặt xe mẫu được tính ở service nào, từ những số nào? (mục 10.1)
7. Gửi lại y hệt request thanh toán thì code đi nhánh nào, và vì sao không tạo giao dịch mới? (mục 10.2)
8. Trong `acceptOffer`, nếu `CreateTrip` lỗi thì tài xế có bị kẹt `BUSY` không? Vì sao? (mục 10.3)
9. Hủy chuyến lúc `payment-service` đang dừng: khách nhận gì, tiền có được hoàn không, khi nào? (mục 13.1)
10. Event bị giao hai lần thì có hoàn tiền hai lần không? (mục 8.3)
11. Vì sao mỗi service một cổng gRPC riêng? (mục 13.1, ADR-020)
12. Gateway lên `healthy` nhưng Postman không gọi được `localhost:3000`: kiểm tra gì? (mục 13.3)
13. Dữ liệu nào được băm, dữ liệu nào được mã hóa, dữ liệu nào lưu rõ? Vì sao khác nhau? (mục 12, 11)
14. Tài xế bị từ chối biết bằng cách nào, xem lý do ở đâu, nộp lại bằng request nào? (mục 10.7)
