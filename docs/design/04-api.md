# 04 — API REST của Gateway

> Vòng 1 (chỉ BA), viết 2026-10-02. Đầu vào: `CLAUDE.md`, `srs.md` (FR01–FR42, BRULE01–18, UC01–UC33, AC01–AC29), file 01, file 02 (G1–G10, S2–S7, K1–K7), file 03, phiếu chấm 30 mục.
> Sửa 2026-10-03: hồ sơ khách tạo sau khi đăng nhập (A37, A38, A10 đổi sang `/customers/me` — ADR-013). Callback A32 xác thực bằng khóa bí mật trong header, bỏ HMAC; adapter gọi callback ngay trong A31; OTP trả trong response khi giả lập (ADR-014). `simulate_result: "MANUAL"` (Q57). Đóng Q50, Q57, Q58.
> **Sửa 2026-10-03 lần 3 (luật thi: gõ tay mọi request, được copy từ response, không mở tài liệu):** mã là **số nguyên** (ADR-015), ví dụ theo seed ở file 03 mục 14; **bỏ tiền tố `/api/v1`**; tên trường ngắn và **giá trị mặc định** (mục 1.8); đường dẫn ngắn (`/auth/otp`, `/auth/register-driver`, `POST /drivers/me`, `POST /drivers/me/online` | `offline` — thêm **A39**); bỏ tham số bán kính (hằng số 1 km); response của thao tác đổi trạng thái trả luôn trạng thái mới; chuỗi request mỗi mục chấm rút còn ≤ 3 (trừ 17, 18 — mục 5). Kịch bản học thuộc: file 06.
> File này trả lời: **client gọi gì, ai được gọi, service nào xử lý, mỗi mục chấm gõ những request nào**. Chi tiết từng field và `.proto`: spec của từng mục chấm.
> Ký hiệu: **[ĐC]** = đã chốt trong `CLAUDE.md` / `srs.md`. **[BA]** = BA tự chọn, chưa ai xác nhận (gom ở mục 9).

## 1. Quy ước chung

| Điểm | Quy ước | Nguồn / lý do |
|---|---|---|
| Địa chỉ | `http://localhost:3000` — cổng duy nhất cho nghiệp vụ. Postman tự thêm `http://` nên gõ `localhost:3000/...` cũng được | Mục chấm 8 |
| Tiền tố | **Không có** (bỏ `/api/v1` từ 2026-10-03) [BA]. Ví dụ `POST http://localhost:3000/bookings` | Luật thi: mỗi request bớt 7 ký tự phải gõ. Đánh đổi: chưa có chỗ đánh phiên bản API; khi cần thì thêm `/v2` cho route mới, route cũ giữ nguyên (Q59) |
| Định dạng | JSON, tên field `snake_case`, ngắn (mục 1.8). Gateway đọc body là JSON **bất kể `Content-Type`** (Postman chọn nhầm "Text" vẫn chạy) [BA] | Luật thi: bớt một chỗ dễ sai. Không mở lỗ CSRF vì token đi trong header `Authorization`, không dùng cookie |
| Token | Header `Authorization: Bearer <JWT>` — trên Postman: tab **Authorization → Bearer Token → dán token**. JWT HS256 mang `sub` (= `account_id` dạng chuỗi theo chuẩn JWT, ví dụ `"1"`; response `account_id` vẫn là số), `role`, `jti`, `exp` | NFR06; ADR-016; `jti` để thu hồi khi đăng xuất (FR42) |
| ID | **Số nguyên dương** (`^[1-9][0-9]{0,15}$`). Sai (gồm `abc`, `1 OR 1=1`) → **400 `INVALID_ID`** ngay ở Gateway. Mã seed là số nhỏ (khách 1–9, tài xế 11–18, admin 99, booking = payment = trip 1–7); mã do API tạo bắt đầu từ **1000** | ADR-015; file 03 mục 2, 14; mục 25 |
| Thời điểm | ISO 8601 UTC, ví dụ `2026-10-03T03:15:00Z` | File 03 mục 2 |
| Tiền, quãng đường | Số nguyên: đồng; mét | File 03 mục 2 |
| Thành công | 200 (đọc, cập nhật, thao tác), 201 (tạo mới). Một đối tượng thì trả thẳng đối tượng; danh sách theo mục 1.3 | |
| Thao tác đổi trạng thái | Response **luôn có trạng thái mới** của đối tượng bị đổi (và đối tượng liên quan nếu đổi trong cùng request) | Luật thi: không cần gọi thêm request để kiểm tra |
| Lỗi | `{ "error": "MA_LOI" }`, không stack trace | `CLAUDE.md` |
| Thứ tự kiểm tra | 429 → 401 → 403 (role) → 400 (hình thức) → service: 404 → 403 (không phải chủ) → 409 → 400 (nghiệp vụ) | Lỗi rẻ nhất trả trước. Hệ quả dùng ở mục 28: sai role thì 403 **dù body rỗng** |
| Header bảo vệ | Mọi response: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`, `X-Request-Id` | Mục chấm 26, NFR08, NFR10 |
| Field lạ trong body | 400 `INVALID_INPUT` | Chặn client tự gửi `role`, `customer_id`… |

### 1.1 Đổi gRPC status sang HTTP [ĐC]

| gRPC status | HTTP | Khi nào | Ví dụ mã lỗi |
|---|---|---|---|
| `OK` | 200 / 201 | | |
| `INVALID_ARGUMENT` | 400 | Thiếu trường, sai kiểu, sai giá trị | `INVALID_INPUT`, `INVALID_PHONE`, `INVALID_EMAIL`, `INVALID_COORDINATES`, `INVALID_PAGINATION`, `TEXT_CONTAINS_HTML`, `OTP_INVALID`, `OTP_EXPIRED`, `REASON_REQUIRED`, `SAME_PICKUP_AND_DESTINATION` |
| `UNAUTHENTICATED` | 401 | Sai thông tin đăng nhập; khóa callback sai / thiếu | `INVALID_CREDENTIALS`, `INVALID_CALLBACK_SECRET` |
| `PERMISSION_DENIED` | 403 | Không phải chủ dữ liệu; tài khoản bị khóa | `NOT_OWNER`, `ACCOUNT_LOCKED` |
| `NOT_FOUND` | 404 | Không có đối tượng | `CUSTOMER_NOT_FOUND`, `DRIVER_NOT_FOUND`, `BOOKING_NOT_FOUND`, `TRIP_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `OFFER_NOT_FOUND`, `RATING_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
| `ALREADY_EXISTS` | 409 | Trùng | `PHONE_ALREADY_EXISTS`, `EMAIL_ALREADY_EXISTS`, `CUSTOMER_ALREADY_EXISTS`, `DRIVER_ALREADY_EXISTS`, `LICENSE_PLATE_ALREADY_EXISTS`, `RATING_ALREADY_EXISTS` |
| `FAILED_PRECONDITION` | 409 | Đúng dữ liệu nhưng sai thời điểm / sai trạng thái | `INVALID_STATUS_TRANSITION`, `BOOKING_NOT_CANCELABLE`, `BOOKING_ALREADY_ASSIGNED`, `TRIP_NOT_CANCELABLE`, `TRIP_NOT_COMPLETED`, `OFFER_EXPIRED`, `DRIVER_NOT_APPROVED`, `DRIVER_NOT_AVAILABLE`, `APPLICATION_ALREADY_REVIEWED`, `PAYMENT_ALREADY_COMPLETED`, `PAYMENT_IN_PROGRESS`, `PAYMENT_EXPIRED`, `PAYMENT_ATTEMPTS_EXHAUSTED`, `PAYMENT_NOT_ONLINE`, `IDEMPOTENCY_KEY_REUSED` |
| Còn lại (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, …) | 503 | Service không chạy, quá deadline, lỗi không lường trước | `SERVICE_UNAVAILABLE` |

Lỗi do **Gateway tự trả**, không qua gRPC:

| HTTP | Mã lỗi | Khi nào |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_ID`, `INVALID_JSON`, `INVALID_PAGINATION`, `IDEMPOTENCY_KEY_REQUIRED` | Kiểm tra hình thức trước khi gọi service |
| 401 | `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` | Mục chấm 27; FR42 |
| 403 | `FORBIDDEN` | Role trong token không nằm trong danh sách của route (mục chấm 28) |
| 404 | `ROUTE_NOT_FOUND` | Đường dẫn không tồn tại |
| 429 | `RATE_LIMITED` | Mục chấm 29 |

Hai mã 403 khác nhau có chủ ý: `FORBIDDEN` = sai role (Gateway biết ngay từ token); `NOT_OWNER` = đúng role nhưng không phải chủ (service biết sau khi đọc dữ liệu).

### 1.2 Sáu đường lỗi mà mọi endpoint phải có (quy tắc 6 của BA)

| Đường lỗi | HTTP | Ai trả |
|---|---|---|
| Thiếu dữ liệu | 400 | Gateway (hình thức); service kiểm tra lại |
| Sai kiểu / sai định dạng | 400 | Gateway |
| Trùng | 409 | Service (UNIQUE trong database) |
| Không tìm thấy | 404 | Service |
| Chưa đăng nhập | 401 | Gateway |
| Sai quyền | 403 | Gateway (role); service (chủ dữ liệu) |

### 1.3 Phân trang

| Điểm | Quy ước |
|---|---|
| Tham số | `page` (≥ 1, mặc định 1); `limit` (1…50, mặc định 10) |
| Sai | `page=0`, `limit=abc`, `limit=1000` → 400 `INVALID_PAGINATION` (không âm thầm sửa) |
| Response | `{ "data": [ … ], "pagination": { "page": 1, "limit": 2, "total": 4, "total_pages": 2 } }` |
| Thứ tự | Cố định cho từng API (bảng mục 2) để trang không lặp, không sót |
| Vì sao `page` + `limit` | Phiếu chấm ghi "limit + paging"; có `total` để người chấm thấy tổng số. Đánh đổi: trang sâu chậm dần — không gặp ở quy mô này |

API có phân trang: A12 (mục 13), A20 (mục 14), A13, A23, A26, A33.

### 1.4 Chống lặp cho thanh toán (mục chấm 30)

| Điểm | Quy ước |
|---|---|
| Header | `Idempotency-Key: k1` — chuỗi 1–100 ký tự do client chọn, **bắt buộc** với A31. Thiếu → 400 `IDEMPOTENCY_KEY_REQUIRED` |
| Phạm vi của khóa | Theo **từng thanh toán** (`payment_id`, khóa) — file 03 mục 8.6. Nhờ vậy gõ `k1` cho mọi thanh toán khác nhau vẫn đúng |
| Cùng khóa, cùng nội dung | Trả **đúng response lần đầu** (cùng mã HTTP, cùng body) kèm header `Idempotency-Replayed: true`. Không tạo giao dịch mới |
| "Cùng nội dung" so thế nào | So SHA-256 của body **đã chuẩn hóa** (đọc JSON rồi viết lại, khóa theo thứ tự chữ cái; body rỗng = `{}`) [BA] — gõ lại body khác khoảng trắng vẫn là cùng nội dung |
| Cùng khóa, khác nội dung | 409 `IDEMPOTENCY_KEY_REUSED` |
| Thứ tự kiểm tra | Tra khóa **trước** mọi kiểm tra trạng thái: gặp lại khóa thì trả response lần đầu dù Payment đã đổi (ví dụ đã `COMPLETED`). Trạng thái hiện tại xem bằng A30 |
| Callback (A32) | Không dùng header này. Chống lặp theo `txn_id` (`provider_transaction_id`): gửi lại trả đúng response cũ kèm `Idempotency-Replayed: true`, không đổi trạng thái, không phát lại K6 |
| Gateway làm gì | Chỉ chuyển header vào metadata. Việc nhớ và trả lại response do `payment-service` làm |

### 1.5 Rate limit (mục chấm 29)

| Điểm | Quy ước |
|---|---|
| Route công khai (A04, A05, A07, A08) | Đếm theo **IP**; `RATE_LIMIT_PUBLIC_MAX` = **5** mỗi `RATE_LIMIT_WINDOW_SECONDS` = **10** giây (`.env.example`) |
| Route có token | Đếm theo **`account_id`**; `RATE_LIMIT_ACCOUNT_MAX` = **30** mỗi 10 giây |
| Không giới hạn | A01–A03 (health), A32 (callback — xác thực bằng khóa; Provider gửi nhiều callback từ một IP là bình thường) |
| Header | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (giây) |
| Vượt ngưỡng | 429 `{ "error": "RATE_LIMITED" }` + `Retry-After: <giây>` |
| IP lấy ở đâu | Địa chỉ kết nối TCP; không tin `X-Forwarded-For` (không có proxy trước Gateway) |
| Redis dừng [ĐC] | Cho qua, ghi log cảnh báo; không có header `RateLimit-*` |

Gõ tay mất ≥ 5 giây mỗi request nên không bao giờ chạm 5 request / 10 giây; bấm Send liên tục thì chạm ở lần thứ 6.

### 1.6 Văn bản do người dùng nhập (mục chấm 26) [BA]

Field văn bản tự do: `name`, `from_address`, `to_address`, `reason`, `comment`, `plate`, `brand`, `model`, `color`.

| Lớp | Làm gì | Ở đâu |
|---|---|---|
| 1 | Chứa `<` hoặc `>` → **400 `TEXT_CONTAINS_HTML`**; không lưu | Gateway; service kiểm tra lại vì là chủ dữ liệu |
| 2 | Response luôn là JSON kèm `nosniff` và CSP `default-src 'none'`: trình duyệt không chạy response như HTML | Gateway |
| 3 | Giới hạn độ dài từng field (file 03) | Gateway và CHECK trong database |

Vì sao từ chối thay vì "lưu rồi escape": API chỉ trả JSON, không có trang HTML nào để escape; từ chối ở cửa vào cho kết quả demo rõ và không biến đổi dữ liệu. Đánh đổi: không gõ được `<`, `>` trong nhận xét.

### 1.7 Danh tính chuyển cho service

Gateway kiểm tra token xong thì **tự dựng** metadata gRPC: `x-account-id`, `x-role`, `x-request-id`, `idempotency-key` (A31), `x-callback-secret` (chỉ A32). Header cùng tên do client gửi bị bỏ qua. Service **không** tự kiểm tra JWT; tin metadata vì chỉ Gateway vào được mạng nội bộ (file 02 mục 2.2).

### 1.8 Tên trường ngắn và giá trị mặc định (luật thi) [BA]

| API | Field | Bắt buộc | Mặc định khi không gửi | Ghi chú |
|---|---|---|---|---|
| A04 đăng ký | `phone`, `password` | Có | — | `email` tùy chọn |
| A05 đăng nhập | `phone` **hoặc** `email`; `password` | Có | — | Gửi cả hai định danh → 400. Cùng body với A04 nên mục 9 chỉ sửa URL |
| A07 xin OTP | `phone` | Có | — | |
| A08 đăng ký tài xế | `phone`, `otp`, `password` | Có | — | Response có luôn `token` (mục 2.1) |
| A37 / A10 hồ sơ khách | `name` | Có (A37) | — | `dob` (`YYYY-MM-DD`) tùy chọn. Tên cũ `full_name`, `date_of_birth` |
| A11 nộp hồ sơ tài xế | `name`, `license`, `plate` | Có | `vehicle` = **`CAR_4`** | `brand`, `model`, `color` tùy chọn |
| A17 / A39 bật / tắt | — | — | — | **Không có body**. A17 nhận `lat`, `lng` tùy chọn; bắt buộc nếu tài xế chưa từng có vị trí |
| A19 đặt xe | `from`, `to` = `[vĩ độ, kinh độ]` | Có | `vehicle` = **`CAR_4`**; `pay` = **`CASH`** | `from_address`, `to_address` tùy chọn. Thứ tự `[lat, lng]` giống cách Google Maps hiện tọa độ |
| A12 tìm tài xế | Query `lat`, `lng` | Có | `vehicle` = mọi loại; `page` = 1; `limit` = 10 | **Bỏ `radius_m`**: bán kính là hằng số 1 000 m (FR02, file 03 mục 13) |
| A22, A29 hủy; A16 từ chối hồ sơ | `reason` | Có | — | FR36 bắt buộc lý do |
| A28 trạng thái chuyến | `status` | Có | — | |
| A31 thanh toán | — | — | `simulate_result` = **`SUCCESS`** | Body có thể rỗng; header `Idempotency-Key` bắt buộc |
| A32 callback | `txn_id` | Có | `result` = **`SUCCESS`** | `amount` tùy chọn; gửi mà khác số tiền giao dịch → 400 |
| A34 đánh giá | `score` (1–5) | Có | — | `comment` tùy chọn |

Giá trị liệt kê (`CAR_4`, `ONLINE`, `ARRIVED`, `MANUAL`…) **không phân biệt hoa thường**: Gateway đổi sang chữ hoa trước khi kiểm tra.

Vì sao mặc định `CAR_4` và `CASH`: là lựa chọn phổ biến nhất, và là tổ hợp đi thẳng sang tìm tài xế (không chờ thanh toán) — đúng chuỗi mục 15. Đánh đổi: khách quên chọn loại xe vẫn đặt được, nên response luôn ghi rõ `vehicle`, `pay`, `fare` để khách thấy mình đã đặt gì.

## 2. Bảng API

Cột **Token**: "Không" = công khai; "Có" = cần JWT. Cột **Role**: role Gateway cho qua; "(chủ)" = service còn kiểm tra chủ dữ liệu (mục 4). Tổng: **39 API** (A39 thêm 2026-10-03 lần 3; mã cũ giữ nguyên).

### 2.1 Gateway và xác thực

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A01 | `GET /health` | Không | — | Gateway tự trả | 6 | — |
| A02 | `GET /ready` | Không | — | Gateway: Redis + kênh gRPC | 6 | — |
| A03 | `GET /health/services` | Không | — | 8 service — `grpc.health.v1.Health/Check` (G9) | 6 | NFR15 |
| A04 | `POST /auth/register` | Không | — | auth — `RegisterCustomer` | 9 | FR26 / UC01, AC27 |
| A05 | `POST /auth/login` | Không | — | auth — `Login` | 10, 25, 29 | FR26 / UC02 |
| A06 | `POST /auth/logout` | Có | Cả ba | **Gateway + Redis**, không gọi service | 27 (mở rộng) | FR42 / UC33 |
| A07 | `POST /auth/otp` (cũ: `/auth/driver/otp`) | Không | — | auth — `RequestDriverOtp` | 21 | FR39 / UC29 |
| A08 | `POST /auth/register-driver` (cũ: `/auth/driver/register`) | Không | — | auth — `RegisterDriver` | 21 | FR39, FR26 / UC29 |

| Mã | Request mẫu | Response thành công |
|---|---|---|
| A01 | — | 200 `{ "status": "UP" }` |
| A02 | — | 200 `{ "status": "READY", "checks": { "redis": "UP", "grpc_clients": "UP" } }`; Redis dừng → 503 `NOT_READY` |
| A03 | — | 200 `{ "status": "UP", "services": { "auth-service": "SERVING", … 8 dòng } }`; có service không `SERVING` → 503 `DEGRADED` |
| A04 | `{ "phone": "0901234567", "password": "12345678" }` | 201 `{ "account_id": 1000, "role": "customer" }` — chỉ tài khoản, chưa có hồ sơ (ADR-013) |
| A05 | `{ "phone": "0900000001", "password": "12345678" }` | 200 `{ "token": "eyJ…", "account_id": 1, "role": "customer", "expires_in": 3600 }` |
| A06 | — | 200 `{ "status": "LOGGED_OUT" }` |
| A07 | `{ "phone": "0911111111" }` | 200 `{ "phone": "0911111111", "expires_in": 300, "otp": "482915" }` — `otp` chỉ có khi `SIMULATION_MODE=true` (ADR-014); mã luôn ghi log của `auth-service` |
| A08 | `{ "phone": "0911111111", "otp": "482915", "password": "12345678" }` | 201 `{ "account_id": 1001, "role": "driver", "token": "eyJ…" }` |

Ghi chú:

- A05 sai mật khẩu và số chưa đăng ký trả **cùng** 401 `INVALID_CREDENTIALS` (không lộ số nào đã có). Mật khẩu đúng nhưng tài khoản `LOCKED` → 403 `ACCOUNT_LOCKED`. Định danh sai định dạng (gồm `' OR 1=1 --`) → 400 `INVALID_PHONE`.
- A08 trả luôn `token` [BA]: OTP vừa chứng minh người gọi giữ số điện thoại, nên cấp token ngay là đủ an toàn và bớt một request đăng nhập ở mục 21. A04 **không** trả token: mục 9 phải thấy "đăng ký xong **đăng nhập được**". OTP sai → 400 `OTP_INVALID`; hết hạn → 400 `OTP_EXPIRED`; số đã có → 409 `PHONE_ALREADY_EXISTS`.

Ba endpoint health:

| Endpoint | Trả lời câu hỏi | 200 khi | 503 khi |
|---|---|---|---|
| `/health` | Gateway còn sống không? | Tiến trình chạy | — |
| `/ready` | Gateway đủ phụ thuộc của **chính nó** chưa? | Redis trả lời | Redis không trả lời [BA: vẫn phục vụ request] |
| `/health/services` | Tám service phía sau thế nào? | Cả 8 `SERVING` | Có service không trả lời; body ghi rõ service nào |

### 2.2 Khách hàng và tài xế

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A37 | `POST /customers/me` | Có | customer | customer — `CreateCustomer` | 11 (phụ), 26 | FR27, BRULE18 / UC03, AC28 |
| A38 | `GET /customers/me` | Có | customer | customer — `GetCustomer` (mã = `sub`) | 26, 27 | FR27 / UC03, AC28 |
| A09 | `GET /customers/{customer_id}` | Có | customer (chủ), admin | customer — `GetCustomer` | **11**, 24, 25 | FR27 / UC03, UC19, AC29 |
| A10 | `PUT /customers/me` | Có | customer | customer — `UpdateCustomer` | 26 | FR27, BRULE18 / UC03, AC29 |
| A11 | `POST /drivers/me` (cũ: `/drivers/applications`) | Có | driver | driver — `SubmitApplication` | 21 | FR39, FR28, FR29 / UC29 |
| A12 | `GET /drivers/nearby?lat&lng&vehicle&page&limit` | Có | customer, admin | driver — `FindNearbyDrivers` | **13** | FR02–FR05 / UC06 |
| A13 | `GET /drivers?status&page&limit` | Có | admin | driver — `ListDrivers` | 22 (bổ trợ) | FR28, FR39 / UC20, UC30 |
| A14 | `GET /drivers/{driver_id}` | Có | Cả ba | driver — `GetDriver` | **12** | FR28, FR29 / UC20, UC21 |
| A15 | `POST /drivers/{driver_id}/approve` | Có | admin | driver — `ApproveDriver` | 22, 28 | FR39 / UC30 |
| A16 | `POST /drivers/{driver_id}/reject` | Có | admin | driver — `RejectDriver` | 22 | FR39 / UC30 |
| A17 | `POST /drivers/me/online` (cũ: `PUT /drivers/me/availability`) | Có | driver | driver — `SetAvailability` (`ONLINE`) | **23** | FR38 / UC28 |
| A39 | `POST /drivers/me/offline` (**mới**, tách từ A17) | Có | driver | driver — `SetAvailability` (`OFFLINE`) | **23** | FR38 / UC28 |
| A18 | `PUT /drivers/me/location` | Có | driver | driver — `UpdateLocation` | Bổ trợ 13, 15 | FR13 / UC12 |

| Mã | Request mẫu | Response thành công |
|---|---|---|
| A37 | `{ "name": "Pham Duc" }` | 201 `{ "customer_id": 1000, "name": "Pham Duc", "dob": null }` |
| A38, A09 | — | 200 `{ "customer_id": 1, "name": "Nguyễn Văn An", "dob": "2000-01-01" }` |
| A10 | `{ "name": "An Nguyen" }` | 200 hồ sơ sau khi sửa |
| A11 | `{ "name": "Tai Xe Moi", "license": "GPLX-99", "plate": "59A-99999" }` | 201 `{ "driver_id": 1001, "name": "Tai Xe Moi", "vehicle": "CAR_4", "plate": "59A99999", "approval_status": "PENDING" }` |
| A12 | `?lat=10.82&lng=106.68&limit=2` | 200 `{ "data": [ { "driver_id": 11, "name": "Tài Xế 1", "vehicle": "CAR_4", "plate": "59A-00001", "distance_m": 111 }, { "driver_id": 12, …, "distance_m": 222 } ], "pagination": { "page": 1, "limit": 2, "total": 4, "total_pages": 2 } }` |
| A13 | `?status=PENDING` | 200 danh sách hồ sơ, cũ nhất trước |
| A14 | — | 200 phần công khai `{ "driver_id": 11, "name": "Tài Xế 1", "vehicle": "CAR_4", "plate": "59A-00001", "availability": "ONLINE" }`; chính tài xế đó hoặc admin thấy thêm `license`, `approval_status`, `lat`, `lng` |
| A15 | — | 200 `{ "driver_id": 1001, "approval_status": "APPROVED" }` |
| A16 | `{ "reason": "thieu giay to" }` | 200 `{ "driver_id": 17, "approval_status": "REJECTED", "reason": "thieu giay to" }` |
| A17 | — (hoặc `{ "lat": 10.825, "lng": 106.68 }`) | 200 `{ "driver_id": 15, "availability": "ONLINE", "lat": 10.825, "lng": 106.68 }` |
| A39 | — | 200 `{ "driver_id": 15, "availability": "OFFLINE" }` |
| A18 | `{ "lat": 10.821, "lng": 106.68 }` | 200 `{ "driver_id": 11, "lat": 10.821, "lng": 106.68 }` |

Ghi chú:

- A37 không nhận `customer_id` từ client: dùng `x-account-id` (C4). Đã có hồ sơ → 409 `CUSTOMER_ALREADY_EXISTS`. A38, A10 chưa có hồ sơ → 404 `CUSTOMER_NOT_FOUND`. A10 body rỗng → 400.
- A09: khách gọi mã **khác mã của mình** → **403 `NOT_OWNER` ngay**, không tra database (vì `customer_id` = `account_id`, biết chủ mà không cần đọc). Đúng mã của mình mà chưa có hồ sơ → 404. Admin: 200 hoặc 404.
- Route tĩnh (`/customers/me`, `/drivers/me`, `/drivers/me/…`, `/drivers/nearby`) được so khớp **trước** route có mã.
- A11 nộp lần hai → 409 `DRIVER_ALREADY_EXISTS`; biển số trùng → 409 `LICENSE_PLATE_ALREADY_EXISTS`.
- A12: chỉ tài xế đã duyệt, `ONLINE`, trong **1 000 m** (D1–D3), sắp theo `distance_m` tăng dần rồi `driver_id`. `lat` ngoài −90…90 hoặc `lng` ngoài −180…180 → 400 `INVALID_COORDINATES`. Cùng rpc với S2.
- A13: `status` = `PENDING` | `APPROVED` | `REJECTED` (lọc theo trạng thái duyệt).
- A15, A16 hồ sơ đã duyệt / từ chối → 409 `APPLICATION_ALREADY_REVIEWED`.
- A17 chưa được duyệt → 409 `DRIVER_NOT_APPROVED` (D6). A39 khi đang `BUSY` → 409 `DRIVER_NOT_AVAILABLE`. Gọi A17 khi đã `ONLINE` → 200 (không đổi gì).
- Vì sao tách A17 / A39 thay vì một API có body `status` [BA]: không phải gõ body; tên đường dẫn tự nói việc làm. Đánh đổi: thêm một route.

### 2.3 Đặt xe và ghép tài xế

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A19 | `POST /bookings` | Có | customer | booking — `CreateBooking` (→ S4, rồi S2 chạy nền) | **15**, 18, 28 | FR01, FR16, FR35 / UC04 |
| A20 | `GET /bookings?status&page&limit` | Có | customer | booking — `ListBookings` | **14** | FR37 / UC18 |
| A21 | `GET /bookings/{booking_id}` | Có | customer (chủ), admin | booking — `GetBooking` | 19 (bổ trợ) | FR35 / UC04 |
| A22 | `POST /bookings/{booking_id}/cancel` | Có | customer (chủ) | booking — `CancelBooking` | 18 (phụ) | FR36 / UC27 |
| A23 | `GET /offers?status&page&limit` | Có | driver | booking — `ListOffers` | **15** | FR06 / UC07 |
| A24 | `POST /offers/{offer_id}/accept` | Có | driver (chủ) | booking — `AcceptOffer` (→ S3, S5) | **16** | FR07, FR11 / UC08 |
| A25 | `POST /offers/{offer_id}/reject` | Có | driver (chủ) | booking — `RejectOffer` | 15 (phụ) | FR08 / UC09 |

| Mã | Request mẫu | Response thành công |
|---|---|---|
| A19 | `{ "from": [10.82, 106.68], "to": [10.83, 106.69] }` | 201 `{ "booking_id": 1000, "status": "SEARCHING", "vehicle": "CAR_4", "pay": "CASH", "distance_m": 2026, "fare": 45000, "payment_id": 1000 }` |
| A19 điện tử | `{ "from": [10.82, 106.68], "to": [10.83, 106.69], "pay": "ONLINE" }` | 201 như trên với `"status": "PENDING_PAYMENT"`, `"pay": "ONLINE"`, kèm `"payment_expires_at"` |
| A20 | `?limit=2` | 200 `{ "data": [ { "booking_id": 7, "status": "PENDING_PAYMENT", "vehicle": "CAR_7", "pay": "ONLINE", "fare": 56000, "created_at": "…" }, … ], "pagination": { "page": 1, "limit": 2, "total": 7, "total_pages": 4 } }` |
| A21 | — | 200 như A19, thêm `driver_id`, `trip_id` (khi đã phân công), `canceled_by`, `cancel_reason` |
| A22 | `{ "reason": "doi y" }` | 200 `{ "booking_id": 1001, "status": "CANCELED", "canceled_by": "customer" }` |
| A23 | — (mặc định `status=PENDING`) | 200 `{ "data": [ { "offer_id": 1000, "booking_id": 1000, "distance_m": 111, "status": "PENDING", "expires_at": "…", "from": [10.82, 106.68], "to": [10.83, 106.69], "pay": "CASH", "fare": 45000 } ], "pagination": { … } }` |
| A24 | — | 200 `{ "offer_id": 1000, "status": "ACCEPTED", "booking_id": 1000, "booking_status": "DRIVER_ASSIGNED", "trip_id": 1000, "trip_status": "ACCEPTED" }` |
| A25 | — | 200 `{ "offer_id": 1000, "status": "REJECTED" }` |

Ghi chú:

- A19: khách **không chờ** ghép xong (B2) — Offer xuất hiện trong khoảng một giây. `from` hoặc `to` không phải mảng hai số → 400 `INVALID_INPUT`; ngoài khoảng → 400 `INVALID_COORDINATES`; trùng nhau → 400 `SAME_PICKUP_AND_DESTINATION`; loại xe không có giá → 400 `INVALID_INPUT` (Payment trả lời ở S4). `fare` = 45 000 đ cho tuyến mẫu P0 → D0 bằng `CAR_4` (file 03 mục 6.3).
- `payment_id` do Payment cấp, **không đảm bảo** bằng `booking_id` (chỉ seed mới bằng nhau): luôn copy từ response.
- A20: chỉ booking của khách trong token; sắp `created_at` giảm dần rồi `booking_id` giảm dần (seed có thể cùng thời điểm tạo, cột thứ hai giữ thứ tự cố định: 7, 6, 5…).
- A22: booking đã có tài xế → 409 `BOOKING_ALREADY_ASSIGNED` (phải hủy chuyến bằng A29); đã hủy / kết thúc → 409 `BOOKING_NOT_CANCELABLE`. Hủy Payment / hoàn tiền đi bằng K4 sau đó.
- A24: Offer quá hạn → 409 `OFFER_EXPIRED`; không phải của mình → 403 `NOT_OWNER`.

### 2.4 Chuyến đi

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A26 | `GET /trips?status&page&limit` | Có | Cả ba | trip — `ListTrips` | Ngoài phiếu | FR30, FR34 / UC18, UC22 |
| A27 | `GET /trips/{trip_id}` | Có | customer (chủ), driver (chủ), admin | trip — `GetTrip` (→ S6) | Bổ trợ 16–18 | FR14 / UC10 |
| A28 | `PATCH /trips/{trip_id}/status` | Có | driver (chủ) | trip — `UpdateTripStatus` | **17** | FR12 / UC11 |
| A29 | `POST /trips/{trip_id}/cancel` | Có | customer (chủ), driver (chủ) | trip — `CancelTrip` | **18** | FR36, FR41 / UC27, UC32 |

| Mã | Request mẫu | Response thành công |
|---|---|---|
| A27 | — | 200 `{ "trip_id": 1000, "booking_id": 1000, "status": "ACCEPTED", "pay": "CASH", "fare": 45000, "driver": { "driver_id": 11, "name": "Tài Xế 1", "plate": "59A-00001", "lat": 10.821, "lng": 106.68 }, "history": [ … ] }` |
| A28 | `{ "status": "ARRIVED" }` | 200 `{ "trip_id": 1000, "status": "ARRIVED", "history": [ { "status": "ACCEPTED", "at": "…" }, { "status": "ARRIVED", "at": "…" } ] }` |
| A29 | `{ "reason": "ban viec" }` | 200 `{ "trip_id": 5, "status": "CANCELED", "canceled_by": "customer", "reason": "ban viec" }` |

Ghi chú:

- A26 làm sau khi xong 30 mục (Q32).
- A27: phần `driver` lấy qua S6; `driver-service` không trả lời thì `driver: null` kèm `driver_info_available: false`.
- A28: `status` ∈ `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED`; phải đi **đúng thứ tự** `ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED` (FR12). Sai thứ tự (kể cả nhảy cóc) → 409 `INVALID_STATUS_TRANSITION`. Response có **luôn lịch sử** nên không cần gọi A27 để kiểm tra.
- A29: đã đón khách (`PICKED_UP` trở đi) → 409 `TRIP_NOT_CANCELABLE` (BRULE16). Hoàn tiền và thông báo đi bằng K5 sau đó.

### 2.5 Thanh toán, thông báo, đánh giá

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A30 | `GET /payments/{payment_id}` | Có | customer (chủ), admin | payment — `GetPayment` | 30 | FR20 / UC24 |
| A31 | `POST /payments/{payment_id}/pay` | Có + `Idempotency-Key` | customer (chủ) | payment — `PayPayment` | **19, 30** | FR18, FR19 / UC14, UC15 |
| A32 | `POST /payments/callback` | **Không; header `X-Callback-Secret`** | — | payment — `HandleProviderCallback` | **19, 30** | FR18 / UC14 |
| A33 | `GET /notifications?page&limit` | Có | Cả ba | notification — `ListNotifications` | 16, 18 | FR21–FR24 / UC16 |
| A34 | `POST /trips/{trip_id}/rating` | Có | customer (chủ) | rating — `CreateRating` (→ S7) | **20** | FR25 / UC17 |
| A35 | `GET /trips/{trip_id}/rating` | Có | customer (chủ), driver (chủ), admin | rating — `GetRatingByTrip` | 20 (bổ trợ) | FR25 |
| A36 | `GET /drivers/{driver_id}/rating` | Có | Cả ba | rating — `GetDriverRating` | 20 (bổ trợ) | UC17 bước 5 |

| Mã | Request mẫu | Response thành công |
|---|---|---|
| A30 | — | 200 `{ "payment_id": 7, "booking_id": 7, "method": "ONLINE", "status": "COMPLETED", "amount": 56000, "fare": { "distance_m": 2026, "base_fare": 25000, "per_km_rate": 15000, "min_fare": 40000 }, "expires_at": "…", "paid_at": "…", "transactions": [ { "txn_id": "SIM-7-1", "type": "CHARGE", "attempt_no": 1, "status": "SUCCEEDED" } ] }` |
| A31 | Header `Idempotency-Key: k1`; body `{ "simulate_result": "MANUAL" }` | 200 `{ "payment_id": 7, "status": "PENDING", "txn_id": "SIM-7-1", "txn_status": "PENDING", "attempt_no": 1, "attempts_left": 2, "expires_at": "…" }` |
| A32 | Header `X-Callback-Secret: cab-secret`; body `{ "txn_id": "SIM-7-1" }` | 200 `{ "txn_id": "SIM-7-1", "txn_status": "SUCCEEDED", "payment_id": 7, "status": "COMPLETED" }` |
| A33 | — | 200 `{ "data": [ { "type": "TRIP_ACCEPTED", "title": "…", "body": "…", "data": { "booking_id": 1000, "trip_id": 1000 }, "created_at": "…" } ], "pagination": { … } }` |
| A34 | `{ "score": 5 }` | 201 `{ "rating_id": 1000, "trip_id": 4, "driver_id": 13, "score": 5, "comment": null, "driver_avg": 5.0, "driver_count": 1 }` |
| A35 | — | 200 đánh giá của chuyến |
| A36 | — | 200 `{ "driver_id": 11, "avg": 5.0, "count": 1 }` |

Ghi chú:

- A30: không field nào chứa thông tin thẻ (BRULE09). `fare` là từng thành phần cước để giải thích con số cuối.
- A31: mỗi lần gọi với **khóa mới** là một lần thử (BRULE17). `simulate_result` chỉ có hiệu lực khi `SIMULATION_MODE=true` (tắt thì bỏ qua); giá trị khác ba giá trị dưới → 400 `INVALID_INPUT`:

  | `simulate_result` | Adapter làm gì | `txn_status` / `status` trong response |
  |---|---|---|
  | Không gửi hoặc `SUCCESS` | Gọi ngay hàm xử lý callback, thành công (ADR-014) | `SUCCEEDED` / `COMPLETED` |
  | `FAILED` | Gọi ngay hàm xử lý callback, thất bại | `FAILED` / `FAILED` (`CANCELED` nếu là lần thử cuối) |
  | `MANUAL` (Q57) | **Không** gọi callback; chờ A32 từ ngoài | `PENDING` / `PENDING` |

  Lỗi: đã `COMPLETED` → 409 `PAYMENT_ALREADY_COMPLETED`; đang có lần thử `PENDING` → 409 `PAYMENT_IN_PROGRESS`; quá hạn → 409 `PAYMENT_EXPIRED`; hết lượt → 409 `PAYMENT_ATTEMPTS_EXHAUSTED`; thanh toán tiền mặt → 409 `PAYMENT_NOT_ONLINE`.
- `txn_id` theo quy luật **`SIM-<payment_id>-<attempt_no>`** (file 03 mục 8.4): học thuộc được, không cần copy.
- A33: thông báo của chính người trong token, mới nhất trước.
- A34: chuyến chưa `COMPLETED` → 409 `TRIP_NOT_COMPLETED`; không phải khách của chuyến → 403 `NOT_OWNER`; đã đánh giá → 409 `RATING_ALREADY_EXISTS`; `score` ngoài 1–5 → 400. Response có luôn điểm trung bình mới của tài xế (bớt request A36).

### 2.6 Callback thanh toán (A32) và cổng thanh toán giả lập — ADR-014

| Điểm | Thiết kế | Vì sao |
|---|---|---|
| Ai gửi callback | **Adapter giả lập trong `payment-service`** gọi ngay hàm xử lý callback khi nhận A31 (thu) hoặc yêu cầu hoàn tiền. A32 là **cùng hàm** gọi từ ngoài qua Gateway. Với `MANUAL` adapter không gọi, nên A32 từ Postman là callback đầu tiên và làm Payment `PENDING → COMPLETED` (mục 19) | Không có bước chờ; người chấm thấy rõ bước "nhận callback" (Q57) |
| Xác thực | Header `X-Callback-Secret: cab-secret` (`PAYMENT_CALLBACK_SECRET`); **không HMAC**. `payment-service` so sánh thời gian hằng | Giả lập đơn giản (giảng viên); khóa thuộc context Payment |
| Sai / thiếu khóa | 401 `INVALID_CALLBACK_SECRET` | |
| Body | `txn_id` (bắt buộc), `result` (`SUCCESS` mặc định / `FAILED`), `amount` (tùy chọn; khác số tiền giao dịch → 400) | Luật thi: body một field |
| Mã giao dịch lạ | 404 `TRANSACTION_NOT_FOUND` | |
| Giao dịch đang `PENDING` | 200 `{ txn_id, txn_status, payment_id, status }`; phát K6; lưu response vào `callback_response` | Callback đầu tiên là callback được xử lý |
| Giao dịch đã có kết quả | 200 **response đã lưu**, header `Idempotency-Replayed: true`; không đổi trạng thái, không phát lại K6 | Mục 30 |
| Không chặn "callback quá cũ" | — | Phiếu chấm yêu cầu replay **trả response cũ**, không phải bị từ chối |
| Đánh đổi | Khóa cố định không chứng minh body không bị sửa; lộ khóa là giả được callback | Chỉ Gateway mở ra ngoài; Provider thật thì đổi sang HMAC trong adapter (NFR13) |

## 3. Ma trận phân quyền (mục chấm 28)

Ô là HTTP mong đợi khi dữ liệu hợp lệ. **200\*** / **201\*** = chỉ với dữ liệu của chính mình; của người khác → 403 `NOT_OWNER` (service trả). 401 và 403 theo role (`FORBIDDEN`) do Gateway trả.

| Mã | API | Không đăng nhập | customer | driver | admin |
|---|---|---|---|---|---|
| A01–A03 | Health | 200 | 200 | 200 | 200 |
| A04 | Đăng ký khách | 201 | 201 | 201 | 201 |
| A05 | Đăng nhập | 200 | 200 | 200 | 200 |
| A06 | Đăng xuất | 401 | 200 | 200 | 200 |
| A07 | Xin OTP | 200 | 200 | 200 | 200 |
| A08 | Đăng ký tài xế | 201 | 201 | 201 | 201 |
| A09 | Xem khách theo mã | 401 | 200\* (404 nếu chưa có hồ sơ) | 403 | 200 / 404 |
| A10 | Sửa hồ sơ của tôi | 401 | 200 (404 nếu chưa có) | 403 | 403 |
| A37 | Tạo hồ sơ của tôi | 401 | 201 (409 nếu đã có) | 403 | 403 |
| A38 | Xem hồ sơ của tôi | 401 | 200 (404 nếu chưa có) | 403 | 403 |
| A11 | Nộp hồ sơ tài xế | 401 | 403 | 201 | 403 |
| A12 | Tài xế quanh tọa độ | 401 | 200 | 403 | 200 |
| A13 | Danh sách tài xế | 401 | 403 | 403 | 200 |
| A14 | Xem tài xế theo mã | 401 | 200 (công khai) | 200 (đủ nếu là mình) | 200 (đủ) |
| A15 | Duyệt hồ sơ | 401 | **403** | 403 | 200 |
| A16 | Từ chối hồ sơ | 401 | 403 | 403 | 200 |
| A17 | Bật nhận chuyến | 401 | 403 | 200 | 403 |
| A39 | Tắt nhận chuyến | 401 | 403 | 200 | 403 |
| A18 | Gửi vị trí | 401 | 403 | 200 | 403 |
| A19 | Đặt xe | 401 | 201 | **403** | 403 |
| A20 | Danh sách booking của tôi | 401 | 200 | 403 | 403 |
| A21 | Xem booking | 401 | 200\* | 403 | 200 |
| A22 | Hủy booking | 401 | 200\* | 403 | 403 |
| A23 | Offer của tôi | 401 | 403 | 200 | 403 |
| A24 | Nhận Offer | 401 | 403 | 200\* | 403 |
| A25 | Từ chối Offer | 401 | 403 | 200\* | 403 |
| A26 | Danh sách chuyến | 401 | 200 (của mình) | 200 (của mình) | 200 |
| A27 | Xem chuyến | 401 | 200\* | 200\* | 200 |
| A28 | Cập nhật trạng thái chuyến | 401 | 403 | 200\* | 403 |
| A29 | Hủy chuyến | 401 | 200\* | 200\* | 403 |
| A30 | Xem thanh toán | 401 | 200\* | 403 | 200 |
| A31 | Thực hiện thanh toán | 401 | 200\* | 403 | 403 |
| A32 | Callback | 200 nếu khóa đúng; 401 nếu sai / thiếu | — | — | — |
| A33 | Thông báo của tôi | 401 | 200 | 200 | 200 |
| A34 | Đánh giá chuyến | 401 | 201\* | 403 | 403 |
| A35 | Xem đánh giá của chuyến | 401 | 200\* | 200\* | 200 |
| A36 | Điểm của tài xế | 401 | 200 | 200 | 200 |

Hai ô in đậm là hai request demo của mục 28: khách gọi duyệt hồ sơ; tài xế gọi đặt xe. Admin **không** hủy được chuyến (A29 → 403): BRULE16 chỉ nói về khách và tài xế; FR31 chưa thiết kế (Q45).

## 4. Kiểm tra quyền sở hữu

Nguyên tắc: **Gateway kiểm tra role; service kiểm tra chủ dữ liệu.** Mã là số nguyên tuần tự nên **dễ đoán** (đổi `/bookings/5` thành `/bookings/6` là thử được) — vì vậy **mọi API có mã trong đường dẫn** đều phải qua bảng dưới (ADR-015).

| Vì sao không kiểm tra ở Gateway | |
|---|---|
| Gateway không có dữ liệu | Muốn biết booking này của ai thì phải đọc database Booking hoặc gọi thêm gRPC — trái "Gateway không chứa logic nghiệp vụ, không truy cập database nghiệp vụ" |
| Là quy tắc nghiệp vụ | "Chỉ tài xế của chuyến mới cập nhật trạng thái" (T3) phải nằm cùng chỗ với dữ liệu Trip |
| Một lần đọc | Service đằng nào cũng đọc đối tượng; so `x-account-id` với chủ là thêm một phép so sánh |

| API | Chủ dữ liệu | Service so `x-account-id` với | Quy tắc (file 01) | Không phải chủ | Không tồn tại |
|---|---|---|---|---|---|
| A09 | Khách có mã đó | Chính mã trong đường dẫn (`customer_id` = `account_id`) — so **trước khi** đọc database; admin bỏ qua | C2 | 403 | 404 (chỉ khi là mã của mình hoặc admin) |
| A10, A37, A38 | Khách trong token | Không nhận mã từ client | C2, C4, BRULE18 | — | 404 (A10, A38) |
| A14 | — (công khai một phần) | Khác chủ thì trả phần công khai, **không lỗi** | FR14, NFR08 | 200 công khai | 404 |
| A15, A16 | — (việc của admin) | Không cần: chỉ admin vào được (role) | D4, D5 | — | 404 |
| A11, A17, A39, A18 | Tài xế trong token | Không nhận mã từ client | D6 | — | 404 (A17, A39, A18 khi chưa nộp hồ sơ) |
| A20, A23, A33 | Người trong token | Lọc theo `x-account-id` | B14, N2 | — | danh sách rỗng |
| A21, A22 | Khách của booking | `bookings.customer_id` | B13, B14 | 403 | 404 |
| A24, A25 | Tài xế được mời | `driver_offers.driver_id` | B9 | 403 | 404 |
| A27 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` theo role | T7 | 403 | 404 |
| A28 | Tài xế của chuyến | `trips.driver_id` | T3 | 403 | 404 |
| A29 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` | T5 | 403 | 404 |
| A30, A31 | Khách của thanh toán | `payments.customer_id` | NFR08 | 403 | 404 |
| A34 | Khách của chuyến | `customer_id` do Trip trả qua S7 | V2 | 403 | 404 |
| A35 | Khách hoặc tài xế của chuyến | `ratings.customer_id` / `ratings.driver_id` | NFR08 | 403 | 404 |
| A36 | — (công khai) | Không cần | UC17 | — | 200 với `count: 0` |

Vì sao không phải chủ thì **403** chứ không giả làm 404: mã tuần tự nên "mã 6 có tồn tại" vốn đã đoán được; thứ cần bảo vệ là **nội dung**, và 403 cho người chấm thấy rõ lý do bị chặn (mục 28). Ngoại lệ A09: biết chủ ngay từ mã nên chặn trước khi đọc database, không lộ "khách số 3 đã tạo hồ sơ hay chưa".

API "của tôi" (A10, A11, A17, A39, A18, A20, A23, A33, A37, A38) **không có mã trong đường dẫn**, nên không thể gọi nhầm dữ liệu người khác.

## 5. Mục chấm → request gõ tay

Ký hiệu: `[KH1]` = tab Authorization → Bearer Token → dán token của KH1 (lấy từ response đăng nhập). Header khác ghi rõ. Body là JSON (Postman: Body → raw). "Sửa tab" = dùng lại tab vừa gửi, chỉ đổi vài ký tự. Ước lượng thời gian: gõ mới một request ≈ 10 giây (GET) – 20 giây (POST có header, body); sửa tab ≈ 3–5 giây. Dữ liệu seed: file 03 mục 14. Kịch bản học thuộc đầy đủ (copy gì, nói gì): file 06.

### 5.1 Thực hành 1 (mục 1–10)

| Mục | # | Request (method URL — auth / header — body) | Kết quả mong đợi |
|---|---|---|---|
| 1, 3, 4 | — | Mô tả bằng lời (file 06) | — |
| 2 | — | Terminal: `cat .gitignore`; `git check-ignore .env`; `git ls-files .env .env.example` | Có dòng `.env`; in ra `.env`; chỉ in `.env.example` |
| 5 | — | Terminal: `docker compose ps -a` | 21 container; 20 đang chạy, `kafka-init` đã thoát 0 |
| 6 | 1 | `GET http://localhost:3000/health` | 200 `UP` |
| | 2 | Sửa tab: `/ready` | 200 `READY` |
| | 3 | Sửa tab: `/health/services` | 200, 8 service `SERVING` |
| 7 | — | Trình duyệt `http://localhost:8080` → Topics | 7 topic; message xuất hiện sau mục 15 |
| 8 | — | Terminal: `docker compose ps`; Postman `GET http://localhost:50051` | Chỉ `gateway` 3000, `kafka-ui` 8080 có cổng; Postman báo `ECONNREFUSED` |
| 9 | 1 | `POST http://localhost:3000/auth/register` — body `{"phone":"0901234567","password":"12345678"}` | 201 `account_id` 1000, `role` customer |
| | 2 | Sửa tab: `register` → `login` (body giữ nguyên) | 200 có `token` |
| | 3 | Sửa tab: `login` → `register` | 409 `PHONE_ALREADY_EXISTS` |
| 10 | 1 | `POST http://localhost:3000/auth/login` — body `{"phone":"0900000001","password":"12345678"}` | 200 `token`, `role` customer, `expires_in` 3600 |
| | 2 | Sửa tab: `"password":"sai"` | 401 `INVALID_CREDENTIALS` |
| | 3 | Sửa tab: `"phone":"0900000009"`, mật khẩu đúng | 403 `ACCOUNT_LOCKED` |

### 5.2 Thực hành 2 (mục 11–20)

| Mục | # | Request | Kết quả mong đợi |
|---|---|---|---|
| 11 | 1 | `GET http://localhost:3000/customers/1` — `[KH1]` | 200 `name` "Nguyễn Văn An", `dob` 2000-01-01 |
| | 2 | Sửa tab: `/customers/2` | 403 `NOT_OWNER` |
| 11 (phụ) | 1 | `POST http://localhost:3000/customers/me` — `[token mục 9]` — `{"name":"Pham Duc"}` | 201 `customer_id` 1000 |
| | 2 | `GET http://localhost:3000/customers/1000` — `[token mục 9]` | 200 hồ sơ vừa tạo |
| 12 | 1 | `GET http://localhost:3000/drivers/11` — `[KH1]` | 200 Tài Xế 1, `CAR_4`, `59A-00001`, `ONLINE` |
| | 2 | Sửa tab: `/drivers/999` | 404 `DRIVER_NOT_FOUND` |
| | 3 | Sửa tab: `/drivers/abc` | 400 `INVALID_ID` |
| 13 | 1 | `GET http://localhost:3000/drivers/nearby?lat=10.82&lng=106.68&limit=2` — `[KH1]` | 200: TX1 (11, ≈ 111 m), TX2 (12, ≈ 222 m); `total` 4 |
| | 2 | Sửa tab: thêm `&page=2` | 200: TX3 (13), TX4 (14) |
| | 3 | Sửa tab: bỏ `&page=2`, thêm `&vehicle=CAR_4` | 200: TX1, TX3; `total` 2 |
| 14 | 1 | `GET http://localhost:3000/bookings?limit=2` — `[KH1]` | 200: booking 7, 6; `total` 7, `total_pages` 4 |
| | 2 | Sửa tab: `&page=2` | 200: booking 5, 4 |
| | 3 | Sửa tab: `limit=abc` | 400 `INVALID_PAGINATION` |
| 15 | 1 | `POST http://localhost:3000/bookings` — `[KH1]` — `{"from":[10.82,106.68],"to":[10.83,106.69]}` | 201 `SEARCHING`, `CAR_4`, `CASH`, `fare` 45000, `booking_id` 1000 |
| | 2 | Sửa tab đăng nhập: `"phone":"0910000001"` | 200 token TX1 |
| | 3 | `GET http://localhost:3000/offers` — `[TX1]` | 200: một Offer `PENDING` cho booking 1000, `distance_m` ≈ 111 |
| 16 | 1 | `POST http://localhost:3000/offers/1000/accept` — `[TX1]` | 200 `ACCEPTED`, `booking_status` `DRIVER_ASSIGNED`, `trip_id` 1000 |
| | 2 | `GET http://localhost:3000/notifications` — `[KH1]` | 200: thông báo `TRIP_ACCEPTED` mới nhất |
| 17 | 1 | `PATCH http://localhost:3000/trips/1000/status` — `[TX1]` — `{"status":"COMPLETED"}` | **409 `INVALID_STATUS_TRANSITION`** (nhảy cóc) |
| | 2–5 | Sửa tab, lần lượt `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED` | 200 mỗi lần; lần cuối `history` đủ 5 trạng thái |
| 18 | 1 | `POST http://localhost:3000/trips/5/cancel` — `[KH1]` — `{"reason":"ban viec"}` | 200 `CANCELED`, `canceled_by` customer |
| | 2 | Sửa tab đăng nhập: `"phone":"0910000006"` | 200 token TX6 |
| | 3 | `GET http://localhost:3000/notifications` — `[TX6]` | 200: `TRIP_CANCELED` cho chuyến 5 |
| | (4) | Sửa tab: token `[KH1]` | `TRIP_CANCELED` và `PAYMENT_REFUNDED` (payment 5) |
| 18 (phụ) | 1 | `POST http://localhost:3000/bookings` — `[KH1]` — `{"from":[10.82,106.68],"to":[10.83,106.69],"pay":"ONLINE"}` | 201 `PENDING_PAYMENT` |
| | 2 | `POST http://localhost:3000/bookings/<booking_id>/cancel` — `[KH1]` — `{"reason":"doi y"}` | 200 `CANCELED` |
| 19 | 1 | `POST http://localhost:3000/payments/7/pay` — `[KH1]` — header `Idempotency-Key: k1` — `{"simulate_result":"MANUAL"}` | 200 `status` `PENDING`, `txn_id` `SIM-7-1`, `txn_status` `PENDING` |
| | 2 | `POST http://localhost:3000/payments/callback` — header `X-Callback-Secret: cab-secret` — `{"txn_id":"SIM-7-1"}` | 200 `txn_status` `SUCCEEDED`, **`status` `COMPLETED`** |
| | (3) | `GET http://localhost:3000/bookings/7` — `[KH1]` | 200 `SEARCHING` (BRULE13: trả xong mới tìm tài xế) |
| 19 (phụ) | 1 | A19 với `"pay":"ONLINE","vehicle":"CAR_7"` | 201 `PENDING_PAYMENT`, `payment_id` P |
| | 2 | `POST http://localhost:3000/payments/P/pay` — `[KH1]` — `Idempotency-Key: k1` — `{"simulate_result":"FAILED"}` | 200 `txn_status` `FAILED`, `attempts_left` 2 |
| 20 | 1 | `POST http://localhost:3000/trips/4/rating` — `[KH1]` — `{"score":5}` | 201 `driver_id` 13, `driver_avg` 5.0 |
| | 2 | Gửi lại y hệt | 409 `RATING_ALREADY_EXISTS` |
| | 3 | Sửa tab: `/trips/5/rating` | 409 `TRIP_NOT_COMPLETED` |

### 5.3 Thực hành 3 (mục 21–30)

| Mục | # | Request | Kết quả mong đợi |
|---|---|---|---|
| 21 | 1 | `POST http://localhost:3000/auth/otp` — `{"phone":"0911111111"}` | 200 có `otp` |
| | 2 | Sửa tab: URL `/auth/register-driver`, body `{"phone":"0911111111","otp":"<otp>","password":"12345678"}` | 201 `role` driver, `token` |
| | 3 | `POST http://localhost:3000/drivers/me` — `[token vừa nhận]` — `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` | 201 `approval_status` **`PENDING`**, `driver_id` D |
| 22 | 1 | Sửa tab đăng nhập: `"phone":"0999999999"` | 200 token AD1 |
| | 2 | `POST http://localhost:3000/drivers/D/approve` — `[AD1]` | 200 `APPROVED` |
| | 3 | Sửa tab: `/drivers/17/reject`, body `{"reason":"thieu giay to"}` | 200 `REJECTED` |
| 23 | 1 | Sửa tab đăng nhập: `"phone":"0910000005"` | 200 token TX5 |
| | 2 | `POST http://localhost:3000/drivers/me/online` — `[TX5]` | 200 `availability` `ONLINE` |
| | 3 | Sửa tab: `online` → `offline` | 200 `OFFLINE` |
| 24 | 1 | `GET http://localhost:3000/customers/1` — `[KH1]` | 200 họ tên rõ |
| | — | Terminal: `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `full_name_enc`, `date_of_birth_enc` là `\x…` |
| | — | Terminal: `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$` |
| 25 | 1 | Sửa tab đăng nhập: `{"phone":"0900000001","password":"' OR '1'='1"}` | 401 `INVALID_CREDENTIALS` |
| | 2 | Sửa tab: `{"phone":"' OR 1=1 --","password":"x"}` | 400 `INVALID_PHONE` |
| | 3 | `GET http://localhost:3000/customers/1 OR 1=1` — `[KH1]` | 400 `INVALID_ID` |
| 26 | 1 | `PUT http://localhost:3000/customers/me` — `[KH1]` — `{"name":"<script>alert(1)</script>"}` | 400 `TEXT_CONTAINS_HTML` |
| | 2 | Sửa tab: method `GET`, xóa body | 200 tên vẫn "Nguyễn Văn An"; tab Headers có `nosniff`, CSP |
| 27 | 1 | `GET http://localhost:3000/customers/me` — `[KH1]` **đã sửa một ký tự ở giữa token** | 401 `TOKEN_INVALID` |
| | 2 | Sửa tab: Authorization → No Auth | 401 `TOKEN_MISSING` |
| | (3) | `POST http://localhost:3000/auth/logout` — `[KH1]` (token đúng) | 200 `LOGGED_OUT` |
| | (4) | Gửi lại request 1 với token đúng vừa đăng xuất | 401 `TOKEN_REVOKED` |
| 28 | 1 | `POST http://localhost:3000/drivers/17/approve` — `[KH1]` | 403 `FORBIDDEN` |
| | 2 | `POST http://localhost:3000/bookings` — `[TX1]` — không body | 403 `FORBIDDEN` (role kiểm tra trước body) |
| 29 | 1 | Tab đăng nhập bất kỳ, bấm Send liên tục 6 lần | Lần 6: **429 `RATE_LIMITED`**, header `Retry-After` |
| 30 | 1 | Tab request 1 của mục 19, bấm Send lại (cùng `k1`, cùng body) | 200, body **y hệt** lần đầu (`PENDING`), header `Idempotency-Replayed: true` |
| | 2 | Tab request 2 của mục 19, bấm Send lại | 200 y hệt (`COMPLETED`), `Idempotency-Replayed: true` |
| | 3 | `GET http://localhost:3000/payments/7` — `[KH1]` | `COMPLETED`, **đúng một** giao dịch `CHARGE` `SIM-7-1` |

### 5.4 Số request, thời gian và lý do vượt

| Mục | Số request (+ lệnh) | Ước lượng | Ghi chú |
|---|---|---|---|
| 2 | 3 lệnh | ~15 s | |
| 5 | 1 lệnh | ~10 s | |
| 6 | 3 | ~15 s | Một tab, đổi đường dẫn |
| 7 | 0 (trình duyệt) | ~15 s | |
| 8 | 1 lệnh + 1 | ~15 s | |
| 9, 10 | 3 | ~25 s | Một tab, body dùng chung |
| 11 | 2 (+1 đăng nhập nếu chưa có token KH1) | ~15 s (~25 s) | |
| 12, 14 | 3 | ~18 s | |
| 13 | 3 | ~22 s | URL dài nhất có query |
| 15 | 3 | **~30 s — sát** | Ba request ba nơi: đặt xe (khách), đăng nhập TX1, xem Offer (tài xế). Không bớt được: phải thấy Offer **ở phía tài xế**. Có token TX1 sẵn thì ~22 s |
| 16 | 2 | ~20 s | |
| 17 | 5 | **~30 s — sát** | FR12 bắt buộc 4 bước trạng thái + 1 lần thử sai thứ tự. Một tab, mỗi lần chỉ đổi một từ (~4 s) |
| 18 | 3 (+1) | **~28 s — sát** | Phải thấy **tài xế** được báo nên cần token TX6 |
| 19 | 2 (+1) | **~35–40 s — vượt** | Hai request đều có header phụ (`Idempotency-Key` cho mục 30; `X-Callback-Secret` để xác thực callback). Không bỏ được mà vẫn giữ hai yêu cầu đó. Cách giảm: dùng Bulk Edit ở tab Headers (gõ `Idempotency-Key:k1` một dòng); phương án dự phòng 1 request ở file 06 |
| 20 | 3 | ~20 s | |
| 21 | 3 | **~35 s — vượt nhẹ** | Ba bước nghiệp vụ khác nhau (OTP → tài khoản → hồ sơ) ở hai service; đã gộp đăng nhập vào A08 |
| 22, 23 | 3 | ~22 s | |
| 24 | 1 + 2 lệnh | **~30 s — sát** | Bằng chứng "at rest" chỉ thấy trong database (Q52) |
| 25 | 3 | ~15 s | |
| 26, 28 | 2 | ~20 s | |
| 27 | 2 (+2) | ~10 s (~25 s) | |
| 29 | 1 × 6 lần | ~10 s | |
| 30 | 3 | ~12 s | Gửi lại tab của mục 19. Gõ lại từ đầu thì ~45 s |

Không chuỗi nào có bước **chờ**: Offer xuất hiện trong khoảng một giây sau đặt xe; Booking sang `SEARCHING` một nhịp K6 sau callback.

### 5.5 Thứ tự chạy và trạng thái seed bị đổi

| Điểm | Nội dung |
|---|---|
| Thứ tự đề xuất | 1–8 → 9 → 10 → 11 → 12 → **13, 14 trước 15** → 15 → 16 → 17 → 20 → 18 → **19 → 30 liền nhau** → 21 → 22 → 23 → 24 → 25 → 26 → 28 → **27** → **29 cuối cùng** (file 06 mục 3) |
| 13, 14 trước 15 | Sau 15, TX1 bận (mục 13 còn 3 tài xế) và KH1 có thêm booking (mục 14 `total` > 7) |
| 15 → 16 → 17 | Dùng chung booking, Offer, trip 1000. Offer hạn `OFFER_TIMEOUT_SECONDS` = 300 giây: mục 16 phải trong 5 phút sau mục 15 |
| 19 → 30 | Sau mục 19, B7 đang tìm tài xế `CAR_7` (chỉ TX4). Không ai nhận thì sau 300 giây booking `NO_DRIVER_FOUND` và Payment 7 thành `REFUNDED`. Replay vẫn trả response cũ, nhưng request 3 của mục 30 sẽ thấy `REFUNDED` thay vì `COMPLETED` → chạy 30 **ngay sau** 19 |
| 15 và 19 không tranh tài xế | 15–17 dùng `CAR_4` (TX1); 19 dùng `CAR_7` (TX4) |
| 27 | Đăng xuất thu hồi token KH1 đang dùng → làm gần cuối; cần KH1 sau đó thì đăng nhập lại |
| 29 | Khóa route công khai theo IP tối đa 10 giây → làm cuối |
| Chấm lại từ đầu | `docker compose down -v` rồi `docker compose up -d --build` (file 03 mục 14) |
| Demo hết hạn (không bắt buộc) | Hạ `PAYMENT_TIMEOUT_SECONDS` hoặc `OFFER_TIMEOUT_SECONDS` trong `.env` rồi `docker compose up -d` |

## 6. Danh sách rpc gRPC theo service

Tên file: `proto/<service>.proto`. Mọi mã là `int64` (`proto-loader` `longs: Number`). Cột "Ai gọi": GW = Gateway; mã S là đường service → service của file 02. Mọi service thêm `grpc.health.v1.Health/Check` (G9).

| Service | rpc | Ai gọi | API / đường |
|---|---|---|---|
| auth | `RegisterCustomer` | GW | A04 (không gọi service khác) |
| | `Login` | GW | A05 |
| | `RequestDriverOtp` | GW | A07 |
| | `RegisterDriver` | GW | A08 (trả cả token) |
| customer | `CreateCustomer` | GW | A37 |
| | `GetCustomer` | GW | A09, A38 |
| | `UpdateCustomer` | GW | A10 |
| driver | `SubmitApplication` | GW | A11 |
| | `FindNearbyDrivers` | GW; **booking** | A12; **S2** |
| | `ListDrivers` | GW | A13 |
| | `GetDriver` | GW | A14 |
| | `ApproveDriver`, `RejectDriver` | GW | A15, A16 (phát K7) |
| | `SetAvailability` | GW | A17 (`ONLINE`), A39 (`OFFLINE`) |
| | `UpdateLocation` | GW | A18 |
| | `ReserveDriver`, `ReleaseDriver` | **booking** | **S3** |
| | `GetDriverSummary` | **trip** | **S6** |
| booking | `CreateBooking` | GW | A19 (gọi S4; phát K1, rồi K2) |
| | `ListBookings`, `GetBooking` | GW | A20, A21 |
| | `CancelBooking` | GW | A22 (phát K4) |
| | `ListOffers` | GW | A23 |
| | `AcceptOffer` | GW | A24 (gọi S3, S5) |
| | `RejectOffer` | GW | A25 |
| trip | `CreateTrip` | **booking** | **S5** (phát K5 `ACCEPTED`) |
| | `ListTrips`, `GetTrip` | GW | A26, A27 (gọi S6) |
| | `UpdateTripStatus` | GW | A28 (phát K5) |
| | `CancelTrip` | GW | A29 (phát K5 `CANCELED`) |
| | `GetTripForRating` | **rating** | **S7** |
| payment | `CreatePayment` | **booking** | **S4** |
| | `GetPayment` | GW | A30 |
| | `PayPayment` | GW | A31 |
| | `HandleProviderCallback` | GW | A32 (phát K6 nếu là kết quả mới). Cùng hàm mà adapter gọi nội bộ trong `PayPayment` và khi hoàn tiền |
| notification | `ListNotifications` | GW | A33 |
| rating | `CreateRating` | GW | A34 (gọi S7) |
| | `GetRatingByTrip`, `GetDriverRating` | GW | A35, A36 |

Tổng: **39 rpc nghiệp vụ** (auth 4, customer 3, driver 11, booking 7, trip 6, payment 4, notification 1, rating 3) + health. A39 dùng chung `SetAvailability` nên số rpc không đổi.

| Kiểm tra với file 02 | Kết quả |
|---|---|
| S2–S7 đều có rpc | `FindNearbyDrivers`, `ReserveDriver` / `ReleaseDriver`, `CreatePayment`, `CreateTrip`, `GetDriverSummary`, `GetTripForRating` |
| Không rpc nào đi **vào** booking, notification, auth, customer, rating từ service khác | Đúng |
| rpc không có đường REST | `ReserveDriver`, `ReleaseDriver`, `GetDriverSummary`, `CreateTrip`, `CreatePayment`, `GetTripForRating` |
| K1–K7 đều có thao tác phát | Như file 02 mục 6 |
| Đăng xuất | Không có rpc: Gateway tự xử lý với Redis [ĐC] |
| `GetTripByBooking` (Q35) | Chưa đưa vào; chờ spec mục 16 |

## 7. Truy vết ngược: yêu cầu nào chưa có API

| Yêu cầu | Tình trạng | Lý do |
|---|---|---|
| FR33 Báo cáo | Không có API | Ngoài 30 mục chấm (Q1) |
| FR31 Xử lý chuyến lỗi | Không có API | Chưa thiết kế (Q45) |
| FR30 Giám sát chuyến | A26, A27 với role admin | Ngoài phiếu chấm; làm sau |
| UC25 Quản lý phân quyền | Không có API | Ba role cố định [ĐC]; admin tạo bằng seed |
| Danh mục loại xe | Không có API | Ba mã cố định; không mục chấm nào cần (Q55) |
| Khóa / mở khóa tài khoản | Không có API | `accounts.status` chỉ đổi bằng seed |
| Đánh dấu thông báo đã đọc | Không có API | Không FR nào yêu cầu |

30/30 mục chấm có chuỗi kiểm tra ở mục 5.

## 8. Khác thiết kế tham chiếu và bản cũ

| Điểm | Trước | Ở đây | Vì sao |
|---|---|---|---|
| Mã | UUID (bản 2026-10-02) | Số nguyên; seed số nhỏ | ADR-015, luật thi |
| Tiền tố | `/api/v1` | Không có | Luật thi (Q59) |
| Tên field | `full_name`, `date_of_birth`, `vehicle_type`, `payment_method`, `identifier`, `provider_transaction_id`, `pickup {lat,lng,address}` | `name`, `dob`, `vehicle`, `pay`, `phone`/`email`, `txn_id`, `from: [lat, lng]` | Luật thi: body ngắn; tên trong database giữ nguyên (file 03) |
| Bật / tắt nhận chuyến | `PUT /drivers/me/availability` + body | `POST /drivers/me/online` (A17), `POST /drivers/me/offline` (A39) | Không body |
| Nộp hồ sơ tài xế | `POST /drivers/applications` | `POST /drivers/me` | Cùng kiểu với `/customers/me`; ngắn |
| Đăng ký tài xế | Không trả token | Trả token | Bớt một request ở mục 21 |
| `/customers/me` | Có ở `docs/study/01` | Có: `POST`, `GET`, `PUT`; giữ `GET /customers/{id}` cho mục 11 | C4, BRULE18 |
| `/driver-requests/{id}/accept` | Tên cũ | `/offers/{id}/accept` | Ngôn ngữ chung "Offer" |
| `/trips/{id}/payments` | Thanh toán gắn chuyến | `/payments/{id}/…` | Trả trước: thanh toán gắn booking (ADR-009) |
| `/operator/*` | Nhóm route riêng | Không có; phân biệt bằng role | Một vai trò `admin` [ĐC] |
| Refresh token | Tham chiếu có bảng | Không có | Không FR nào yêu cầu |

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn, chưa ai xác nhận

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| P1 | Đường dẫn, tên rpc, mã lỗi trong file này | Bảng mục 2, 6 |
| P2 | Tài xế thấy Offer bằng A23 (GĐ-2, Q5) | Bỏ A23; mục 15 chứng minh bằng thông báo |
| P3 | A14 cho mọi role xem phần công khai của tài xế | Ma trận dòng A14; mục 12 phải dùng token admin |
| P4 | Văn bản chứa `<`, `>` bị từ chối 400 | Mục 1.6; mục 26 |
| P5 | `/ready` trả 503 khi Redis dừng dù Gateway vẫn phục vụ | Mục 2.1 |
| P6 | Callback không bị rate limit; khóa trong header do `payment-service` kiểm tra | Mục 1.5, 2.6 |
| P7 | Không phải chủ trả 403 (không giả 404); A09 so mã trước khi đọc database | Mục 4 |
| P8 | `limit` tối đa 50; sai thì 400 | Mục 1.3 |
| P9 | Mục 18 dùng chuyến seed T5; mục 19 dùng B7 (`CAR_7`) | Mục 5 và seed |
| P10 | Tạo hồ sơ (`POST`, 409) và sửa hồ sơ (`PUT`, 404) là hai API | Gộp thành `PUT` upsert: mất đường lỗi "trùng" và "chưa có" |
| P11 | `simulate_result` nằm trong body A31 | Header riêng; khóa chống lặp phải tính cả header |
| P12 | Bỏ tiền tố `/api/v1` | Mọi đường dẫn, spec 00, 09-10, 11 |
| P13 | Tên field ngắn và giá trị mặc định ở mục 1.8; enum không phân biệt hoa thường | Mục 1.8, spec từng mục |
| P14 | Gateway đọc body là JSON bất kể `Content-Type` | Mục 1; spec 09-10 (đã khớp, 2026-10-03) |
| P15 | A08 trả token | Mục 21 thêm một request đăng nhập |
| P16 | Tách A17 / A39 thay vì một API có body | Gộp lại thành `PUT /drivers/me/availability` |
| P17 | Khóa chống lặp so body **đã chuẩn hóa** | File 03 mục 8.6 (đã khớp, 2026-10-03) |
| P18 | A12 không có tham số bán kính | Thêm `radius` nếu giảng viên muốn thử bán kính khác |

### 9.2 Câu hỏi còn mở (đánh số tiếp Q58)

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| Q51 | Chống XSS bằng cách nào? | (a) Từ chối `<`, `>`; (b) lưu nguyên, escape khi trả; (c) escape trước khi lưu | (a) | SV / GV |
| Q52 | Mục 24 ghi "POSTMAN", nhưng dữ liệu "at rest" chỉ thấy trong database. Chứng minh bằng gì? | (a) Postman + 2 lệnh `psql`; (b) API admin trả bản mã — không đề xuất | (a) | GV |
| Q53 | Mục 12 chạy với token nào? | (a) Mọi role xem phần công khai; (b) chỉ chính chủ và admin | (a) | GV |
| Q54 | Mục 18 chấm hủy Trip hay hủy Booking? | Cả hai có chuỗi | Hủy Trip là chính | GV |
| Q55 | Có cần API danh mục loại xe? | (a) Không; (b) `GET /vehicle-types` | (a) | SV |
| Q59 | Bỏ tiền tố `/api/v1` có bị trừ điểm "thiết kế API" không? | (a) Bỏ (ngắn); (b) giữ (chuẩn hơn, mỗi request thêm 7 ký tự) | (a) | GV |
| Q60 | Trong lúc thi, tab Postman đã gõ ở mục trước có được dùng lại (sửa rồi gửi) không? Mục 30 và ước lượng thời gian giả định **có** | (a) Có; (b) không — mục 30 ~45 s, mục 17 ~60 s | Hỏi trước buổi thi | GV |
| Q61 | 30 giây tính từ lúc gõ request đầu tiên hay gồm cả lúc giải thích? Mục 19 (~35–40 s), 21 (~35 s) vượt nếu tính cả gõ | (a) Chỉ thao tác; (b) cả giải thích | — | GV |
| Q62 | Token sống 3 600 giây (`JWT_TTL_SECONDS`). Buổi thi dài hơn một giờ thì phải đăng nhập lại | (a) Giữ, đăng nhập lại khi 401 `TOKEN_EXPIRED`; (b) tăng trong `.env.example` | (a) — mỗi lần chỉ một request sửa tab | SV |
| Q63 | Mục 17 có 5 request (FR12 có 4 bước). Có cần seed thêm một chuyến đang `IN_PROGRESS` để demo nhanh 2 request không? | (a) Không, chạy đủ chuỗi; (b) thêm seed T8 (file 03) | (a) — đủ chuỗi chứng minh "đúng trình tự" rõ hơn | SV |

Chưa kiểm tra được ở vòng thiết kế: thời gian thực của từng chuỗi khi gõ tay; số mét chính xác của tuyến P0 → D0 (≈ 2 026 m); độ trễ đặt xe → Offer và callback → `SEARCHING`.
