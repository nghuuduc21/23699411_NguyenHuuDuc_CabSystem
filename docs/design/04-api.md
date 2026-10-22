# 04 — API REST của Gateway

> Vòng 1 (chỉ BA), viết 2026-10-02. Đầu vào: `CLAUDE.md`, `srs.md` (FR01–FR42, BRULE01–18, UC01–UC33, AC01–AC29), file 01, file 02 (G1–G10, S2–S7, K1–K7), file 03, phiếu chấm 30 mục.
> Sửa 2026-10-03: hồ sơ khách tạo sau khi đăng nhập (ADR-013); callback xác thực bằng khóa bí mật trong header, OTP trả trong response khi giả lập (ADR-014); `simulate_result: "MANUAL"` (Q57). Lần 3 (luật thi gõ tay): mã số nguyên (ADR-015), tên trường ngắn và giá trị mặc định (mục 1.8), chuỗi request mỗi mục ≤ 3.
> **Sửa 2026-10-03 lần 4 (giảng viên trả lời Q59–Q61) — ADR-018:** đường dẫn theo chuẩn bài giảng **`/api/{version}/{resource}/{id}?{query-params}`**; **không động từ trong đường dẫn**, đổi trạng thái bằng `PATCH` + `status`; tìm kiếm, lọc bằng query; chỉ dùng **GET, POST, PATCH**. **Giữ nguyên mã A01–A39** (mã = một thao tác nghiệp vụ = một rpc; nhiều mã có thể chung một đường dẫn — mục 1.10). Không đổi proto, rpc. Chuỗi request mục 5 viết lại: được dùng lại tab, 30 giây gồm cả giải thích. Đóng Q59, Q60, Q61.
> **Sửa 2026-10-05 (sinh viên chốt):** A04 không nhận `email`, A05 chỉ nhận `phone` (ADR-019); A37, A10 nhận `email` tùy chọn, A09, A38 trả `email`; A11 dùng cho cả **nộp lại** hồ sơ bị từ chối → 200 (FR43); **không thêm API `/me` mới** — khách, tài xế xem hồ sơ bằng mã của mình (`account_id` trong response đăng nhập), người khác → 403; giữ các route `/me` đã có. Bỏ mã lỗi `EMAIL_ALREADY_EXISTS`.
> **Sửa 2026-10-14 (theo yêu cầu giảng viên, sinh viên chốt) — ADR-021 thay ADR-019:** (1) health trả đúng chữ `healthy` / `ready` / `not_ready` / `unhealthy` (A01–A03); (2) nhóm xác thực `/api/v1/auth/…`: A04 `auth/register` `{"email","password"}`, A05 `auth/login` với **đúng một** trong `email` / `phone`, A07 `auth/otp`, A08 `auth/driver-register`; admin seed `admin@cab.vn`; (3) hồ sơ khách: bỏ `email`, thêm `phone` bắt buộc (A37, A10, A09, A38); (4) A14 chỉ admin (mọi mã) và tài xế (mã của mình, khác → 403 `NOT_OWNER`); khách → 403 `FORBIDDEN`; (5) A20 thành `GET /api/v1/customers/{id}/bookings` (khách chỉ mã của mình, admin mọi mã; bỏ `GET /api/v1/bookings`); (6) mục 27 demo bằng jwt.io (ADR-016); (7) rate limit theo IP cho bốn route công khai mới. Mã lỗi: thêm lại `EMAIL_ALREADY_EXISTS`; `INVALID_EMAIL` về auth; `INVALID_PHONE` thêm ở customer. Chuỗi gõ tay mục 6, 9, 10, 11, 12, 13, 14, 21, 24, 25, 27, 29 viết lại (mục 5). Tổng vẫn **39 mã API**, nay trên **32 đường dẫn**.
> **Sửa 2026-10-21 (sinh viên chốt, M1 / L1 của báo cáo 2026-10-21):** A27 trả khối `driver` `{driver_id, name, plate}` lấy từ **bản chụp trong chuyến lúc nhận** (S3 → S5), không qua S6 (S6 bỏ, rpc `GetDriverSummary` bỏ); bỏ `lat`, `lng`, `driver_info_available`. Tổng còn **38 rpc nghiệp vụ**. Lời gọi gRPC bật `waitForReady` (spec 00): 503 khi service dừng đến sau tối đa hết deadline.
> File này trả lời: **client gọi gì, ai được gọi, service nào xử lý, mỗi mục chấm gõ những request nào**. Chi tiết từng field và `.proto`: spec của từng mục chấm. Kịch bản học thuộc: file 06.
> Ký hiệu: **[ĐC]** = đã chốt trong `CLAUDE.md` / `srs.md` / giảng viên. **[BA]** = BA tự chọn, chưa ai xác nhận (gom ở mục 9).

## 1. Quy ước chung

| Điểm | Quy ước | Nguồn / lý do |
|---|---|---|
| Địa chỉ | `http://localhost:3000` — cổng duy nhất cho nghiệp vụ. Postman tự thêm `http://` nên gõ `localhost:3000/...` cũng được | Mục chấm 8 |
| Cấu trúc đường dẫn | **`/api/v1/{resource}/{id}?{query-params}`** [ĐC GV 2026-10-03]. Ví dụ `GET localhost:3000/api/v1/customers/1`, `GET localhost:3000/api/v1/drivers?lat=10.82&lng=106.68&page=1&limit=2` | Chuẩn bài giảng; giảng viên: bỏ `/api/v1` gây ấn tượng xấu. `v1` cho phép sau này thêm `v2` mà client cũ không gãy |
| Ngoài tiền tố | Chỉ `/health`, `/ready`, `/health/services` | Không phải tài nguyên nghiệp vụ: là trạng thái của tiến trình Gateway; Docker healthcheck và công cụ giám sát gọi đường cố định, không đổi theo phiên bản API |
| Quy tắc đặt tên | Mục 1.9 | |
| Định dạng | JSON, tên field `snake_case`, ngắn (mục 1.8). Gateway đọc body là JSON **bất kể `Content-Type`** [BA] | Luật thi: bớt một chỗ dễ sai. Không mở lỗ CSRF vì token đi trong header `Authorization`, không dùng cookie |
| Token | Header `Authorization: Bearer <JWT>` — trên Postman: tab **Authorization → Bearer Token → dán token**. JWT HS256 mang `sub` (= `account_id` dạng chuỗi, ví dụ `"1"`), `role`, `jti`, `exp` | NFR06; ADR-016; `jti` để thu hồi khi đăng xuất (FR42) |
| ID | **Số nguyên dương** (`^[1-9][0-9]{0,15}$`). Sai (gồm `abc`, `1 OR 1=1`) → **400 `INVALID_ID`** ngay ở Gateway. Mã seed số nhỏ (khách 1–9, tài xế 11–18, admin 99, booking = payment = trip 1–7); mã do API tạo bắt đầu từ **1000** | ADR-015; file 03 mục 2, 14; mục 25 |
| Thời điểm | ISO 8601 UTC, ví dụ `2026-10-03T03:15:00Z` | File 03 mục 2 |
| Tiền, quãng đường | Số nguyên: đồng; mét | File 03 mục 2 |
| Thành công | 200 (đọc, sửa, đổi trạng thái), 201 (tạo mới). Một đối tượng thì trả thẳng đối tượng; danh sách theo mục 1.3 | |
| Đổi trạng thái | Response **luôn có trạng thái mới** của đối tượng bị đổi (và đối tượng liên quan nếu đổi trong cùng request) | Luật thi: không cần gọi thêm request để kiểm tra |
| Lỗi | `{ "error": "MA_LOI" }`, không stack trace | `CLAUDE.md` |
| Thứ tự kiểm tra | **Route công khai:** 429 (đếm theo IP) → 400 → service. **Route có token:** 401 (xác thực token) → 429 (đếm theo `account_id`) → 403 (role của **đường dẫn**) → 400 (hình thức, gồm chọn biến thể — mục 1.10) → 403 (role của **biến thể**) → service: 404 → 403 (không phải chủ) → 409 → 400 (nghiệp vụ). Sửa 2026-10-05 (GH-Q2, spec 20-29 GH-M1) | Lỗi rẻ nhất trả trước. Route có token đếm **sau** khi xác thực vì `account_id` chỉ đáng tin khi chữ ký đúng: đọc `sub` từ token chưa kiểm thì kẻ xấu ghi `sub` của người khác để làm người đó bị chặn. Request sai token không bị đếm (kiểm HS256 tại chỗ, rẻ — GH-Q4). Hệ quả dùng ở mục 28: sai role thì 403 **dù body rỗng** |
| Header bảo vệ | Mọi response: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`, `X-Request-Id` | Mục chấm 26, NFR08, NFR10 |
| Field lạ trong body | 400 `INVALID_INPUT` | Chặn client tự gửi `role`, `customer_id`… |
| Body của `GET` | **Bỏ qua** (không kiểm tra, không chuyển cho service) [BA] | Khi sửa tab từ `POST` / `PATCH` sang `GET`, Postman vẫn gửi body cũ; không bắt người thi phải xóa body |

### 1.1 Đổi gRPC status sang HTTP [ĐC]

| gRPC status | HTTP | Khi nào | Ví dụ mã lỗi |
|---|---|---|---|
| `OK` | 200 / 201 | | |
| `INVALID_ARGUMENT` | 400 | Thiếu trường, sai kiểu, sai giá trị | `INVALID_INPUT`, `INVALID_PHONE` (auth: số tài xế; customer: số hồ sơ — 2026-10-14), `INVALID_EMAIL` (auth — 2026-10-14), `INVALID_PASSWORD`, `INVALID_COORDINATES`, `INVALID_PAGINATION`, `TEXT_CONTAINS_HTML`, `OTP_INVALID`, `OTP_EXPIRED`, `REASON_REQUIRED`, `SAME_PICKUP_AND_DESTINATION` |
| `UNAUTHENTICATED` | 401 | Sai thông tin đăng nhập; khóa callback sai / thiếu | `INVALID_CREDENTIALS`, `INVALID_CALLBACK_SECRET` |
| `PERMISSION_DENIED` | 403 | Không phải chủ dữ liệu; tài khoản bị khóa | `NOT_OWNER`, `ACCOUNT_LOCKED` |
| `NOT_FOUND` | 404 | Không có đối tượng | `CUSTOMER_NOT_FOUND`, `DRIVER_NOT_FOUND`, `BOOKING_NOT_FOUND`, `TRIP_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `OFFER_NOT_FOUND`, `RATING_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
| `ALREADY_EXISTS` | 409 | Trùng | `EMAIL_ALREADY_EXISTS` (A04 — thêm lại 2026-10-14), `PHONE_ALREADY_EXISTS` (A07, A08), `CUSTOMER_ALREADY_EXISTS`, `DRIVER_ALREADY_EXISTS`, `LICENSE_PLATE_ALREADY_EXISTS`, `RATING_ALREADY_EXISTS` |
| `FAILED_PRECONDITION` | 409 | Đúng dữ liệu nhưng sai thời điểm / sai trạng thái | `INVALID_STATUS_TRANSITION`, `BOOKING_NOT_CANCELABLE`, `BOOKING_ALREADY_ASSIGNED`, `TRIP_NOT_CANCELABLE`, `TRIP_NOT_COMPLETED`, `OFFER_EXPIRED`, `DRIVER_NOT_APPROVED`, `DRIVER_NOT_AVAILABLE`, `APPLICATION_ALREADY_REVIEWED`, `PAYMENT_ALREADY_COMPLETED`, `PAYMENT_IN_PROGRESS`, `PAYMENT_EXPIRED`, `PAYMENT_ATTEMPTS_EXHAUSTED`, `PAYMENT_CANCELED` (thanh toán đã hủy vì booking hủy / không có tài xế / chuyến hủy — spec 14-15-16-19-30 DX11), `PAYMENT_NOT_ONLINE`, `IDEMPOTENCY_KEY_REUSED` |
| Còn lại (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, …) | 503 | Service không chạy, quá deadline, lỗi không lường trước | `SERVICE_UNAVAILABLE` |

Lỗi do **Gateway tự trả**, không qua gRPC:

| HTTP | Mã lỗi | Khi nào |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_ID`, `INVALID_JSON`, `INVALID_PAGINATION`, `IDEMPOTENCY_KEY_REQUIRED` | Kiểm tra hình thức trước khi gọi service; gồm thiếu / sai giá trị `status`, `approval_status` ở route có biến thể (mục 1.10) |
| 401 | `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` | Mục chấm 27; FR42 |
| 403 | `FORBIDDEN` | Role trong token không nằm trong danh sách của route / biến thể (mục chấm 28) |
| 404 | `ROUTE_NOT_FOUND` | Đường dẫn không tồn tại (gồm đường dẫn cũ thiếu `/api/v1`) |
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
| Tham số | Query `page` (≥ 1, mặc định 1); `limit` (1…50, mặc định 10) |
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
| "Cùng nội dung" so thế nào | So SHA-256 của body **đã chuẩn hóa** (đọc JSON rồi viết lại, khóa theo thứ tự chữ cái; body rỗng = `{}`) [BA] |
| Cùng khóa, khác nội dung | 409 `IDEMPOTENCY_KEY_REUSED` |
| Thứ tự kiểm tra | Tra khóa **trước** mọi kiểm tra trạng thái: gặp lại khóa thì trả response lần đầu dù Payment đã đổi. Trạng thái hiện tại xem bằng A30 |
| Callback (A32) | Không dùng header này. Chống lặp theo `txn_id` (`provider_transaction_id`): gửi lại trả đúng response cũ kèm `Idempotency-Replayed: true`, không đổi trạng thái, không phát lại K6 |
| Gateway làm gì | Chỉ chuyển header vào metadata. Việc nhớ và trả lại response do `payment-service` làm |

### 1.5 Rate limit (mục chấm 29)

| Điểm | Quy ước |
|---|---|
| Route công khai (A04 `auth/register`, A05 `auth/login`, A07 `auth/otp`, A08 `auth/driver-register` — đường dẫn đổi 2026-10-14) | Đếm theo **IP**, **một bộ đếm chung** cho cả bốn; `RATE_LIMIT_PUBLIC_MAX` = **5** mỗi `RATE_LIMIT_WINDOW_SECONDS` = **10** giây (`.env.example`) |
| Route có token | Đếm theo **`account_id`**; `RATE_LIMIT_ACCOUNT_MAX` = **30** mỗi 10 giây |
| Không giới hạn | A01–A03 (health), A32 (callback — xác thực bằng khóa; Provider gửi nhiều callback từ một IP là bình thường) |
| Cửa sổ | Cố định, **bắt đầu từ request đầu tiên** của client (key Redis tạo kèm hạn ở request đầu; request sau không kéo dài hạn) — file 03 mục 12, GH-Q1. Bấm Send 6 lần liên tục thì lần 6 luôn 429 |
| Thứ tự | Route công khai: đếm trước mọi kiểm tra. Route có token: xác thực token trước, rồi mới đếm (401 trước 429) — mục 1 |
| Header | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (giây) |
| Vượt ngưỡng | 429 `{ "error": "RATE_LIMITED" }` + `Retry-After: <giây>` (NFR17) |
| IP lấy ở đâu | Địa chỉ kết nối TCP; không tin `X-Forwarded-For` (không có proxy trước Gateway) |
| Redis dừng [ĐC] | Cho qua, ghi log cảnh báo; không có header `RateLimit-*` |

Sửa tab rồi gửi mất ≥ 3 giây mỗi request nên mục 9 + 10 (5 request công khai) không chạm ngưỡng; bấm Send liên tục thì chạm ở lần thứ 6.

### 1.6 Văn bản do người dùng nhập (mục chấm 26) [BA]

Field văn bản tự do: `name`, `from_address`, `to_address`, `reason`, `comment`, `plate`, `brand`, `model`, `color`. `email` (A04, A05) và `phone` (A05, A07, A08, A37, A10) **không** thuộc nhóm này: có định dạng cố định, biểu thức kiểm tra đã loại `<`, `>` → 400 `INVALID_EMAIL` / `INVALID_PHONE`.

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
| A04 đăng ký khách | `email`, `password` | Có | — | Không có field nào khác; gửi `phone` → 400 `INVALID_INPUT` như field lạ (sửa 2026-10-14, ADR-021) |
| A05 đăng nhập | **Đúng một** trong `email` / `phone`, cộng `password` | Có | — | Khách, admin gửi `email`; tài xế gửi `phone`. Thiếu cả hai hoặc có cả hai → 400 `INVALID_INPUT`. Khách: cùng body với A04 nên mục 9 chỉ sửa URL |
| A07 xin OTP | `phone` | Có | — | Đường dẫn `auth/otp` (2026-10-14) |
| A08 đăng ký tài xế | `phone`, `otp`, `password` | Có | — | Đường dẫn `auth/driver-register` (2026-10-14). Response có luôn `token` |
| A37 / A10 hồ sơ khách | `name`, `phone` | Có cả hai (A37) | — | `dob` (`YYYY-MM-DD`) tùy chọn. A10 gửi ít nhất một trong `name`, `phone`, `dob`; `phone: null` → 400 (không xóa được); `dob: null` = xóa ngày sinh. Bỏ `email` (2026-10-14): gửi `email` → 400 `INVALID_INPUT` |
| A11 nộp / nộp lại hồ sơ tài xế | `name`, `license`, `plate` | Có | `vehicle` = **`CAR_4`** | `brand`, `model`, `color` tùy chọn. Nộp lại (hồ sơ `REJECTED`) gửi **cùng body** như lần đầu |
| A17 / A39 bật / tắt | `status` = `ONLINE` / `OFFLINE` | Có | — | A17 nhận thêm `lat`, `lng` tùy chọn; bắt buộc nếu tài xế chưa từng có vị trí |
| A18 vị trí | `lat`, `lng` | Có | — | Không có `status` |
| A15 / A16 duyệt hồ sơ | `approval_status` = `APPROVED` / `REJECTED` | Có | — | A16 bắt buộc `reason` (FR36) |
| A19 đặt xe | `from`, `to` = `[vĩ độ, kinh độ]` | Có | `vehicle` = **`CAR_4`**; `pay` = **`CASH`** | `from_address`, `to_address` tùy chọn. Thứ tự `[lat, lng]` giống Google Maps |
| A12 tìm tài xế | Query `lat`, `lng` | Có | `vehicle` = mọi loại; `page` = 1; `limit` = 10 | Bán kính là hằng số 1 000 m (FR02, file 03 mục 13) |
| A22 hủy booking; A29 hủy chuyến | `status` = `CANCELED`, `reason` | Có | — | Thiếu `reason` → 400 `REASON_REQUIRED` (FR36) |
| A24 / A25 trả lời lời mời | `status` = `ACCEPTED` / `REJECTED` | Có | — | |
| A28 trạng thái chuyến | `status` ∈ `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED` | Có | — | |
| A31 thanh toán | — | — | `simulate_result` = **`SUCCESS`** | Body có thể rỗng; header `Idempotency-Key` bắt buộc |
| A32 callback | `txn_id` | Có | `result` = **`SUCCESS`** | `amount` tùy chọn; khác số tiền giao dịch → 400 |
| A34 đánh giá | `trip_id`, `score` (1–5) | Có | — | `comment` tùy chọn |

Giá trị liệt kê (`CAR_4`, `ONLINE`, `ARRIVED`, `MANUAL`…) **không phân biệt hoa thường**: Gateway đổi sang chữ hoa trước khi kiểm tra.

Vì sao mặc định `CAR_4` và `CASH`: là lựa chọn phổ biến nhất, và là tổ hợp đi thẳng sang tìm tài xế (không chờ thanh toán) — đúng chuỗi mục 15. Đánh đổi: khách quên chọn loại xe vẫn đặt được, nên response luôn ghi rõ `vehicle`, `pay`, `fare`.

Tài xế có **hai trạng thái độc lập** (file 03 mục 5.2): `status` ở API = cột `availability` (`ONLINE`, `OFFLINE`, `BUSY` — tài xế tự đổi); `approval_status` = trạng thái duyệt hồ sơ (admin đổi). Tên field API ngắn, tên cột database giữ nguyên — như `name` ↔ `full_name_enc`.

### 1.9 Quy tắc đặt đường dẫn (học thuộc) [ĐC GV 2026-10-03, ADR-018]

| # | Quy tắc | Ví dụ |
|---|---|---|
| R1 | Mọi API nghiệp vụ nằm dưới `/api/v1/` | `/api/v1/bookings` |
| R2 | Tài nguyên là **danh từ số nhiều**, chữ thường, nối bằng `-` | `customers`, `drivers`, `offers`, `payment-callbacks`. Tài nguyên con của một phần tử: `/{resource}/{id}/{sub-resource}` — `customers/1/bookings` (2026-10-14), `payments/7/transactions` |
| R3 | **Method nói việc làm**, đường dẫn chỉ nói tài nguyên. Chỉ dùng ba method: `GET` đọc, `POST` tạo mới, `PATCH` sửa một phần | `POST /api/v1/bookings` = đặt xe |
| R4 | **Đổi trạng thái** = `PATCH /api/v1/{resource}/{id}` với body `{"status": "<trạng thái mới>"}` (kèm `reason` khi hủy) | `PATCH /api/v1/trips/1000` `{"status":"ARRIVED"}` |
| R5 | Tìm kiếm, lọc, phân trang = **query params** | `GET /api/v1/drivers?lat=10.82&lng=106.68&limit=2` |
| R6 | `me` = "mã của người trong token", dùng thay `{id}` cho API "của tôi". **Không thêm route `/me` mới** (sinh viên chốt 2026-10-05): xem hồ sơ của mình thì dùng `/{resource}/{id}` với mã = `account_id` trả về khi đăng nhập; mã người khác → 403. Giữ các route `/me` đã có (A38, A10, A17, A39, A18) | `GET /api/v1/customers/me` (có sẵn); `GET /api/v1/drivers/11` (tài xế 11 xem chính mình) |
| R7 | Một "lần làm" có lưu lại (lần thanh toán, lần callback, mã OTP) là **tài nguyên được tạo** → `POST` | `POST /api/v1/payments/7/transactions` |

**Ngoại lệ có chủ đích** (chỉ hai nhóm — sửa 2026-10-14 theo yêu cầu giảng viên):

| Đường dẫn | Vì sao giữ | Cách "chuẩn" đã cân nhắc | Vì sao không chọn |
|---|---|---|---|
| **Nhóm `/api/v1/auth/…`**: `register` (A04), `login` (A05), `logout` (A06), `otp` (A07), `driver-register` (A08) | Giảng viên yêu cầu gom mọi thao tác xác thực vào một nhóm (2026-10-14). Quy ước phổ biến mà người chấm nhận ra ngay; một tiền tố dễ nhớ; cả nhóm là route công khai cùng một bộ đếm rate limit theo IP (trừ `logout`) | Tài nguyên danh từ: `POST /api/v1/accounts`, `/otps`, `/driver-accounts`, `/tokens` (bản 2026-10-03) | Giảng viên đã chọn nhóm `auth`; tên danh từ phải giải thích thêm ("token là tài nguyên") |
| `/health`, `/ready`, `/health/services` | Ngoài tiền tố `/api/v1` (mục 1) | `/api/v1/health` | Không phải tài nguyên nghiệp vụ; healthcheck của Docker gọi `/health` cố định |

`me` không phải động từ mà là bí danh của một mã; `auth` là tên nhóm. Mọi đường dẫn **ngoài nhóm `auth`** không có động từ.

### 1.10 Một đường dẫn, nhiều mã API (biến thể) [BA]

Mã API = **một thao tác nghiệp vụ = một rpc**. Khi gộp hành động thành `PATCH` + `status`, nhiều mã dùng chung một đường dẫn; Gateway chọn rpc bằng **bảng tra cố định** theo một field:

| Đường dẫn | Gateway chọn theo | Mã → rpc | Role |
|---|---|---|---|
| `GET /api/v1/drivers` | Query có `lat` hoặc `lng`? | Có → **A12** `FindNearbyDrivers`; không → **A13** `ListDrivers` | A12: customer, admin. A13: admin |
| `PATCH /api/v1/drivers/me` | Body có `status`? | `ONLINE` → **A17**, `OFFLINE` → **A39** (`SetAvailability`); chỉ `lat`, `lng` → **A18** `UpdateLocation` | driver |
| `PATCH /api/v1/drivers/{id}` | `approval_status` | `APPROVED` → **A15** `ApproveDriver`; `REJECTED` → **A16** `RejectDriver` | admin |
| `PATCH /api/v1/offers/{id}` | `status` | `ACCEPTED` → **A24** `AcceptOffer`; `REJECTED` → **A25** `RejectOffer` | driver |
| `PATCH /api/v1/trips/{id}` | `status` | `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED` → **A28** `UpdateTripStatus`; `CANCELED` → **A29** `CancelTrip` | A28: driver. A29: customer, driver |
| `GET /api/v1/ratings` | Query `trip_id` hay `driver_id` (đúng một) | `trip_id` → **A35** `GetRatingByTrip`; `driver_id` → **A36** `GetDriverRating` | Cả ba |

| Điểm | Quy định |
|---|---|
| Giá trị lạ / thiếu field chọn biến thể | 400 `INVALID_INPUT` (ví dụ `{"status":"BUSY"}` ở `drivers/me`, `{"status":"ACCEPTED"}` ở `trips/{id}`: client không được tự đặt trạng thái đó) |
| Role | Role của đường dẫn (hợp các biến thể) kiểm tra **trước** khi đọc body; role của biến thể kiểm tra **sau** khi chọn. Ví dụ khách gửi `PATCH /api/v1/trips/5` `{"status":"ARRIVED"}` → 403 `FORBIDDEN` |
| Vì sao không gộp rpc | Mỗi rpc giữ một quy tắc nghiệp vụ riêng (hủy chuyến ≠ tiến trạng thái: khác người được làm, khác điều kiện, khác event). Gateway chỉ **tra bảng** như tra route — không quyết định nghiệp vụ, nên vẫn đúng "Gateway không chứa logic nghiệp vụ". Proto không đổi |
| Đánh đổi | Gateway phải đọc một field của body / query trước khi chọn rpc; bảng route có thêm một cột. Đổi lại client chỉ nhớ một đường dẫn cho mỗi tài nguyên |

## 2. Bảng API

Cột **Role**: role Gateway cho qua ("—" = công khai); "(chủ)" = service còn kiểm tra chủ dữ liệu (mục 4). Tổng: **39 mã API trên 32 đường dẫn** (mã giữ nguyên từ lần 3; không đánh số lại để spec, file 05, ADR không phải đổi mã).

### 2.1 Gateway và tài khoản

| Mã | Method, đường dẫn | Body / query | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A01 | `GET /health` | — | — | Gateway tự trả | 6 | — |
| A02 | `GET /ready` | — | — | Gateway: Redis + kênh gRPC | 6 | — |
| A03 | `GET /health/services` | — | — | 8 service — `grpc.health.v1.Health/Check` (G9) | 6 | NFR15 |
| A04 | `POST /api/v1/auth/register` | `{"email","password"}` | — | auth — `RegisterCustomer` | 9 | FR26 / UC01, AC27 |
| A05 | `POST /api/v1/auth/login` | `{"email","password"}` (khách, admin) hoặc `{"phone","password"}` (tài xế) | — | auth — `Login` | 10, 25, 29 | FR26, BRULE19 / UC02, AC32 |
| A06 | `POST /api/v1/auth/logout` | — | Cả ba | **Gateway + Redis**, không gọi service | 27 (mở rộng) | FR42 / UC33 |
| A07 | `POST /api/v1/auth/otp` | `{"phone"}` | — | auth — `RequestDriverOtp` | 21 | FR39 / UC29 |
| A08 | `POST /api/v1/auth/driver-register` | `{"phone","otp","password"}` | — | auth — `RegisterDriver` | 21 | FR39, FR26 / UC29 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A01–A03 | Ngoài `/api/v1`: trạng thái tiến trình, không phải tài nguyên (mục 1.9). Chữ trả về chốt **theo yêu cầu giảng viên 2026-10-14** | 200 `{ "status": "healthy" }`; 200 `{ "status": "ready", "checks": { "redis": "healthy", "grpc_clients": "healthy" } }` (Redis dừng → 503 `{ "status": "not_ready", "checks": { "redis": "unhealthy", … } }`); 200 `{ "status": "healthy", "services": { "auth-service": "healthy", … 8 dòng } }` (có service hỏng → 503 `{ "status": "unhealthy", "services": { …, "rating-service": "unhealthy" } }`) |
| A04 | Nhóm `auth` (mục 1.9, theo yêu cầu giảng viên 2026-10-14). Role do server đặt (`customer`), client không gửi | `{"email":"new1@cab.vn","password":"12345678"}` → 201 `{ "account_id": 1000, "role": "customer" }` — chỉ tài khoản, chưa có hồ sơ (ADR-013) |
| A05 | Nhóm `auth`. Một API cho cả ba role; định danh theo role (BRULE19) | `{"email":"kh1@cab.vn","password":"12345678"}` → 200 `{ "token": "eyJ…", "account_id": 1, "role": "customer", "expires_in": 3600 }`; `{"phone":"0910000001","password":"12345678"}` → 200 `role` `driver`, `account_id` 11 |
| A06 | Nhóm `auth` | — → 200 `{ "status": "LOGGED_OUT" }` |
| A07 | Nhóm `auth`. Vẫn tạo một dòng OTP có hạn, lưu bản băm ở `otp_verifications` (file 03 mục 3.2) → 201 | `{"phone":"0911111111"}` → 201 `{ "phone": "0911111111", "expires_in": 300, "otp": "482915" }` — `otp` chỉ có khi `SIMULATION_MODE=true` (ADR-014) |
| A08 | Nhóm `auth`. Đường riêng vì luật tạo khác (phải có OTP, role `driver`); A04 công khai chỉ tạo `customer` [ĐC "Đăng ký"]; client không tự chọn role | `{"phone":"0911111111","otp":"482915","password":"12345678"}` → 201 `{ "account_id": 1001, "role": "driver", "token": "eyJ…", "expires_in": 3600 }` |

Ghi chú:

- A05: **đúng một** trong `email` / `phone`; thiếu cả hai hoặc có cả hai → 400 `INVALID_INPUT` (Gateway). Sai mật khẩu, định danh chưa đăng ký, hoặc dùng sai loại định danh cho role (ví dụ tài xế gửi `email` — tài xế không có email) trả **cùng** 401 `INVALID_CREDENTIALS`. Mật khẩu đúng nhưng `LOCKED` → 403 `ACCOUNT_LOCKED`.
- **SQL injection ở A05 (mục 25) — chốt 400:** `email` sai định dạng (gồm `' OR 1=1 --`) → **400 `INVALID_EMAIL`**; `phone` sai định dạng → 400 `INVALID_PHONE`. Vì sao 400 chứ không 401: chuỗi không phải một email hợp lệ thì bị chặn **trước khi chạm database** — người chấm thấy rõ "đầu vào bị từ chối ở cửa", và mã lỗi nói đúng lý do (sai định dạng) thay vì giả vờ là sai mật khẩu. Lớp thứ hai là SQL tham số `$1`: chứng minh bằng chuỗi injection ở `password` (định dạng tự do) → 401 `INVALID_CREDENTIALS`.
- A04 gửi `phone` (hoặc field lạ khác) → 400 `INVALID_INPUT`. A04 email sai định dạng → 400 `INVALID_EMAIL`; email đã có → 409 **`EMAIL_ALREADY_EXISTS`** (so sau khi đổi chữ thường: `KH1@cab.vn` trùng `kh1@cab.vn`).
- A07, A08 số đã có tài khoản → 409 `PHONE_ALREADY_EXISTS`. A08 OTP sai → 400 `OTP_INVALID`; hết hạn → 400 `OTP_EXPIRED`.
- A08 trả luôn `token` [BA]: OTP vừa chứng minh người gọi giữ số điện thoại, bớt một request ở mục 21. A04 **không** trả token: mục 9 phải thấy "đăng ký xong **đăng nhập được**".
- Đường dẫn cũ `POST /api/v1/accounts`, `/otps`, `/driver-accounts` → 404 `ROUTE_NOT_FOUND`.

Ba endpoint health (chữ trả về chốt theo yêu cầu giảng viên 2026-10-14):

| Endpoint | Trả lời câu hỏi | 200 khi | 503 khi |
|---|---|---|---|
| `/health` | Gateway còn sống không? | Tiến trình chạy → `{"status":"healthy"}` | — |
| `/ready` | Gateway đủ phụ thuộc của **chính nó** chưa? | Redis trả lời, đã tạo 8 kênh gRPC → `{"status":"ready","checks":{…}}` | Redis không trả lời → `{"status":"not_ready","checks":{"redis":"unhealthy",…}}` [BA: Gateway vẫn phục vụ request] |
| `/health/services` | Tám service phía sau thế nào? | Cả 8 `healthy` → `{"status":"healthy","services":{…8 dòng}}` | Có service không trả lời **hoặc** trả `NOT_SERVING` → `{"status":"unhealthy","services":{…,"rating-service":"unhealthy"}}` |

Giá trị mỗi service chỉ còn hai chữ `healthy` / `unhealthy` (trước đây `SERVING` / `NOT_SERVING` / `UNREACHABLE`): Gateway đổi `SERVING` → `healthy`, mọi trường hợp khác → `unhealthy`; lý do chi tiết (mất database hay không kết nối được) ghi vào log Gateway, không trả ra ngoài.

### 2.2 Khách hàng

| Mã | Method, đường dẫn | Body / query | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A37 | `POST /api/v1/customers` | `{"name","phone"}` (+ `dob`) | customer | customer — `CreateCustomer` | 11 (phụ), 26 | FR27, BRULE18 / UC03, AC28 |
| A38 | `GET /api/v1/customers/me` | — | customer | customer — `GetCustomer` (mã = `sub`) | 26, 27 | FR27 / UC03, AC28 |
| A09 | `GET /api/v1/customers/{id}` | — | customer (chủ), admin | customer — `GetCustomer` | **11**, 24, 25 | FR27 / UC03, UC19, AC29 |
| A10 | `PATCH /api/v1/customers/me` | Ít nhất một trong `name`, `phone`, `dob` | customer | customer — `UpdateCustomer` | 26 | FR27, BRULE18 / UC03, AC29 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A37 | Tạo hồ sơ = `POST` vào tập `customers`. Không gửi mã: `customer_id` = `account_id` trong token (C4), nên khách không tạo hộ người khác | `{"name":"Pham Duc","phone":"0901234567"}` → 201 `{ "customer_id": 1000, "name": "Pham Duc", "phone": "0901234567", "dob": null }` (sửa 2026-10-14: `phone` bắt buộc, bỏ `email`) |
| A38 | `me` = mã trong token (R6): khách không cần nhớ mã của mình | — → 200 `{ "customer_id": 1, "name": "Nguyễn Văn An", "phone": "0900000001", "dob": "2000-01-01" }` |
| A09 | Đúng mẫu `/{resource}/{id}` của phiếu chấm "xem theo mã số". Cách khách xem hồ sơ của mình được khuyến nghị khi thi: mã = `account_id` trong response đăng nhập | — → 200 như A38 |
| A10 | `PATCH` vì **sửa một phần** (field vắng giữ nguyên); đổi từ `PUT` (đóng HS-Q4). Không có `PATCH /api/v1/customers/{id}`: chỉ chủ được sửa (BRULE18) | `{"name":"An Nguyen"}` → 200 hồ sơ sau khi sửa |

Ghi chú:

- A37 đã có hồ sơ → 409 `CUSTOMER_ALREADY_EXISTS`. A38, A10 chưa có hồ sơ → 404 `CUSTOMER_NOT_FOUND`. A10 body rỗng → 400.
- A37 thiếu `phone` → 400 `INVALID_INPUT`. A37, A10 `phone` sai định dạng (không chuẩn hóa được về `0` + 9 chữ số) → 400 `INVALID_PHONE`; không phải chuỗi, hoặc `null` → 400 `INVALID_INPUT` (không xóa được). Số **không** UNIQUE: hai khách cùng số đều 201 (ADR-021). Gửi `email` → 400 `INVALID_INPUT` (field lạ — email nằm ở tài khoản).
- A09: khách gọi mã **khác mã của mình** → **403 `NOT_OWNER` ngay**, không tra database. Đúng mã của mình mà chưa có hồ sơ → 404. Admin: 200 hoặc 404.
- Đường dẫn tĩnh (`/api/v1/customers/me`, `/api/v1/drivers/me`) được so khớp **trước** đường dẫn có mã.

### 2.3 Tài xế

| Mã | Method, đường dẫn | Body / query | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A11 | `POST /api/v1/drivers` | `{"name","license","plate"}` (+ `vehicle`, `brand`, `model`, `color`) | driver | driver — `SubmitApplication` | 21, 22 (nộp lại) | FR39, FR43, FR28, FR29 / UC29 |
| A12 | `GET /api/v1/drivers?lat&lng&vehicle&page&limit` | Query | customer, admin | driver — `FindNearbyDrivers` | **13** | FR02–FR05 / UC06 |
| A13 | `GET /api/v1/drivers?approval_status&page&limit` | Query | admin | driver — `ListDrivers` | 22 (bổ trợ) | FR28, FR39 / UC20, UC30 |
| A14 | `GET /api/v1/drivers/{id}` | — | driver (chủ), admin (sửa 2026-10-14) | driver — `GetDriver` | **12** | FR28, FR29 / UC20, UC21, AC31 |
| A15 | `PATCH /api/v1/drivers/{id}` | `{"approval_status":"APPROVED"}` | admin | driver — `ApproveDriver` | **22**, 28 | FR39 / UC30 |
| A16 | `PATCH /api/v1/drivers/{id}` | `{"approval_status":"REJECTED","reason":"…"}` | admin | driver — `RejectDriver` | 22 | FR39 / UC30 |
| A17 | `PATCH /api/v1/drivers/me` | `{"status":"ONLINE"}` (+ `lat`, `lng`) | driver | driver — `SetAvailability` | **23** | FR38 / UC28 |
| A39 | `PATCH /api/v1/drivers/me` | `{"status":"OFFLINE"}` | driver | driver — `SetAvailability` | **23** | FR38 / UC28 |
| A18 | `PATCH /api/v1/drivers/me` | `{"lat","lng"}` | driver | driver — `UpdateLocation` | Bổ trợ 13, 15 | FR13 / UC12 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A11 | Nộp hồ sơ = **tạo bản ghi tài xế** (`PENDING`) → `POST` vào `drivers`, giống A37. `driver_id` = `account_id` (file 03 mục 5.2). Bỏ `POST /drivers/me` (POST vào một phần tử không đúng chuẩn) | `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` → 201 `{ "driver_id": 1001, "name": "Tai Xe Moi", "vehicle": "CAR_4", "plate": "59A99999", "approval_status": "PENDING" }` |
| A12 | Tìm tài xế quanh tọa độ = **lọc tập `drivers` bằng query** (đúng ví dụ của giảng viên). Bỏ `/drivers/nearby` | `?lat=10.82&lng=106.68&limit=2` → 200 `{ "data": [ { "driver_id": 11, "name": "Tài Xế 1", "vehicle": "CAR_4", "plate": "59A-00001", "distance_m": 111 }, { "driver_id": 12, …, "distance_m": 222 } ], "pagination": { "page": 1, "limit": 2, "total": 4, "total_pages": 2 } }` |
| A13 | Cùng tập, lọc khác (R5). `approval_status` thay `status` vì `status` của tài xế là Online / Offline (mục 1.8) | `?approval_status=PENDING` → 200 danh sách hồ sơ, cũ nhất trước |
| A14 | `/{resource}/{id}` (mục 12 "xem theo mã số"). **Sửa 2026-10-14 theo yêu cầu giảng viên:** chỉ admin và chính tài xế; bỏ "phần công khai" cho người khác | `[AD1]` hoặc `[TX1]` `/drivers/11` → 200 bản đầy đủ `{ "driver_id": 11, "name": "Tài Xế 1", "vehicle": "CAR_4", "plate": "59A-00001", "status": "ONLINE", "approval_status": "APPROVED", "license": "GPLX-00001", "lat": 10.821, "lng": 106.68 }` (+ `brand`, `model`, `color`, `reason` nếu có) |
| A15, A16 | Duyệt / từ chối = **đổi trạng thái duyệt** của hồ sơ → `PATCH` (R4). Field riêng `approval_status` vì đây là trạng thái thứ hai của tài xế, do admin đổi. Bỏ `/approve`, `/reject` | A15 `{"approval_status":"APPROVED"}` → 200 `{ "driver_id": 1001, "approval_status": "APPROVED" }`. A16 `{"approval_status":"REJECTED","reason":"thieu giay to"}` → 200 `{ "driver_id": 17, "approval_status": "REJECTED", "reason": "thieu giay to" }` |
| A17, A39 | Bật / tắt = **đổi trạng thái** của chính mình → `PATCH /api/v1/drivers/me` + `status` (R4, R6). Bỏ `/me/online`, `/me/offline` | `{"status":"ONLINE"}` → 200 `{ "driver_id": 11, "status": "ONLINE", "lat": 10.821, "lng": 106.68 }`; `{"status":"OFFLINE"}` → 200 `{ "driver_id": 11, "status": "OFFLINE" }` |
| A18 | Vị trí là thuộc tính của tài xế → sửa một phần cùng tài nguyên. Bỏ `PUT /drivers/me/location` | `{"lat":10.821,"lng":106.68}` → 200 `{ "driver_id": 11, "lat": 10.821, "lng": 106.68 }` |

Ghi chú:

- A11 khi hồ sơ đang `PENDING` hoặc `APPROVED` → 409 `DRIVER_ALREADY_EXISTS`; biển số trùng **tài xế khác** → 409 `LICENSE_PLATE_ALREADY_EXISTS`.
- A11 khi hồ sơ đang `REJECTED` → **nộp lại** (FR43, sửa 2026-10-05): ghi đè thông tin và xe, về `PENDING`, xóa `reason` và người / thời điểm xét → **200** (sửa bản ghi đã có, không tạo mới — R3; 201 chỉ dành cho lần tạo đầu). Response cùng dạng lần đầu. Không giới hạn số lần nộp lại. Admin duyệt lại bằng A15 / A16.
- A14 (sửa 2026-10-14): khách → **403 `FORBIDDEN`** ở Gateway (role không có trong route). Tài xế gọi mã **khác** mã của mình → **403 `NOT_OWNER`** ngay ở service, **không đọc database** (như A09 — không lộ "mã này có tài xế hay không"). Tài xế xem chính mình (mã = `account_id`) thấy cả hồ sơ `PENDING` / `REJECTED`, kèm `reason` khi `REJECTED` — đó là nơi thông báo `APPLICATION_REJECTED` dẫn tới. Admin: 200 mọi mã có hồ sơ (gồm chờ duyệt), 404 `DRIVER_NOT_FOUND` khi không có. Khách vẫn thấy họ tên, biển số tài xế của **chuyến mình** qua A27 (FR14; khối `driver` chụp lúc nhận chuyến — sửa 2026-10-21) và tài xế quanh mình qua A12.
- A12: chỉ tài xế đã duyệt, `ONLINE`, trong **1 000 m** (D1–D3), sắp theo `distance_m` tăng dần rồi `driver_id`. `lat` ngoài −90…90 hoặc `lng` ngoài −180…180 → 400 `INVALID_COORDINATES`; chỉ có một trong `lat`, `lng` → 400 `INVALID_INPUT`. Cùng rpc với S2. Khách gọi `GET /api/v1/drivers` không có `lat` → biến thể A13 → 403 `FORBIDDEN`.
- A15, A16 hồ sơ đã xét → 409 `APPLICATION_ALREADY_REVIEWED`; A16 thiếu `reason` → 400 `REASON_REQUIRED`.
- A17 chưa được duyệt → 409 `DRIVER_NOT_APPROVED` (D6); không có vị trí và không gửi `lat`, `lng` → 400 `INVALID_INPUT`. A39 khi đang `BUSY` → 409 `DRIVER_NOT_AVAILABLE`. Đặt trạng thái đang có → 200 (không đổi gì). `{"status":"BUSY"}` → 400 (chỉ hệ thống đặt `BUSY`, qua S3).
- A17, A39, A18 khi chưa nộp hồ sơ → 404 `DRIVER_NOT_FOUND`.

### 2.4 Đặt xe và lời mời

| Mã | Method, đường dẫn | Body / query | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A19 | `POST /api/v1/bookings` | `{"from","to"}` (+ `vehicle`, `pay`, `from_address`, `to_address`) | customer | booking — `CreateBooking` (→ S4, rồi S2 chạy nền) | **15**, 18, 28 | FR01, FR16, FR35 / UC04 |
| A20 | `GET /api/v1/customers/{id}/bookings?status&page&limit` (sửa 2026-10-14) | Query | customer (chủ), admin | booking — `ListBookings` | **14** | FR37 / UC18, AC17 |
| A21 | `GET /api/v1/bookings/{id}` | — | customer (chủ), admin | booking — `GetBooking` | 19 (bổ trợ) | FR35 / UC04 |
| A22 | `PATCH /api/v1/bookings/{id}` | `{"status":"CANCELED","reason":"…"}` | customer (chủ) | booking — `CancelBooking` | 18 (phụ) | FR36 / UC27 |
| A23 | `GET /api/v1/offers?status&page&limit` | Query | driver | booking — `ListOffers` | **15** | FR06 / UC07 |
| A24 | `PATCH /api/v1/offers/{id}` | `{"status":"ACCEPTED"}` | driver (chủ) | booking — `AcceptOffer` (→ S3, S5) | **16** | FR07, FR11 / UC08 |
| A25 | `PATCH /api/v1/offers/{id}` | `{"status":"REJECTED"}` | driver (chủ) | booking — `RejectOffer` | 15 (phụ) | FR08 / UC09 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A19 | Đặt xe = tạo một booking | `{"from":[10.82,106.68],"to":[10.83,106.69]}` → 201 `{ "booking_id": 1000, "status": "SEARCHING", "vehicle": "CAR_4", "pay": "CASH", "distance_m": 2026, "fare": 45000, "payment_id": 1000 }`. Thêm `"pay":"ONLINE"` → `"status": "PENDING_PAYMENT"`, kèm `payment_expires_at` |
| A20 | **Sửa 2026-10-14 theo yêu cầu giảng viên:** danh sách booking **theo mã khách** = tài nguyên con `customers/{id}/bookings` (R2). Đường dẫn bắt đầu bằng `customers` nhưng dữ liệu thuộc Booking → Gateway định tuyến theo bảng route sang `booking-service` (`customer-service` không tham gia). Bỏ `GET /api/v1/bookings` để chỉ còn một cách | `/customers/1/bookings?limit=2` `[KH1]` → 200 `{ "data": [ { "booking_id": 7, "status": "PENDING_PAYMENT", "vehicle": "CAR_7", "pay": "ONLINE", "fare": 56000, "created_at": "…" }, … ], "pagination": { "page": 1, "limit": 2, "total": 7, "total_pages": 4 } }` |
| A21 | `/{resource}/{id}` | — → 200 như A19, thêm `driver_id`, `trip_id` (khi đã phân công), `canceled_by`, `cancel_reason` |
| A22 | Hủy = đổi trạng thái sang `CANCELED` (R4). Bỏ `/cancel` | `{"status":"CANCELED","reason":"doi y"}` → 200 `{ "booking_id": 1001, "status": "CANCELED", "canceled_by": "customer" }` |
| A23 | Lời mời là tài nguyên riêng (`driver_offers`) của tài xế; lọc theo token | — (mặc định `status=PENDING`) → 200 `{ "data": [ { "offer_id": 1000, "booking_id": 1000, "distance_m": 111, "status": "PENDING", "expires_at": "…", "from": [10.82, 106.68], "to": [10.83, 106.69], "pay": "CASH", "fare": 45000 } ], "pagination": { … } }` |
| A24, A25 | Nhận / từ chối = **đổi trạng thái lời mời** (R4); đúng tên trạng thái trong database (`ACCEPTED`, `REJECTED`). Bỏ `/accept`, `/reject` | A24 `{"status":"ACCEPTED"}` → 200 `{ "offer_id": 1000, "status": "ACCEPTED", "booking_id": 1000, "booking_status": "DRIVER_ASSIGNED", "trip_id": 1000, "trip_status": "ACCEPTED" }`. A25 `{"status":"REJECTED"}` → 200 `{ "offer_id": 1000, "status": "REJECTED" }` |

Ghi chú:

- A19: khách **không chờ** ghép xong (B2) — Offer xuất hiện trong khoảng một giây. `from` hoặc `to` không phải mảng hai số → 400 `INVALID_INPUT`; ngoài khoảng → 400 `INVALID_COORDINATES`; trùng nhau → 400 `SAME_PICKUP_AND_DESTINATION`; loại xe không có giá → 400 `INVALID_INPUT`. `fare` = 45 000 đ cho tuyến mẫu P0 → D0 bằng `CAR_4` (file 03 mục 6.3).
- `payment_id` do Payment cấp, **không đảm bảo** bằng `booking_id` (chỉ seed mới bằng nhau): luôn copy từ response.
- A20: sắp `created_at` giảm dần rồi `booking_id` giảm dần. Khách gọi mã **khác** mã của mình → **403 `NOT_OWNER`** ngay ở service, không đọc database (như A09). Tài xế → 403 `FORBIDDEN` (Gateway). Admin: mọi mã; mã không có booking (kể cả mã không tồn tại) → 200 `data: []`, `total: 0` — **không có 404** vì `booking-service` không biết khách nào tồn tại và không gọi `customer-service` (Q56). `{id}` sai định dạng (`abc`, `me`) → 400 `INVALID_ID`. `GET /api/v1/bookings` (đường cũ) → 404 `ROUTE_NOT_FOUND`.
- A22: `status` khác `CANCELED` → 400 `INVALID_INPUT`; thiếu `reason` → 400 `REASON_REQUIRED`; booking đã có tài xế → 409 `BOOKING_ALREADY_ASSIGNED` (phải hủy chuyến bằng A29); đã hủy / kết thúc → 409 `BOOKING_NOT_CANCELABLE`. Hoàn tiền đi bằng K4 sau đó.
- A24: Offer quá hạn → 409 `OFFER_EXPIRED`; không phải của mình → 403 `NOT_OWNER`; Offer đã trả lời → 409 `INVALID_STATUS_TRANSITION`.

### 2.5 Chuyến đi

| Mã | Method, đường dẫn | Body / query | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A26 | `GET /api/v1/trips?status&page&limit` | Query | Cả ba | trip — `ListTrips` | Ngoài phiếu | FR30, FR34 / UC18, UC22 |
| A27 | `GET /api/v1/trips/{id}` | — | customer (chủ), driver (chủ), admin | trip — `GetTrip` (không gọi service khác) | Bổ trợ 16–18; vấn đáp 12 | FR14 / UC10 |
| A28 | `PATCH /api/v1/trips/{id}` | `{"status":"ARRIVED"}` | driver (chủ) | trip — `UpdateTripStatus` | **17** | FR12 / UC11 |
| A29 | `PATCH /api/v1/trips/{id}` | `{"status":"CANCELED","reason":"…"}` | customer (chủ), driver (chủ) | trip — `CancelTrip` | **18** | FR36, FR41 / UC27, UC32 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A27 | `/{resource}/{id}` | — → 200 `{ "trip_id": 1000, "booking_id": 1000, "status": "ACCEPTED", "pay": "CASH", "fare": 45000, "driver_id": 11, "driver": { "driver_id": 11, "name": "Tài Xế 1", "plate": "59A-00001" }, "history": [ … ] }`. Seed: `[KH1]` `trips/5` → `"driver": { "driver_id": 16, "name": "Tài Xế 6", "plate": "59A-00006" }` |
| A28 | Tiến trạng thái = `PATCH` + `status` (R4). Bỏ `/status` ở cuối đường dẫn: `status` đã nằm trong body | `{"status":"ARRIVED"}` → 200 `{ "trip_id": 1000, "status": "ARRIVED", "history": [ { "status": "ACCEPTED", "at": "…" }, { "status": "ARRIVED", "at": "…" } ] }` |
| A29 | Hủy chuyến cũng là đổi trạng thái → **cùng đường dẫn** với A28, khác giá trị. Bỏ `/cancel` | `{"status":"CANCELED","reason":"ban viec"}` → 200 `{ "trip_id": 5, "status": "CANCELED", "canceled_by": "customer", "reason": "ban viec" }` |

Ghi chú:

- A26 làm sau khi xong 30 mục (Q32).
- A27 (sửa 2026-10-21): `driver.name`, `driver.plate` là **bản chụp lúc tài xế nhận chuyến** (S3 `ReserveDriver` trả → S5 `CreateTrip` mang → `trips.driver_name`, `driver_plate`). Xem chuyến không gọi Driver, nên `driver-service` dừng thì A27 vẫn đủ. Cả ba người xem được (khách, tài xế của chuyến, admin) thấy cùng khối; đây là cách khách biết ai tới đón vì A14 chặn khách. Không có vị trí sống (FR15 ngoài phiếu).
- A28: phải đi **đúng thứ tự** `ACCEPTED → ARRIVED → PICKED_UP → IN_PROGRESS → COMPLETED` (FR12). Sai thứ tự (kể cả nhảy cóc) → 409 `INVALID_STATUS_TRANSITION`. Response có **luôn lịch sử**.
- A29: thiếu `reason` → 400 `REASON_REQUIRED`; đã đón khách (`PICKED_UP` trở đi) → 409 `TRIP_NOT_CANCELABLE` (BRULE16). Hoàn tiền và thông báo đi bằng K5 sau đó.
- Khách gửi `status` khác `CANCELED` → 403 `FORBIDDEN` (biến thể A28 chỉ cho driver); admin gửi bất kỳ → 403.

### 2.6 Thanh toán, thông báo, đánh giá

| Mã | Method, đường dẫn | Body / header | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A30 | `GET /api/v1/payments/{id}` | — | customer (chủ), admin | payment — `GetPayment` | 30 | FR20 / UC24 |
| A31 | `POST /api/v1/payments/{id}/transactions` | Header `Idempotency-Key`; body tùy chọn `{"simulate_result"}` | customer (chủ) | payment — `PayPayment` | **19, 30** | FR18, FR19 / UC14, UC15 |
| A32 | `POST /api/v1/payment-callbacks` | Header `X-Callback-Secret`; `{"txn_id"}` | — (khóa bí mật) | payment — `HandleProviderCallback` | **19, 30** | FR18 / UC14 |
| A33 | `GET /api/v1/notifications?page&limit` | Query | Cả ba | notification — `ListNotifications` | 16, 18 | FR21–FR24 / UC16 |
| A34 | `POST /api/v1/ratings` | `{"trip_id","score"}` (+ `comment`) | customer (chủ) | rating — `CreateRating` (→ S7) | **20** | FR25 / UC17 |
| A35 | `GET /api/v1/ratings?trip_id` | Query | customer (chủ), driver (chủ), admin | rating — `GetRatingByTrip` | 20 (bổ trợ) | FR25 |
| A36 | `GET /api/v1/ratings?driver_id` | Query | Cả ba | rating — `GetDriverRating` | 20 (bổ trợ) | UC17 bước 5 |

| Mã | Vì sao đặt như vậy | Request mẫu → response thành công |
|---|---|---|
| A30 | `/{resource}/{id}` | — → 200 `{ "payment_id": 7, "booking_id": 7, "method": "ONLINE", "status": "COMPLETED", "amount": 56000, "fare": { "distance_m": 2026, "base_fare": 25000, "per_km_rate": 15000, "min_fare": 40000 }, "expires_at": "…", "paid_at": "…", "transactions": [ { "txn_id": "SIM-7-1", "type": "CHARGE", "attempt_no": 1, "status": "SUCCEEDED" } ] }` |
| A31 | Mỗi lần thanh toán là **một giao dịch mới** (`payment_transactions`, file 03 mục 8.4) → `POST` tạo phần tử con (R7). Bỏ `/pay` (động từ). Khớp đúng nghiệp vụ "tối đa 3 lần thử" = tối đa 3 transaction | Header `Idempotency-Key: k1`; `{"simulate_result":"MANUAL"}` → 200 `{ "payment_id": 7, "status": "PENDING", "txn_id": "SIM-7-1", "txn_status": "PENDING", "attempt_no": 1, "attempts_left": 2, "expires_at": "…" }` |
| A32 | Mỗi callback là **một thông báo kết quả** mà cổng thanh toán gửi tới; response được lưu (`callback_response`) để trả lại khi gửi lặp → là tài nguyên được tạo (R7). Không đặt dưới `/payments/{id}` vì Provider chỉ biết `txn_id` của nó. Bỏ `/payments/callback` (số ít, lẫn vào tập `payments`) | Header `X-Callback-Secret:<khóa trong .env>`; `{"txn_id":"SIM-7-1"}` → 200 `{ "txn_id": "SIM-7-1", "txn_status": "SUCCEEDED", "payment_id": 7, "status": "COMPLETED" }` |
| A33 | Danh sách "của tôi", lọc theo token | — → 200 `{ "data": [ { "type": "TRIP_ACCEPTED", "title": "…", "body": "…", "data": { "booking_id": 1000, "trip_id": 1000 }, "created_at": "…" } ], "pagination": { … } }` |
| A34 | Đánh giá là tài nguyên của context Rating → tập `ratings` ở gốc; `trip_id` trong body như mọi tham chiếu khác. Bỏ `/trips/{id}/rating` (số ít, lồng vào tài nguyên của service khác) | `{"trip_id":4,"score":5}` → 201 `{ "rating_id": 1000, "trip_id": 4, "driver_id": 13, "score": 5, "driver_avg": 5, "driver_count": 1 }` — không gửi `comment` thì response không có key `comment`; `driver_avg` làm tròn 1 chữ số (JSON in `5`, `4.5`) (spec 20-29, DG-M2) |
| A35 | Lọc tập `ratings` theo chuyến (R5). Một chuyến có nhiều nhất một đánh giá (UNIQUE `trip_id`) nên trả một đối tượng | `?trip_id=4` → 200 đánh giá của chuyến; chưa có → 404 `RATING_NOT_FOUND` |
| A36 | Lọc tập `ratings` theo tài xế; trả **số liệu tổng hợp** của tập đó (không thêm API liệt kê vì không FR nào cần) | `?driver_id=11` → 200 `{ "driver_id": 11, "avg": 5, "count": 1 }`; tài xế chưa có đánh giá → 200 `{ "driver_id": 999, "count": 0 }` (không có `avg`) |

Ghi chú:

- A30: không field nào chứa thông tin thẻ (BRULE09). `fare` là từng thành phần cước để giải thích con số cuối.
- A31: mỗi lần gọi với **khóa mới** là một lần thử (BRULE17). `simulate_result` chỉ có hiệu lực khi `SIMULATION_MODE=true`; giá trị khác ba giá trị dưới → 400 `INVALID_INPUT`:

  | `simulate_result` | Adapter làm gì | `txn_status` / `status` trong response |
  |---|---|---|
  | Không gửi hoặc `SUCCESS` | Gọi ngay hàm xử lý callback, thành công (ADR-014) | `SUCCEEDED` / `COMPLETED` |
  | `FAILED` | Gọi ngay hàm xử lý callback, thất bại | `FAILED` / `FAILED` (`CANCELED` nếu là lần thử cuối) |
  | `MANUAL` (Q57) | **Không** gọi callback; chờ A32 từ ngoài | `PENDING` / `PENDING` |

  Lỗi: đã `COMPLETED` → 409 `PAYMENT_ALREADY_COMPLETED`; đang có lần thử `PENDING` → 409 `PAYMENT_IN_PROGRESS`; quá hạn → 409 `PAYMENT_EXPIRED`; hết lượt → 409 `PAYMENT_ATTEMPTS_EXHAUSTED`; thanh toán tiền mặt → 409 `PAYMENT_NOT_ONLINE`.
- `txn_id` theo quy luật **`SIM-<payment_id>-<attempt_no>`** (file 03 mục 8.4): học thuộc được, không cần copy.
- A34: `trip_id` không phải số nguyên dương → 400 `INVALID_INPUT`; chuyến không có → 404 `TRIP_NOT_FOUND`; chưa `COMPLETED` → 409 `TRIP_NOT_COMPLETED`; không phải khách của chuyến → 403 `NOT_OWNER`; đã đánh giá → 409 `RATING_ALREADY_EXISTS`; `score` ngoài 1–5 → 400. Response có luôn điểm trung bình mới của tài xế (bớt request A36).
- A35, A36: thiếu cả hai hoặc gửi cả `trip_id` lẫn `driver_id` → 400 `INVALID_INPUT`; `trip_id` / `driver_id` trong query sai định dạng (`abc`, `4 OR 1=1`) → 400 **`INVALID_ID`** như mã trong đường dẫn (khác A34: mã trong body sai → `INVALID_INPUT`) (spec 20-29 DG5, DG-M3). Thang điểm 1–5 số nguyên, không có hạn đánh giá (DG-Q1, DG-Q3 đã chốt 2026-10-05).

### 2.7 Callback thanh toán (A32) và cổng thanh toán giả lập — ADR-014

| Điểm | Thiết kế | Vì sao |
|---|---|---|
| Ai gửi callback | **Adapter giả lập trong `payment-service`** gọi ngay hàm xử lý callback khi nhận A31 (thu) hoặc yêu cầu hoàn tiền. A32 là **cùng hàm** gọi từ ngoài qua Gateway. Với `MANUAL` adapter không gọi, nên A32 từ Postman là callback đầu tiên và làm Payment `PENDING → COMPLETED` (mục 19) | Không có bước chờ; người chấm thấy rõ bước "nhận callback" (Q57) |
| Xác thực | Header `X-Callback-Secret:<khóa trong .env>` (`PAYMENT_CALLBACK_SECRET`); **không HMAC**. `payment-service` so sánh thời gian hằng | Giả lập đơn giản (giảng viên); khóa thuộc context Payment |
| Sai / thiếu khóa | 401 `INVALID_CALLBACK_SECRET` | |
| Body | `txn_id` (bắt buộc), `result` (`SUCCESS` mặc định / `FAILED`), `amount` (tùy chọn; khác số tiền giao dịch → 400) | Luật thi: body một field |
| Mã giao dịch lạ | 404 `TRANSACTION_NOT_FOUND` | |
| Giao dịch đang `PENDING` | 200 `{ txn_id, txn_status, payment_id, status }`; phát K6; lưu response vào `callback_response` | Callback đầu tiên là callback được xử lý |
| Giao dịch đã có kết quả | 200 **response đã lưu**, header `Idempotency-Replayed: true`; không đổi trạng thái, không phát lại K6 | Mục 30 |
| Đánh đổi | Khóa cố định không chứng minh body không bị sửa; lộ khóa là giả được callback | Chỉ Gateway mở ra ngoài; Provider thật thì đổi sang HMAC trong adapter (NFR13) |

### 2.8 Danh sách 32 đường dẫn (học thuộc theo tài nguyên)

| Tài nguyên | GET | POST | PATCH |
|---|---|---|---|
| (health) | `/health`, `/ready`, `/health/services` | | |
| `auth` (nhóm ngoại lệ — sửa 2026-10-14) | | `/api/v1/auth/register` (A04), `/api/v1/auth/login` (A05), `/api/v1/auth/logout` (A06), `/api/v1/auth/otp` (A07), `/api/v1/auth/driver-register` (A08) | |
| `customers` | `/api/v1/customers/me` (A38), `/api/v1/customers/{id}` (A09), **`/api/v1/customers/{id}/bookings?…` (A20 — do `booking-service` xử lý)** | `/api/v1/customers` (A37) | `/api/v1/customers/me` (A10) |
| `drivers` | `/api/v1/drivers?…` (A12, A13), `/api/v1/drivers/{id}` (A14) | `/api/v1/drivers` (A11) | `/api/v1/drivers/me` (A17, A39, A18), `/api/v1/drivers/{id}` (A15, A16) |
| `bookings` | `/api/v1/bookings/{id}` (A21) | `/api/v1/bookings` (A19) | `/api/v1/bookings/{id}` (A22) |
| `offers` | `/api/v1/offers?…` (A23) | | `/api/v1/offers/{id}` (A24, A25) |
| `trips` | `/api/v1/trips?…` (A26), `/api/v1/trips/{id}` (A27) | | `/api/v1/trips/{id}` (A28, A29) |
| `payments`, `payment-callbacks` | `/api/v1/payments/{id}` (A30) | `/api/v1/payments/{id}/transactions` (A31), `/api/v1/payment-callbacks` (A32) | |
| `notifications` | `/api/v1/notifications` (A33) | | |
| `ratings` | `/api/v1/ratings?trip_id` (A35), `?driver_id` (A36) | `/api/v1/ratings` (A34) | |

## 3. Ma trận phân quyền (mục chấm 28)

Ô là HTTP mong đợi khi dữ liệu hợp lệ. **200\*** / **201\*** = chỉ với dữ liệu của chính mình; của người khác → 403 `NOT_OWNER` (service trả). 401 và 403 theo role (`FORBIDDEN`) do Gateway trả.

| Mã | Đường dẫn | Không đăng nhập | customer | driver | admin |
|---|---|---|---|---|---|
| A01–A03 | `/health…`, `/ready` | 200 | 200 | 200 | 200 |
| A04 | `POST /api/v1/auth/register` | 201 | 201 | 201 | 201 |
| A05 | `POST /api/v1/auth/login` | 200 | 200 | 200 | 200 |
| A06 | `POST /api/v1/auth/logout` | 401 | 200 | 200 | 200 |
| A07 | `POST /api/v1/auth/otp` | 201 | 201 | 201 | 201 |
| A08 | `POST /api/v1/auth/driver-register` | 201 | 201 | 201 | 201 |
| A37 | `POST /api/v1/customers` | 401 | 201 (409 nếu đã có) | 403 | 403 |
| A38 | `GET /api/v1/customers/me` | 401 | 200 (404 nếu chưa có) | 403 | 403 |
| A09 | `GET /api/v1/customers/{id}` | 401 | 200\* (404 nếu chưa có hồ sơ) | 403 | 200 / 404 |
| A10 | `PATCH /api/v1/customers/me` | 401 | 200 (404 nếu chưa có) | 403 | 403 |
| A11 | `POST /api/v1/drivers` | 401 | 403 | 201 (200 nếu nộp lại hồ sơ `REJECTED`; 409 nếu `PENDING` / `APPROVED`) | 403 |
| A12 | `GET /api/v1/drivers?lat&lng` | 401 | 200 | 403 | 200 |
| A13 | `GET /api/v1/drivers` (không `lat`) | 401 | 403 | 403 | 200 |
| A14 | `GET /api/v1/drivers/{id}` | 401 | **403** `FORBIDDEN` (sửa 2026-10-14) | 200\* (403 `NOT_OWNER` với mã khác) | 200 / 404 |
| A15, A16 | `PATCH /api/v1/drivers/{id}` | 401 | **403** | 403 | 200 |
| A17, A39, A18 | `PATCH /api/v1/drivers/me` | 401 | 403 | 200 | 403 |
| A19 | `POST /api/v1/bookings` | 401 | 201 | **403** | 403 |
| A20 | `GET /api/v1/customers/{id}/bookings` (sửa 2026-10-14) | 401 | 200\* | 403 | 200 (mọi mã) |
| A21 | `GET /api/v1/bookings/{id}` | 401 | 200\* | 403 | 200 |
| A22 | `PATCH /api/v1/bookings/{id}` | 401 | 200\* | 403 | 403 |
| A23 | `GET /api/v1/offers` | 401 | 403 | 200 | 403 |
| A24, A25 | `PATCH /api/v1/offers/{id}` | 401 | 403 | 200\* | 403 |
| A26 | `GET /api/v1/trips` | 401 | 200 (của mình) | 200 (của mình) | 200 |
| A27 | `GET /api/v1/trips/{id}` | 401 | 200\* | 200\* | 200 |
| A28 | `PATCH /api/v1/trips/{id}` (tiến trạng thái) | 401 | 403 | 200\* | 403 |
| A29 | `PATCH /api/v1/trips/{id}` (`CANCELED`) | 401 | 200\* | 200\* | 403 |
| A30 | `GET /api/v1/payments/{id}` | 401 | 200\* | 403 | 200 |
| A31 | `POST /api/v1/payments/{id}/transactions` | 401 | 200\* | 403 | 403 |
| A32 | `POST /api/v1/payment-callbacks` | 200 nếu khóa đúng; 401 nếu sai / thiếu | — | — | — |
| A33 | `GET /api/v1/notifications` | 401 | 200 | 200 | 200 |
| A34 | `POST /api/v1/ratings` | 401 | 201\* | 403 | 403 |
| A35 | `GET /api/v1/ratings?trip_id` | 401 | 200\* | 200\* | 200 |
| A36 | `GET /api/v1/ratings?driver_id` | 401 | 200 | 200 | 200 |

Hai ô in đậm là hai request demo của mục 28: khách gọi duyệt hồ sơ (`PATCH /api/v1/drivers/17`, không body); tài xế gọi đặt xe (`POST /api/v1/bookings`, không body). Cả hai đường dẫn có role cố định cho mọi biến thể nên Gateway trả 403 **trước khi đọc body**. Admin **không** hủy được chuyến (A29 → 403): BRULE16 chỉ nói về khách và tài xế; FR31 chưa thiết kế (Q45).

## 4. Kiểm tra quyền sở hữu

Nguyên tắc: **Gateway kiểm tra role; service kiểm tra chủ dữ liệu.** Mã là số nguyên tuần tự nên **dễ đoán** (đổi `/api/v1/bookings/5` thành `/api/v1/bookings/6` là thử được) — vì vậy **mọi API có mã trong đường dẫn hoặc trong body** đều phải qua bảng dưới (ADR-015).

| Vì sao không kiểm tra ở Gateway | |
|---|---|
| Gateway không có dữ liệu | Muốn biết booking này của ai thì phải đọc database Booking hoặc gọi thêm gRPC — trái "Gateway không chứa logic nghiệp vụ, không truy cập database nghiệp vụ" |
| Là quy tắc nghiệp vụ | "Chỉ tài xế của chuyến mới cập nhật trạng thái" (T3) phải nằm cùng chỗ với dữ liệu Trip |
| Một lần đọc | Service đằng nào cũng đọc đối tượng; so `x-account-id` với chủ là thêm một phép so sánh |

| API | Chủ dữ liệu | Service so `x-account-id` với | Quy tắc (file 01) | Không phải chủ | Không tồn tại |
|---|---|---|---|---|---|
| A09 | Khách có mã đó | Chính mã trong đường dẫn (`customer_id` = `account_id`) — so **trước khi** đọc database; admin bỏ qua | C2 | 403 | 404 (chỉ khi là mã của mình hoặc admin) |
| A10, A37, A38 | Khách trong token | Không nhận mã từ client | C2, C4, BRULE18 | — | 404 (A10, A38) |
| A14 (sửa 2026-10-14) | Tài xế có mã đó | Chính mã trong đường dẫn (`driver_id` = `account_id`) — so **trước khi** đọc database; admin bỏ qua | D11 | 403 | 404 (chỉ khi là mã của mình hoặc admin) |
| A20 (sửa 2026-10-14) | Khách có mã đó | Chính mã trong đường dẫn — so **trước khi** đọc database; admin bỏ qua | B14 | 403 | — (danh sách rỗng) |
| A15, A16 | — (việc của admin) | Không cần: chỉ admin vào được (role) | D4, D5 | — | 404 |
| A11, A17, A39, A18 | Tài xế trong token | Không nhận mã từ client | D6 | — | 404 (A17, A39, A18 khi chưa nộp hồ sơ) |
| A23, A33 | Người trong token | Lọc theo `x-account-id` | B9, N2 | — | danh sách rỗng |
| A21, A22 | Khách của booking | `bookings.customer_id` | B13, B14 | 403 | 404 |
| A24, A25 | Tài xế được mời | `driver_offers.driver_id` | B9 | 403 | 404 |
| A27 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` theo role | T7 | 403 | 404 |
| A28 | Tài xế của chuyến | `trips.driver_id` | T3 | 403 | 404 |
| A29 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` | T5 | 403 | 404 |
| A30, A31 | Khách của thanh toán | `payments.customer_id` | NFR08 | 403 | 404 |
| A34 | Khách của chuyến (`trip_id` trong body) | `customer_id` do Trip trả qua S7 | V2 | 403 | 404 |
| A35 | Khách hoặc tài xế của chuyến | `ratings.customer_id` / `ratings.driver_id` | NFR08 | 403 | 404 |
| A36 | — (công khai) | Không cần | UC17 | — | 200 với `count: 0` |

Vì sao không phải chủ thì **403** chứ không giả làm 404: mã tuần tự nên "mã 6 có tồn tại" vốn đã đoán được; thứ cần bảo vệ là **nội dung**, và 403 cho người chấm thấy rõ lý do bị chặn (mục 28). Ngoại lệ A09, A14, A20: biết chủ ngay từ mã (mã khách / tài xế = `account_id`) nên chặn trước khi đọc database, không lộ "khách số 3 đã tạo hồ sơ hay chưa", "mã 17 có phải tài xế không".

API "của tôi" (A10, A11, A17, A39, A18, A23, A33, A37, A38) **không nhận mã từ client** (`me` hoặc lọc theo token), nên không thể gọi nhầm dữ liệu người khác.

## 5. Mục chấm → request gõ tay

Giảng viên trả lời 2026-10-03 (đóng Q60, Q61): **được dùng lại tab** đã gõ và mở tab mới; **30 giây gồm cả giải thích** (vừa làm vừa nói). Vì vậy mỗi mục ưu tiên **sửa tab** (đổi vài ký tự) thay vì gõ mới, và chỉ giữ request chứng minh đúng nội dung phiếu chấm; request phụ đánh dấu `(tùy chọn)` — chỉ làm khi được hỏi.

Ký hiệu: `[KH1]` = tab Authorization → Bearer Token → dán token của KH1. "Sửa tab" = dùng lại tab vừa gửi, chỉ đổi phần ghi rõ. "Nhân bản tab" = chuột phải tab → **Duplicate Tab** rồi sửa (giữ nguyên tab cũ để gửi lại sau). Ước lượng: gõ mới GET ≈ 10 s, POST / PATCH có body ≈ 15–20 s, thêm header phụ ≈ +5 s; sửa tab ≈ 3–5 s; nói song song khi gõ, cộng thêm ≈ 5–10 s sau khi thấy kết quả. Dữ liệu seed: file 03 mục 14. Câu nói từng mục: file 06.

**Ba tab giữ suốt buổi:** tab đăng nhập KH1, TX1, AD1 (tạo ở mục 10) — cần token thì bấm Send lại tab đó rồi copy.

### 5.1 Thực hành 1 (mục 1–10)

| Mục | # | Request (method URL — auth / header — body) | Kết quả mong đợi |
|---|---|---|---|
| 1, 3, 4 | — | Mô tả bằng lời (file 06) | — |
| 2 | — | Terminal: `cat .gitignore`; `git ls-files .env .env.example` | Có dòng `.env`; chỉ in `.env.example` |
| 5 | — | Terminal: `docker compose ps -a` | 21 container; 20 đang chạy, `kafka-init` đã thoát 0 |
| 6 | 1 | `GET localhost:3000/health` | 200 `{"status":"healthy"}` |
| | 2 | Sửa tab: `/ready` | 200 `{"status":"ready","checks":{"redis":"healthy","grpc_clients":"healthy"}}` |
| | 3 | Sửa tab: `/health/services` | 200 `"status":"healthy"`, 8 service `"healthy"` |
| | (4) | (tùy chọn) Terminal `docker compose stop rating-service` → Send lại request 3 → `docker compose start rating-service` | 503 `"status":"unhealthy"`, `"rating-service":"unhealthy"`, 7 service còn lại `healthy` |
| 7 | — | Trình duyệt `localhost:8080` → Topics | 7 topic; message xuất hiện sau mục 15 |
| 8 | — | Terminal: `docker compose ps`; Postman `GET localhost:50051` | Chỉ `gateway` 3000, `kafka-ui` 8080 có cổng; Postman báo `ECONNREFUSED` |
| 9 | 1 | `POST localhost:3000/api/v1/auth/register` — `{"email":"new1@cab.vn","password":"12345678"}` | 201 `account_id` 1000, `role` customer |
| | 2 | Sửa tab: `register` → `login` (body giữ nguyên) | 200 có `token` — **đăng nhập được** |
| | (3) | (tùy chọn) Sửa tab: `login` → `register` | 409 `EMAIL_ALREADY_EXISTS` |
| 10 | 1 | Sửa tab mục 9: `"email":"kh1@cab.vn"` | 200 `token` KH1, `role` customer, `account_id` 1, `expires_in` 3600 — **giữ tab (tab KH1)** |
| | 2 | Nhân bản tab: `"email":"admin@cab.vn"` | 200 `role` admin, `account_id` 99 — **tab AD1** |
| | 3 | Nhân bản tab: body `{"phone":"0910000001","password":"12345678"}` (đổi chữ `email` thành `phone` và giá trị) | 200 `role` driver, `account_id` 11 — **tab TX1** |
| | (4) | (tùy chọn) Tab KH1: thêm `"phone":"0910000001",` (gửi cả hai định danh) rồi xóa đi; hoặc `"password":"sai"` rồi sửa lại | 400 `INVALID_INPUT`; 401 `INVALID_CREDENTIALS` |

### 5.2 Thực hành 2 (mục 11–20)

| Mục | # | Request | Kết quả mong đợi |
|---|---|---|---|
| 11 | 1 | `GET localhost:3000/api/v1/customers/1` — `[KH1]` — **tab GET** | 200 `name` "Nguyễn Văn An", `phone` `0900000001`, `dob` 2000-01-01 |
| | 2 | Sửa tab: `/customers/2` | 403 `NOT_OWNER` |
| | (3) | (tùy chọn, tạo hồ sơ) `POST localhost:3000/api/v1/customers` — `[token mục 9]` — `{"name":"Pham Duc","phone":"0901234567"}` | 201 `customer_id` 1000 |
| 12 | 1 | Tab GET (`[KH1]`): `customers/2` → `drivers/11` | **403 `FORBIDDEN`** — khách không xem tài xế theo mã (sửa 2026-10-14) |
| | 2 | Nhân bản tab, Authorization dán token `[AD1]` (copy từ tab AD1) — **tab admin** | 200 bản đầy đủ: Tài Xế 1, `CAR_4`, `59A-00001`, `ONLINE`, `approval_status` `APPROVED`, `license` `GPLX-00001`, `lat`, `lng` |
| | 3 | Sửa tab admin: `/drivers/999` | 404 `DRIVER_NOT_FOUND` |
| | (4) | (tùy chọn) Tab admin đổi token `[TX1]`: `/drivers/11` rồi `/drivers/12` | 200 (chính mình); 403 `NOT_OWNER` |
| 13 | 1 | Tab GET: `drivers/11` → `drivers?lat=10.82&lng=106.68&limit=2` | 200: TX1 (11, ≈ 111 m), TX2 (12, ≈ 222 m); `total` 4 |
| | 2 | Sửa tab: thêm `&page=2` | 200: TX3 (13), TX4 (14) |
| 14 | 1 | Tab GET: `drivers?lat=…` → `customers/1/bookings?limit=2` | 200: booking 7, 6; `total` 7, `total_pages` 4 |
| | 2 | Sửa tab: thêm `&page=2` | 200: booking 5, 4 |
| | 3 | Sửa tab: `customers/1` → `customers/2` | 403 `NOT_OWNER` — khách chỉ xem theo mã của mình |
| | (4) | (tùy chọn) Tab admin: `customers/1/bookings?limit=2` | 200 như request 1 — admin xem mọi mã |
| 15 | 1 | `POST localhost:3000/api/v1/bookings` — `[KH1]` — `{"from":[10.82,106.68],"to":[10.83,106.69]}` | 201 `SEARCHING`, `CAR_4`, `CASH`, `fare` 45000, `booking_id` 1000 — **giữ tab (dùng ở mục 28)** |
| | 2 | Nhân bản tab: method `GET`, URL `offers`, token `[TX1]` | 200: một Offer `PENDING` cho booking 1000, `distance_m` ≈ 111 |
| 16 | 1 | Sửa tab: method `PATCH`, URL `offers/1000`, body `{"status":"ACCEPTED"}` | 200 `ACCEPTED`, `booking_status` `DRIVER_ASSIGNED`, `trip_id` 1000 |
| | 2 | **Tab GET** (đang `[KH1]`, URL `customers/2/bookings?…` của mục 14): sửa URL thành `notifications` (CD-Q1, chốt 2026-10-05) | 200: `data[0]` `TRIP_ACCEPTED`, `data[1]` `BOOKING_CREATED` |
| 17 | 1 | Sửa tab mục 16: URL `trips/1000`, body `{"status":"COMPLETED"}` | **409 `INVALID_STATUS_TRANSITION`** (nhảy cóc) |
| | 2–5 | Sửa tab, lần lượt `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED` | 200 mỗi lần; lần cuối `history` đủ 5 trạng thái |
| 18 | 1 | **Tab GET** (đang `[KH1]`, không phải đổi token — CD-Q2, chốt 2026-10-05): method `PATCH`, URL `trips/5`, Body raw `{"status":"CANCELED","reason":"ban viec"}` | 200 `CANCELED`, `canceled_by` customer |
| | 2 | Cùng tab: method `GET`, URL `notifications` (body để nguyên — Gateway bỏ qua body của `GET`) | 200: `PAYMENT_REFUNDED` (payment 5, 45000) và `TRIP_CANCELED` (trip 5) — Trip, Payment, Notification đều đã nhận event |
| | (3) | (tùy chọn, phía tài xế) Tab đăng nhập TX1 sửa `"phone":"0910000006"` → copy token → tab GET `[TX6]` Send | `TRIP_CANCELED` cho chuyến 5 |
| | (4) | (tùy chọn, hủy booking) Tab mục 15: thêm `"pay":"ONLINE"` → copy `booking_id` → tab GET `PATCH …/api/v1/bookings/<id>` `{"status":"CANCELED","reason":"doi y"}` | 201 `PENDING_PAYMENT`; 200 `CANCELED` |
| 19 | 1 | `POST localhost:3000/api/v1/payments/7/transactions` — `[KH1]` — Headers `Idempotency-Key:k1` — `{"simulate_result":"MANUAL"}` | 200 `status` `PENDING`, `txn_id` `SIM-7-1`, `txn_status` `PENDING` |
| | 2 | Nhân bản tab: URL `payment-callbacks`, Authorization **No Auth**, Headers `X-Callback-Secret:<khóa trong .env>`, body `{"txn_id":"SIM-7-1"}` | 200 `txn_status` `SUCCEEDED`, **`status` `COMPLETED`** |
| | (3) | (tùy chọn) `GET …/api/v1/bookings/7` — `[KH1]` | `SEARCHING` (BRULE13: trả xong mới tìm tài xế) |
| | Dự phòng | Chỉ request 1, **bỏ body** | 200 `COMPLETED` ngay (adapter tự gọi callback) |
| 20 | 1 | `POST localhost:3000/api/v1/ratings` — `[KH1]` — `{"trip_id":4,"score":5}` | 201 `driver_id` 13, `driver_avg` 5, `driver_count` 1 |
| | 2 | Gửi lại y hệt | 409 `RATING_ALREADY_EXISTS` |
| | (3) | (tùy chọn) Sửa body `"trip_id":5` | 409 `TRIP_NOT_COMPLETED` |

### 5.3 Thực hành 3 (mục 21–30)

| Mục | # | Request | Kết quả mong đợi |
|---|---|---|---|
| 21 | 1 | `POST localhost:3000/api/v1/auth/otp` — `{"phone":"0911111111"}` | 201 có `otp` |
| | 2 | Sửa tab: URL `auth/otp` → `auth/driver-register`, body `{"phone":"0911111111","otp":"<otp>","password":"12345678"}` | 201 `role` driver, `token` |
| | 3 | Sửa tab: URL `drivers`, token `[token vừa nhận]`, body `{"name":"Tai Xe Moi","license":"GPLX-99","plate":"59A-99999"}` | 201 `approval_status` **`PENDING`**, `driver_id` D |
| 22 | 1 | Sửa tab mục 21: method `PATCH`, URL `drivers/D`, token `[AD1]`, body `{"approval_status":"APPROVED"}` | 200 `APPROVED` |
| | (2) | (tùy chọn) Sửa tab: `drivers/17`, body `{"approval_status":"REJECTED","reason":"thieu giay to"}` | 200 `REJECTED` |
| | (—) | (chỉ vấn đáp) Bị từ chối thì sao? | Tài xế nộp lại bằng **chính request 3 mục 21** (`POST drivers`, cùng body) → 200 `PENDING`; admin duyệt lại như request 1 (FR43) |
| 23 | 1 | Sửa tab mục 22: URL `drivers/me`, token `[TX1]`, body `{"status":"OFFLINE"}` | 200 `status` `OFFLINE` |
| | 2 | Sửa tab: `"ONLINE"` | 200 `ONLINE` (TX1 trở lại như seed) |
| 24 | 1 | Tab GET (mục 11–14, 18): URL `customers/1`, `[KH1]` | 200 họ tên rõ, `phone` rõ |
| | — | Terminal: `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `full_name_enc`, `date_of_birth_enc` là `\x…`; `phone` rõ (đúng thiết kế) |
| | (—) | (tùy chọn) `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$`; `email` / `phone` rõ |
| 25 | 1 | Tab đăng nhập KH1: body `{"email":"' OR 1=1 --","password":"x"}` | **400 `INVALID_EMAIL`** — không đăng nhập được, chặn trước khi chạm database |
| | 2 | Sửa tab: `{"email":"kh1@cab.vn","password":"' OR '1'='1"}` | 401 `INVALID_CREDENTIALS` — SQL tham số, mật khẩu so bằng hash |
| | (3) | (tùy chọn) Tab GET: URL `customers/1 OR 1=1` | 400 `INVALID_ID` |
| 26 | 1 | Tab GET: method `PATCH`, URL `customers/me`, body `{"name":"<script>alert(1)</script>"}` | 400 `TEXT_CONTAINS_HTML` |
| | 2 | Sửa tab: method `GET` | 200 tên vẫn "Nguyễn Văn An"; tab Headers có `nosniff`, CSP |
| 27 | 1 | Tab GET (mục 26, `customers/me`): copy token → trình duyệt **jwt.io** → dán → sửa payload `"role":"customer"` → `"admin"` (**không** nhập `JWT_SECRET`; trang bắt nhập khóa thì gõ chuỗi bất kỳ như `abc`) → copy token mới → dán vào tab → Send (ADR-016) | 401 `TOKEN_INVALID` |
| | 2 | Sửa tab: Authorization → No Auth | 401 `TOKEN_MISSING` |
| | Dự phòng | Không có Internet: **sửa một ký tự ở giữa token** trong Postman | 401 `TOKEN_INVALID` |
| | (3) | (tùy chọn) `POST …/api/v1/auth/logout` — `[KH1]` → gửi lại request 1 với token đúng | 200 `LOGGED_OUT`; 401 `TOKEN_REVOKED` |
| 28 | 1 | Tab mục 23: token `[KH1]`, URL `drivers/17`, **xóa body** | 403 `FORBIDDEN` |
| | 2 | Tab mục 15 (`POST …/api/v1/bookings`): token `[TX1]` | 403 `FORBIDDEN` (role kiểm tra trước body) |
| 29 | 1 | **Tab đăng nhập KH1** (`POST …/api/v1/auth/login` `{"email":"kh1@cab.vn","password":"12345678"}`, route công khai, ngưỡng 5 — không phải tab có token, ngưỡng 30; GH-M4), bấm Send liên tục 6 lần → mở Headers của response | Lần 1–5: 200; lần 6: **429 `RATE_LIMITED`**, header `Retry-After`, `RateLimit-Remaining: 0` |
| 30 | 1 | Tab request 1 mục 19 → Send (cùng `k1`, cùng body) | 200, body **y hệt** lần đầu (`PENDING`), header `Idempotency-Replayed: true` |
| | 2 | Tab request 2 mục 19 → Send | 200 y hệt (`COMPLETED`), `Idempotency-Replayed: true` |
| | 3 | Sửa tab request 1: method `GET`, URL bỏ `/transactions` | `COMPLETED`, **đúng một** giao dịch `CHARGE` `SIM-7-1` |

### 5.4 Số request và thời gian (tính cả giải thích)

Ngưỡng: **Ổn** ≤ 25 s; **Sát** 26–32 s; **Vượt** > 32 s. Chỉ tính request chính, không tính `(tùy chọn)`.

| Mục | Request chính (+ lệnh) | Thao tác | Tổng gồm nói | Đánh giá | Ghi chú |
|---|---|---|---|---|---|
| 1, 3, 4 | 0 | — | ~30 s | Sát | Chỉ nói 3–4 ý (file 06) |
| 2 | 2 lệnh | ~12 s | ~22 s | Ổn | Bỏ `git check-ignore` (trùng ý) |
| 5 | 1 lệnh | ~6 s | ~20 s | Ổn | |
| 6 | 1 gõ + 2 sửa | ~15 s | ~25 s | Ổn | |
| 7 | trình duyệt | ~10 s | ~22 s | Ổn | |
| 8 | 1 lệnh + 1 | ~12 s | ~22 s | Ổn | |
| 9 | 1 gõ + 1 sửa | ~20 s | ~28 s | Sát | Body dài nhất của phần 1; 409 để tùy chọn. Sửa 2026-10-14: `auth/register` + email — độ dài như bản cũ |
| 10 | 1 sửa + 2 nhân bản | ~17 s | ~27 s | Sát | Ba role (UC02) và ba tab token. Sửa 2026-10-14: tab TX1 phải đổi cả tên field `email` → `phone` (+~2 s) nên làm **cuối** |
| 11 | 1 gõ + 1 sửa | ~15 s | ~23 s | Ổn | Body tạo hồ sơ (tùy chọn) dài thêm `"phone"` |
| 12 | 1 sửa + 1 nhân bản (dán token AD1) + 1 sửa | ~15 s | ~25 s | Ổn | Sửa 2026-10-14: thêm 403 của khách và tab admin; tab GET vẫn giữ token KH1 cho mục 13, 14, 16 |
| 13 | 2 sửa | ~12 s | ~24 s | Ổn | |
| 14 | 3 sửa | ~12 s | ~22 s | Ổn | Sửa 2026-10-14: `customers/1/bookings` + 403 `NOT_OWNER` với mã 2 |
| 15 | 1 gõ + 1 nhân bản | ~25 s | ~32 s | **Sát** | Không bớt được: phải thấy Offer **ở phía tài xế**. Token TX1 có sẵn từ mục 10 nên bỏ được request đăng nhập |
| 16 | 2 sửa | ~15 s | ~26 s | Sát | Thêm xem thông báo (A33) làm request chính vì phiếu ghi Notification cho mục 16 (CD-Q1) |
| 17 | 5 sửa | ~20 s | ~30 s | **Sát** | FR12: 4 bước + 1 lần thử sai; mỗi lần đổi một từ |
| 18 | 2 sửa ở tab GET | ~20 s | ~28 s | Sát | Tab GET đã mang token KH1 nên không phải đổi token (dùng tab chuyến mang TX1 thì ~36 s, Vượt — CD-Q2). Thông báo của KH1 chứng minh cả hoàn tiền (Payment) lẫn thông báo (Notification) |
| 19 | 1 gõ + 1 nhân bản | ~35 s | **~42 s** | **Vượt** | Hai request đều có header phụ (`Idempotency-Key` cho mục 30; `X-Callback-Secret` cho callback). Dự phòng 1 request ~25 s |
| 20 | 1 gõ + gửi lại | ~18 s | ~25 s | Ổn | |
| 21 | 1 gõ + 2 sửa | ~35 s | **~42 s** | **Vượt** | Ba bước nghiệp vụ khác nhau (OTP → tài khoản → hồ sơ) ở hai service; đã gộp đăng nhập vào A08. Đường dẫn `auth/otp`, `auth/driver-register` (2026-10-14) không đổi thời gian |
| 22 | 1 sửa | ~15 s | ~22 s | Ổn | Token AD1 có sẵn từ mục 10 |
| 23 | 2 sửa | ~10 s | ~20 s | Ổn | Dùng TX1 (đã có token); TX5 là phương án thay |
| 24 | 1 gửi lại + 1 lệnh | ~18 s | ~28 s | Sát | Bằng chứng at rest chỉ thấy trong database (Q52); lệnh `auth-db` để tùy chọn |
| 25 | 2 sửa | ~12 s | ~22 s | Ổn | Sửa 2026-10-14: injection trên `email` (400) và `password` (401); `INVALID_ID` để tùy chọn |
| 26 | 2 sửa | ~15 s | ~25 s | Ổn | |
| 27 | jwt.io + 1 sửa | ~20 s | ~30 s | Sát | Sửa 2026-10-14: sửa payload trên jwt.io (giảng viên); dự phòng sửa một ký tự (~20 s) |
| 28 | 2 sửa | ~10 s | ~20 s | Ổn | |
| 29 | 6 lần Send | ~5 s | ~18 s | Ổn | |
| 30 | 2 gửi lại + 1 sửa | ~10 s | ~22 s | Ổn | Phải còn hai tab của mục 19 |

So với lần 3: tiền tố `/api/v1` thêm 7 ký tự mỗi URL gõ mới, nhưng phần lớn request giờ là **sửa tab** nên không tốn thêm. Còn **2 mục vượt** (19, 21) và 8 mục sát (9, 10, 15, 16, 17, 18, 24, 27 — mục 10, 27 thành Sát từ 2026-10-14) — xem Q64.

Không chuỗi nào có bước **chờ**: Offer xuất hiện trong khoảng một giây sau đặt xe; Booking sang `SEARCHING` một nhịp K6 sau callback.

### 5.5 Thứ tự chạy và trạng thái seed bị đổi

| Điểm | Nội dung |
|---|---|
| Thứ tự đề xuất | 1–8 → 9 → **10** (tạo ba tab token) → 11 → 12 → **13, 14 trước 15** → 15 → 16 → 17 → 20 → 18 → **19 → 30 liền nhau** → 21 → 22 → 23 → 24 → 25 → 26 → 28 → **27** → **29 cuối cùng** (file 06 mục 3) |
| Chuỗi tab | **Tab GET** (`[KH1]`): 11 → 12 (request 1) → 13 → 14 → 16 (thông báo) → 18 (hủy chuyến + thông báo) → 24 → 25 (tùy chọn) → 26 → 27. **Tab admin** (`[AD1]`, tạo ở mục 12 — 2026-10-14): 12 → (14 tùy chọn). **Tab đặt xe** (mục 15 request 1): giữ cho mục 28. **Tab chuyến** (`[TX1]`): 15 (offers) → 16 → 17. **Hai tab thanh toán**: 19 → 30. **Tab tài xế**: 21 → 22 → 23 → 28. **Ba tab đăng nhập** KH1 (email), AD1 (email), TX1 (số điện thoại): 10 → 25, 29 (mục 25, 29 ở **tab đăng nhập KH1**) |
| 13, 14 trước 15 | Sau 15, TX1 bận (mục 13 còn 3 tài xế) và KH1 có thêm booking (mục 14 `total` > 7) |
| 15 → 16 → 17 | Dùng chung booking, Offer, trip 1000. Offer hạn `OFFER_TIMEOUT_SECONDS` = 300 giây: mục 16 phải trong 5 phút sau mục 15 |
| 19 → 30 | Sau mục 19, B7 đang tìm tài xế `CAR_7` (chỉ TX4). Không ai nhận thì sau 300 giây Payment 7 thành `REFUNDED` → chạy 30 **ngay sau** 19 |
| 15 và 19 không tranh tài xế | 15–17 dùng `CAR_4` (TX1); 19 dùng `CAR_7` (TX4) |
| 23 sau 17 | TX1 đã được trả về rảnh (K5 `COMPLETED`) nên bật / tắt được; kết thúc ở `ONLINE` như seed |
| 27 | Phần tùy chọn đăng xuất thu hồi token KH1 → làm gần cuối |
| 29 | Khóa route công khai theo IP tối đa 10 giây → làm cuối |
| Chấm lại từ đầu | `docker compose down -v` rồi `docker compose up -d --build` (file 03 mục 14) |
| Demo hết hạn (không bắt buộc) | Hạ `PAYMENT_TIMEOUT_SECONDS` hoặc `OFFER_TIMEOUT_SECONDS` trong `.env` rồi `docker compose up -d` |

## 6. Danh sách rpc gRPC theo service

Tên file: `proto/<service>.proto`. Mọi mã là `int64` (`proto-loader` `longs: Number`). Cột "Ai gọi": GW = Gateway; mã S là đường service → service của file 02. Mọi service thêm `grpc.health.v1.Health/Check` (G9). **Không đổi rpc ở lần 4**: quy tắc "không động từ" áp dụng cho **đường dẫn REST** (tài nguyên); rpc là tên hàm nên vẫn là động từ (`AcceptOffer`, `PayPayment`).

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
| | `ReserveDriver`, `ReleaseDriver` | **booking** | **S3** (`ReserveDriver` trả thêm họ tên, biển số — 2026-10-21) |
| booking | `CreateBooking` | GW | A19 (gọi S4; phát K1, rồi K2) |
| | `ListBookings`, `GetBooking` | GW | A20, A21 |
| | `CancelBooking` | GW | A22 (phát K4) |
| | `ListOffers` | GW | A23 |
| | `AcceptOffer` | GW | A24 (gọi S3, S5) |
| | `RejectOffer` | GW | A25 |
| trip | `CreateTrip` | **booking** | **S5** (mang họ tên, biển số tài xế; phát K5 `ACCEPTED`) |
| | `ListTrips`, `GetTrip` | GW | A26, A27 (không gọi ai) |
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

Tổng: **38 rpc nghiệp vụ** (auth 4, customer 3, driver 10, booking 7, trip 6, payment 4, notification 1, rating 3) + health. (Bỏ `GetDriverSummary` 2026-10-21.)

| Kiểm tra với file 02 | Kết quả |
|---|---|
| S2–S5, S7 đều có rpc (S1, S6 đã bỏ) | `FindNearbyDrivers`, `ReserveDriver` / `ReleaseDriver`, `CreatePayment`, `CreateTrip`, `GetTripForRating` |
| Không rpc nào đi **vào** booking, notification, auth, customer, rating từ service khác | Đúng |
| rpc không có đường REST | `ReserveDriver`, `ReleaseDriver`, `CreateTrip`, `CreatePayment`, `GetTripForRating` |
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

## 8. Khác thiết kế tham chiếu và bản trước

| Điểm | Trước (lần 3) | Ở đây (lần 4) | Vì sao |
|---|---|---|---|
| Tiền tố | Không có | `/api/v1` (trừ health) | Giảng viên (Q59) |
| Đổi trạng thái | Động từ trong đường dẫn: `/offers/{id}/accept`, `/reject`, `/trips/{id}/cancel`, `/bookings/{id}/cancel`, `/drivers/{id}/approve`, `/reject`, `/drivers/me/online`, `/offline`, `PATCH /trips/{id}/status` | `PATCH /api/v1/{resource}/{id}` + `status` (hoặc `approval_status`) | Chuẩn bài giảng: không động từ (R4) |
| Đăng ký, OTP | `/auth/register`, `/auth/otp`, `/auth/register-driver` | Lần 4: `accounts`, `otps`, `driver-accounts`. **2026-10-14: `/api/v1/auth/register`, `/auth/otp`, `/auth/driver-register`** | Giảng viên yêu cầu gom nhóm `auth` (ADR-021) |
| Định danh đăng nhập | — | 2026-10-05: chỉ số điện thoại. **2026-10-14: khách, admin email; tài xế số điện thoại** | ADR-021 |
| Danh sách booking (mục 14) | — | Lần 4: `GET /api/v1/bookings` (lọc theo token). **2026-10-14: `GET /api/v1/customers/{id}/bookings`** | Giảng viên: xem theo mã khách; admin xem được mọi khách |
| Xem tài xế theo mã (mục 12) | — | Lần 4: mọi role, khách thấy phần công khai. **2026-10-14: chỉ admin và chính tài xế** | Giảng viên (đóng Q53) |
| Health | — | Lần 4: `UP` / `READY` / `SERVING` / `DEGRADED`. **2026-10-14: `healthy` / `ready` / `not_ready` / `unhealthy`** | Giảng viên: giá trị trả về đúng chữ |
| Tạo hồ sơ | `POST /customers/me`, `POST /drivers/me` | `POST /api/v1/customers`, `POST /api/v1/drivers` | `POST` vào tập, không vào một phần tử |
| Sửa hồ sơ khách | `PUT /customers/me` | `PATCH /api/v1/customers/me` | Sửa một phần (đóng HS-Q4) |
| Tìm tài xế gần | `GET /drivers/nearby?…` | `GET /api/v1/drivers?lat&lng…` | Lọc bằng query (R5), ví dụ của giảng viên |
| Vị trí tài xế | `PUT /drivers/me/location` | `PATCH /api/v1/drivers/me` `{lat, lng}` | Thuộc tính của tài xế; chỉ còn ba method |
| Thanh toán, callback | `POST /payments/{id}/pay`, `POST /payments/callback` | `POST /api/v1/payments/{id}/transactions`, `POST /api/v1/payment-callbacks` | R7 |
| Đánh giá | `POST /trips/{id}/rating`, `GET /trips/{id}/rating`, `GET /drivers/{id}/rating` | `POST /api/v1/ratings`, `GET /api/v1/ratings?trip_id` / `?driver_id` | Tài nguyên của context Rating; số nhiều |
| Trạng thái Online của tài xế ở API | `availability` | `status` (cột vẫn `availability`) | Thống nhất "đổi trạng thái = `status`" |
| Mã | UUID (bản 2026-10-02) | Số nguyên; seed số nhỏ | ADR-015 |
| Tên field | `full_name`, `date_of_birth`, `vehicle_type`, `payment_method`, `pickup {lat,lng,address}`… | `name`, `dob`, `vehicle`, `pay`, `from: [lat, lng]` | Luật thi: body ngắn |
| `/driver-requests/{id}/accept` (tham chiếu) | Tên cũ | `PATCH /api/v1/offers/{id}` | Ngôn ngữ chung "Offer" |
| `/trips/{id}/payments` (tham chiếu) | Thanh toán gắn chuyến | `/api/v1/payments/{id}/…` | Trả trước: thanh toán gắn booking (ADR-009) |
| `/operator/*` (tham chiếu) | Nhóm route riêng | Không có; phân biệt bằng role | Một vai trò `admin` [ĐC] |
| Refresh token (tham chiếu) | Có bảng | Không có | Không FR nào yêu cầu |

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn, chưa ai xác nhận

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| P1 | Đường dẫn, tên rpc, mã lỗi trong file này | Bảng mục 2, 6 |
| P2 | Tài xế thấy Offer bằng A23 (GĐ-2, Q5) | Bỏ A23; mục 15 chứng minh bằng thông báo |
| ~~P3~~ | **Đã thay 2026-10-14 (giảng viên):** A14 chỉ admin và chính tài xế; khách 403 | — |
| P4 | Văn bản chứa `<`, `>` bị từ chối 400 | Mục 1.6; mục 26 |
| P5 | `/ready` trả 503 khi Redis dừng dù Gateway vẫn phục vụ | Mục 2.1 |
| P6 | Callback không bị rate limit; khóa trong header do `payment-service` kiểm tra | Mục 1.5, 2.7 |
| P7 | Không phải chủ trả 403 (không giả 404); A09 so mã trước khi đọc database | Mục 4 |
| P8 | `limit` tối đa 50; sai thì 400 | Mục 1.3 |
| P9 | Mục 18 dùng chuyến seed T5; mục 19 dùng B7 (`CAR_7`) | Mục 5 và seed |
| P10 | Tạo hồ sơ (`POST`, 409) và sửa hồ sơ (`PATCH`, 404) là hai API | Gộp thành upsert: mất đường lỗi "trùng" và "chưa có" |
| P11 | `simulate_result` nằm trong body A31 | Header riêng; khóa chống lặp phải tính cả header |
| ~~P12~~ | Đã thay: giữ `/api/v1` theo giảng viên (Q59 đóng) | — |
| P13 | Tên field ngắn và giá trị mặc định ở mục 1.8; enum không phân biệt hoa thường | Mục 1.8, spec từng mục |
| P14 | Gateway đọc body là JSON bất kể `Content-Type` | Mục 1 |
| P15 | A08 trả token | Mục 21 thêm một request đăng nhập |
| ~~P16~~ | Đã thay bằng P20 (bật / tắt là `PATCH /api/v1/drivers/me` + `status`) | — |
| P17 | Khóa chống lặp so body **đã chuẩn hóa** | File 03 mục 8.6 |
| P18 | A12 không có tham số bán kính | Thêm `radius` nếu giảng viên muốn thử bán kính khác |
| P19 | **Giữ mã A01–A39**; mã = thao tác (rpc), nhiều mã chung một đường dẫn (mục 1.10). Không đánh số lại | Đánh số theo route: phải đổi mã ở spec, file 05, ADR |
| P20 | Một đường dẫn `PATCH` nhiều biến thể, Gateway chọn rpc theo `status` / `approval_status` / query (mục 1.10); proto không đổi | Gộp rpc (`UpdateOffer`, `UpdateTrip`…): đổi proto và logic service |
| ~~P21~~ | **Đã thay 2026-10-14 (giảng viên):** nhóm `/api/v1/auth/register`, `/auth/otp`, `/auth/driver-register` | — |
| P22 | Ngoại lệ có động từ là **cả nhóm `auth`** (mục 1.9, sửa 2026-10-14) | Đổi sang tài nguyên danh từ (`accounts`, `otps`, `tokens`) |
| P26 (2026-10-14) | A05 nhận đúng một trong `email` / `phone`; cả hai / không có → 400 `INVALID_INPUT` ở Gateway | Cho phép cả hai thì phải định nghĩa ưu tiên |
| P27 (2026-10-14) | SQL injection trên `email` → **400 `INVALID_EMAIL`** (kiểm định dạng trước database), không phải 401 | Đổi sang 401 `INVALID_CREDENTIALS` (bỏ kiểm định dạng ở A05) — mất lý do "chặn ở cửa" |
| P28 (2026-10-14) | A14, A20: không phải chủ → 403 `NOT_OWNER` **trước khi đọc database** (như A09); A20 admin mã không có booking → 200 rỗng, không 404 | Tra trước rồi so chủ: lộ "mã có tồn tại không" |
| P29 (2026-10-14) | Health: mọi trạng thái không phải `SERVING` gộp thành `unhealthy`; chi tiết ghi log | Trả thêm field lý do (`reason`) cho từng service |
| P23 | `status` của tài xế ở API = cột `availability`; duyệt hồ sơ dùng `approval_status` | Đổi tên field API; A14, A17 |
| P24 | Đánh giá là tập gốc `ratings` (`trip_id` trong body) | Đổi về `/api/v1/trips/{id}/ratings` |
| P25 | Mục 10 đăng nhập ba role và tạo ba tab token; 401 chuyển sang tùy chọn | Mục 15, 22, 23 thêm một request đăng nhập |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| Q51 | Chống XSS bằng cách nào? | (a) Từ chối `<`, `>`; (b) lưu nguyên, escape khi trả; (c) escape trước khi lưu | (a) | SV / GV |
| Q52 | Mục 24 ghi "POSTMAN", nhưng dữ liệu "at rest" chỉ thấy trong database. Chứng minh bằng gì? | (a) Postman + lệnh `psql`; (b) API admin trả bản mã — không đề xuất | (a) | GV |
| ~~Q53~~ | Đã đóng 2026-10-14 (giảng viên): mục 12 — **(b) chỉ chính chủ và admin**; khách 403 | — | — | — |
| Q54 | Mục 18 chấm hủy Trip hay hủy Booking? | Cả hai có chuỗi | Hủy Trip là chính | GV |
| Q55 | Có cần API danh mục loại xe? | (a) Không; (b) `GET /api/v1/vehicle-types` | (a) | SV |
| ~~Q59~~ | Đã đóng 2026-10-03: **giữ `/api/v1`** theo cấu trúc `/api/{version}/{resource}/{id}?{query-params}` (giảng viên) | — | — | — |
| ~~Q60~~ | Đã đóng 2026-10-03: **được** dùng lại tab đã gõ và mở tab mới | — | — | — |
| ~~Q61~~ | Đã đóng 2026-10-03: 30 giây **gồm cả giải thích** | — | — | — |
| Q62 | Token sống 3 600 giây. Buổi thi dài hơn một giờ thì phải đăng nhập lại | (a) Giữ, gặp 401 `TOKEN_EXPIRED` thì Send lại tab đăng nhập; (b) tăng trong `.env.example` | (a) — ba tab token có sẵn, mỗi lần một Send | SV |
| Q63 | Mục 17 có 5 request (FR12 có 4 bước). Có cần seed thêm chuyến đang `IN_PROGRESS` để demo nhanh không? | (a) Không; (b) thêm seed T8 | (a) — mỗi request chỉ đổi một từ | SV |
| Q64 | Mục 19 (~42 s) và 21 (~42 s) vẫn vượt 30 giây khi tính cả giải thích. Giảng viên có chấp nhận, hay dùng phương án rút gọn? | (a) Chạy đủ, nói nhanh; (b) mục 19 dùng dự phòng 1 request (không `MANUAL`, nói bằng lời bước callback); mục 21 bỏ bước nộp hồ sơ, dùng TX7 seed để thấy `PENDING`; (c) hỏi được chia làm hai lượt | (a), dự phòng (b) cho 19 | GV |
| ~~Q65~~ | Đã đóng 2026-10-14: giảng viên yêu cầu gom cả nhóm xác thực vào `/api/v1/auth/…` | — | — | — |
| Q67 (2026-10-14) | Mục 27 demo bằng jwt.io cần Internet ở phòng thi. Không có mạng thì sao? | (a) Dự phòng sửa một ký tự ở giữa token trong Postman; (b) giải base64 payload bằng lệnh terminal | (a) — cùng kết quả 401, không cần mạng | GV |
| Q68 (2026-10-14) | Mục 12 có cần cho khách thấy 403 (request 1) không, hay chỉ cần admin 200 + 404? | (a) Giữ 3 request (thấy cả luật phân quyền mới); (b) bỏ request 1 cho nhanh | (a) — vẫn ~25 s | SV |
| Q66 | Mục 10 đăng nhập ba role thay vì thử sai mật khẩu — có đúng ý "đăng nhập → cấp token" của phiếu chấm không? | (a) Ba role (UC02, tạo sẵn token); (b) KH1 đúng + sai mật khẩu | (a); nếu được hỏi thì làm thêm (4) | GV |

Chưa kiểm tra được ở vòng thiết kế: thời gian thực của từng chuỗi khi vừa gõ vừa nói; số mét chính xác của tuyến P0 → D0 (≈ 2 026 m); độ trễ đặt xe → Offer và callback → `SEARCHING`.
