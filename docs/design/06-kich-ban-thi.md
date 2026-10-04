# 06 — Kịch bản thi (học thuộc)

> Viết 2026-10-03. Nguồn: `docs/design/04-api.md` (API, mục 5), `docs/design/03-du-lieu.md` mục 13 (biến môi trường), mục 14 (seed), `CLAUDE.md` (Ràng buộc khi thi). Sửa API hay seed thì sửa file này theo.
> **Sửa 2026-10-03 lần 4 theo 04 lần 4 (ADR-018):** mọi đường dẫn dưới `/api/v1/`; đổi trạng thái là `PATCH` + `status`; được **dùng lại tab**; 30 giây **gồm cả giải thích**, nên mỗi mục chỉ giữ request chính, phần còn lại ghi `(tùy chọn)`.
> Luật thi: Postman **không lưu sẵn** gì; **được copy** giá trị từ response; **được dùng lại tab và mở tab mới**; lệnh terminal **gõ đầy đủ**; **không mở ghi chú**. Mỗi mục khoảng **30 giây, vừa làm vừa nói**.
> Cách dùng: học thuộc mục 4 ("những thứ phải nhớ") trước, rồi tập từng mục ở mục 2 theo thứ tự ở mục 3.

## 1. Sáu thao tác Postman dùng ở mọi mục

| Việc | Làm thế nào |
|---|---|
| Chọn method | Ô bên trái URL: `GET`, `POST`, `PATCH` (chỉ ba method) |
| Gõ URL | `localhost:3000/api/v1/...` (Postman tự thêm `http://`). Chỉ health không có `/api/v1` |
| Gắn token | Tab **Authorization** → Type **Bearer Token** → dán token (không gõ chữ `Bearer`) |
| Header phụ | Tab **Headers** → **Bulk Edit** → gõ một dòng `Idempotency-Key:k1` hoặc `X-Callback-Secret:cab-secret` |
| Body | Tab **Body** → **raw** → gõ JSON. "Text" hay "JSON" đều được. Đổi sang `GET` thì không cần xóa body (Gateway bỏ qua) |
| Nhân bản tab | Chuột phải tab → **Duplicate Tab** — giữ tab cũ để gửi lại sau (mục 10, 15, 19) |

"Sửa tab" = dùng lại tab vừa gửi, chỉ đổi phần ghi rõ rồi Send. Nói **trong lúc gõ**, đừng chờ gõ xong mới nói.

Các tab giữ suốt buổi (04 mục 5.5):

| Tab | Tạo ở | Dùng lại ở |
|---|---|---|
| Đăng nhập KH1, TX1, AD1 | 10 | Lấy token (Send lại rồi copy); 25, 29 |
| Tab GET | 11 | 12, 13, 14, 18, 24, 25, 26, 27 |
| Tab đặt xe | 15 | 28 |
| Tab chuyến | 15 | 16, 17, 18 |
| Hai tab thanh toán | 19 | 30 |
| Tab tài xế | 21 | 22, 23, 28 |

## 2. Từng mục chấm

Ký hiệu: `[KH1]` = gắn token của KH1. `(tùy chọn)` = chỉ làm khi được hỏi. Mã do API tạo bắt đầu từ **1000**; luôn **copy** từ response, không đoán.

### Trước giờ thi — dựng hệ thống (một lần)

| # | Lệnh | Kết quả |
|---|---|---|
| 1 | `cp .env.example .env` | Có file `.env` (giá trị mẫu dùng được ngay) |
| 2 | `docker compose up -d --build` | Toàn bộ container lên; seed tự chạy (`SIMULATION_MODE=true`) |
| 3 | Postman `GET localhost:3000/health/services` | 200, 8 service `SERVING` → sẵn sàng |

Chấm lại từ đầu (seed bị dùng hỏng): `docker compose down -v` rồi `docker compose up -d --build`.

---

### Mục 1 — Kiến trúc tổ chức source code (mô tả, ~30 s)

Ý cần nói (mở cây thư mục trong VS Code):

- `proto/`: hợp đồng gRPC, **mỗi service một file**.
- `services/`: `gateway` + 8 service; mỗi service có `package.json`, `Dockerfile`, `migrations/`, `src/` **riêng** → build, chạy độc lập; khớp database-per-service.
- Trong `src/`: `domain/` (logic nghiệp vụ) tách khỏi `grpc/` (tầng giao tiếp) → test không cần database thật.
- Không có code dùng chung giữa service: lặp vài module nhỏ, đổi lại không service nào phải build lại theo service khác.

### Mục 2 — `.gitignore` và `.env`

| # | Gõ (terminal) | Kết quả |
|---|---|---|
| 1 | `cat .gitignore` | Có dòng `.env` |
| 2 | `git ls-files .env .env.example` | Chỉ in `.env.example` → `.env` không có trên GitHub |
| (3) | (tùy chọn) `git check-ignore .env` | In ra `.env` |

Nói gì: `.env` chứa mật khẩu database, `JWT_SECRET`, khóa mã hóa nên không commit. `.env.example` có **khóa mẫu chỉ cho máy demo** (giảng viên cho phép) để `cp` là chạy; chạy thật phải thay khóa mới trong `.env`.

### Mục 3 — Nhiệm vụ Gateway (mô tả, ~30 s)

- Cổng **duy nhất** mở ra ngoài (`localhost:3000`); client gọi REST/JSON theo chuẩn `/api/v1/tài-nguyên/mã`, Gateway gọi service bằng gRPC.
- Năm việc: **xác thực** JWT (HS256); **phân quyền** theo role (403); **rate limit** bằng Redis (429); **định tuyến** REST → gRPC, đổi gRPC status → HTTP; **ghi log** kèm `X-Request-Id`.
- **Không** có logic nghiệp vụ, **không** đọc database nghiệp vụ; quyền sở hữu do service kiểm tra. Không có Nginx riêng: Gateway đã là reverse proxy.

### Mục 4 — IPC giữa các microservice (mô tả, ~30 s)

Ý cần nói (mở ảnh `docs/architecture/kien-truc.png`):

- **gRPC là mặc định** khi bên gọi cần kết quả ngay: Booking → Driver (tìm, giữ tài xế), Booking → Payment (tính cước), Booking → Trip (tạo chuyến khi tài xế nhận), Trip → Driver (thông tin xe), Rating → Trip (chuyến đã xong chưa).
- **Kafka chỉ khi bắt buộc**: bên phát không được chờ / không được lỗi theo bên nhận (NFR05), hoặc nhiều bên cùng nghe. 7 topic. Ví dụ: hủy chuyến phải thành công **dù Payment đang dừng** → Trip phát `trip.status-changed`, Payment nghe để hoàn tiền sau.
- Auth, Customer, Rating không dùng Kafka; Auth và Customer **không gọi nhau**.

### Mục 5 — Compose, liệt kê container

| # | Gõ (terminal) | Kết quả |
|---|---|---|
| 1 | `docker compose ps -a` | **21 container**: `gateway`; 8 service; 8 database (`<context>-db`; `notification-db` là MongoDB); `redis`; `kafka`; `kafka-init` (đã thoát 0); `kafka-ui` |

Nói gì: mỗi service **một container database riêng** → không nối nhầm database khác. Đánh đổi: tốn RAM hơn. MongoDB cho Notification vì mỗi loại thông báo có phần `data` khác nhau.

### Mục 6 — `/health`, `/ready`, `/health/services`

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/health` | 200 `{"status":"UP"}` |
| 2 | Sửa tab: `/ready` | 200 `READY`, `redis: UP` |
| 3 | Sửa tab: `/health/services` | 200 `UP`, 8 service `SERVING` |

Nói gì: `/health` = Gateway còn sống; `/ready` = Gateway đủ phụ thuộc **của chính nó** (Redis); `/health/services` = hỏi gRPC Health của 8 service, deadline 1 giây. Ba đường này **không có `/api/v1`** vì không phải tài nguyên nghiệp vụ, và Docker healthcheck gọi đường cố định.

### Mục 7 — Kafka

Chuẩn bị: làm sau mục 15 để có message.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Trình duyệt: `localhost:8080` → cluster `cab` → **Topics** | Đủ **7 topic** (mục 4) |
| 2 | Bấm `booking.offer-created` → **Messages** | Message có `booking_id`, `driver_id` của mục 15 |
| (3) | (tùy chọn) Tab **Consumers** | Group mang tên service, lag 0 |

Nói gì: topic **tạo sẵn** bởi `kafka-init`, broker tắt tự tạo topic. Consumer group = tên service. Event gửi **ngay sau khi commit**, không outbox — đánh đổi: service dừng đúng lúc đó thì mất event.

### Mục 8 — Mọi request đi qua Gateway

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Terminal: `docker compose ps` | Cột PORTS: chỉ `gateway` `3000` và `kafka-ui` `8080` |
| 2 | Postman `GET localhost:50051` | `Error: connect ECONNREFUSED` |

Nói gì: service chỉ nghe trong mạng Compose; database, Redis, Kafka không có `ports`. Mọi request từ ngoài buộc qua Gateway, nơi có JWT, role, rate limit. Nếu gọi thẳng `27017` (hay `5432`) mà có trả lời: đó là MongoDB / PostgreSQL **cài trên Windows**, không phải container của project (đã gặp thật) — chứng minh bằng `docker compose ps -a`: cột cổng của `notification-db` không có `->`. Tốt nhất tắt dịch vụ MongoDB của Windows trước buổi thi.

### Mục 9 — Đăng ký khách hàng → đăng nhập được

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/api/v1/accounts`, body `{"phone":"0901234567","password":"12345678"}` | — | 201 `{"account_id":1000,"role":"customer"}` |
| 2 | Sửa tab: `accounts` → `auth/login` (body giữ nguyên) | `token` (mục 11 tùy chọn) | 200 có `token`, `account_id` 1000 |
| (3) | (tùy chọn) Sửa tab: `auth/login` → `accounts` | — | 409 `PHONE_ALREADY_EXISTS` |

Chạy lại lần hai thì đổi số thành `0901234568`.

Nói gì: đăng ký = **tạo một tài khoản** nên là `POST /api/v1/accounts` (danh từ, không phải `/register`); chỉ tạo `customer` ở `auth-service`, mật khẩu băm scrypt, không gọi service nào; hồ sơ khách tạo sau khi đăng nhập. `auth/login` là ngoại lệ có chủ đích: quy ước phổ biến, đăng nhập không tạo bản ghi nào.

### Mục 10 — Đăng nhập → cấp token

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | Sửa tab mục 9: `"phone":"0900000001"` | — (tab này = **tab KH1**) | 200 `token`, `role` customer, `expires_in` 3600 |
| 2 | Nhân bản tab: `"phone":"0910000001"` | — (**tab TX1**) | 200 `role` driver |
| 3 | Nhân bản tab: `"phone":"0999999999"` | — (**tab AD1**) | 200 `role` admin |
| (4) | (tùy chọn) Tab KH1: `"password":"sai"` (rồi sửa lại) | — | 401 `INVALID_CREDENTIALS` |

Nói gì: một API đăng nhập cho cả ba role; JWT ký **HS256** bằng `JWT_SECRET` chỉ có ở auth và Gateway; payload có `sub` (mã tài khoản), `role`, `jti`, `exp` — không có số điện thoại. Sai mật khẩu và số chưa đăng ký trả **cùng** 401 để không lộ số nào đã có. Ba tab này giữ cả buổi để lấy token.

### Mục 11 — Xem khách hàng theo mã (có token)

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/api/v1/customers/1`, `[KH1]` — tab này = **tab GET** | 200 `{"customer_id":1,"name":"Nguyễn Văn An","dob":"2000-01-01"}` |
| 2 | Sửa tab: `/customers/2` | 403 `NOT_OWNER` |
| (3) | (tùy chọn, tạo hồ sơ) `POST localhost:3000/api/v1/customers`, `[token mục 9]`, body `{"name":"Pham Duc"}` | 201 `customer_id` 1000 |

Nói gì: đúng mẫu `/api/v1/customers/{mã}`. Mã là **số nguyên** để gõ tay được; vì dễ đoán nên mọi API theo mã đều kiểm tra chủ → khách 1 xem khách 2 bị 403. Tạo hồ sơ là `POST /api/v1/customers`, không gửi mã: `customer_id` lấy từ token.

### Mục 12 — Xem tài xế theo mã (có token)

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: `customers/2` → `drivers/11` | 200 Tài Xế 1, `CAR_4`, `59A-00001`, `status` `ONLINE` |
| 2 | Sửa tab: `/drivers/999` | 404 `DRIVER_NOT_FOUND` |
| (3) | (tùy chọn) `/drivers/abc` | 400 `INVALID_ID` |

Nói gì: tài xế mã `10 + n`. Khách chỉ thấy **phần công khai** (họ tên, loại xe, biển số — FR14); số giấy phép (mã hóa) chỉ chính tài xế và admin thấy.

### Mục 13 — Tài xế quanh tọa độ 1 km, limit + paging

Chuẩn bị: **trước** mục 15 (TX1 còn rảnh).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: `drivers/999` → `drivers?lat=10.82&lng=106.68&limit=2` | 200: TX1 (11, ≈ 111 m), TX2 (12, ≈ 222 m); `total` 4, `total_pages` 2 |
| 2 | Sửa tab: thêm `&page=2` | TX3 (13, ≈ 334 m), TX4 (14, ≈ 445 m) |
| (3) | (tùy chọn) bỏ `&page=2`, thêm `&vehicle=CAR_4` | TX1, TX3; `total` 2 |

Nói gì: tìm kiếm là **lọc tập `drivers` bằng query**, không có đường dẫn riêng. Seed 8 tài xế, chỉ 4 trong kết quả: TX5 `OFFLINE`, TX6 bận, TX7 chưa duyệt, TX8 cách 2,2 km. Khoảng cách tính bằng **Haversine** trong SQL, gần nhất trước (BRULE03).

### Mục 14 — Booking của khách, limit + paging

Chuẩn bị: **trước** mục 15 (`total` đúng 7).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: `drivers?…` → `bookings?limit=2` | 200: booking 7, 6; `total` 7, `total_pages` 4 |
| 2 | Sửa tab: thêm `&page=2` | booking 5, 4 |

Nói gì: chỉ trả booking của khách trong token. Sắp mới nhất trước, có `total`. Index `(customer_id, created_at DESC)` phục vụ đúng truy vấn này. Sai tham số (`limit=abc`) thì 400.

### Mục 15 — Đặt xe → tìm tài xế → gửi Offer

Chuẩn bị: mục 13, 14 đã chạy; có token TX1 (mục 10).

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/api/v1/bookings`, `[KH1]`, body `{"from":[10.82,106.68],"to":[10.83,106.69]}` — **tab đặt xe** | — | 201 `SEARCHING`, `vehicle` CAR_4, `pay` CASH, **`fare` 45000**, `booking_id` 1000 |
| 2 | Nhân bản tab: method `GET`, URL `offers`, `[TX1]` — **tab chuyến** | — | 200: Offer `PENDING`, `offer_id` 1000, `booking_id` 1000, `distance_m` ≈ 111 |

Nói gì: Booking tính quãng đường = đường thẳng × 1,3, gọi **gRPC** sang Payment tính cước cố định — khách thấy giá ngay. Tìm tài xế chạy **nền**: gọi Driver lấy tài xế rảnh, đúng loại xe, trong 1 km, gần nhất → tạo Offer → phát `booking.offer-created`.

### Mục 16 — Tài xế nhận chuyến

Chuẩn bị: trong 5 phút sau mục 15.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab chuyến: method `PATCH`, URL `offers/1000`, body `{"status":"ACCEPTED"}` | 200 `ACCEPTED`, `booking_status` `DRIVER_ASSIGNED`, **`trip_id` 1000** |
| (2) | (tùy chọn) Tab GET: `notifications`, `[KH1]` | Thông báo mới nhất `TRIP_ACCEPTED` |

Nói gì: nhận chuyến = **đổi trạng thái lời mời** sang `ACCEPTED`, nên là `PATCH` + `status`, không có `/accept`. Booking giữ tài xế rồi gọi **gRPC `CreateTrip`** — đồng bộ vì tài xế cần ngay mã chuyến. Trip phát `trip.status-changed`, Notification báo khách.

### Mục 17 — Cập nhật trạng thái chuyến đúng trình tự

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab chuyến: URL `trips/1000`, body `{"status":"COMPLETED"}` | **409 `INVALID_STATUS_TRANSITION`** (nhảy cóc) |
| 2 | Sửa tab: `"ARRIVED"` | 200 `ARRIVED` |
| 3 | Sửa tab: `"PICKED_UP"` | 200 |
| 4 | Sửa tab: `"IN_PROGRESS"` | 200 |
| 5 | Sửa tab: `"COMPLETED"` | 200 `COMPLETED`, `history` đủ 5 trạng thái |

Nói gì (trong lúc sửa từng từ): cùng một đường dẫn `PATCH /api/v1/trips/{mã}`, chỉ đổi `status`. Thứ tự cố định `ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED` (FR12); sai thời điểm là `FAILED_PRECONDITION` → 409. Khi `COMPLETED`: Driver nghe Kafka trả TX1 về rảnh, Payment ghi nhận tiền mặt.

### Mục 18 — Hủy chuyến → CANCELED, các bên được báo

Chuẩn bị: seed chuyến **5** (KH1, TX6, đã trả online, `ACCEPTED`).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab chuyến: URL `trips/5`, `[KH1]`, body `{"status":"CANCELED","reason":"ban viec"}` | 200 `CANCELED`, `canceled_by` customer |
| 2 | Tab GET: `notifications`, `[KH1]` | `TRIP_CANCELED` và `PAYMENT_REFUNDED` |
| (3) | (tùy chọn, phía tài xế) Tab TX1 sửa `"phone":"0910000006"` → copy → Tab GET `[TX6]` | `TRIP_CANCELED` cho chuyến 5 |
| (4) | (tùy chọn, hủy booking) Tab đặt xe thêm `"pay":"ONLINE"` → copy `booking_id` → `PATCH …/api/v1/bookings/<id>` `{"status":"CANCELED","reason":"doi y"}` | 201 `PENDING_PAYMENT`; 200 `CANCELED` |

Nói gì: hủy cũng là đổi trạng thái — **cùng đường dẫn** với mục 17, `status` là `CANCELED` kèm lý do. Chỉ hủy được **trước khi đón khách** (BRULE16). Trip phát `trip.status-changed`: Payment hoàn tiền, Driver trả TX6 về rảnh, Notification báo cả hai — thấy ngay `PAYMENT_REFUNDED` trong thông báo của khách. Kafka vì hủy phải thành công **dù Payment đang dừng** (NFR05).

### Mục 19 — Thanh toán online + callback → COMPLETED

Chuẩn bị: seed booking **7** = payment **7** (`CAR_7`, online, `PENDING`, 56 000 đ).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/api/v1/payments/7/transactions`, `[KH1]`, Headers `Idempotency-Key:k1`, body `{"simulate_result":"MANUAL"}` | 200 `status` `PENDING`, `txn_id` `SIM-7-1`, `txn_status` `PENDING` |
| 2 | Nhân bản tab: URL `payment-callbacks`, Authorization **No Auth**, Headers `X-Callback-Secret:cab-secret`, body `{"txn_id":"SIM-7-1"}` | 200 `txn_status` `SUCCEEDED`, **`status` `COMPLETED`** |
| (3) | (tùy chọn) Tab GET: `bookings/7`, `[KH1]` | `SEARCHING` |

**Giữ nguyên hai tab** cho mục 30.

Dự phòng khi thiếu giờ (1 request): bỏ body ở request 1 → adapter tự gọi callback → 200 `COMPLETED` ngay.

Nói gì: mỗi lần thanh toán là **một giao dịch mới** → `POST /api/v1/payments/7/transactions` (tối đa 3 giao dịch). Trả trước: trả xong mới tìm tài xế (BRULE13). `MANUAL` giữ giao dịch chờ để mình tự gửi callback như cổng thanh toán thật; callback xác thực bằng khóa bí mật trong header. `txn_id` = `SIM-<payment>-<lần thử>`.

### Mục 20 — Đánh giá chuyến đi

Chuẩn bị: seed chuyến **4** (`COMPLETED`, TX3, chưa đánh giá).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/api/v1/ratings`, `[KH1]`, body `{"trip_id":4,"score":5}` | 201 `trip_id` 4, `driver_id` 13, `driver_avg` 5.0 |
| 2 | Gửi lại y hệt | 409 `RATING_ALREADY_EXISTS` |
| (3) | (tùy chọn) Sửa body `"trip_id":5` | 409 `TRIP_NOT_COMPLETED` |

Nói gì: đánh giá là tài nguyên của Rating nên là tập `ratings`, mã chuyến nằm trong body. Rating gọi **gRPC** sang Trip hỏi "chuyến đã xong chưa, đúng khách không". Mỗi chuyến một đánh giá (UNIQUE `trip_id`).

### Mục 21 — Đăng ký tài xế (OTP) → hồ sơ chờ duyệt

Chạy lại thì đổi số `0911111112`.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/api/v1/otps`, body `{"phone":"0911111111"}` — **tab tài xế** | `otp` | 201 có `otp` |
| 2 | Sửa tab: URL `driver-accounts`, body `{"phone":"0911111111","otp":"<otp>","password":"12345678"}` | **`token`** | 201 `role` driver |
| 3 | Sửa tab: URL `drivers`, `[token vừa nhận]`, body `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` | **`driver_id`** (D) | 201 **`approval_status` `PENDING`** |

Lưu ý: **luôn copy `driver_id` từ response bước 3**, không đoán số. Mã do API tạo phụ thuộc các lần thử trước (dãy identity không đặt lại khi lệnh lỗi hay khi xóa dòng); muốn số cố định thì demo trên database sạch (`docker compose down -v` rồi `docker compose up -d --build`).

Nói gì (nói trong lúc gõ, mục này dài): xin OTP = **tạo một mã OTP** (`POST /api/v1/otps`), lưu dạng băm, hạn 5 phút; giả lập nên trả mã trong response. Tài khoản tài xế là tập riêng `/api/v1/driver-accounts` vì phải có OTP. Nộp hồ sơ = `POST /api/v1/drivers`, số giấy phép mã hóa, mới nộp là `PENDING`.

### Mục 22 — Admin duyệt / từ chối hồ sơ

Chuẩn bị: mục 21 (có D); token AD1 (mục 10). Chưa chạy 21 thì duyệt TX7 (17).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab tài xế: method `PATCH`, URL `drivers/D`, `[AD1]`, body `{"approval_status":"APPROVED"}` | 200 `APPROVED` |
| (2) | (tùy chọn) Sửa tab: `drivers/17`, body `{"approval_status":"REJECTED","reason":"thieu giay to"}` | 200 `REJECTED` |

Nói gì: duyệt = đổi **trạng thái duyệt** → `PATCH` + `approval_status` (tách khỏi `status` Online / Offline). Chỉ admin (403 với role khác). Đã xét thì không xét lại (409). Lưu `reviewed_by`, `reviewed_at`; Driver phát `driver.application-reviewed`.

### Mục 23 — Tài xế bật / tắt nhận chuyến

Chuẩn bị: sau mục 17 (TX1 đã rảnh).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab tài xế: URL `drivers/me`, `[TX1]`, body `{"status":"OFFLINE"}` | 200 `status` `OFFLINE` |
| 2 | Sửa tab: `"ONLINE"` | 200 `ONLINE` |
| (3) | (tùy chọn, lỗi — làm ngay sau mục 21, **trước** mục 22) token tài xế mục 21, `PATCH …/api/v1/drivers/me` `{"status":"ONLINE","lat":10.82,"lng":106.68}` | 409 `DRIVER_NOT_APPROVED` |

Nói gì: bật / tắt = `PATCH /api/v1/drivers/me` + `status`; `me` = mã trong token → không bật hộ người khác được. Database có CHECK "chưa duyệt thì không `ONLINE`". Đang chở khách thì không tắt được (409).

### Mục 24 — Mã hóa dữ liệu nhạy cảm + quản lý khóa

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: `customers/1`, `[KH1]` | 200 `name` "Nguyễn Văn An" (rõ, cho đúng chủ) |
| 2 | Terminal: `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `full_name_enc`, `date_of_birth_enc` là `\x…` |
| (3) | (tùy chọn) `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$` |

Nói gì (trong lúc gõ lệnh): **mật khẩu băm** scrypt có salt; **họ tên, ngày sinh, số giấy phép mã hóa AES-256-GCM**. Khóa nằm trong biến môi trường **riêng từng service** (`CUSTOMER_DATA_KEY`, `DRIVER_DATA_KEY`) trong `.env`, không ở code, database. Số điện thoại không mã hóa vì dùng để đăng nhập và chặn trùng.

### Mục 25 — SQL injection

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab KH1: `"password":"' OR '1'='1"` | 401 `INVALID_CREDENTIALS` |
| 2 | Tab GET: `customers/1 OR 1=1` | 400 `INVALID_ID` |
| (3) | (tùy chọn) Tab KH1: `{"phone":"' OR 1=1 --","password":"x"}` | 400 `INVALID_PHONE` |

**Sửa lại** mật khẩu tab KH1 thành `12345678` sau mục này.

Nói gì: kiểm tra định dạng trước (mã là số nguyên) nên chuỗi lạ bị 400; mọi câu SQL dùng **tham số** `$1`; mật khẩu so bằng hash. Không lần nào 200 hay 500.

### Mục 26 — XSS

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: method `PATCH`, URL `customers/me`, body `{"name":"<script>alert(1)</script>"}` | 400 `TEXT_CONTAINS_HTML` |
| 2 | Sửa tab: method `GET` | 200 tên vẫn "Nguyễn Văn An"; tab **Headers**: `nosniff`, `Content-Security-Policy: default-src 'none'` |

Nói gì: sửa hồ sơ là `PATCH /api/v1/customers/me` (sửa một phần). Văn bản có `<` hoặc `>` bị **từ chối ở cửa vào** (Gateway và service), không lưu. API chỉ trả JSON kèm `nosniff` và CSP.

### Mục 27 — JWT bị sửa → 401

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET (`customers/me`): **sửa một ký tự ở giữa token** | 401 `TOKEN_INVALID` |
| 2 | Sửa tab: Authorization → **No Auth** | 401 `TOKEN_MISSING` |
| (3) | (tùy chọn) `POST localhost:3000/api/v1/auth/logout`, `[KH1]` → gửi lại request 1 với token đúng | 200 `LOGGED_OUT`; 401 `TOKEN_REVOKED` |

**Không** sửa ký tự **cuối cùng** của token (bit thừa của base64url).

Nói gì: chữ ký HS256 tính trên header + payload; sửa một ký tự thì chữ ký không khớp → 401, kể cả khi đổi `role` thành `admin`. Đăng xuất: Gateway ghi `jti` vào Redis đến hết hạn token.

### Mục 28 — Sai quyền → 403

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab tài xế: URL `drivers/17`, `[KH1]`, **xóa body** | 403 `FORBIDDEN` |
| 2 | Tab đặt xe (`POST …/api/v1/bookings`): `[TX1]` | 403 `FORBIDDEN` |

Nói gì: Gateway so `role` trong token với danh sách role của đường dẫn **trước** khi đọc body — body rỗng vẫn 403. Ba role cố định, không có bảng PERMISSION. Lớp thứ hai ở service: đúng role nhưng không phải chủ → 403 `NOT_OWNER` (mục 11).

### Mục 29 — Spam → 429

Chuẩn bị: làm **cuối cùng**.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab KH1, bấm **Send liên tục 6 lần** | Lần 6: **429 `RATE_LIMITED`**, header `Retry-After` |

Nói gì: Redis `INCR` theo **IP** cho route công khai (5 / 10 giây), theo **tài khoản** cho route có token (30 / 10 giây). Redis dừng thì cho qua.

### Mục 30 — Replay thanh toán → trả response cũ

Chuẩn bị: **ngay sau** mục 19, còn hai tab của mục 19.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab request 1 mục 19 → Send | 200 body **y hệt** lần đầu (`PENDING`), header `Idempotency-Replayed: true` |
| 2 | Tab request 2 mục 19 → Send | 200 y hệt (`COMPLETED`), `Idempotency-Replayed: true` |
| 3 | Sửa tab request 1: method `GET`, URL bỏ `/transactions` | `COMPLETED`, **đúng một** giao dịch `SIM-7-1` |

Nói gì: hai lớp chống lặp — khách bấm hai lần: `idempotency_keys` theo (`payment_id`, khóa) lưu response lần đầu; cổng thanh toán gửi lại callback: `txn_id` UNIQUE + response đã lưu, không phát lại event. Replay ghi `PENDING` vì đó là **response lần đầu**; trạng thái thật xem ở request 3.

## 3. Thứ tự chạy khi thi

| Bước | Mục | Vì sao phải theo thứ tự |
|---|---|---|
| 1 | 1 → 8 | Hạ tầng, không đổi dữ liệu |
| 2 | 9 → **10** | Mục 10 tạo ba tab token KH1, TX1, AD1 dùng suốt buổi |
| 3 | 11 → 12 → **13 → 14** | Một tab GET; trước mục 15: TX1 còn rảnh, KH1 còn đúng 7 booking |
| 4 | **15 → 16 → 17** | Cùng booking / Offer / chuyến 1000; mục 16 trong 5 phút sau 15 |
| 5 | 7 (xem message) | Sau 15 mới có message |
| 6 | 20 | Chuyến seed 4 |
| 7 | 18 | Chuyến seed 5 — chỉ hủy được một lần |
| 8 | **19 → 30** liền nhau | Payment seed 7 thanh toán một lần; sau 5 phút không tài xế `CAR_7` nhận thì bị hoàn tiền |
| 9 | 21 → 22 → 23 | Một tab tài xế; 22 duyệt tài xế của 21; 23 sau 17 (TX1 rảnh) |
| 10 | 24 → 25 → 26 → 28 | Chỉ đọc hoặc bị từ chối |
| 11 | **27** | Phần tùy chọn đăng xuất thu hồi token KH1 |
| 12 | **29** cuối cùng | Khóa đăng nhập / đăng ký tối đa 10 giây |

Giảng viên gọi lệch thứ tự: mục chỉ đọc (6, 11–14, 24–26, 28) chạy lúc nào cũng được; mục đổi seed (15–20, 22, 23, 30) xem dòng "Chuẩn bị". Tab cần chưa có thì gõ mới (≈ +10 s). Seed hỏng thì `docker compose down -v` rồi `docker compose up -d --build`.

## 4. Những thứ phải nhớ

| Nhóm | Giá trị | Mẹo nhớ |
|---|---|---|
| **Quy tắc đường dẫn** | `localhost:3000/api/v1/{tài nguyên số nhiều}/{mã}?{query}`. Chỉ `GET` (đọc), `POST` (tạo), `PATCH` (sửa một phần) | "Đường dẫn nói **cái gì**, method nói **làm gì**" |
| **Đổi trạng thái** | Luôn `PATCH /api/v1/{tài nguyên}/{mã}` + `{"status":"…"}`; hủy thêm `"reason"`. Duyệt hồ sơ dùng `approval_status` | Nhận chuyến, cập nhật chuyến, hủy chuyến, hủy booking, Online / Offline |
| **Tìm, lọc, trang** | Query: `?lat=10.82&lng=106.68&limit=2&page=2` | |
| **"Hành động" thành tài nguyên** (đều sau `/api/v1`) | Đăng ký `POST /api/v1/accounts`; OTP `POST /api/v1/otps`; tài xế đăng ký `POST /api/v1/driver-accounts`; thanh toán `POST /api/v1/payments/{mã}/transactions`; callback `POST /api/v1/payment-callbacks`; đánh giá `POST /api/v1/ratings` | Mỗi lần làm tạo ra một bản ghi |
| **Ngoại lệ** | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` (quy ước phổ biến, không tạo bản ghi); `/health`, `/ready`, `/health/services` không có `/api/v1` | |
| `me` | `/api/v1/customers/me`, `/api/v1/drivers/me` = của người trong token | |
| Mật khẩu mọi tài khoản seed | `12345678` | Một mật khẩu |
| Khách | KH1 `0900000001` (mã **1**, hồ sơ "Nguyễn Văn An", 2000-01-01); KH2 `0900000002` (**2**); KH3 `0900000003` (**3**, chưa có hồ sơ); KH9 `0900000009` (**9**, **bị khóa**) | `090000000n` ↔ mã `n` |
| Tài xế | TX1–TX8: `0910000001`…`0910000008` ↔ mã **11–18** | `091000000n` ↔ mã `10 + n` |
| Vai trò tài xế seed | TX1 `CAR_4` rảnh (15–17, 23); TX2 xe máy; TX3 `CAR_4` (chuyến 4); TX4 `CAR_7` (B7); TX5 `OFFLINE`; TX6 bận chuyến 5 (18); TX7 chờ duyệt (22); TX8 xa 2,2 km | TXn đứng ở `10.82n, 106.68`, cách P0 n × 111 m |
| Admin | AD1 `0999999999` ↔ mã **99** | Toàn số 9 |
| Booking seed (của KH1) | Booking = payment = trip = **1…7**. **4**: chuyến xong, chưa đánh giá (20). **5**: chuyến `ACCEPTED`, đã trả online (18). **7**: `CAR_7`, online, chờ thanh toán 56 000 đ (19, 30) | 4 đánh giá, 5 hủy, 7 trả tiền |
| Mã do API tạo | Từ **1000** (booking, offer, trip đầu tiên đều 1000) | Seed số nhỏ, API số lớn |
| Tọa độ | P0 = `10.82, 106.68` (đón); D0 = `10.83, 106.69` (đến) | D0 = P0 cộng 0.01 |
| Cước P0 → D0 (≈ 2 026 m) | `CAR_4` **45 000**; `MOTORBIKE` 21 000; `CAR_7` **56 000** | mở cửa + đơn giá/km × km, làm tròn lên 1 000 |
| Bảng giá | Xe máy 10 000 + 5 000/km (tối thiểu 15 000); 4 chỗ 20 000 + 12 000/km (30 000); 7 chỗ 25 000 + 15 000/km (40 000) | |
| Body hay gõ | Đặt xe `{"from":[10.82,106.68],"to":[10.83,106.69]}` (mặc định `CAR_4`, `CASH`); đánh giá `{"trip_id":4,"score":5}`; duyệt `{"approval_status":"APPROVED"}` | |
| Giá trị `status` | Offer: `ACCEPTED` / `REJECTED`. Chuyến: `ARRIVED` → `PICKED_UP` → `IN_PROGRESS` → `COMPLETED`, hoặc `CANCELED`. Booking: `CANCELED`. Tài xế: `ONLINE` / `OFFLINE` | |
| Header | Token ở tab Authorization; `Idempotency-Key:k1`; `X-Callback-Secret:cab-secret` | |
| Mã giao dịch | `SIM-<payment_id>-<lần thử>` → `SIM-7-1` | |
| Giả lập thanh toán | `simulate_result`: không gửi = thành công ngay; `FAILED`; `MANUAL` = chờ callback | |
| Số mới khi demo | Khách `0901234567` (lần hai `…68`); tài xế `0911111111` (lần hai `…12`) | |
| Địa chỉ | Gateway `localhost:3000`; Kafka UI `localhost:8080`; service bên trong `:50051` (không mở) | |
| Container database | `<context>-db`: `auth-db`, `customer-db`, … (PostgreSQL), `notification-db` (MongoDB) | |
| Database, user | Database = tên context; user **`cab`**; mật khẩu `cab123` | |
| Lệnh xem bảng | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `table <bảng>` = `select *` |
| Lệnh dựng / đặt lại / xem | `cp .env.example .env`; `docker compose up -d --build`; `docker compose down -v`; `docker compose ps -a` (21 container) | |
| Giới hạn thời gian (`.env.example`) | Offer 300 s; thanh toán 600 s (B7: 1 ngày); OTP 300 s; token 3 600 s; rate limit 5 công khai / 10 s, 30 có token / 10 s | |
| Hằng số | Bán kính 1 000 m; hệ số quãng đường 1,3; 3 lần thử thanh toán; 5 lần nhập OTP | |
| Mã lỗi hay gặp | 400 sai dữ liệu; 401 token / đăng nhập; 403 `FORBIDDEN` (sai role) và `NOT_OWNER` (không phải chủ); 404 (gồm đường dẫn thiếu `/api/v1`); 409 trùng **hoặc sai trạng thái**; 429; 503 service dừng | |

## 5. Mục chấm → số request → thời gian (gồm cả giải thích)

Giả định: gõ mới GET ≈ 10 s, POST / PATCH có body ≈ 15–20 s, thêm header phụ ≈ +5 s; sửa tab 3–5 s; lệnh terminal 6–15 s; nói song song khi gõ, thêm 5–10 s sau khi thấy kết quả. **Ổn** ≤ 25 s; **Sát** 26–32 s; **Vượt** > 32 s. Không tính request `(tùy chọn)`.

| Mục | Request chính (+ lệnh) | Thao tác | Tổng gồm nói | Đánh giá |
|---|---|---|---|---|
| 1, 3, 4 | 0 (nói) | — | ~30 s | Sát — chỉ nói các gạch đầu dòng |
| 2 | 2 lệnh | ~12 s | ~22 s | Ổn |
| 5 | 1 lệnh | ~6 s | ~20 s | Ổn |
| 6 | 1 gõ + 2 sửa | ~15 s | ~25 s | Ổn |
| 7 | trình duyệt | ~10 s | ~22 s | Ổn |
| 8 | 1 lệnh + 1 | ~12 s | ~22 s | Ổn |
| 9 | 1 gõ + 1 sửa | ~20 s | ~28 s | Sát |
| 10 | 1 sửa + 2 nhân bản | ~15 s | ~25 s | Ổn |
| 11 | 1 gõ + 1 sửa | ~15 s | ~23 s | Ổn |
| 12 | 2 sửa | ~8 s | ~18 s | Ổn |
| 13 | 2 sửa | ~12 s | ~24 s | Ổn |
| 14 | 2 sửa | ~8 s | ~18 s | Ổn |
| 15 | 1 gõ + 1 nhân bản | ~25 s | ~32 s | **Sát** |
| 16 | 1 sửa | ~10 s | ~18 s | Ổn |
| 17 | 5 sửa | ~20 s | ~30 s | **Sát** |
| 18 | 2 sửa | ~18 s | ~28 s | Sát |
| 19 | 1 gõ + 1 nhân bản | ~35 s | **~42 s** | **Vượt** — dự phòng 1 request ~25 s |
| 20 | 1 gõ + gửi lại | ~18 s | ~25 s | Ổn |
| 21 | 1 gõ + 2 sửa | ~35 s | **~42 s** | **Vượt** — nói trong lúc gõ |
| 22 | 1 sửa | ~15 s | ~22 s | Ổn |
| 23 | 2 sửa | ~10 s | ~20 s | Ổn |
| 24 | 1 sửa + 1 lệnh | ~18 s | ~28 s | Sát |
| 25 | 2 sửa | ~10 s | ~22 s | Ổn |
| 26 | 2 sửa | ~15 s | ~25 s | Ổn |
| 27 | 2 sửa | ~8 s | ~20 s | Ổn |
| 28 | 2 sửa | ~10 s | ~20 s | Ổn |
| 29 | 6 lần Send | ~5 s | ~18 s | Ổn |
| 30 | 2 gửi lại + 1 sửa | ~10 s | ~22 s | Ổn — **phải giữ hai tab mục 19** |

Câu hỏi còn mở ảnh hưởng tới bảng này (chi tiết ở file 04 mục 9.2): Q62 (token hết hạn sau một giờ), Q64 (mục 19, 21 vượt 30 giây), Q65 (ngoại lệ `auth/login`, `auth/logout`), Q66 (mục 10 đăng nhập ba role). Q60, Q61 đã đóng.
