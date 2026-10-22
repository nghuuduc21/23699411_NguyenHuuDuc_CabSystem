# 06 — Kịch bản thi (học thuộc)

> Viết 2026-10-03. Nguồn: `docs/design/04-api.md` (API, mục 5), `docs/design/03-du-lieu.md` mục 13 (biến môi trường), mục 14 (seed), `CLAUDE.md` (Ràng buộc khi thi). Sửa API hay seed thì sửa file này theo.
> **Sửa 2026-10-03 lần 4 theo 04 lần 4 (ADR-018):** mọi đường dẫn dưới `/api/v1/`; đổi trạng thái là `PATCH` + `status`; được **dùng lại tab**; 30 giây **gồm cả giải thích**, nên mỗi mục chỉ giữ request chính, phần còn lại ghi `(tùy chọn)`.
> Luật thi: Postman **không lưu sẵn** gì; **được copy** giá trị từ response; **được dùng lại tab và mở tab mới**; lệnh terminal **gõ đầy đủ**; **không mở ghi chú**. Mỗi mục khoảng **30 giây, vừa làm vừa nói**.
> **Sửa 2026-10-05** (sinh viên chốt spec 17-18, 20-29): mục 16 thêm xem thông báo là request chính; mục 18 gõ ở tab GET đang mang token KH1; mục 29 bấm Send ở tab **đăng nhập** KH1; `driver_avg` in `5`.
> **Sửa 2026-10-05 lần 2** (sinh viên chốt): tài khoản chỉ có số điện thoại + mật khẩu, email nằm ở hồ sơ khách (mục 9, 11 — ADR-019); bị từ chối thì nộp lại bằng chính request nộp hồ sơ (mục 21, 22 — FR43); cổng gRPC riêng 50051–50058 (mục 8, mục 4 — ADR-020). Không thêm request vào chuỗi chính.
> **Sửa 2026-10-07** (sinh viên chốt M1 báo cáo hồi quy): mục 7 thêm câu trả lời vấn đáp về Kafka UI chỉ đọc và chống lặp event. Không thêm request.
> **Sửa 2026-10-14 (theo yêu cầu giảng viên, sinh viên chốt — ADR-021 thay ADR-019):** health trả `healthy` / `ready` / `unhealthy` (mục 6); khách, admin đăng ký / đăng nhập bằng **email**, tài xế bằng **số điện thoại**, nhóm route `/api/v1/auth/…` (mục 9, 10, 21, 25, 29); hồ sơ khách có `phone` thay `email` (mục 11, 24); xem tài xế theo mã chỉ admin và chính tài xế, thêm **tab admin** (mục 12); booking theo mã khách `customers/{id}/bookings` (mục 14); mục 27 demo bằng jwt.io (ADR-016). Mục 4 "Những thứ phải nhớ" đổi seed: `kh1@cab.vn`, `admin@cab.vn`.
> **Sửa 2026-10-21** (sinh viên chốt sau báo cáo hồi quy 2026-10-21): mục 12 câu vấn đáp "khách thấy tài xế của chuyến mình" nay đúng với hệ thống — `GET /api/v1/trips/{id}` có khối `driver` chụp lúc nhận chuyến (M1 / L1); gRPC bật `waitForReady` nên request đầu sau khi bật lại một service không còn 503 (L2). Mục 6 (tùy chọn dừng `rating-service`): `/health/services` vẫn trả 503 sau ≈ 1 giây như cũ; nếu gọi API nghiệp vụ của service đang dừng thì 503 đến sau ≈ 3 giây (hết deadline), không phải ngay. Không thêm request vào chuỗi chính.
> Cách dùng: học thuộc mục 4 ("những thứ phải nhớ") trước, rồi tập từng mục ở mục 2 theo thứ tự ở mục 3.

## 1. Sáu thao tác Postman dùng ở mọi mục

| Việc | Làm thế nào |
|---|---|
| Chọn method | Ô bên trái URL: `GET`, `POST`, `PATCH` (chỉ ba method) |
| Gõ URL | `localhost:3000/api/v1/...` (Postman tự thêm `http://`). Chỉ health không có `/api/v1` |
| Gắn token | Tab **Authorization** → Type **Bearer Token** → dán token (không gõ chữ `Bearer`) |
| Header phụ | Tab **Headers** → **Bulk Edit** → gõ một dòng `Idempotency-Key:k1` hoặc `X-Callback-Secret:<khóa trong .env>` |
| Body | Tab **Body** → **raw** → gõ JSON. "Text" hay "JSON" đều được. Đổi sang `GET` thì không cần xóa body (Gateway bỏ qua) |
| Nhân bản tab | Chuột phải tab → **Duplicate Tab** — giữ tab cũ để gửi lại sau (mục 10, 15, 19) |

"Sửa tab" = dùng lại tab vừa gửi, chỉ đổi phần ghi rõ rồi Send. Nói **trong lúc gõ**, đừng chờ gõ xong mới nói.

Các tab giữ suốt buổi (04 mục 5.5):

| Tab | Tạo ở | Dùng lại ở |
|---|---|---|
| Đăng nhập KH1 (email), AD1 (email), TX1 (số điện thoại) | 10 | Lấy token (Send lại rồi copy); 25, 29 (**tab đăng nhập KH1**) |
| Tab GET (`[KH1]`) | 11 | 12 (request 1), 13, 14, 16 (thông báo), 18 (hủy chuyến + thông báo), 24, 25 (tùy chọn), 26, 27 |
| Tab admin (`[AD1]`) — mới 2026-10-14 | 12 | 14 (tùy chọn) |
| Tab đặt xe | 15 | 28 |
| Tab chuyến (`[TX1]`) | 15 | 16, 17 |
| Hai tab thanh toán | 19 | 30 |
| Tab tài xế | 21 | 22, 23, 28 |

## 2. Từng mục chấm

Ký hiệu: `[KH1]` = gắn token của KH1. `(tùy chọn)` = chỉ làm khi được hỏi. Mã do API tạo bắt đầu từ **1000**; luôn **copy** từ response, không đoán.

### Trước giờ thi — dựng hệ thống (một lần)

| # | Lệnh | Kết quả |
|---|---|---|
| 1 | (đã làm sẵn trên máy) `.env` có đủ 14 biến; 5 biến bí mật tự sinh, không có trên Git | Không cần gõ gì lúc thi |
| 2 | `docker compose up -d --build` | Toàn bộ container lên; seed tự chạy (`SIMULATION_MODE=true`) |
| 3 | Postman `GET localhost:3000/health/services` | 200 `"status":"healthy"`, 8 service `"healthy"` → sẵn sàng |

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

Nói gì: `.env` chứa mật khẩu database, `JWT_SECRET`, khóa mã hóa nên không commit. `.env.example` chỉ có **tên biến**: 5 biến bí mật để trống, giá trị thật chỉ nằm trong `.env` trên máy này. Ai clone repo phải tự sinh khóa (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Lộ khóa thì đổi khóa, xóa commit không đủ.

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
| 1 | `GET localhost:3000/health` | 200 `{"status":"healthy"}` |
| 2 | Sửa tab: `/ready` | 200 `{"status":"ready","checks":{"redis":"healthy","grpc_clients":"healthy"}}` |
| 3 | Sửa tab: `/health/services` | 200 `{"status":"healthy","services":{"auth-service":"healthy",…8 service}}` |
| (4) | (tùy chọn) Terminal `docker compose stop rating-service` → Send lại request 3 → `docker compose start rating-service` | 503 `{"status":"unhealthy","services":{…,"rating-service":"unhealthy"}}` |

Thời gian: 1 gõ + 2 sửa ~15 s + nói ~10 s → **~25 s, Ổn**.

Nói gì: `/health` = Gateway còn sống → `healthy`; `/ready` = Gateway đủ phụ thuộc **của chính nó** (Redis, 8 kênh gRPC) → `ready`, thiếu thì 503 `not_ready`; `/health/services` = hỏi gRPC Health của 8 service song song, deadline 1 giây → mỗi service `healthy` / `unhealthy`, có một service hỏng thì tổng là `unhealthy` và 503. (Nếu thầy hỏi vì sao 503 chậm ~1 giây: kênh gRPC bật `waitForReady`, chờ service trong hạn deadline rồi mới kết luận — để service vừa bật lại, đổi IP, không bị báo lỗi oan.) Chữ trả về chốt theo yêu cầu của thầy. Ba đường này **không có `/api/v1`** vì không phải tài nguyên nghiệp vụ, và Docker healthcheck gọi đường cố định.

Nếu hỏi "mất database và không kết nối được có khác nhau không?": ra ngoài đều là `unhealthy`; lý do chi tiết nằm trong log Gateway — người gọi chỉ cần biết dùng được hay không.

### Mục 7 — Kafka

Chuẩn bị: làm sau mục 15 để có message.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Trình duyệt: `localhost:8080` → cluster `cab` → **Topics** | Đủ **7 topic** (mục 4) |
| 2 | Bấm `booking.offer-created` → **Messages** | Message có `booking_id`, `driver_id` của mục 15 |
| (3) | (tùy chọn) Tab **Consumers** | Group mang tên service, lag 0 |

Nói gì: topic **tạo sẵn** bởi `kafka-init`, broker tắt tự tạo topic. Consumer group = tên service. Event gửi **ngay sau khi commit**, không outbox — đánh đổi: service dừng đúng lúc đó thì mất event.

Nếu hỏi "sao không có nút Produce?": Kafka UI để **chỉ đọc** (`KAFKA_CLUSTERS_0_READONLY=true`). Mục 7 chỉ cần **xem** event; chỉ đọc thì không ai gửi nhầm event giả vào hệ thống lúc demo. Đánh đổi: muốn gửi lại message phải dùng `kafka-console-producer.sh` trong container `kafka` (lệnh dài, không gõ khi thi — spec 17-18 mục 8.0).

Nếu hỏi "event bị gửi hai lần thì sao?" (trả lời bằng lời): Kafka giao **ít nhất một lần**, nên mọi bên nghe chịu được event lặp, **không cần bảng "event đã xử lý"**:
- **Payment, Driver, Booking**: đổi trạng thái **có điều kiện** — chỉ đổi khi đang ở trạng thái trước đó (Driver còn so cả `booking_id`). Lần hai thấy đã đổi rồi thì bỏ qua. Ví dụ hủy chuyến gửi hai lần: lần hai Payment đã `REFUNDED` nên không hoàn thêm; UNIQUE một giao dịch `REFUND` mỗi thanh toán chặn thêm lần nữa.
- **Notification**: thông báo là bản ghi mới, không có trạng thái để so → UNIQUE (`event_id`, `recipient_id`); event lặp cùng `event_id` không tạo thông báo thứ hai.

### Mục 8 — Mọi request đi qua Gateway

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Terminal: `docker compose ps` | Cột PORTS: chỉ `gateway` `3000` và `kafka-ui` `8080` |
| 2 | Postman `GET localhost:50051` (cổng của auth; 50052–50058 cũng vậy) | `Error: connect ECONNREFUSED` |

Nói gì: service chỉ nghe trong mạng Compose, mỗi service một cổng gRPC riêng **50051–50058** (auth 1 … rating 8, theo thứ tự 8 service); thử cổng nào cũng `ECONNREFUSED`. Database, Redis, Kafka không có `ports`. Mọi request từ ngoài buộc qua Gateway, nơi có JWT, role, rate limit. Nếu gọi thẳng `27017` (hay `5432`) mà có trả lời: đó là MongoDB / PostgreSQL **cài trên Windows**, không phải container của project (đã gặp thật) — chứng minh bằng `docker compose ps -a`: cột cổng của `notification-db` không có `->`. Tốt nhất tắt dịch vụ MongoDB của Windows trước buổi thi.

### Mục 9 — Đăng ký khách hàng → đăng nhập được

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/api/v1/auth/register`, body `{"email":"new1@cab.vn","password":"12345678"}` | — | 201 `{"account_id":1000,"role":"customer"}` |
| 2 | Sửa tab: `register` → `login` (body giữ nguyên) | `token` (mục 11 tùy chọn) | 200 có `token`, `account_id` 1000 |
| (3) | (tùy chọn) Sửa tab: `login` → `register` | — | 409 `EMAIL_ALREADY_EXISTS` |

Chạy lại lần hai thì đổi email thành `new2@cab.vn`.

Thời gian: 1 gõ + 1 sửa ~20 s + nói ~8 s → **~28 s, Sát**.

Nói gì: theo yêu cầu của thầy, mọi thao tác xác thực nằm trong nhóm **`/api/v1/auth/…`**; khách đăng ký bằng **email + mật khẩu** (gửi thêm `phone` → 400 vì là field lạ). Chỉ tạo `customer` ở `auth-service`, email lưu chữ thường và UNIQUE, mật khẩu băm scrypt, không gọi service nào; hồ sơ khách (họ tên, số điện thoại, ngày sinh) tạo sau khi đăng nhập. Đăng ký và đăng nhập cùng body nên chỉ sửa URL.

### Mục 10 — Đăng nhập → cấp token

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | Sửa tab mục 9: `"email":"kh1@cab.vn"` | — (tab này = **tab KH1**) | 200 `token`, `role` customer, `account_id` 1, `expires_in` 3600 |
| 2 | Nhân bản tab: `"email":"admin@cab.vn"` | — (**tab AD1**) | 200 `role` admin, `account_id` 99 |
| 3 | Nhân bản tab: body `{"phone":"0910000001","password":"12345678"}` (đổi chữ `email` → `phone` và giá trị) | — (**tab TX1**) | 200 `role` driver, `account_id` 11 |
| (4) | (tùy chọn) Tab KH1: thêm `"phone":"0910000001",` (gửi cả hai) rồi xóa; hoặc `"password":"sai"` rồi sửa lại | — | 400 `INVALID_INPUT`; 401 `INVALID_CREDENTIALS` |

Thời gian: 1 sửa + 2 nhân bản ~17 s + nói ~10 s → **~27 s, Sát**. Làm tab TX1 **cuối** vì phải đổi cả tên field.

Nói gì: một API đăng nhập cho cả ba role, **mỗi role đúng một định danh**: khách và admin dùng email, tài xế dùng số điện thoại (vì tài xế đã xác thực số bằng OTP). Gửi đúng một trong hai field; cả hai hoặc không có → 400. Database có CHECK theo role nên tra theo số chỉ ra tài xế, tra theo email chỉ ra khách / admin. JWT ký **HS256** bằng `JWT_SECRET` chỉ có ở auth và Gateway; payload có `sub` (mã tài khoản), `role`, `jti`, `exp` — không có email, số điện thoại. Sai mật khẩu và định danh chưa đăng ký trả **cùng** 401 để không lộ ai đã có tài khoản. Ba tab này giữ cả buổi để lấy token.

### Mục 11 — Xem khách hàng theo mã (có token)

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `GET localhost:3000/api/v1/customers/1`, `[KH1]` — tab này = **tab GET** | 200 `{"customer_id":1,"name":"Nguyễn Văn An","phone":"0900000001","dob":"2000-01-01"}` |
| 2 | Sửa tab: `/customers/2` | 403 `NOT_OWNER` |
| (3) | (tùy chọn, tạo hồ sơ) `POST localhost:3000/api/v1/customers`, `[token mục 9]`, body `{"name":"Pham Duc","phone":"0901234567"}` | 201 `customer_id` 1000 |

Thời gian: ~15 s + nói ~8 s → **~23 s, Ổn**.

Nói gì: đúng mẫu `/api/v1/customers/{mã}`; mã của mình là `account_id` trong response đăng nhập. Số điện thoại của khách là thông tin **liên hệ** nên nằm ở **hồ sơ**, bắt buộc khi tạo hồ sơ; email là định danh đăng nhập nên nằm ở **tài khoản** — mỗi dữ liệu một nơi, auth và customer không gọi nhau. Số trong hồ sơ lưu rõ, không UNIQUE (hai người nhà dùng chung số vẫn được); chỉ họ tên, ngày sinh mã hóa. Mã là **số nguyên** để gõ tay được; vì dễ đoán nên mọi API theo mã đều kiểm tra chủ → khách 1 xem khách 2 bị 403. Tạo hồ sơ là `POST /api/v1/customers`, không gửi mã: `customer_id` lấy từ token.

### Mục 12 — Xem tài xế theo mã (có token)

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET (`[KH1]`): `customers/2` → `drivers/11` | **403 `FORBIDDEN`** — khách không xem tài xế theo mã |
| 2 | Chuột phải tab → **Duplicate Tab**; tab Authorization dán token `[AD1]` (copy ở tab đăng nhập AD1) → Send — tab mới = **tab admin** | 200 bản đầy đủ: Tài Xế 1, `CAR_4`, `59A-00001`, `ONLINE`, `approval_status` `APPROVED`, `license` `GPLX-00001`, `lat`, `lng` |
| 3 | Sửa tab admin: `/drivers/999` | 404 `DRIVER_NOT_FOUND` |
| (4) | (tùy chọn) Tab admin đổi token `[TX1]`: `/drivers/11` → 200; `/drivers/12` | 403 `NOT_OWNER` |

Thời gian: 1 sửa (~4 s) + nhân bản và dán token (~8 s) + 1 sửa (~3 s) + nói ~10 s → **~25 s, Ổn**. Tab GET vẫn giữ token KH1 cho mục 13, 14, 16.

Nói gì: tài xế mã `10 + n`. Theo yêu cầu của thầy, hồ sơ tài xế theo mã chỉ **admin** (mọi mã) và **chính tài xế** (mã của mình) được xem: khách → 403 `FORBIDDEN` ngay ở Gateway vì role không có trong route; tài xế xem mã người khác → 403 `NOT_OWNER` ở service, so mã trước khi đọc database. Khách vẫn thấy họ tên, biển số tài xế **của chuyến mình** qua `GET /api/v1/trips/{mã}` (FR14): ví dụ KH1 xem `trips/5` thấy `"driver": {"driver_id": 16, "name": "Tài Xế 6", "plate": "59A-00006"}`. Hai giá trị này được **chụp vào chuyến lúc tài xế nhận**: Driver trả họ tên, biển số khi giữ tài xế (`ReserveDriver`), Booking chuyển sang Trip trong `CreateTrip`, Trip lưu lại. Vì sao chụp: biển số của xe **đã chạy chuyến đó** là lịch sử của chuyến — tài xế đổi xe sau này thì chuyến cũ vẫn đúng xe cũ; xem chuyến không phải gọi thêm Driver, Driver dừng vẫn xem được. Không thêm đường giao tiếp nào. Số giấy phép mã hóa trong database, chỉ giải mã cho admin và chủ.

(Tùy chọn nếu thầy hỏi "khách biết tài xế nào tới đón bằng cách nào?") Tab GET `[KH1]`: sửa URL `drivers/11` → `trips/5` → 200 có khối `driver` (+~6 s).

### Mục 13 — Tài xế quanh tọa độ 1 km, limit + paging

Chuẩn bị: **trước** mục 15 (TX1 còn rảnh).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET (`[KH1]`): `drivers/11` → `drivers?lat=10.82&lng=106.68&limit=2` | 200: TX1 (11, ≈ 111 m), TX2 (12, ≈ 222 m); `total` 4, `total_pages` 2 |
| 2 | Sửa tab: thêm `&page=2` | TX3 (13, ≈ 334 m), TX4 (14, ≈ 445 m) |
| (3) | (tùy chọn) bỏ `&page=2`, thêm `&vehicle=CAR_4` | TX1, TX3; `total` 2 |

Nói gì: tìm kiếm là **lọc tập `drivers` bằng query**, không có đường dẫn riêng. Seed 8 tài xế, chỉ 4 trong kết quả: TX5 `OFFLINE`, TX6 bận, TX7 chưa duyệt, TX8 cách 2,2 km. Khoảng cách tính bằng **Haversine** trong SQL, gần nhất trước (BRULE03).

### Mục 14 — Booking của khách, limit + paging

Chuẩn bị: **trước** mục 15 (`total` đúng 7).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET (`[KH1]`): `drivers?…` → `customers/1/bookings?limit=2` | 200: booking 7, 6; `total` 7, `total_pages` 4 |
| 2 | Sửa tab: thêm `&page=2` | booking 5, 4 |
| 3 | Sửa tab: `customers/1` → `customers/2` | 403 `NOT_OWNER` |
| (4) | (tùy chọn) Tab admin: `customers/1/bookings?limit=2` | 200 như request 1 — admin xem mọi mã |

Thời gian: 3 sửa ~12 s + nói ~10 s → **~22 s, Ổn**.

Nói gì: theo yêu cầu của thầy, xem booking **theo mã khách**: `customers/{mã}/bookings` là tài nguyên con của khách. Đường dẫn bắt đầu bằng `customers` nhưng dữ liệu thuộc Booking nên Gateway định tuyến sang `booking-service`, không qua `customer-service`. Khách chỉ xem mã của mình (mã khác → 403, so mã trước khi đọc database); admin xem mọi mã. Sắp mới nhất trước, có `total`. Index `(customer_id, created_at DESC)` phục vụ đúng truy vấn này. Sai tham số (`limit=abc`) thì 400. Admin hỏi mã không có booking → 200 danh sách rỗng, không 404, vì Booking không biết khách nào tồn tại.

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
| 2 | **Tab GET** (đang `[KH1]`, URL `customers/2/bookings?…` của mục 14): sửa URL thành `notifications` | 200: `data[0]` **`TRIP_ACCEPTED`**, `data[1]` `BOOKING_CREATED` |

Thời gian: ~15 s thao tác + nói → **~26 s, Sát**. Request 2 là **chính** (chốt 2026-10-05, CD-Q1): phiếu chấm ghi Notification cho mục 16.

Nói gì: nhận chuyến = **đổi trạng thái lời mời** sang `ACCEPTED`, nên là `PATCH` + `status`, không có `/accept`. Booking giữ tài xế rồi gọi **gRPC `CreateTrip`** — đồng bộ vì tài xế cần ngay mã chuyến. Trip phát `trip.status-changed`, Notification nghe Kafka và báo khách — Notification lỗi thì nhận chuyến vẫn thành công.

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
| 1 | **Tab GET** (đang `[KH1]`): method `PATCH`, URL `trips/5`, Body raw `{"status":"CANCELED","reason":"ban viec"}` | 200 `CANCELED`, `canceled_by` customer |
| 2 | Cùng tab: method `GET`, URL `notifications` (body để nguyên — Gateway bỏ qua body của `GET`) | `PAYMENT_REFUNDED` (payment 5, 45000) và `TRIP_CANCELED` (trip 5) |
| (3) | (tùy chọn, phía tài xế) Tab đăng nhập TX1 sửa `"phone":"0910000006"` → copy token → tab GET `[TX6]` Send (nhớ đổi lại `[KH1]` sau đó) | `TRIP_CANCELED` cho chuyến 5 |
| (4) | (tùy chọn, hủy booking) Tab đặt xe thêm `"pay":"ONLINE"` → copy `booking_id` → tab GET `PATCH …/api/v1/bookings/<id>` `{"status":"CANCELED","reason":"doi y"}` | 201 `PENDING_PAYMENT`; 200 `CANCELED` |

Thời gian: ~20 s thao tác + nói ~8 s → **~28 s, Sát**. Vì sao tab GET (chốt 2026-10-05, CD-Q2): tab chuyến đang mang token TX1, đổi sang KH1 phải sang tab đăng nhập, Send, copy, dán → ~36 s, Vượt. Tab GET đã mang token KH1, chỉ đổi method / URL / body.

Nếu được hỏi "booking 5 sau khi hủy chuyến có trạng thái gì?": vẫn `DRIVER_ASSIGNED` (CD-Q4). *"Booking là yêu cầu đặt xe; nhiệm vụ của nó kết thúc khi đã bàn giao cho một chuyến. Trạng thái thật của chuyến, kể cả `CANCELED`, nằm ở Trip. Cho Booking nghe thêm event chỉ để chép lại trạng thái là thêm một đường giao tiếp không có FR nào cần."* Admin không hủy được chuyến (403) — trong phạm vi 30 mục (CD-Q7).

Nói gì: hủy cũng là đổi trạng thái — **cùng đường dẫn** với mục 17, `status` là `CANCELED` kèm lý do. Chỉ hủy được **trước khi đón khách** (BRULE16). Trip phát `trip.status-changed`: Payment hoàn tiền, Driver trả TX6 về rảnh, Notification báo cả hai — thấy ngay `PAYMENT_REFUNDED` trong thông báo của khách. Kafka vì hủy phải thành công **dù Payment đang dừng** (NFR05).

### Mục 19 — Thanh toán online + callback → COMPLETED

Chuẩn bị: seed booking **7** = payment **7** (`CAR_7`, online, `PENDING`, 56 000 đ).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/api/v1/payments/7/transactions`, `[KH1]`, Headers `Idempotency-Key:k1`, body `{"simulate_result":"MANUAL"}` | 200 `status` `PENDING`, `txn_id` `SIM-7-1`, `txn_status` `PENDING` |
| 2 | Nhân bản tab: URL `payment-callbacks`, Authorization **No Auth**, Headers `X-Callback-Secret:<khóa trong .env>`, body `{"txn_id":"SIM-7-1"}` | 200 `txn_status` `SUCCEEDED`, **`status` `COMPLETED`** |
| (3) | (tùy chọn) Tab GET: `bookings/7`, `[KH1]` | `SEARCHING` |

**Giữ nguyên hai tab** cho mục 30.

Dự phòng khi thiếu giờ (1 request): bỏ body ở request 1 → adapter tự gọi callback → 200 `COMPLETED` ngay.

Nói gì: mỗi lần thanh toán là **một giao dịch mới** → `POST /api/v1/payments/7/transactions` (tối đa 3 giao dịch). Trả trước: trả xong mới tìm tài xế (BRULE13). `MANUAL` giữ giao dịch chờ để mình tự gửi callback như cổng thanh toán thật; callback xác thực bằng khóa bí mật trong header. `txn_id` = `SIM-<payment>-<lần thử>`.

### Mục 20 — Đánh giá chuyến đi

Chuẩn bị: seed chuyến **4** (`COMPLETED`, TX3, chưa đánh giá).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | `POST localhost:3000/api/v1/ratings`, `[KH1]`, body `{"trip_id":4,"score":5}` | 201 `trip_id` 4, `driver_id` 13, `driver_avg` 5, `driver_count` 1 |
| 2 | Gửi lại y hệt | 409 `RATING_ALREADY_EXISTS` |
| (3) | (tùy chọn) Sửa body `"trip_id":5` | 409 `TRIP_NOT_COMPLETED` |

Nói gì: đánh giá là tài nguyên của Rating nên là tập `ratings`, mã chuyến nằm trong body. Rating gọi **gRPC** sang Trip hỏi "chuyến đã xong chưa, đúng khách không". Mỗi chuyến một đánh giá (UNIQUE `trip_id`).

### Mục 21 — Đăng ký tài xế (OTP) → hồ sơ chờ duyệt

Chạy lại thì đổi số `0911111112`.

| # | Gõ | Copy | Kết quả |
|---|---|---|---|
| 1 | `POST localhost:3000/api/v1/auth/otp`, body `{"phone":"0911111111"}` — **tab tài xế** | `otp` | 201 có `otp` |
| 2 | Sửa tab: URL `auth/otp` → `auth/driver-register`, body `{"phone":"0911111111","otp":"<otp>","password":"12345678"}` | **`token`** | 201 `role` driver |
| 3 | Sửa tab: URL `drivers`, `[token vừa nhận]`, body `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` | **`driver_id`** (D) | 201 **`approval_status` `PENDING`** |

Lưu ý: **luôn copy `driver_id` từ response bước 3**, không đoán số. Mã do API tạo phụ thuộc các lần thử trước (dãy identity không đặt lại khi lệnh lỗi hay khi xóa dòng); muốn số cố định thì demo trên database sạch (`docker compose down -v` rồi `docker compose up -d --build`).

Thời gian: 1 gõ + 2 sửa ~35 s + nói → **~42 s, Vượt** (Q64; không đổi so với trước).

Nói gì (nói trong lúc gõ, mục này dài): tài xế khác khách — đăng ký bằng **số điện thoại + OTP** vì phải chứng minh giữ số đó. Xin OTP `POST /api/v1/auth/otp`: tạo một mã, lưu dạng băm, hạn 5 phút; giả lập nên trả mã trong response. Tạo tài khoản `auth/driver-register` vì phải có OTP và role `driver`; trả luôn token. Sau này tài xế đăng nhập bằng số điện thoại + mật khẩu, OTP chỉ dùng khi đăng ký. Nộp hồ sơ = `POST /api/v1/drivers`, số giấy phép mã hóa, mới nộp là `PENDING`.

Nếu bị hỏi "hồ sơ bị từ chối thì sao?": **bị từ chối thì nộp lại bằng chính request nộp hồ sơ** (bước 3, cùng body) → 200, hồ sơ về `PENDING`, lý do cũ bị xóa, admin duyệt lại như mục 22 (FR43). Đang chờ duyệt hoặc đã duyệt mà nộp lại → 409.

### Mục 22 — Admin duyệt / từ chối hồ sơ

Chuẩn bị: mục 21 (có D); token AD1 (mục 10). Chưa chạy 21 thì duyệt TX7 (17).

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab tài xế: method `PATCH`, URL `drivers/D`, `[AD1]`, body `{"approval_status":"APPROVED"}` | 200 `APPROVED` |
| (2) | (tùy chọn) Sửa tab: `drivers/17`, body `{"approval_status":"REJECTED","reason":"thieu giay to"}` | 200 `REJECTED` |

Nói gì: duyệt = đổi **trạng thái duyệt** → `PATCH` + `approval_status` (tách khỏi `status` Online / Offline). Chỉ admin (403 với role khác). Đã xét thì không xét lại (409). Lưu `reviewed_by`, `reviewed_at`; Driver phát `driver.application-reviewed`.

Nếu bị hỏi "từ chối rồi tài xế làm gì?": tài xế nhận thông báo "Hồ sơ của bạn bị từ chối. Xem lý do tại hồ sơ tài xế và nộp lại.", xem lý do ở `GET drivers/{mã của mình}`, rồi **nộp lại bằng chính request nộp hồ sơ** (`POST drivers`, mục 21 bước 3) → 200 `PENDING`; admin duyệt lại bằng request 1 ở trên. Không phải API mới: cùng một thao tác "nộp hồ sơ", khác ở chỗ ghi đè hồ sơ cũ (200) thay vì tạo mới (201).

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
| 1 | Tab GET: `customers/1`, `[KH1]` | 200 `name` "Nguyễn Văn An", `phone` `0900000001` (rõ, cho đúng chủ) |
| 2 | Terminal: `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `full_name_enc`, `date_of_birth_enc` là `\x…`; cột `phone` rõ |
| (3) | (tùy chọn) `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$`; `email` (khách, admin) và `phone` (tài xế) rõ |

Thời gian: ~18 s + nói ~10 s → **~28 s, Sát**.

Nói gì (trong lúc gõ lệnh): **mật khẩu băm** scrypt có salt; **họ tên, ngày sinh, số giấy phép mã hóa AES-256-GCM**. Khóa nằm trong biến môi trường **riêng từng service** (`CUSTOMER_DATA_KEY`, `DRIVER_DATA_KEY`) trong `.env`, không ở code, database. Email và số điện thoại không mã hóa theo quyết định đã chốt: email, số tài xế dùng để đăng nhập và chặn trùng (mã hóa thì phải thêm chỉ mục mù); số trong hồ sơ là thông tin liên hệ, bảo vệ bằng quyền ở API và mạng nội bộ.

### Mục 25 — SQL injection

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab đăng nhập KH1: body `{"email":"' OR 1=1 --","password":"x"}` | **400 `INVALID_EMAIL`** — không đăng nhập được |
| 2 | Sửa tab: `{"email":"kh1@cab.vn","password":"' OR '1'='1"}` | 401 `INVALID_CREDENTIALS` |
| (3) | (tùy chọn) Tab GET: `customers/1 OR 1=1` | 400 `INVALID_ID` |

**Sửa lại** tab KH1 thành `{"email":"kh1@cab.vn","password":"12345678"}` sau mục này (mục 29 dùng tab này).

Thời gian: 2 sửa ~12 s + nói ~10 s → **~22 s, Ổn**.

Nói gì: hai lớp. Lớp 1 — **kiểm định dạng trước khi chạm database**: `' OR 1=1 --` không phải email nên bị 400 `INVALID_EMAIL` (em chọn 400 chứ không 401 vì lý do thật là sai định dạng, và chứng tỏ chuỗi không bao giờ tới câu SQL). Lớp 2 — **SQL tham số `$1`**: ô mật khẩu nhận chuỗi tự do nên chuỗi injection đi vào được, nhưng nó chỉ là một giá trị, không thành lệnh SQL; mật khẩu lại so bằng hash → 401. Mã trong đường dẫn phải là số nguyên → 400. Không lần nào 200 hay 500.

### Mục 26 — XSS

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET: method `PATCH`, URL `customers/me`, body `{"name":"<script>alert(1)</script>"}` | 400 `TEXT_CONTAINS_HTML` |
| 2 | Sửa tab: method `GET` | 200 tên vẫn "Nguyễn Văn An"; tab **Headers**: `nosniff`, `Content-Security-Policy: default-src 'none'` |

Nói gì: sửa hồ sơ là `PATCH /api/v1/customers/me` (sửa một phần). Văn bản có `<` hoặc `>` bị **từ chối ở cửa vào** (Gateway và service), không lưu. API chỉ trả JSON kèm `nosniff` và CSP.

### Mục 27 — JWT bị sửa → 401

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab GET (`customers/me`, `[KH1]`): copy token → trình duyệt mở **jwt.io** → dán token → ở payload sửa `"role":"customer"` thành `"role":"admin"` → copy token mới → dán vào tab Authorization → Send | 401 `TOKEN_INVALID` |
| 2 | Sửa tab: Authorization → **No Auth** | 401 `TOKEN_MISSING` |
| (3) | (tùy chọn) `POST localhost:3000/api/v1/auth/logout`, `[KH1]` → gửi lại request 1 với token đúng | 200 `LOGGED_OUT`; 401 `TOKEN_REVOKED` |
| Dự phòng | Không có Internet: **sửa một ký tự ở giữa token** ngay trong Postman (**không** sửa ký tự cuối — bit thừa của base64url) | 401 `TOKEN_INVALID` |

Trên jwt.io: **không** gõ `JWT_SECRET` vào ô khóa. Nếu trang bắt nhập khóa để ký lại thì gõ chuỗi bất kỳ (ví dụ `abc`) — đúng vị trí kẻ tấn công không có khóa (ADR-016).

Thời gian: jwt.io ~17 s + 1 sửa ~3 s + nói ~10 s → **~30 s, Sát** (dự phòng ~20 s).

Nói gì: dán lên jwt.io thấy ngay payload `sub`, `role`, `jti`, `exp` — payload chỉ là base64, ai cũng đọc được, nên em không để email, số điện thoại trong đó. Chữ ký HS256 tính trên header + payload bằng `JWT_SECRET`; đổi `role` thành `admin` mà không có khóa thì chữ ký không khớp → Gateway trả 401. **Rủi ro em biết:** ai có `JWT_SECRET` thì ký được token admin thật, nên khóa chỉ nằm ở auth và Gateway, `.env` không lên Git, và em không dán khóa lên jwt.io hay đưa cho ai khi demo. Đăng xuất: Gateway ghi `jti` vào Redis đến hết hạn token.

### Mục 28 — Sai quyền → 403

| # | Gõ | Kết quả |
|---|---|---|
| 1 | Tab tài xế: URL `drivers/17`, `[KH1]`, **xóa body** | 403 `FORBIDDEN` |
| 2 | Tab đặt xe (`POST …/api/v1/bookings`): `[TX1]` | 403 `FORBIDDEN` |

Nói gì: Gateway so `role` trong token với danh sách role của đường dẫn **trước** khi đọc body — body rỗng vẫn 403. Ba role cố định, không có bảng PERMISSION. Lớp thứ hai ở service: đúng role nhưng không phải chủ → 403 `NOT_OWNER` (mục 11).

### Mục 29 — Spam → 429

Chuẩn bị: làm **cuối cùng** (khóa đăng nhập / đăng ký theo IP tối đa 10 giây); trong 10 giây trước đó không gửi request công khai nào.

| # | Gõ | Kết quả |
|---|---|---|
| 1 | **Tab đăng nhập KH1** (`POST …/api/v1/auth/login`, body `{"email":"kh1@cab.vn","password":"12345678"}` của mục 10 — route công khai, ngưỡng 5; **không** phải tab có token, ngưỡng 30), bấm **Send** (hoặc **Ctrl+Enter**) **liên tục 6 lần** → mở tab **Headers** của response | Lần 1–5: 200; lần 6: **429 `RATE_LIMITED`**, header `Retry-After`, `RateLimit-Limit: 5`, `RateLimit-Remaining: 0` |

Thời gian: bấm ~4 s + mở Headers ~4 s + nói ~10 s → **~18 s, Ổn**. Không dùng Collection Runner (cần collection lưu sẵn — luật thi cấm).

Nói gì: Gateway đếm bằng Redis: route công khai (bốn route `auth/register`, `auth/login`, `auth/otp`, `auth/driver-register`, **chung một** bộ đếm) theo **IP**, 5 lần mỗi 10 giây, để chặn dò mật khẩu và spam đăng ký; route có token theo **tài khoản**, 30 lần — đếm **sau** khi kiểm token nên token sai là 401 chứ không phải 429. Cửa sổ **bắt đầu từ request đầu tiên**; spam không kéo dài cửa sổ; `Retry-After` cho biết bao lâu nữa gọi lại được. Vượt ngưỡng thì không request nào tới service. Ngưỡng đọc từ biến môi trường (NFR17). Redis dừng thì cho qua và ghi log.

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
| 12 | **29** cuối cùng | Bấm Send ở **tab đăng nhập KH1**; khóa đăng nhập / đăng ký theo IP tối đa 10 giây |

Giảng viên gọi lệch thứ tự: mục chỉ đọc (6, 11–14, 24–26, 28) chạy lúc nào cũng được; mục đổi seed (15–20, 22, 23, 30) xem dòng "Chuẩn bị". Tab cần chưa có thì gõ mới (≈ +10 s). Seed hỏng thì `docker compose down -v` rồi `docker compose up -d --build`.

## 4. Những thứ phải nhớ

| Nhóm | Giá trị | Mẹo nhớ |
|---|---|---|
| **Quy tắc đường dẫn** | `localhost:3000/api/v1/{tài nguyên số nhiều}/{mã}?{query}`. Chỉ `GET` (đọc), `POST` (tạo), `PATCH` (sửa một phần) | "Đường dẫn nói **cái gì**, method nói **làm gì**" |
| **Đổi trạng thái** | Luôn `PATCH /api/v1/{tài nguyên}/{mã}` + `{"status":"…"}`; hủy thêm `"reason"`. Duyệt hồ sơ dùng `approval_status` | Nhận chuyến, cập nhật chuyến, hủy chuyến, hủy booking, Online / Offline |
| **Tìm, lọc, trang** | Query: `?lat=10.82&lng=106.68&limit=2&page=2` | |
| **Nhóm xác thực** `/api/v1/auth/…` (giảng viên 2026-10-14) | `register` (khách, email), `login`, `logout`, `otp` (tài xế), `driver-register` (tài xế) | "Mọi thứ đăng ký / đăng nhập nằm trong `auth`" |
| **"Hành động" thành tài nguyên** (đều sau `/api/v1`) | Thanh toán `POST /api/v1/payments/{mã}/transactions`; callback `POST /api/v1/payment-callbacks`; đánh giá `POST /api/v1/ratings` | Mỗi lần làm tạo ra một bản ghi |
| **Ngoại lệ** | Cả nhóm `auth`; `/health`, `/ready`, `/health/services` không có `/api/v1` | |
| `me` | `/api/v1/customers/me`, `/api/v1/drivers/me` = của người trong token (chỉ các route đã có; không thêm mới). Xem hồ sơ của mình: `/customers/{account_id}`, `/drivers/{account_id}` | `account_id` có trong response đăng nhập |
| Tài khoản và hồ sơ | Khách, admin: tài khoản = **email** + mật khẩu. Tài xế: tài khoản = **số điện thoại** + mật khẩu (OTP khi đăng ký). Hồ sơ khách = họ tên, **số điện thoại** (bắt buộc), ngày sinh | "Tài xế dùng số, còn lại dùng email"; email ở tài khoản, số của khách ở hồ sơ — mỗi thứ một nơi |
| Ai xem được gì theo mã | Hồ sơ khách `customers/{id}`, booking `customers/{id}/bookings`: chủ + admin. Hồ sơ tài xế `drivers/{id}`: chủ + admin; **khách 403** | Mã người khác → 403 `NOT_OWNER`; sai role → 403 `FORBIDDEN` |
| Health | `healthy`; `ready` / `not_ready`; mỗi service `healthy` / `unhealthy` | Chữ thường, đúng như thầy yêu cầu |
| Hồ sơ tài xế bị từ chối | Nộp lại bằng chính `POST /api/v1/drivers` (cùng body) → 200 `PENDING` | "Từ chối thì nộp lại" |
| Mật khẩu mọi tài khoản seed | `12345678` | Một mật khẩu |
| Khách | KH1 `kh1@cab.vn` (mã **1**, hồ sơ "Nguyễn Văn An", `0900000001`, 2000-01-01); KH2 `kh2@cab.vn` (**2**, số `0900000002`); KH3 `kh3@cab.vn` (**3**, chưa có hồ sơ); KH9 `kh9@cab.vn` (**9**, **bị khóa**, số `0900000009`) | `khn@cab.vn` ↔ mã `n` ↔ số hồ sơ `090000000n` |
| Tài xế | TX1–TX8: `0910000001`…`0910000008` ↔ mã **11–18** | `091000000n` ↔ mã `10 + n` |
| Vai trò tài xế seed | TX1 `CAR_4` rảnh (15–17, 23); TX2 xe máy; TX3 `CAR_4` (chuyến 4); TX4 `CAR_7` (B7); TX5 `OFFLINE`; TX6 bận chuyến 5 (18); TX7 chờ duyệt (22); TX8 xa 2,2 km | TXn đứng ở `10.82n, 106.68`, cách P0 n × 111 m |
| Admin | AD1 `admin@cab.vn` ↔ mã **99** (không còn số điện thoại) | "admin" + mã 99 |
| Booking seed (của KH1) | Booking = payment = trip = **1…7**. **4**: chuyến xong, chưa đánh giá (20). **5**: chuyến `ACCEPTED`, đã trả online (18). **7**: `CAR_7`, online, chờ thanh toán 56 000 đ (19, 30) | 4 đánh giá, 5 hủy, 7 trả tiền |
| Mã do API tạo | Từ **1000** (booking, offer, trip đầu tiên đều 1000) | Seed số nhỏ, API số lớn |
| Tọa độ | P0 = `10.82, 106.68` (đón); D0 = `10.83, 106.69` (đến) | D0 = P0 cộng 0.01 |
| Cước P0 → D0 (≈ 2 026 m) | `CAR_4` **45 000**; `MOTORBIKE` 21 000; `CAR_7` **56 000** | mở cửa + đơn giá/km × km, làm tròn lên 1 000 |
| Bảng giá | Xe máy 10 000 + 5 000/km (tối thiểu 15 000); 4 chỗ 20 000 + 12 000/km (30 000); 7 chỗ 25 000 + 15 000/km (40 000) | |
| Body hay gõ | Đặt xe `{"from":[10.82,106.68],"to":[10.83,106.69]}` (mặc định `CAR_4`, `CASH`); đánh giá `{"trip_id":4,"score":5}`; duyệt `{"approval_status":"APPROVED"}` | |
| Giá trị `status` | Offer: `ACCEPTED` / `REJECTED`. Chuyến: `ARRIVED` → `PICKED_UP` → `IN_PROGRESS` → `COMPLETED`, hoặc `CANCELED`. Booking: `CANCELED`. Tài xế: `ONLINE` / `OFFLINE` | |
| Header | Token ở tab Authorization; `Idempotency-Key:k1`; `X-Callback-Secret:<khóa trong .env>` | |
| Mã giao dịch | `SIM-<payment_id>-<lần thử>` → `SIM-7-1` | |
| Giả lập thanh toán | `simulate_result`: không gửi = thành công ngay; `FAILED`; `MANUAL` = chờ callback | |
| Dữ liệu mới khi demo | Khách `new1@cab.vn` (lần hai `new2@cab.vn`), số hồ sơ `0901234567`; tài xế `0911111111` (lần hai `…12`) | |
| Body đăng nhập | Khách / admin `{"email":"kh1@cab.vn","password":"12345678"}`; tài xế `{"phone":"0910000001","password":"12345678"}` | Đúng một trong hai field |
| Địa chỉ | Gateway `localhost:3000`; Kafka UI `localhost:8080`; service bên trong `:50051`–`:50058` (không mở) | auth 1, customer 2, driver 3, booking 4, trip 5, payment 6, notification 7, rating 8 |
| Container database | `<context>-db`: `auth-db`, `customer-db`, … (PostgreSQL), `notification-db` (MongoDB) | |
| Database, user | Database = tên context; user **`cab`**; mật khẩu `cab123` | |
| Lệnh xem bảng | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `table <bảng>` = `select *` |
| Lệnh dựng / đặt lại / xem | `docker compose up -d --build`; `docker compose down -v`; `docker compose ps -a` (21 container) | |
| Giới hạn thời gian (`.env`) | Offer 300 s; thanh toán 600 s (B7: 1 ngày); OTP 300 s; token 3 600 s; rate limit 5 công khai / 10 s, 30 có token / 10 s | |
| Hằng số | Bán kính 1 000 m; hệ số quãng đường 1,3; 3 lần thử thanh toán; 5 lần nhập OTP | |
| Mã lỗi hay gặp | 400 sai dữ liệu (`INVALID_EMAIL`, `INVALID_PHONE`, `INVALID_ID`, `INVALID_INPUT`); 401 token / đăng nhập; 403 `FORBIDDEN` (sai role) và `NOT_OWNER` (không phải chủ); 404 (gồm đường dẫn thiếu `/api/v1`); 409 trùng (`EMAIL_ALREADY_EXISTS`, `PHONE_ALREADY_EXISTS`) **hoặc sai trạng thái**; 429; 503 service dừng | |

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
| 10 | 1 sửa + 2 nhân bản | ~17 s | ~27 s | Sát — tab TX1 đổi cả tên field (2026-10-14) |
| 11 | 1 gõ + 1 sửa | ~15 s | ~23 s | Ổn |
| 12 | 1 sửa + 1 nhân bản (dán token AD1) + 1 sửa | ~15 s | ~25 s | Ổn — thêm 403 của khách, tab admin (2026-10-14) |
| 13 | 2 sửa | ~12 s | ~24 s | Ổn |
| 14 | 3 sửa | ~12 s | ~22 s | Ổn — thêm 403 `NOT_OWNER` (2026-10-14) |
| 15 | 1 gõ + 1 nhân bản | ~25 s | ~32 s | **Sát** |
| 16 | 2 sửa (tab chuyến + tab GET) | ~15 s | ~26 s | Sát — thêm xem thông báo (CD-Q1) |
| 17 | 5 sửa | ~20 s | ~30 s | **Sát** |
| 18 | 2 sửa ở tab GET | ~20 s | ~28 s | Sát — tab GET đã có token KH1 (CD-Q2) |
| 19 | 1 gõ + 1 nhân bản | ~35 s | **~42 s** | **Vượt** — dự phòng 1 request ~25 s |
| 20 | 1 gõ + gửi lại | ~18 s | ~25 s | Ổn |
| 21 | 1 gõ + 2 sửa | ~35 s | **~42 s** | **Vượt** — nói trong lúc gõ |
| 22 | 1 sửa | ~15 s | ~22 s | Ổn |
| 23 | 2 sửa | ~10 s | ~20 s | Ổn |
| 24 | 1 sửa + 1 lệnh | ~18 s | ~28 s | Sát |
| 25 | 2 sửa | ~12 s | ~22 s | Ổn — injection trên `email` (2026-10-14) |
| 26 | 2 sửa | ~15 s | ~25 s | Ổn |
| 27 | jwt.io + 1 sửa | ~20 s | ~30 s | Sát — dự phòng sửa một ký tự ~20 s (2026-10-14) |
| 28 | 2 sửa | ~10 s | ~20 s | Ổn |
| 29 | 6 lần Send | ~5 s | ~18 s | Ổn |
| 30 | 2 gửi lại + 1 sửa | ~10 s | ~22 s | Ổn — **phải giữ hai tab mục 19** |

Câu hỏi còn mở ảnh hưởng tới bảng này (chi tiết ở file 04 mục 9.2): Q62 (token hết hạn sau một giờ), Q64 (mục 19, 21 vượt 30 giây), Q66 (mục 10 đăng nhập ba role), Q67 (jwt.io cần Internet), Q68 (mục 12 có giữ request 403 của khách). Q60, Q61, Q65 đã đóng.
