# 06 — Kịch bản thi (học thuộc)

> Viết 2026-10-03. Nguồn: `docs/design/04-api.md` (API, mục 5), `docs/design/03-du-lieu.md` mục 13 (biến môi trường), mục 14 (seed), `CLAUDE.md` (Ràng buộc khi thi). Sửa API hay seed thì sửa file này theo.
> Luật thi: Postman **không lưu sẵn** gì; **được copy** giá trị từ response; lệnh terminal **gõ đầy đủ**; **không mở ghi chú**. Mỗi mục khoảng **30 giây**.
> Cách dùng: học thuộc mục 4 ("những thứ phải nhớ") trước, rồi tập từng mục ở mục 2 theo thứ tự ở mục 3.

## 1. Năm thao tác Postman dùng ở mọi mục

| Việc | Làm thế nào |
|---|---|
| Chọn method | Ô bên trái URL: `GET`, `POST`, `PUT`, `PATCH` |
| Gõ URL | `localhost:3000/...` (Postman tự thêm `http://`). **Không có** `/api/v1` |
| Gắn token | Tab **Authorization** → Type **Bearer Token** → dán token (không gõ chữ `Bearer`) |
| Header phụ | Tab **Headers** → **Bulk Edit** → gõ một dòng `Idempotency-Key:k1` hoặc `X-Callback-Secret:cab-secret` |
| Body | Tab **Body** → **raw** → gõ JSON. Chọn "Text" hay "JSON" đều được (Gateway đọc JSON bất kể `Content-Type`) |

"Sửa tab" = dùng lại tab vừa gửi, chỉ đổi vài ký tự rồi Send — nhanh hơn mở tab mới. Mỗi token nên để ở một tab đăng nhập riêng để copy lại khi cần.

## 2. Từng mục chấm

Ký hiệu: `[KH1]` = gắn token của KH1. `→` = kết quả. Mã do API tạo bắt đầu từ **1000**; luôn **copy** từ response, không đoán.

### Trước giờ thi — dựng hệ thống (một lần)

| # | Lệnh | Kết quả |
|---|---|---|
| 1 | `cp .env.example .env` | Có file `.env` (giá trị mẫu dùng được ngay) |
| 2 | `docker compose up -d --build` | Toàn bộ container lên; seed tự chạy (`SIMULATION_MODE=true`) |
| 3 | Postman `GET localhost:3000/health/services` | 200, 8 service `SERVING` → sẵn sàng |

Chấm lại từ đầu (seed bị dùng hỏng): `docker compose down -v` rồi `docker compose up -d --build`.

---

### Mục 1 — Kiến trúc tổ chức source code (mô tả)

Ý cần nói (mở cây thư mục trong VS Code):

- `proto/`: hợp đồng gRPC, **mỗi service một file** — nguồn duy nhất cho mọi lời gọi gRPC.
- `services/`: 9 thư mục = `gateway` + 8 service. Mỗi service có `package.json`, `Dockerfile`, `migrations/`, `src/` **riêng** → build, chạy, đổi phiên bản độc lập; khớp database-per-service.
- Trong `src/`: `domain/` (logic nghiệp vụ, không biết gRPC hay database) tách khỏi `grpc/` (tầng giao tiếp) → test logic không cần database thật.
- `compose.yaml` dựng toàn hệ thống; `.env.example` mẫu biến môi trường; `tests/`, `postman/`, `docs/` (SRS, thiết kế, spec, ADR).
- Không có thư mục code dùng chung giữa service: đánh đổi là lặp lại vài module nhỏ, đổi lại không service nào phải build lại theo service khác.

### Mục 2 — `.gitignore` và `.env`

| # | Gõ (terminal) | Kết quả |
|---|---|---|
| 1 | `cat .gitignore` | Có dòng `.env`, `node_modules/` |
| 2 | `git check-ignore .env` | In ra `.env` → Git bỏ qua file này |
| 3 | `git ls-files .env .env.example` | Chỉ in `.env.example` → `.env` không có trên GitHub |

Nói gì: `.env` chứa mật khẩu database, `JWT_SECRET`, khóa mã hóa nên không commit; `.env.example` có giá trị mẫu **chỉ cho máy demo** để `cp` là chạy. Đánh đổi: khóa mẫu nằm trên Git nên dữ liệu demo không thật sự bí mật — chạy thật phải thay khóa mới trong `.env`.

### Mục 3 — Nhiệm vụ Gateway (mô tả)

Ý cần nói:

- Cổng **duy nhất** mở ra ngoài (`localhost:3000`); client gọi REST/JSON, Gateway gọi service bằng gRPC.
- Năm việc: **xác thực** JWT (HS256, `JWT_SECRET`); **phân quyền** theo role trong token (403 `FORBIDDEN`); **rate limit** bằng bộ đếm Redis (429); **định tuyến** REST → gRPC và đổi gRPC status → HTTP; **ghi log** mỗi request kèm `X-Request-Id`.
- Thêm: ba endpoint health; header bảo vệ (`nosniff`, CSP); đăng xuất bằng danh sách token thu hồi trong Redis.
- **Không** có logic nghiệp vụ, **không** đọc database nghiệp vụ; quyền sở hữu dữ liệu do service kiểm tra (vì chỉ service có dữ liệu).
- Không đặt Nginx riêng: Gateway đã là reverse proxy (giảng viên chốt). Redis dừng thì Gateway cho request đi qua và ghi cảnh báo — đánh đổi: tạm mất rate limit.

### Mục 4 — IPC giữa các microservice (mô tả)

Ý cần nói (mở ảnh `docs/architecture/kien-truc.png`):

- **Đồng bộ gRPC là mặc định** khi bên gọi cần kết quả ngay. Sáu đường service → service:
  - Booking → Driver: tìm tài xế gần (S2), giữ / nhả tài xế (S3).
  - Booking → Payment: tính cước, tạo thanh toán (S4) — khách phải thấy ngay số tiền.
  - Booking → Trip: tạo chuyến khi tài xế nhận (S5) — tài xế cần `trip_id` ngay.
  - Trip → Driver: thông tin tài xế, xe cho khách xem (S6).
  - Rating → Trip: kiểm tra chuyến đã hoàn thành và đúng khách (S7).
- **Bất đồng bộ Kafka chỉ khi bắt buộc**: bên phát không được chờ / không được lỗi theo bên nhận (NFR05), hoặc nhiều bên cùng cần biết. 7 topic: `booking.created`, `booking.offer-created`, `booking.no-driver-found`, `booking.canceled`, `trip.status-changed`, `payment.status-changed`, `driver.application-reviewed`.
- Ví dụ để giải thích: hủy chuyến phải thành công **dù Payment đang dừng** → Trip phát `trip.status-changed`, Payment nghe để hoàn tiền sau.
- Auth, Customer, Rating không dùng Kafka; Auth và Customer **không gọi nhau** (đăng ký và hồ sơ tách hai bước).

### Mục 5 — Compose, liệt kê container

| # | Gõ (terminal) | Kết quả |
|---|---|---|
| 1 | `docker compose ps -a` | **21 container**: `gateway`; 8 service; 8 database (`auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` là PostgreSQL; `notification-db` là MongoDB); `redis`; `kafka`; `kafka-init` (đã thoát 0 — chỉ tạo topic); `kafka-ui` |

Nói gì: mỗi service **một container database riêng** → service không thể nối nhầm database khác, dừng riêng từng database được. Đánh đổi: tốn RAM hơn một server PostgreSQL chung. MongoDB cho Notification vì mỗi loại thông báo có phần `data` khác nhau, chỉ ghi thêm và đọc theo người nhận.

### Mục 6 — `/health`, `/ready`, `/health/services`

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/health` | 200 `{"status":"UP"}` |
| 2 | Sửa tab: `/ready` | 200 `READY`, `redis: UP` |
| 3 | Sửa tab: `/health/services` | 200 `UP`, 8 service `SERVING` |

Nói gì: `/health` = Gateway còn sống; `/ready` = Gateway đủ phụ thuộc **của chính nó** (Redis); `/health/services` = Gateway hỏi gRPC Health của 8 service song song, mỗi lời hỏi có deadline 1 giây. Service dừng → 503 `DEGRADED` và chỉ rõ service nào.

### Mục 7 — Kafka

Chuẩn bị: muốn thấy message thì chạy mục 15 trước (hoặc làm mục 7 sau mục 15).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Trình duyệt: `localhost:8080` → cluster `cab` → **Topics** | Đủ **7 topic** (mục 4) |
| 2 | Bấm `booking.offer-created` → **Messages** | Message có `booking_id`, `driver_id` của mục 15 |
| 3 | Tab **Consumers** | Group mang tên service (`notification-service`…), lag 0 |

Dự phòng (terminal): `docker exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list`

Nói gì: topic được **tạo sẵn** bởi `kafka-init`, broker tắt tự tạo topic → gửi nhầm tên là lỗi ngay. Consumer group = tên service: mỗi service nhận mỗi event một lần. Event gửi **ngay sau khi commit**, không có bảng outbox — đánh đổi: service dừng đúng lúc đó thì mất event; bên nghe vẫn phải chịu được event lặp.

### Mục 8 — Mọi request đi qua Gateway

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Terminal: `docker compose ps` | Cột PORTS: chỉ `gateway` có `0.0.0.0:3000->3000`, `kafka-ui` có `0.0.0.0:8080->8080` |
| 2 | Postman `GET localhost:50051` | `Error: connect ECONNREFUSED` — service không mở cổng ra máy |

Nói gì: service chỉ nghe trong mạng Compose và gọi nhau bằng tên (`auth-service:50051`); database, Redis, Kafka đều không có `ports`. Vì vậy mọi request từ ngoài buộc qua Gateway, nơi có JWT, role, rate limit. Kafka UI là công cụ xem, không phải đường vào nghiệp vụ.

### Mục 9 — Đăng ký khách hàng → đăng nhập được

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/auth/register`, body `{"phone":"0901234567","password":"12345678"}` | — | 201 `{"account_id":1000,"role":"customer"}` |
| 2 | Sửa tab: `register` → `login` (body giữ nguyên) | `token` → dùng ở mục 11 (phụ) | 200 có `token`, `account_id` 1000 |
| 3 | Sửa tab: `login` → `register` | — | 409 `PHONE_ALREADY_EXISTS` |

Chuẩn bị: không. Chạy lại lần hai thì đổi số thành `0901234568`.

Nói gì: đăng ký **chỉ tạo tài khoản** ở `auth-service` (số điện thoại, mật khẩu băm scrypt), không gọi service nào; hồ sơ khách tạo sau khi đăng nhập (giảng viên đề xuất). Lý do: không có tình huống tài khoản có mà hồ sơ không, nên không cần bù trừ. Trùng số chặn bằng UNIQUE trong database → 409.

### Mục 10 — Đăng nhập → cấp token

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/auth/login`, body `{"phone":"0900000001","password":"12345678"}` | **`token` của KH1** — giữ tab này | 200 `token`, `role` customer, `expires_in` 3600 |
| 2 | Sửa tab: `"password":"sai"` | — | 401 `INVALID_CREDENTIALS` |
| 3 | Sửa tab: `"phone":"0900000009","password":"12345678"` | — | 403 `ACCOUNT_LOCKED` |

Nói gì: JWT ký **HS256** bằng `JWT_SECRET` chỉ có ở auth và Gateway; payload có `sub` (mã tài khoản), `role`, `jti`, `exp` — không có số điện thoại vì payload ai cũng đọc được. Sai mật khẩu và số chưa đăng ký trả **cùng** 401 để không lộ số nào đã có. Đánh đổi HS256: ai có khóa đều ký được, nên khóa chỉ nằm ở hai nơi.

### Mục 11 — Xem khách hàng theo mã (có token)

Chuẩn bị: token KH1 (mục 10). Chưa có thì đăng nhập KH1 (+1 request).

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `GET localhost:3000/customers/1`, `[KH1]` | — | 200 `{"customer_id":1,"name":"Nguyễn Văn An","dob":"2000-01-01"}` |
| 2 | Sửa tab: `/customers/2` | — | 403 `NOT_OWNER` |

Phụ (nếu được hỏi "tạo hồ sơ"): `POST localhost:3000/customers/me`, `[token mục 9]`, body `{"name":"Pham Duc"}` → 201 `customer_id` 1000; rồi `GET localhost:3000/customers/1000` cùng token → 200.

Nói gì: mã là **số nguyên** để gõ tay được; vì số dễ đoán nên mọi API theo mã đều kiểm tra chủ → khách số 1 xem số 2 bị 403. `customer_id` **bằng** mã tài khoản trong token, nên khách không thể tạo hồ sơ cho người khác. Hồ sơ không lưu số điện thoại (chỉ ở auth) để không lệch hai nơi.

### Mục 12 — Xem tài xế theo mã (có token)

Chuẩn bị: token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/drivers/11`, `[KH1]` | 200 Tài Xế 1, `CAR_4`, `59A-00001`, `ONLINE` |
| 2 | Sửa tab: `/drivers/999` | 404 `DRIVER_NOT_FOUND` |
| 3 | Sửa tab: `/drivers/abc` | 400 `INVALID_ID` |

Nói gì: tài xế mã `10 + n`. Khách chỉ thấy **phần công khai** (họ tên, loại xe, biển số) vì cần nhận ra xe đến đón (FR14); số giấy phép (mã hóa) chỉ chính tài xế và admin thấy. Mã sai định dạng bị Gateway chặn 400, không đi tới database.

### Mục 13 — Tài xế quanh tọa độ 1 km, limit + paging

Chuẩn bị: chạy **trước** mục 15 (TX1 còn rảnh). Token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/drivers/nearby?lat=10.82&lng=106.68&limit=2`, `[KH1]` | 200: TX1 (11, ≈ 111 m), TX2 (12, ≈ 222 m); `total` 4, `total_pages` 2 |
| 2 | Sửa tab: thêm `&page=2` | TX3 (13, ≈ 334 m), TX4 (14, ≈ 445 m) |
| 3 | Sửa tab: bỏ `&page=2`, thêm `&vehicle=CAR_4` | TX1, TX3; `total` 2 |

Nói gì: seed 8 tài xế, chỉ 4 trong kết quả: TX5 `OFFLINE`, TX6 bận, TX7 chưa duyệt, TX8 cách 2,2 km. Khoảng cách tính bằng **Haversine** trên hai cột `lat`, `lng` trong SQL, sắp gần nhất trước (BRULE03). Không dùng PostGIS: một công thức dễ giải thích, cùng image PostgreSQL; đánh đổi: chậm khi có hàng chục nghìn tài xế.

### Mục 14 — Booking của khách, limit + paging

Chuẩn bị: chạy **trước** mục 15 để `total` đúng 7. Token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/bookings?limit=2`, `[KH1]` | 200: booking 7, 6; `total` 7, `total_pages` 4 |
| 2 | Sửa tab: thêm `&page=2` | booking 5, 4 |
| 3 | Sửa tab: `limit=abc` | 400 `INVALID_PAGINATION` |

Nói gì: chỉ trả booking của khách trong token, không nhận `customer_id` từ client. Sắp mới nhất trước, có `total` để thấy tổng. Index `(customer_id, created_at DESC)` phục vụ đúng truy vấn này. Sai tham số thì 400, không tự sửa.

### Mục 15 — Đặt xe → tìm tài xế → gửi Offer

Chuẩn bị: mục 13, 14 đã chạy; TX1 rảnh. Token KH1.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/bookings`, `[KH1]`, body `{"from":[10.82,106.68],"to":[10.83,106.69]}` | `booking_id` (≈ 1000) | 201 `SEARCHING`, `vehicle` CAR_4, `pay` CASH, `distance_m` ≈ 2026, **`fare` 45000** |
| 2 | Tab đăng nhập: `"phone":"0910000001","password":"12345678"` | **`token` TX1** | 200 |
| 3 | `GET localhost:3000/offers`, `[TX1]` | `offer_id` (≈ 1000) | 200: Offer `PENDING`, đúng `booking_id`, `distance_m` ≈ 111 |

Nói gì: Booking tính quãng đường = đường thẳng × 1,3, gọi **gRPC** sang Payment để tính cước cố định (Payment giữ bảng giá) — khách thấy giá ngay. Tìm tài xế chạy **nền** (khách không chờ): gọi Driver lấy tài xế rảnh, đúng loại xe, trong 1 km, gần nhất → tạo Offer → phát `booking.offer-created` để Notification báo tài xế. Mặc định `CAR_4` + tiền mặt nên đi thẳng sang tìm tài xế.

### Mục 16 — Tài xế nhận chuyến

Chuẩn bị: mục 15 trong vòng 5 phút (hạn Offer 300 giây). Token TX1, KH1.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/offers/<offer_id>/accept`, `[TX1]` | **`trip_id`** (≈ 1000) | 200 `ACCEPTED`, `booking_status` `DRIVER_ASSIGNED`, `trip_status` `ACCEPTED` |
| 2 | `GET localhost:3000/notifications`, `[KH1]` | — | Thông báo mới nhất `TRIP_ACCEPTED` |

Nói gì: Booking giữ tài xế (gRPC sang Driver) rồi gọi **gRPC `CreateTrip`** sang Trip — đồng bộ vì tài xế phải có ngay mã chuyến để cập nhật trạng thái; nhận chuyến mà không có Trip là vô nghĩa, nên Booking được phép lỗi theo Trip. Trip phát `trip.status-changed`, Notification báo khách. Hai tài xế nhận cùng lúc: index duy nhất "mỗi booking một Offer được nhận" chặn người thứ hai.

### Mục 17 — Cập nhật trạng thái chuyến đúng trình tự

Chuẩn bị: mục 16. Token TX1, `trip_id`.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `PATCH localhost:3000/trips/<trip_id>/status`, `[TX1]`, body `{"status":"COMPLETED"}` | **409 `INVALID_STATUS_TRANSITION`** (nhảy cóc) |
| 2 | Sửa tab: `"ARRIVED"` | 200 `ARRIVED` |
| 3 | Sửa tab: `"PICKED_UP"` | 200 |
| 4 | Sửa tab: `"IN_PROGRESS"` | 200 |
| 5 | Sửa tab: `"COMPLETED"` | 200 `COMPLETED`, `history` đủ 5 trạng thái |

Nói gì: thứ tự cố định `ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED` (FR12); đúng thao tác nhưng sai thời điểm là `FAILED_PRECONDITION` → 409, không phải lỗi hạ tầng. Đổi trạng thái và ghi lịch sử trong **một giao dịch**. Khi `COMPLETED`: Driver nghe Kafka trả TX1 về rảnh, Payment ghi nhận tiền mặt — dùng Kafka vì chuyến xong ngoài đời thì phải ghi nhận dù Driver đang lỗi.

### Mục 18 — Hủy chuyến → CANCELED, các bên được báo

Chuẩn bị: seed chuyến **5** (KH1, TX6, đã trả online, `ACCEPTED`) chưa bị hủy. Token KH1.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/trips/5/cancel`, `[KH1]`, body `{"reason":"ban viec"}` | — | 200 `CANCELED`, `canceled_by` customer |
| 2 | Tab đăng nhập: `"phone":"0910000006"` | `token` TX6 | 200 |
| 3 | `GET localhost:3000/notifications`, `[TX6]` | — | `TRIP_CANCELED` cho chuyến 5 |
| (4) | Sửa tab: token `[KH1]` | — | `TRIP_CANCELED` và `PAYMENT_REFUNDED` |

Phụ (hủy khi chưa có tài xế): `POST localhost:3000/bookings`, `[KH1]`, body `{"from":[10.82,106.68],"to":[10.83,106.69],"pay":"ONLINE"}` → copy `booking_id` → `POST localhost:3000/bookings/<booking_id>/cancel`, body `{"reason":"doi y"}` → 200 `CANCELED`.

Nói gì: chỉ hủy được **trước khi đón khách** (BRULE16); chưa có tài xế thì hủy Booking, có rồi thì hủy Trip. Trip phát `trip.status-changed`: Payment hoàn tiền (khách đã trả trước), Driver trả TX6 về rảnh, Notification báo cả hai. Dùng Kafka vì hủy phải thành công **dù Payment đang dừng** (NFR05); đánh đổi: tiền hoàn sau một nhịp.

### Mục 19 — Thanh toán online + callback → COMPLETED

Chuẩn bị: seed booking **7** = payment **7** (`CAR_7`, online, `PENDING`, 56 000 đ). Token KH1.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/payments/7/pay`, `[KH1]`, Headers `Idempotency-Key:k1`, body `{"simulate_result":"MANUAL"}` | — (`txn_id` = `SIM-7-1` theo quy luật) | 200 `status` `PENDING`, `txn_id` `SIM-7-1`, `txn_status` `PENDING` |
| 2 | `POST localhost:3000/payments/callback`, **không token**, Headers `X-Callback-Secret:cab-secret`, body `{"txn_id":"SIM-7-1"}` | — | 200 `txn_status` `SUCCEEDED`, **`status` `COMPLETED`** |
| (3) | `GET localhost:3000/bookings/7`, `[KH1]` | — | `SEARCHING` |

**Giữ nguyên hai tab 1, 2** cho mục 30.

Dự phòng khi thiếu giờ (1 request): bỏ body ở request 1 → adapter tự gọi callback → 200 `status` `COMPLETED` ngay (nói: "cổng giả lập gọi callback ngay; `MANUAL` để tách bước callback ra cho thấy rõ").

Nói gì: thanh toán điện tử là **trả trước** — trả xong mới tìm tài xế (BRULE13), thấy ở request 3. `MANUAL` giữ giao dịch chờ để mình tự gửi callback như cổng thanh toán thật. Callback xác thực bằng khóa bí mật trong header (giả lập đơn giản, không HMAC) — đánh đổi: không chứng minh body không bị sửa. Payment phát `payment.status-changed`, Booking nghe để bắt đầu tìm tài xế. Cước 56 000 = 25 000 + 15 000 × 2,026 km = 55 390, làm tròn lên 1 000.

### Mục 20 — Đánh giá chuyến đi

Chuẩn bị: seed chuyến **4** (`COMPLETED`, TX3, chưa đánh giá). Token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/trips/4/rating`, `[KH1]`, body `{"score":5}` | 201 `trip_id` 4, `driver_id` 13, `driver_avg` 5.0 |
| 2 | Gửi lại y hệt | 409 `RATING_ALREADY_EXISTS` |
| 3 | Sửa tab: `/trips/5/rating` | 409 `TRIP_NOT_COMPLETED` |

Nói gì: Rating gọi **gRPC** sang Trip hỏi "chuyến đã hoàn thành chưa, khách có đúng là người đi không" — cần câu trả lời ngay mới ghi được. Mỗi chuyến một đánh giá bằng UNIQUE `trip_id`. Điểm tài xế lưu **tổng và số lượng** (số nguyên), trung bình tính lúc đọc, không trôi sai số.

### Mục 21 — Đăng ký tài xế (OTP) → hồ sơ chờ duyệt

Chuẩn bị: không. Chạy lại thì đổi số `0911111112`.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/auth/otp`, body `{"phone":"0911111111"}` | `otp` | 200 có `otp` (6 số) |
| 2 | Sửa tab: URL `/auth/register-driver`, body `{"phone":"0911111111","otp":"<otp>","password":"12345678"}` | **`token`** tài xế mới, `account_id` | 201 `role` driver |
| 3 | `POST localhost:3000/drivers/me`, `[token vừa nhận]`, body `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` | **`driver_id`** (D) | 201 **`approval_status` `PENDING`**, `vehicle` CAR_4 |

Nói gì: OTP chứng minh người đăng ký giữ số điện thoại; giả lập nên trả luôn mã trong response (và ghi log), tắt `SIMULATION_MODE` thì không trả. OTP lưu dạng **băm scrypt**, hạn 5 phút, sai 5 lần là hủy. Tài khoản chỉ được tạo **sau khi** OTP đúng. Hồ sơ nằm ở `driver-service`, số giấy phép **mã hóa AES-256-GCM**; mới nộp thì `PENDING`, chưa nhận chuyến được.

### Mục 22 — Admin duyệt / từ chối hồ sơ

Chuẩn bị: mục 21 (có D). Nếu chưa chạy 21: chỉ duyệt được TX7 (17).

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | Tab đăng nhập: `"phone":"0999999999","password":"12345678"` | `token` AD1 | 200 `role` admin |
| 2 | `POST localhost:3000/drivers/<D>/approve`, `[AD1]` | — | 200 `APPROVED` |
| 3 | Sửa tab: `/drivers/17/reject`, body `{"reason":"thieu giay to"}` | — | 200 `REJECTED` |

Nói gì: chỉ role `admin` gọi được (Gateway chặn role khác 403). Hồ sơ đã xét thì không xét lại (409). Driver phát `driver.application-reviewed`, Notification báo tài xế. Người duyệt và thời điểm được lưu (`reviewed_by`, `reviewed_at`) để lưu vết.

### Mục 23 — Tài xế bật / tắt nhận chuyến

Chuẩn bị: seed TX5 (đã duyệt, `OFFLINE`, có vị trí).

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | Tab đăng nhập: `"phone":"0910000005"` | `token` TX5 | 200 |
| 2 | `POST localhost:3000/drivers/me/online`, `[TX5]` | — | 200 `availability` `ONLINE` |
| 3 | Sửa tab: `online` → `offline` | — | 200 `OFFLINE` |

Đường lỗi (nếu được hỏi): token tài xế mục 21 **trước** khi duyệt → `POST /drivers/me/online` → 409 `DRIVER_NOT_APPROVED`.

Nói gì: API "của tôi" không có mã trong đường dẫn → không bật hộ người khác được. Database có CHECK "chưa duyệt thì không `ONLINE` được" và "`ONLINE` phải có vị trí". Đang bận chuyến thì không tắt được (409). Chỉ tài xế `ONLINE` mới được tìm thấy ở mục 13.

### Mục 24 — Mã hóa dữ liệu nhạy cảm + quản lý khóa

Chuẩn bị: token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/customers/1`, `[KH1]` | 200 `name` "Nguyễn Văn An" (rõ, cho đúng chủ) |
| 2 | Terminal: `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `full_name_enc`, `date_of_birth_enc` là `\x…` (byte), không đọc được tên |
| 3 | Terminal: `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$` |

Nói gì: **mật khẩu băm** scrypt có salt (không giải ngược được). **Họ tên, ngày sinh khách, số giấy phép mã hóa AES-256-GCM**, IV ngẫu nhiên từng giá trị. Khóa nằm trong biến môi trường **riêng từng service** (`CUSTOMER_DATA_KEY`, `DRIVER_DATA_KEY`) đọc từ `.env`, không ở code, image, database; thiếu khóa thì service không khởi động. Số điện thoại, email **không mã hóa** vì dùng để đăng nhập và chặn trùng — mã hóa thì phải thêm chỉ mục mù; được bảo vệ bằng mạng nội bộ và quyền API. Đánh đổi: ai đọc được biến môi trường container thì có khóa; thật thì dùng KMS / Vault.

### Mục 25 — SQL injection

Chuẩn bị: tab đăng nhập, token KH1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab đăng nhập: body `{"phone":"0900000001","password":"' OR '1'='1"}` | 401 `INVALID_CREDENTIALS` |
| 2 | Sửa tab: `{"phone":"' OR 1=1 --","password":"x"}` | 400 `INVALID_PHONE` |
| 3 | `GET localhost:3000/customers/1 OR 1=1`, `[KH1]` | 400 `INVALID_ID` |

Nói gì: ba lớp — (1) kiểm tra định dạng trước (số điện thoại `0` + 9 chữ số, mã là số nguyên) nên chuỗi lạ bị 400; (2) mọi câu SQL dùng **tham số** `$1`, giá trị không bao giờ ghép vào câu lệnh; (3) mật khẩu so bằng hash, chuỗi `' OR '1'='1` chỉ là một mật khẩu sai. Không lần nào 200 hay 500.

### Mục 26 — XSS

Chuẩn bị: token KH1 (KH1 có hồ sơ).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `PUT localhost:3000/customers/me`, `[KH1]`, body `{"name":"<script>alert(1)</script>"}` | 400 `TEXT_CONTAINS_HTML` |
| 2 | Sửa tab: method `GET`, xóa body | 200 tên vẫn "Nguyễn Văn An"; tab **Headers**: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` |

Nói gì: văn bản có `<` hoặc `>` bị **từ chối ở cửa vào** (Gateway và service đều kiểm tra), không lưu. API chỉ trả JSON kèm `nosniff` và CSP nên trình duyệt không chạy response như HTML. Đánh đổi: người dùng không gõ được `<`, `>` trong nhận xét.

### Mục 27 — JWT bị sửa → 401

Chuẩn bị: token KH1. Làm **gần cuối** (phần mở rộng thu hồi token này).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/customers/me`, `[KH1]` nhưng **sửa một ký tự ở giữa token** (ví dụ đổi một chữ trong đoạn giữa hai dấu chấm) | 401 `TOKEN_INVALID` |
| 2 | Sửa tab: Authorization → **No Auth** | 401 `TOKEN_MISSING` |
| (3) | `POST localhost:3000/auth/logout`, `[KH1]` (token đúng) | 200 `LOGGED_OUT` |
| (4) | Tab request 1, dán lại token đúng vừa đăng xuất | 401 `TOKEN_REVOKED` |

Lưu ý: **không** sửa ký tự **cuối cùng** của token — ký tự cuối base64url có bit thừa, đổi có thể không làm hỏng chữ ký.

Nói gì: chữ ký HS256 tính trên header + payload bằng `JWT_SECRET`; sửa một ký tự thì chữ ký không khớp → 401, kể cả khi đổi `role` thành `admin`. Đăng xuất: Gateway ghi `jti` của token vào Redis với thời gian sống bằng thời gian còn lại của token, mọi request sau tra Redis → 401. Đánh đổi: Redis dừng thì token đã đăng xuất tạm dùng lại được.

### Mục 28 — Sai quyền → 403

Chuẩn bị: token KH1, token TX1.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/drivers/17/approve`, `[KH1]` | 403 `FORBIDDEN` |
| 2 | `POST localhost:3000/bookings`, `[TX1]`, không body | 403 `FORBIDDEN` |

Nói gì: Gateway so `role` trong token với danh sách role của route **trước** khi đọc body — nên body rỗng vẫn 403, không phải 400. Ba role cố định trong cột `role`, không có bảng PERMISSION (phiếu chấm chỉ kiểm tra theo role). Còn một lớp nữa ở service: đúng role nhưng không phải chủ → 403 `NOT_OWNER` (đã thấy ở mục 11).

### Mục 29 — Spam → 429

Chuẩn bị: làm **cuối cùng** (khóa route công khai tối đa 10 giây).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab đăng nhập bất kỳ, bấm **Send liên tục 6 lần** | Lần 1–5: 200 / 401 kèm `RateLimit-Remaining` giảm dần; lần 6: **429 `RATE_LIMITED`**, header `Retry-After` |

Nói gì: Gateway đếm bằng Redis `INCR` theo **IP** cho route công khai (5 request / 10 giây) và theo **tài khoản** cho route có token (30 / 10 giây); key tự hết hạn cuối cửa sổ. Ngưỡng là biến môi trường để hạ thấp khi demo. Redis dừng thì cho qua (hệ thống không dừng vì thiếu bộ đếm). Đánh đổi của cửa sổ cố định: ở ranh giới hai cửa sổ có thể lọt gấp đôi trong chốc lát.

### Mục 30 — Replay thanh toán → trả response cũ

Chuẩn bị: chạy **ngay sau** mục 19 (trong 5 phút), còn hai tab của mục 19.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab request 1 mục 19 (`/payments/7/pay`, `k1`, cùng body) → Send | 200 body **y hệt** lần đầu (`PENDING`), header `Idempotency-Replayed: true`; không tạo lần thử mới |
| 2 | Tab request 2 mục 19 (callback) → Send | 200 y hệt (`COMPLETED`), `Idempotency-Replayed: true`; không đổi trạng thái |
| 3 | `GET localhost:3000/payments/7`, `[KH1]` | `COMPLETED`, **đúng một** giao dịch `CHARGE` `SIM-7-1` |

Nói gì: hai lớp chống lặp — (1) khách bấm hai lần: bảng `idempotency_keys` theo (`payment_id`, khóa) lưu response lần đầu, gặp lại thì trả nguyên văn, khác body thì 409; (2) cổng thanh toán gửi lại callback: `txn_id` UNIQUE + response đã lưu, không phát lại event (Kafka UI: `payment.status-changed` không có message mới). Response replay vẫn ghi `PENDING` vì đó là **response lần đầu**, không phải trạng thái hiện tại — trạng thái thật xem ở request 3.

## 3. Thứ tự chạy khi thi

| Bước | Mục | Vì sao phải theo thứ tự |
|---|---|---|
| 1 | 1 → 8 | Hạ tầng, không đổi dữ liệu |
| 2 | 9 → 10 → 11 | Mục 10 cho token KH1 dùng suốt buổi; mục 11 (phụ) dùng token của mục 9 |
| 3 | 12 → **13 → 14** | Trước mục 15: TX1 còn rảnh (13 thấy 4 tài xế), KH1 còn đúng 7 booking (14) |
| 4 | **15 → 16 → 17** | Cùng booking / Offer / chuyến; mục 16 trong 5 phút sau 15 |
| 5 | 7 (xem message) | Sau 15 mới có message ở `booking.offer-created` |
| 6 | 20 | Chuyến seed 4 |
| 7 | 18 | Chuyến seed 5 — chỉ hủy được một lần |
| 8 | **19 → 30** liền nhau | Payment seed 7 chỉ thanh toán được một lần; sau 5 phút không tài xế `CAR_7` nhận thì Payment 7 bị hoàn tiền |
| 9 | 21 → 22 → 23 | 22 duyệt tài xế của 21 |
| 10 | 24 → 25 → 26 → 28 | Chỉ đọc hoặc bị từ chối, không đổi seed |
| 11 | **27** | Phần mở rộng đăng xuất thu hồi token KH1 |
| 12 | **29** cuối cùng | Khóa đăng nhập / đăng ký tối đa 10 giây |

Giảng viên gọi mục lệch thứ tự: mục chỉ đọc (6, 11–14, 24–26, 28) chạy lúc nào cũng được; mục đổi seed (15–20, 22, 23, 30) kiểm tra cột "Chuẩn bị". Seed hỏng thì `docker compose down -v` rồi `docker compose up -d --build` (khoảng 1–2 phút).

## 4. Những thứ phải nhớ

| Nhóm | Giá trị | Mẹo nhớ |
|---|---|---|
| Mật khẩu mọi tài khoản seed | `12345678` | Một mật khẩu |
| Khách | KH1 `0900000001` (mã **1**, có hồ sơ "Nguyễn Văn An", 2000-01-01); KH2 `0900000002` (**2**); KH3 `0900000003` (**3**, chưa có hồ sơ); KH9 `0900000009` (**9**, **bị khóa**) | `090000000n` ↔ mã `n` |
| Tài xế | TX1–TX8: `0910000001`…`0910000008` ↔ mã **11–18** | `091000000n` ↔ mã `10 + n` |
| Vai trò tài xế seed | TX1 `CAR_4` rảnh (mục 15–17); TX2 xe máy; TX3 `CAR_4` (chuyến 4); TX4 `CAR_7` (B7); TX5 `OFFLINE` (mục 23); TX6 bận chuyến 5 (mục 18); TX7 chờ duyệt (mục 22); TX8 xa 2,2 km | TXn đứng ở `10.82n, 106.68`, cách P0 n × 111 m |
| Admin | AD1 `0999999999` ↔ mã **99** | Toàn số 9 |
| Booking seed (của KH1) | Mã booking = payment = trip = **1…7**. **4**: chuyến xong, chưa đánh giá (mục 20). **5**: chuyến `ACCEPTED`, đã trả online (mục 18). **7**: `CAR_7`, online, chờ thanh toán 56 000 đ (mục 19, 30) | 4 đánh giá, 5 hủy, 7 trả tiền |
| Mã do API tạo | Từ **1000** | Seed số nhỏ, API số lớn |
| Tọa độ | P0 = `10.82, 106.68` (điểm đón); D0 = `10.83, 106.69` (điểm đến) | D0 = P0 cộng 0.01 |
| Cước P0 → D0 (≈ 2 026 m) | `CAR_4` **45 000**; `MOTORBIKE` 21 000; `CAR_7` **56 000** | mở cửa + đơn giá/km × km, làm tròn lên 1 000 |
| Bảng giá | Xe máy 10 000 + 5 000/km (tối thiểu 15 000); 4 chỗ 20 000 + 12 000/km (30 000); 7 chỗ 25 000 + 15 000/km (40 000) | |
| Body đặt xe | `{"from":[10.82,106.68],"to":[10.83,106.69]}`; thêm `"pay":"ONLINE"`, `"vehicle":"CAR_7"` khi cần | Mặc định `CAR_4`, `CASH` |
| Header | `Authorization: Bearer <token>` (tab Authorization); `Idempotency-Key: k1`; `X-Callback-Secret: cab-secret` | |
| Mã giao dịch | `SIM-<payment_id>-<lần thử>` → `SIM-7-1` | |
| Giả lập thanh toán | `simulate_result`: không gửi = thành công ngay; `FAILED`; `MANUAL` = chờ callback | |
| Số mới khi demo | Khách `0901234567` (lần hai `…68`); tài xế `0911111111` (lần hai `…12`) | |
| Địa chỉ | Gateway `localhost:3000`; Kafka UI `localhost:8080`; service bên trong `:50051` (không mở) | |
| Container database | `auth-db`, `customer-db`, `driver-db`, `booking-db`, `trip-db`, `payment-db`, `rating-db` (PostgreSQL), `notification-db` (MongoDB) | `<context>-db` |
| Database, user | Database = tên context (`auth`, `customer`…); user **`cab`**; mật khẩu `cab123` (`DB_PASSWORD`) | |
| Lệnh xem bảng | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `table <tên bảng>` = `select *` |
| Lệnh dựng | `cp .env.example .env` (lần đầu); `docker compose up -d --build` | |
| Lệnh đặt lại seed | `docker compose down -v` rồi `docker compose up -d --build` | `-v` xóa volume |
| Lệnh xem container | `docker compose ps -a` (21 container) | |
| Giới hạn thời gian (`.env.example`) | Offer 300 s; thanh toán 600 s (B7: 1 ngày); OTP 300 s; token 3 600 s; rate limit 5 request công khai / 10 s, 30 request có token / 10 s | |
| Hằng số | Bán kính 1 000 m; hệ số quãng đường 1,3; 3 lần thử thanh toán; 5 lần nhập OTP | |
| Mã lỗi hay gặp | 400 sai dữ liệu; 401 token / đăng nhập; 403 `FORBIDDEN` (sai role) và `NOT_OWNER` (không phải chủ); 404; 409 trùng **hoặc sai trạng thái**; 429; 503 service dừng | |

## 5. Mục chấm → số request → thời gian gõ

Giả định: gõ mới một request 10–20 giây; sửa tab 3–5 giây; một lệnh terminal 10–15 giây. **Sát** = 28–32 giây; **vượt** = trên 32 giây.

| Mục | Số request (+ lệnh) | Ước lượng | Đánh giá |
|---|---|---|---|
| 1, 3, 4 | 0 (nói) | ~30 s nói | — |
| 2 | 3 lệnh | ~15 s | |
| 5 | 1 lệnh | ~10 s | |
| 6 | 3 | ~15 s | |
| 7 | 0 (trình duyệt) | ~15 s | |
| 8 | 1 lệnh + 1 | ~15 s | |
| 9 | 3 | ~25 s | |
| 10 | 3 | ~25 s | |
| 11 | 2 (+1 nếu chưa có token) | ~15 s (~25 s) | |
| 12 | 3 | ~18 s | |
| 13 | 3 | ~22 s | |
| 14 | 3 | ~16 s | |
| 15 | 3 | ~30 s | **Sát** — phải thấy Offer ở phía tài xế nên cần đăng nhập TX1 |
| 16 | 2 | ~20 s | |
| 17 | 5 (1 gõ + 4 sửa một từ) | ~30 s | **Sát** — FR12 có 4 bước + 1 lần thử sai |
| 18 | 3 (+1) | ~28 s | **Sát** — cần token TX6 để thấy tài xế được báo |
| 19 | 2 (+1) | ~35–40 s | **Vượt** — hai request đều có header phụ; dự phòng 1 request (~20 s) |
| 20 | 3 | ~20 s | |
| 21 | 3 | ~35 s | **Vượt nhẹ** — ba bước nghiệp vụ ở hai service |
| 22 | 3 | ~25 s | |
| 23 | 3 | ~20 s | |
| 24 | 1 + 2 lệnh | ~30 s | **Sát** — lệnh `psql` dài |
| 25 | 3 | ~15 s | |
| 26 | 2 | ~20 s | |
| 27 | 2 (+2) | ~10 s (~25 s) | |
| 28 | 2 | ~20 s | |
| 29 | 1 × 6 lần | ~10 s | |
| 30 | 3 (gửi lại tab mục 19) | ~12 s | Gõ lại từ đầu thì ~45 s — **phải giữ tab mục 19** |

Câu hỏi còn mở ảnh hưởng tới bảng này (chi tiết ở file 04 mục 9.2): Q60 (được dùng lại tab đã gõ trong buổi thi không), Q61 (30 giây tính cả lúc giải thích không), Q62 (token hết hạn sau một giờ).
