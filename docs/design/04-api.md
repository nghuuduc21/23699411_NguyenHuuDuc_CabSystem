# 04 — API REST của Gateway

> Vòng 1 (chỉ BA), viết 2026-10-02. Đầu vào: `CLAUDE.md`, `srs.md` (FR01–FR42, BRULE01–17, UC01–UC33), file 01, file 02 (G1–G10, S1–S7, K1–K7), file 03, phiếu chấm 30 mục.
> File này trả lời: **client gọi gì, ai được gọi, service nào xử lý, mỗi mục chấm bấm những request nào**. Request / response từng field và `.proto`: spec của từng mục chấm.
> Ký hiệu: **[ĐC]** = đã chốt trong `CLAUDE.md` / `srs.md`. **[BA]** = BA tự chọn, chưa ai xác nhận (gom ở mục 9).

## 1. Quy ước chung

| Điểm | Quy ước | Nguồn / lý do |
|---|---|---|
| Địa chỉ | `http://localhost:3000` — cổng duy nhất cho nghiệp vụ | Mục chấm 8 |
| Tiền tố | `/api/v1` cho mọi API nghiệp vụ. Ba endpoint health **không** có tiền tố: `/health`, `/ready`, `/health/services` | Phiếu chấm mục 6 ghi đúng ba đường dẫn đó |
| Định dạng | Request và response là JSON, `Content-Type: application/json; charset=utf-8`; tên field `snake_case` | `CLAUDE.md` |
| Token | `Authorization: Bearer <JWT>`. JWT mang `sub` (= `account_id`), `role`, `jti`, `exp` | NFR06; `jti` để thu hồi khi đăng xuất (FR42) |
| ID | UUID. Sai định dạng → 400 ngay ở Gateway | Mục 25: chuỗi lạ không đi tới SQL |
| Thời điểm | ISO 8601 UTC, ví dụ `2026-10-02T03:15:00Z` | File 03 mục 2 |
| Tiền | Số nguyên, đơn vị đồng | File 03 mục 2 |
| Thành công | 200 (đọc, cập nhật, thao tác), 201 (tạo mới). Một đối tượng thì trả thẳng đối tượng; danh sách thì theo mục 1.3 | |
| Lỗi | `{ "error": "MA_LOI" }`, không kèm stack trace | `CLAUDE.md` |
| Thứ tự kiểm tra | 429 → 401 → 403 (role) → 400 (hình thức) → service: 404 → 403 (không phải chủ) → 409 → 400 (nghiệp vụ) | Lỗi rẻ nhất trả trước; request sai không tốn lời gọi gRPC |
| Header bảo vệ | Mọi response: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` | Mục chấm 26, NFR08 |
| Mã request | Gateway sinh `X-Request-Id`, trả về trong response và chuyển cho service qua metadata | Log (NFR10) |

### 1.1 Đổi gRPC status sang HTTP [ĐC]

| gRPC status | HTTP | Khi nào | Ví dụ mã lỗi |
|---|---|---|---|
| `OK` | 200 / 201 | | |
| `INVALID_ARGUMENT` | 400 | Thiếu trường, sai kiểu, sai giá trị | `INVALID_INPUT`, `INVALID_PHONE`, `INVALID_COORDINATES`, `INVALID_PAGINATION`, `TEXT_CONTAINS_HTML`, `OTP_INVALID`, `OTP_EXPIRED`, `REASON_REQUIRED` |
| `UNAUTHENTICATED` | 401 | Sai thông tin đăng nhập; chữ ký callback sai | `INVALID_CREDENTIALS`, `INVALID_SIGNATURE` |
| `PERMISSION_DENIED` | 403 | Không phải chủ dữ liệu; tài khoản bị khóa | `NOT_OWNER`, `ACCOUNT_LOCKED` |
| `NOT_FOUND` | 404 | Không có đối tượng | `CUSTOMER_NOT_FOUND`, `DRIVER_NOT_FOUND`, `BOOKING_NOT_FOUND`, `TRIP_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `OFFER_NOT_FOUND`, `RATING_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
| `ALREADY_EXISTS` | 409 | Trùng | `PHONE_ALREADY_EXISTS`, `APPLICATION_ALREADY_EXISTS`, `LICENSE_PLATE_ALREADY_EXISTS`, `RATING_ALREADY_EXISTS` |
| `FAILED_PRECONDITION` | 409 | Đúng dữ liệu nhưng sai thời điểm / sai trạng thái | `INVALID_STATUS_TRANSITION`, `BOOKING_NOT_CANCELABLE`, `BOOKING_ALREADY_ASSIGNED`, `TRIP_NOT_CANCELABLE`, `TRIP_NOT_COMPLETED`, `OFFER_EXPIRED`, `DRIVER_NOT_APPROVED`, `DRIVER_NOT_AVAILABLE`, `PAYMENT_ALREADY_COMPLETED`, `PAYMENT_EXPIRED`, `PAYMENT_ATTEMPTS_EXHAUSTED`, `IDEMPOTENCY_KEY_REUSED` |
| Còn lại (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, …) | 503 | Service không chạy, quá deadline, lỗi không lường trước | `SERVICE_UNAVAILABLE` |

Lỗi do **Gateway tự trả**, không qua gRPC:

| HTTP | Mã lỗi | Khi nào |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_ID`, `INVALID_JSON`, `IDEMPOTENCY_KEY_REQUIRED` | Kiểm tra hình thức trước khi gọi service |
| 401 | `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` | Mục chấm 27; FR42 |
| 403 | `FORBIDDEN` | Role trong token không nằm trong danh sách của route (mục chấm 28) |
| 404 | `ROUTE_NOT_FOUND` | Đường dẫn không tồn tại |
| 429 | `RATE_LIMITED` | Mục chấm 29 |

Danh sách mã lỗi là mức thiết kế; spec từng mục chốt mã cho từng endpoint.

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
| Tham số | `page` (số nguyên ≥ 1, mặc định 1); `limit` (số nguyên 1…50, mặc định 10) |
| Sai | `page=0`, `limit=abc`, `limit=1000` → 400 `INVALID_PAGINATION` (không âm thầm sửa giá trị) |
| Response | `{ "data": [ … ], "pagination": { "page": 1, "limit": 10, "total": 6, "total_pages": 1 } }` |
| Thứ tự | Cố định cho từng API (ghi ở bảng mục 2) để trang không lặp, không sót |
| Vì sao `page` + `limit` mà không con trỏ | Phiếu chấm ghi "limit + paging"; dữ liệu ít; có `total` để người chấm thấy tổng số. Đánh đổi: trang sâu chậm dần — không gặp ở quy mô này |

API có phân trang: A12 (mục 13), A20 (mục 14), A13, A26, A33.

### 1.4 Chống lặp cho thanh toán (mục chấm 30)

| Điểm | Quy ước |
|---|---|
| Header | `Idempotency-Key: <UUID do client sinh>`, **bắt buộc** với A31 (khách thực hiện thanh toán). Thiếu → 400 `IDEMPOTENCY_KEY_REQUIRED` |
| Cùng khóa, cùng nội dung | Trả **đúng response lần đầu** (cùng mã HTTP, cùng body), kèm header `Idempotency-Replayed: true`. Không tạo giao dịch mới |
| Cùng khóa, khác nội dung | 409 `IDEMPOTENCY_KEY_REUSED` |
| Phạm vi của khóa | Theo từng tài khoản (file 03 mục 8.6) |
| Callback của Provider (A32) | Không dùng header này. Chống lặp theo `provider_transaction_id`: callback gửi lại trả đúng response cũ kèm `Idempotency-Replayed: true`, không đổi trạng thái, không phát lại event |
| Gateway làm gì | Chỉ chuyển header vào gRPC metadata. Việc nhớ và trả lại response do `payment-service` làm (Gateway không giữ dữ liệu nghiệp vụ) |

### 1.5 Rate limit (mục chấm 29)

| Điểm | Quy ước |
|---|---|
| Nhóm công khai (A04, A05, A07, A08) | Đếm theo **IP** của kết nối; ngưỡng `RATE_LIMIT_PUBLIC_MAX` mỗi `RATE_LIMIT_WINDOW_SECONDS` |
| Nhóm có token | Đếm theo **`account_id`**; ngưỡng `RATE_LIMIT_ACCOUNT_MAX` |
| Không giới hạn | A01–A03 (health) và A32 (callback: xác thực bằng chữ ký; Provider gửi nhiều callback từ cùng một IP là bình thường) |
| Header mọi response có giới hạn | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (số giây đến hết cửa sổ) |
| Vượt ngưỡng | 429 `{ "error": "RATE_LIMITED" }` + `Retry-After: <giây>` |
| IP lấy ở đâu | Địa chỉ của kết nối TCP. **Không** tin header `X-Forwarded-For` vì không có proxy nào đứng trước Gateway và client tự đặt được header đó |
| Redis dừng [ĐC] | Cho qua, ghi log cảnh báo; không có header `RateLimit-*` |

Ba con số là biến môi trường (file 03 mục 13) để hạ thấp khi demo.

### 1.6 Văn bản do người dùng nhập (mục chấm 26) [BA]

Field văn bản tự do: họ tên, địa chỉ đón / trả, lý do hủy, lý do từ chối hồ sơ, nhận xét đánh giá, hãng / mẫu / màu xe.

| Lớp | Làm gì | Ở đâu |
|---|---|---|
| 1 | Chứa ký tự `<` hoặc `>` → **400 `TEXT_CONTAINS_HTML`**; không lưu | Gateway (kiểm tra hình thức); service kiểm tra lại vì là chủ dữ liệu |
| 2 | Response luôn là JSON kèm `nosniff` và CSP `default-src 'none'`: trình duyệt không chạy nội dung response như HTML | Gateway |
| 3 | Giới hạn độ dài từng field (file 03) | Gateway và CHECK trong database |

Lý do chọn từ chối thay vì "lưu rồi escape khi hiển thị": API chỉ trả JSON, không có trang HTML nào để escape; từ chối ở cửa vào cho kết quả demo rõ ràng và không biến đổi dữ liệu. Đánh đổi: người dùng không gõ được dấu `<`, `>` trong nhận xét.

### 1.7 Danh tính chuyển cho service

Gateway kiểm tra token xong thì chuyển cho service qua gRPC metadata: `x-account-id`, `x-role`, `x-request-id`, và `idempotency-key` (nếu có). Service **không** tự kiểm tra JWT; tin metadata vì chỉ Gateway vào được mạng nội bộ (file 02 mục 2.2).

## 2. Bảng API

Cột **Token**: "Không" = công khai; "Có" = cần JWT hợp lệ. Cột **Role**: role được Gateway cho qua; "(chủ)" = service còn kiểm tra đúng chủ dữ liệu (mục 4). Tổng: **36 API**.

### 2.1 Gateway và xác thực

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A01 | `GET /health` | Không | — | Gateway tự trả: tiến trình còn sống | 6 | — |
| A02 | `GET /ready` | Không | — | Gateway: kiểm tra Redis và đã tạo kênh gRPC | 6 | — |
| A03 | `GET /health/services` | Không | — | Cả 8 service — `grpc.health.v1.Health/Check` (G9) | 6 | NFR15 |
| A04 | `POST /api/v1/auth/register` | Không | — | auth — `RegisterCustomer` (→ S1) | 9 | FR26 / UC01 |
| A05 | `POST /api/v1/auth/login` | Không | — | auth — `Login` | 10, 25 | FR26 / UC02 |
| A06 | `POST /api/v1/auth/logout` | Có | Cả ba | **Gateway + Redis**, không gọi service | 27 (bổ trợ) | FR42 / UC33 |
| A07 | `POST /api/v1/auth/driver/otp` | Không | — | auth — `RequestDriverOtp` | 21 | FR39 / UC29 |
| A08 | `POST /api/v1/auth/driver/register` | Không | — | auth — `RegisterDriver` (kiểm tra OTP, tạo tài khoản `driver`) | 21 | FR39, FR26 / UC29 |

Ý nghĩa ba endpoint health:

| Endpoint | Trả lời câu hỏi | 200 khi | 503 khi |
|---|---|---|---|
| `/health` | Gateway còn sống không? | Luôn, nếu tiến trình chạy | — |
| `/ready` | Gateway đủ phụ thuộc của **chính nó** chưa? | Redis trả lời | Redis không trả lời [BA: vẫn phục vụ request nhưng báo "chưa đủ"] |
| `/health/services` | Tám service phía sau thế nào? | Cả 8 `SERVING` | Có service không trả lời; body liệt kê từng service |

### 2.2 Khách hàng và tài xế

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A09 | `GET /api/v1/customers/{customer_id}` | Có | customer (chủ), admin | customer — `GetCustomer` | 11, 24 | FR27 / UC03, UC19 |
| A10 | `PUT /api/v1/customers/{customer_id}` | Có | customer (chủ) | customer — `UpdateCustomer` | 26 | FR27 / UC03 |
| A11 | `POST /api/v1/drivers/applications` | Có | driver | driver — `SubmitApplication` | 21 | FR39, FR28, FR29 / UC29 |
| A12 | `GET /api/v1/drivers/nearby?lat&lng&radius_m&vehicle_type&page&limit` | Có | customer, admin | driver — `FindNearbyDrivers` | **13** | FR02–FR04 / UC06 |
| A13 | `GET /api/v1/drivers?approval_status&page&limit` | Có | admin | driver — `ListDrivers` | 22 | FR28, FR39 / UC20, UC30 |
| A14 | `GET /api/v1/drivers/{driver_id}` | Có | Cả ba | driver — `GetDriver` | 12 | FR28, FR29 / UC20, UC21 |
| A15 | `POST /api/v1/drivers/{driver_id}/approve` | Có | admin | driver — `ApproveDriver` | 22, 28 | FR39 / UC30 |
| A16 | `POST /api/v1/drivers/{driver_id}/reject` | Có | admin | driver — `RejectDriver` | 22 | FR39 / UC30 |
| A17 | `PUT /api/v1/drivers/me/availability` | Có | driver | driver — `SetAvailability` | 23 | FR38 / UC28 |
| A18 | `PUT /api/v1/drivers/me/location` | Có | driver | driver — `UpdateLocation` | Bổ trợ 13, 15 | FR13 / UC12 |

Ghi chú:

- A12: `radius_m` mặc định 1000, tối đa 5000; `vehicle_type` tùy chọn. Kết quả chỉ gồm tài xế đã duyệt, đang `ONLINE` (D1–D3), sắp theo khoảng cách tăng dần, mỗi dòng có `distance_m`. Cùng rpc với S2 của `booking-service`.
- A14 [BA]: tài xế xem chính mình và admin thấy đủ hồ sơ (kể cả số giấy phép đã giải mã, trạng thái duyệt). Role khác thấy **phần công khai**: họ tên, loại xe, biển số, trạng thái nhận chuyến.
- A17: body `{ "status": "ONLINE" | "OFFLINE" }`; khi `ONLINE` kèm `lat`, `lng` (tài xế phải có vị trí mới tìm được). Chưa được duyệt → 409 `DRIVER_NOT_APPROVED` (D6). Đang `BUSY` mà tắt → 409.
- Route tĩnh (`/drivers/nearby`, `/drivers/applications`, `/drivers/me/…`) được so khớp **trước** route có tham số `/drivers/{driver_id}`.

### 2.3 Đặt xe và ghép tài xế

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A19 | `POST /api/v1/bookings` | Có | customer | booking — `CreateBooking` (→ S4, rồi S2 chạy nền) | **15**, 19 | FR01, FR16, FR35 / UC04 |
| A20 | `GET /api/v1/bookings?status&page&limit` | Có | customer | booking — `ListBookings` | **14** | FR37 / UC18 |
| A21 | `GET /api/v1/bookings/{booking_id}` | Có | customer (chủ), admin | booking — `GetBooking` | 15, 16, 19 | FR35 / UC04 |
| A22 | `POST /api/v1/bookings/{booking_id}/cancel` | Có | customer (chủ) | booking — `CancelBooking` | 18 | FR36 / UC27 |
| A23 | `GET /api/v1/offers?status&page&limit` | Có | driver | booking — `ListOffers` | 15 | FR06 / UC07 |
| A24 | `POST /api/v1/offers/{offer_id}/accept` | Có | driver (chủ) | booking — `AcceptOffer` (→ S3, S5) | **16** | FR07, FR11 / UC08 |
| A25 | `POST /api/v1/offers/{offer_id}/reject` | Có | driver (chủ) | booking — `RejectOffer` | 15 | FR08 / UC09 |

Ghi chú:

- A19 body: điểm đón và điểm đến (`lat`, `lng`, `address`), `vehicle_type`, `payment_method`. Response 201: `booking_id`, `status` (`SEARCHING` nếu `CASH`, `PENDING_PAYMENT` nếu `ONLINE`), `estimated_distance_m`, `distance_km`, `fare_amount`, `payment_id`. Khách **không chờ** ghép xong (B2).
- A20: chỉ trả booking của chính khách trong token; không nhận `customer_id` từ client. Thứ tự: `created_at` giảm dần.
- A22: body `{ "reason": "…" }` bắt buộc. Booking đã phân công → 409 `BOOKING_ALREADY_ASSIGNED` (phải hủy chuyến bằng A29).
- A23: Offer của chính tài xế trong token; mặc định `status=PENDING`.
- A24 response 200 kèm `trip_id` (B17).

### 2.4 Chuyến đi

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A26 | `GET /api/v1/trips?status&page&limit` | Có | Cả ba | trip — `ListTrips` | Ngoài phiếu | FR30, FR34 / UC18, UC22 |
| A27 | `GET /api/v1/trips/{trip_id}` | Có | customer (chủ), driver (chủ), admin | trip — `GetTrip` (→ S6) | 16, 17, 18 | FR14 / UC10 |
| A28 | `PATCH /api/v1/trips/{trip_id}/status` | Có | driver (chủ) | trip — `UpdateTripStatus` | **17** | FR12 / UC11 |
| A29 | `POST /api/v1/trips/{trip_id}/cancel` | Có | customer (chủ), driver (chủ) | trip — `CancelTrip` | **18** | FR36, FR41 / UC27, UC32 |

Ghi chú:

- A26: khách và tài xế chỉ thấy chuyến của mình; admin thấy tất cả. **Làm sau khi xong 30 mục** (Q32).
- A27: response gồm trạng thái, bản chụp cước, lịch sử trạng thái, và thông tin tài xế / xe / vị trí lấy qua S6. Phần S6 làm sau cùng; khi `driver-service` không trả lời thì bỏ trống phần đó kèm cờ `driver_info_available: false`.
- A28: body `{ "status": "ARRIVED" | "PICKED_UP" | "IN_PROGRESS" | "COMPLETED" }`. Sai trình tự → 409 `INVALID_STATUS_TRANSITION` (T2).
- A29: body `{ "reason": "…" }` bắt buộc. Đã đón khách → 409 `TRIP_NOT_CANCELABLE` (BRULE16).

### 2.5 Thanh toán, thông báo, đánh giá

| Mã | Method, đường dẫn | Token | Role | Service — rpc | Mục chấm | FR / UC |
|---|---|---|---|---|---|---|
| A30 | `GET /api/v1/payments/{payment_id}` | Có | customer (chủ), admin | payment — `GetPayment` | 18, 19, 30 | FR20 / UC24 |
| A31 | `POST /api/v1/payments/{payment_id}/pay` | Có + `Idempotency-Key` | customer (chủ) | payment — `PayPayment` | **19, 30** | FR18, FR19 / UC14, UC15 |
| A32 | `POST /api/v1/payments/callback` | **Không; chữ ký HMAC** | — | payment — `HandleProviderCallback` | **19, 30** | FR18 / UC14 |
| A33 | `GET /api/v1/notifications?page&limit` | Có | Cả ba | notification — `ListNotifications` | 16, 18, 22 | FR21–FR24 / UC16 |
| A34 | `POST /api/v1/trips/{trip_id}/rating` | Có | customer (chủ) | rating — `CreateRating` (→ S7) | **20** | FR25 / UC17 |
| A35 | `GET /api/v1/trips/{trip_id}/rating` | Có | customer (chủ), driver (chủ), admin | rating — `GetRatingByTrip` | 20 | FR25 |
| A36 | `GET /api/v1/drivers/{driver_id}/rating` | Có | Cả ba | rating — `GetDriverRating` | 20 | UC17 bước 5 |

Ghi chú:

- A30: response gồm trạng thái, số tiền, **từng thành phần cước** (`distance_m`, `base_fare`, `per_km_rate`, `min_fare`, `total_amount`), hạn thanh toán, và danh sách các lần giao dịch. Không field nào chứa thông tin thẻ (BRULE09).
- A31: mỗi lần gọi (với khóa mới) là **một lần thử** (BRULE17). Response: `transaction_id`, `provider_transaction_id`, `attempt_no`, `attempts_remaining`, `expires_at`. Payment đã `COMPLETED` → 409; quá hạn → 409 `PAYMENT_EXPIRED`; hết lượt → 409 `PAYMENT_ATTEMPTS_EXHAUSTED`. Payment `CASH` → 409.
- A33: thông báo của chính người trong token, mới nhất trước.
- A34: body `{ "score": 1…5, "comment": "…" }`. Chuyến chưa hoàn thành → 409 `TRIP_NOT_COMPLETED`; không phải khách của chuyến → 403; đã đánh giá → 409 `RATING_ALREADY_EXISTS`.

### 2.6 Xác thực callback thanh toán (A32)

Callback không mang JWT của người dùng: bên gọi là Payment Provider, không phải người dùng.

| Điểm | Thiết kế | Vì sao |
|---|---|---|
| Cách xác thực | Header `X-Provider-Signature: sha256=<hex>` = HMAC-SHA256 của **nguyên văn body** với khóa chung `PAYMENT_CALLBACK_SECRET` | Chứng minh callback do bên giữ khóa gửi và body không bị sửa |
| Ai kiểm tra | `payment-service`. Gateway chuyển **nguyên byte body** và header chữ ký qua gRPC, không phân tích lại JSON | Khóa của Provider thuộc context Payment (file 02 mục 2.2). JSON bị ghi lại thì chữ ký không còn khớp |
| Sai / thiếu chữ ký | 401 `INVALID_SIGNATURE` | |
| So sánh chữ ký | So sánh thời gian hằng | Không lộ thông tin qua thời gian phản hồi |
| Body | `provider_transaction_id`, `result` (`SUCCESS` / `FAILED`), `amount` | `amount` khác số tiền của giao dịch → 400 |
| Mã giao dịch lạ | 404 `TRANSACTION_NOT_FOUND` | |
| Gửi lại (replay) | Trả response cũ, `Idempotency-Replayed: true` | Mục chấm 30 |
| Không kiểm tra "callback quá cũ" | Không có giới hạn thời gian trên chữ ký | Phiếu chấm yêu cầu replay **trả response cũ**, không phải bị từ chối |
| Giả lập [BA] | Postman đóng vai Provider: script trước request tính chữ ký bằng `PAYMENT_CALLBACK_SECRET` đặt trong môi trường Postman, gửi **ngay** sau A31, không có bước chờ | File 02 đường C2; xem Q50 |

## 3. Ma trận phân quyền (mục chấm 28)

Ô là HTTP status mong đợi khi dữ liệu hợp lệ. **200\*** / **201\*** = chỉ với dữ liệu của chính mình; của người khác → 403 (do service trả). 401 và 403 theo role do Gateway trả.

| Mã | API | Không đăng nhập | customer | driver | admin |
|---|---|---|---|---|---|
| A01–A03 | Health | 200 | 200 | 200 | 200 |
| A04 | Đăng ký khách | 201 | 201 | 201 | 201 |
| A05 | Đăng nhập | 200 | 200 | 200 | 200 |
| A06 | Đăng xuất | 401 | 200 | 200 | 200 |
| A07 | Xin OTP tài xế | 200 | 200 | 200 | 200 |
| A08 | Đăng ký tài xế | 201 | 201 | 201 | 201 |
| A09 | Xem khách hàng theo mã | 401 | 200\* | 403 | 200 |
| A10 | Sửa hồ sơ khách | 401 | 200\* | 403 | 403 |
| A11 | Nộp hồ sơ tài xế | 401 | 403 | 201 | 403 |
| A12 | Tài xế quanh tọa độ | 401 | 200 | 403 | 200 |
| A13 | Danh sách tài xế | 401 | 403 | 403 | 200 |
| A14 | Xem tài xế theo mã | 401 | 200 (công khai) | 200 (đủ nếu là mình) | 200 (đủ) |
| A15 | Duyệt hồ sơ | 401 | **403** | 403 | 200 |
| A16 | Từ chối hồ sơ | 401 | 403 | 403 | 200 |
| A17 | Bật / tắt nhận chuyến | 401 | 403 | 200 | 403 |
| A18 | Gửi vị trí | 401 | 403 | 200 | 403 |
| A19 | Đặt xe | 401 | 201 | **403** | 403 |
| A20 | Danh sách booking | 401 | 200\* | 403 | 403 |
| A21 | Xem booking | 401 | 200\* | 403 | 200 |
| A22 | Hủy booking | 401 | 200\* | 403 | 403 |
| A23 | Offer của tôi | 401 | 403 | 200\* | 403 |
| A24 | Nhận Offer | 401 | 403 | 200\* | 403 |
| A25 | Từ chối Offer | 401 | 403 | 200\* | 403 |
| A26 | Danh sách chuyến | 401 | 200\* | 200\* | 200 |
| A27 | Xem chuyến | 401 | 200\* | 200\* | 200 |
| A28 | Cập nhật trạng thái chuyến | 401 | 403 | 200\* | 403 |
| A29 | Hủy chuyến | 401 | 200\* | 200\* | 403 |
| A30 | Xem thanh toán | 401 | 200\* | 403 | 200 |
| A31 | Thực hiện thanh toán | 401 | 200\* | 403 | 403 |
| A32 | Callback | 200 nếu chữ ký đúng; 401 nếu sai | — | — | — |
| A33 | Thông báo của tôi | 401 | 200\* | 200\* | 200\* |
| A34 | Đánh giá chuyến | 401 | 201\* | 403 | 403 |
| A35 | Xem đánh giá của chuyến | 401 | 200\* | 200\* | 200 |
| A36 | Điểm của tài xế | 401 | 200 | 200 | 200 |

Hai ô in đậm là hai request demo của mục 28: khách gọi API duyệt hồ sơ; tài xế gọi API đặt xe.

Admin **không** hủy được chuyến (A29 → 403): BRULE16 chỉ nói về khách và tài xế; FR31 chưa thiết kế (Q45).

## 4. Kiểm tra quyền sở hữu

Nguyên tắc: **Gateway kiểm tra role; service kiểm tra chủ dữ liệu.**

| Vì sao không kiểm tra ở Gateway | |
|---|---|
| Gateway không có dữ liệu | Muốn biết booking này của ai thì phải đọc database của Booking hoặc gọi thêm một lời gRPC — cả hai đều trái "Gateway không chứa logic nghiệp vụ, không truy cập database nghiệp vụ" |
| Là quy tắc nghiệp vụ | "Chỉ tài xế của chuyến mới cập nhật trạng thái" (T3) thuộc Trip, phải nằm cùng chỗ với dữ liệu Trip |
| Một lần đọc | Service đằng nào cũng đọc đối tượng để xử lý; so `x-account-id` với chủ là thêm một phép so sánh |

| API | Chủ dữ liệu là | Service so `x-account-id` với | Quy tắc (file 01) | Không phải chủ |
|---|---|---|---|---|
| A09, A10 | Khách có hồ sơ | `customer_profiles.customer_id` (admin được xem, không được sửa) | C2 | 403 |
| A14 | Tài xế có hồ sơ | `drivers.driver_id` — khác thì trả phần công khai, không lỗi | NFR08 | — |
| A17, A18 | Tài xế trong token | Không nhận ID từ client: dùng thẳng `x-account-id` | D6 | — |
| A20, A23, A33 | Người trong token | Lọc theo `x-account-id`; không nhận ID người khác từ client | B14, N2 | — |
| A21, A22 | Khách của booking | `bookings.customer_id` | B13, B14 | 403 |
| A24, A25 | Tài xế được mời | `driver_offers.driver_id` | B9 | 403 |
| A27 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` theo role | T7 | 403 |
| A28 | Tài xế của chuyến | `trips.driver_id` | T3 | 403 |
| A29 | Khách hoặc tài xế của chuyến | `trips.customer_id` / `trips.driver_id` | T5 | 403 |
| A30, A31 | Khách của thanh toán | `payments.customer_id` | NFR08 | 403 |
| A34 | Khách của chuyến | `customer_id` do Trip trả về qua S7 | V2 | 403 |
| A35 | Khách hoặc tài xế của chuyến | `ratings.customer_id` / `ratings.driver_id` | NFR08 | 403 |

Trả 403 chứ không 404 khi không phải chủ: ID là UUID không đoán được nên không lo lộ "đối tượng có tồn tại"; 403 giúp demo mục 28 rõ ràng. Đối tượng không tồn tại thì 404 (service chưa biết chủ là ai).

Cách thiết kế giảm chỗ phải kiểm tra: API "của tôi" (A17, A18, A20, A23, A33) **không có ID trong đường dẫn**, nên không thể gọi nhầm dữ liệu người khác.

## 5. Mục chấm → chuỗi request Postman

Ước lượng: mỗi request khoảng 4–5 giây khi bấm tay và đọc kết quả, nên **tối đa 6 request cho một mục**. Chạy cả thư mục bằng Runner thì chỉ vài giây. Biến Postman (token, ID) do script của request trước lưu lại. "Seed" = dữ liệu ở file 03 mục 14.

### 5.1 Thực hành 1 (mục 6–10)

| Mục | Chuỗi request | Kết quả mong đợi | Số request | Cần trước |
|---|---|---|---|---|
| 6 | A01 → A02 → A03 | 200; 200; 200 với 8 service `SERVING` | 3 | Compose đang chạy |
| 7 | (Không phải Postman) Mở `http://localhost:8080` → Topics; sau đó chạy mục 15 và xem message | Thấy đủ 7 topic; `booking.created`, `booking.offer-created` có message; group `notification-service` lag 0 (file 02 mục 7) | 0 + mục 15 | — |
| 8 | (Không phải Postman) `docker compose ps`; thử gọi thẳng một service từ máy chủ | Chỉ `gateway` :3000 và `kafka-ui` :8080 có cổng; gọi thẳng service thất bại | 0 | — |
| 9 | A04 (số điện thoại mới) → A05 → A04 lần hai cùng số | 201 kèm `account_id`; 200 kèm token; 409 `PHONE_ALREADY_EXISTS` | 3 | — |
| 10 | A05 đúng → A05 sai mật khẩu → A05 thiếu mật khẩu → A05 bằng KH9 | 200 kèm token (lưu biến); 401 `INVALID_CREDENTIALS`; 400; 403 `ACCOUNT_LOCKED` | 4 | Mục 9 hoặc seed KH1; KH9 |

### 5.2 Thực hành 2 (mục 11–20)

| Mục | Chuỗi request | Kết quả mong đợi | Số request | Cần trước |
|---|---|---|---|---|
| 11 | A09 (mã của mình) → A09 không token → A09 với mã của KH2 | 200 hồ sơ; 401; 403 | 3 | Token khách (mục 10); seed KH2 |
| 12 | A14 (TX1) → A14 với UUID không tồn tại → A14 với mã `abc` | 200; 404 `DRIVER_NOT_FOUND`; 400 `INVALID_ID` | 3 | Token; seed TX1 |
| 13 | A12 tại P0, `limit=2&page=1` → `page=2` → `vehicle_type=CAR_4` → `lat=999` | 200: TX1, TX3, `total=4`; 200: TX2, TX4; 200: TX1, TX2; 400 `INVALID_COORDINATES` | 4 | Seed TX1–TX8 ở trạng thái đầu |
| 14 | A20 `limit=2&page=1` → `page=3` → `limit=abc` | 200, 2 dòng, `total ≥ 6`; 200; 400 `INVALID_PAGINATION` | 3 | Token KH1; seed B1–B6 |
| 15 | A19 (`CASH`, `CAR_4`, đón tại P0) → A05 (TX1) → A23 → A19 thiếu điểm đến | 201: `SEARCHING`, `fare_amount`, `payment_id`; 200; 200 có một Offer `PENDING` của booking vừa tạo, kèm `distance_m`; 400 | 4 | Token KH1; TX1 đang `ONLINE` và không có Offer chờ |
| 16 | A24 → A21 (khách) → A33 (khách) | 200 kèm `trip_id`; `DRIVER_ASSIGNED`; có thông báo "tài xế đã nhận chuyến" | 3 | Mục 15 (Offer còn hạn) |
| 17 | A28 `ARRIVED` → A28 `COMPLETED` (nhảy cóc) → A28 `PICKED_UP` → A28 `IN_PROGRESS` → A28 `COMPLETED` → A27 | 200; **409 `INVALID_STATUS_TRANSITION`**; 200; 200; 200; 200 với đủ lịch sử | 6 | Mục 16 |
| 18 | A29 (KH1 hủy chuyến seed T5, kèm lý do) → A27 → A05 (TX6) + A33 → A30 (payment của B5) | 200; `CANCELED` kèm `canceled_by`; tài xế có thông báo hủy; Payment `REFUNDED` | 5 | Seed B5 / T5 / TX6 **chưa bị hủy** (chạy lại thì đặt lại seed) |
| 18 (phụ) | A19 (`CASH`) → A22 → A22 lần hai | 201; 200 `CANCELED`; 409 `BOOKING_NOT_CANCELABLE` | 3 | Token KH1 |
| 19 | A19 (`ONLINE`, **`CAR_7`**) → A31 (kèm `Idempotency-Key`) → A32 (`SUCCESS`, chữ ký đúng) → A30 → A21 | 201 `PENDING_PAYMENT`; 200 kèm `provider_transaction_id`; 200; Payment **`COMPLETED`**; Booking đã sang `SEARCHING` (BRULE13) | 5 | Token KH1 |
| 20 | A34 (chuyến của mục 17, hoặc T4 seed) → A35 → A34 lần hai → A34 cho T5 | 201 kèm `rating_id`, `trip_id`; 200; 409 `RATING_ALREADY_EXISTS`; 409 `TRIP_NOT_COMPLETED` | 4 | Mục 17, hoặc seed T4 |

### 5.3 Thực hành 3 (mục 21–30)

| Mục | Chuỗi request | Kết quả mong đợi | Số request | Cần trước |
|---|---|---|---|---|
| 21 | A07 → A08 → A05 → A11 | 200 (môi trường demo trả OTP trong response — Q43); 201; 200 token `driver`; 201 `approval_status = PENDING` | 4 | Số điện thoại mới |
| 22 | A05 (AD1) → A13 `approval_status=PENDING` → A15 (tài xế của mục 21) → A16 (TX7, kèm lý do) → A33 (tài xế) | 200; 200 có hồ sơ chờ; 200 `APPROVED`; 200 `REJECTED`; có thông báo kết quả | 5 | Mục 21; seed AD1, TX7 |
| 23 | A17 `ONLINE` kèm vị trí → A14 → A17 `OFFLINE` → A17 bằng tài xế chưa duyệt | 200; `availability = ONLINE`; 200; 409 `DRIVER_NOT_APPROVED` | 4 | Tài xế đã duyệt (mục 22 hoặc TX5) |
| 24 | A04 → A09; rồi **ngoài Postman**: một lệnh `docker compose exec auth-db psql …` xem `accounts`, một lệnh với `customer-db`; mở `.env.example` | API trả số điện thoại rõ cho đúng chủ; trong database cột `phone_enc`, `full_name_enc` là byte, `password_hash` bắt đầu bằng `scrypt$`; `.env` không có trên Git | 2 + 2 lệnh | — (Q52) |
| 25 | A05 với mật khẩu `' OR '1'='1` → A05 với định danh `' OR 1=1 --` → A09 với mã `1 OR 1=1` | 401 `INVALID_CREDENTIALS`; 400; 400 `INVALID_ID`. Không lần nào 200 hay 500 | 3 | — |
| 26 | A10 với họ tên `<script>alert(1)</script>` → A34 / A22 với nội dung chứa thẻ HTML → A09 | 400 `TEXT_CONTAINS_HTML`; 400; hồ sơ không đổi, response có `nosniff` và CSP | 3 | Token KH1 |
| 27 | A09 với token bị sửa một ký tự → A09 không token → A06 → A09 với token vừa đăng xuất | 401 `TOKEN_INVALID`; 401 `TOKEN_MISSING`; 200; 401 `TOKEN_REVOKED` | 4 | Một token riêng cho mục này (sau đó đăng nhập lại) |
| 28 | A15 bằng token khách → A19 bằng token tài xế | 403 `FORBIDDEN`; 403 | 2 | Token khách, token tài xế |
| 29 | Một request Postman có script gửi A05 liên tiếp quá `RATE_LIMIT_PUBLIC_MAX` lần | Các lần đầu 401 / 200 kèm `RateLimit-Remaining` giảm dần; lần vượt ngưỡng **429** kèm `Retry-After` | 1 (lặp bằng script) | Chạy **sau** các mục cần đăng nhập — xem ghi chú |
| 30 | A32 **y hệt** request của mục 19 → A31 với **cùng** `Idempotency-Key` của mục 19 → A30 | 200, body giống lần đầu, `Idempotency-Replayed: true`; response giống lần đầu; vẫn đúng một giao dịch `CHARGE` `SUCCEEDED` | 3 | Mục 19 trong cùng phiên |

### 5.4 Ghi chú về thứ tự và thời gian

| Điểm | Nội dung |
|---|---|
| Không mục nào vượt 30 giây | Mục dài nhất là 17 (6 request). Không chuỗi nào có bước chờ: Offer xuất hiện trong khoảng một giây sau khi đặt xe; callback do Postman gửi ngay |
| Mục 15 và 19 không tranh tài xế | Mục 15–18 dùng `CAR_4` (TX1, TX2); mục 19 dùng `CAR_7` (TX4). Nếu dùng chung loại xe, Offer của booking mục 19 sẽ chiếm TX1 và mục 15 chạy sau đó nhận tài xế khác |
| Mục 19 để lại một booking đang tìm tài xế | Không ai nhận thì sau khi hết lượt mời booking thành `NO_DRIVER_FOUND` và Payment tự `REFUNDED`. Mục 30 chạy trong vài phút sau mục 19 vẫn thấy `COMPLETED`; dù trạng thái đã đổi, replay vẫn trả đúng response cũ |
| Mục 29 làm khóa nhóm route công khai theo IP | Trong tối đa `RATE_LIMIT_WINDOW_SECONDS` sau đó, đăng ký / đăng nhập trả 429. Mục 30 chỉ dùng token có sẵn và callback (không giới hạn theo IP) nên không bị ảnh hưởng. Khi demo có thể hạ cửa sổ xuống 10–15 giây bằng biến môi trường |
| Mục 27 thu hồi một token | Dùng token đăng nhập riêng cho mục này, không dùng token của các mục sau |
| Mục phụ thuộc nhau | 16 ← 15; 17 ← 16; 30 ← 19; 22 ← 21. Mục 18, 20 có đường dự phòng bằng seed |
| Trạng thái đổi sau khi demo | TX1 về `ONLINE` sau mục 17; TX6 về `ONLINE` sau mục 18 (kết quả mục 13 thành 5 tài xế). Chấm lại từ đầu thì chạy lệnh đặt lại seed |
| Demo trường hợp hết hạn (không bắt buộc) | Hạ `PAYMENT_TIMEOUT_SECONDS` hoặc `OFFER_TIMEOUT_SECONDS` xuống vài giây rồi khởi động lại service tương ứng |

Mục 1–5 là mô tả và kiểm tra hạ tầng, không có request Postman.

## 6. Danh sách rpc gRPC theo service

Tên file: `proto/<service>.proto`. Cột "Ai gọi": GW = Gateway; mã S là đường service → service của file 02. Mọi service thêm `grpc.health.v1.Health/Check` (GW gọi cho A03 — đường G9).

| Service | rpc | Ai gọi | API / đường |
|---|---|---|---|
| auth | `RegisterCustomer` | GW | A04 (bên trong gọi S1) |
| | `Login` | GW | A05 |
| | `RequestDriverOtp` | GW | A07 |
| | `RegisterDriver` | GW | A08 |
| customer | `CreateProfile` | **auth** | **S1** |
| | `GetCustomer` | GW | A09 |
| | `UpdateCustomer` | GW | A10 |
| driver | `SubmitApplication` | GW | A11 |
| | `FindNearbyDrivers` | GW; **booking** | A12; **S2** |
| | `ListDrivers` | GW | A13 |
| | `GetDriver` | GW | A14 |
| | `ApproveDriver`, `RejectDriver` | GW | A15, A16 (phát K7) |
| | `SetAvailability` | GW | A17 |
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
| | `HandleProviderCallback` | GW | A32 (phát K6) |
| notification | `ListNotifications` | GW | A33 |
| rating | `CreateRating` | GW | A34 (gọi S7) |
| | `GetRatingByTrip`, `GetDriverRating` | GW | A35, A36 |

Tổng: **39 rpc nghiệp vụ** (auth 4, customer 3, driver 11, booking 7, trip 6, payment 4, notification 1, rating 3) + health.

Đối chiếu với file 02:

| Kiểm tra | Kết quả |
|---|---|
| S1–S7 đều có rpc | Có: `CreateProfile`, `FindNearbyDrivers`, `ReserveDriver` / `ReleaseDriver`, `CreatePayment`, `CreateTrip`, `GetDriverSummary`, `GetTripForRating` |
| Không rpc nào đi **vào** booking, notification, auth, rating từ service khác | Đúng |
| rpc chỉ service khác gọi, **không có đường REST** | `CreateProfile`, `ReserveDriver`, `ReleaseDriver`, `GetDriverSummary`, `CreateTrip`, `CreatePayment`, `GetTripForRating` — Gateway không định tuyến tới chúng |
| K1–K7 đều có thao tác phát | K1, K2: `CreateBooking` và bộ ghép; K3: bộ ghép; K4: `CancelBooking` và khi nhận K6 `CANCELED`; K5: `CreateTrip`, `UpdateTripStatus`, `CancelTrip`; K6: `HandleProviderCallback`, tiến trình hết hạn, và khi nhận K3 / K4 / K5; K7: `ApproveDriver`, `RejectDriver` |
| Đăng xuất | Không có rpc: Gateway tự xử lý với Redis [ĐC] |
| Chờ spec mục 16 (Q35) | Có thể thêm `GetTripByBooking` (booking → trip) để xử lý khe hở "đã tạo Trip nhưng Booking chưa ghi phân công". Chưa đưa vào danh sách |

## 7. Truy vết ngược: yêu cầu nào chưa có API

| Yêu cầu | Tình trạng | Lý do |
|---|---|---|
| FR33 Báo cáo | Không có API | Ngoài 30 mục chấm (Q1) |
| FR31 Xử lý chuyến lỗi | Không có API | Chưa thiết kế (Q45) |
| FR30 Giám sát chuyến | A26, A27 với role admin | Ngoài phiếu chấm; làm sau |
| UC25 Quản lý phân quyền | Không có API | Ba role cố định [ĐC]; admin tạo bằng seed |
| Danh mục loại xe | Không có API | Ba mã cố định ghi trong tài liệu; không mục chấm nào cần |
| Khóa / mở khóa tài khoản | Không có API | `accounts.status` chỉ đổi bằng seed; không mục chấm nào cần |
| Đánh dấu thông báo đã đọc | Không có API | Không FR nào yêu cầu |

30/30 mục chấm có chuỗi kiểm tra; mục 6–30 có request hoặc bước kiểm tra ở mục 5.

## 8. Khác thiết kế tham chiếu và bản cũ

| Điểm | Trước | Ở đây | Vì sao |
|---|---|---|---|
| `/customers/me` (`docs/study/01`) | Có | Chỉ `/customers/{customer_id}` | Phiếu chấm mục 11 là "xem theo mã"; một đường dẫn cho cả khách và admin |
| `/driver-requests/{id}/accept` | Tên cũ | `/offers/{offer_id}/accept` | Theo ngôn ngữ chung "Offer" của Booking |
| `/trips/{id}/payments`, `/trips/{id}/fare` | Thanh toán gắn chuyến | `/payments/{payment_id}/…` | Trả trước: thanh toán gắn booking, lúc đó chưa có Trip (ADR-009) |
| `/operator/*` | Nhóm route riêng | Không có; admin dùng chung route, phân biệt bằng role | Một vai trò `admin` [ĐC] |
| Refresh token | Tham chiếu có bảng | Không có API làm mới token | Không FR nào yêu cầu |

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn, chưa ai xác nhận

| # | Quyết định | Nếu đổi thì sửa |
|---|---|---|
| P1 | Đường dẫn, tên rpc, mã lỗi trong file này | Bảng mục 2, 6 |
| P2 | Tài xế nhận Offer bằng cách gọi A23 (GĐ-2, Q5) | Bỏ A23; mục 15 chỉ chứng minh bằng thông báo |
| P3 | A14 cho mọi role xem phần công khai của tài xế (Q9 đề xuất chỉ chính chủ và admin) | Ma trận dòng A14; mục 12 phải dùng token admin |
| P4 | Văn bản chứa `<`, `>` bị từ chối 400 | Mục 1.6; chuỗi mục 26 |
| P5 | `/ready` trả 503 khi Redis dừng dù Gateway vẫn phục vụ | Bảng mục 2.1 |
| P6 | Callback không bị rate limit; chữ ký HMAC do `payment-service` kiểm tra | Mục 1.5, 2.6 |
| P7 | Không phải chủ dữ liệu trả 403 (không 404) | Mục 4 |
| P8 | `limit` tối đa 50; sai thì 400 chứ không tự sửa | Mục 1.3 |
| P9 | Mục 18 demo bằng chuyến seed T5; mục 19 dùng `CAR_7` | Mục 5 và seed |

### 9.2 Câu hỏi còn mở (đánh số tiếp Q49 của file 03)

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| Q50 | `CLAUDE.md`: "cổng thanh toán giả lập gửi callback ngay". Ai gửi? | (a) Postman đóng vai Provider, gửi A32 ngay sau A31 — thấy rõ bước callback, replay chỉ là bấm lại; (b) adapter trong `payment-service` tự xử lý callback trong tiến trình ngay khi nhận A31 — mục 19 còn 1 request nhưng không thấy callback, mục 30 vẫn cần A32 | (a) | SV |
| Q51 | Chống XSS bằng cách nào? | (a) Từ chối `<`, `>`; (b) lưu nguyên, escape khi trả; (c) escape trước khi lưu | (a) | SV / GV |
| Q52 | Mục 24 ghi "POSTMAN", nhưng dữ liệu "at rest" chỉ thấy được trong database. Chứng minh bằng gì? | (a) Postman cho thấy API hoạt động + 2 lệnh `psql` cho thấy cột đã mã hóa; (b) thêm một API admin trả dạng lưu trữ — không đề xuất vì đưa dữ liệu mã hóa ra ngoài chỉ để demo | (a) | GV |
| Q53 | Phiếu chấm mục 12 chạy với token nào? Nếu là token khách thì P3 cần giữ | (a) Mọi role xem phần công khai; (b) chỉ chính chủ và admin | (a) | GV |
| Q54 | Mục 18 "hủy chuyến": chấm hủy Trip (đã có tài xế) hay hủy Booking (chưa có tài xế)? | Cả hai đã có chuỗi request | Demo hủy Trip là chính, hủy Booking là phụ | GV |
| Q55 | Có cần API danh mục loại xe cho client không? | (a) Không; (b) `GET /api/v1/vehicle-types` | (a) | SV |

Chưa kiểm tra được ở vòng thiết kế: thời gian thực của từng chuỗi request; Postman tính được chữ ký HMAC trên đúng nguyên văn body mà Gateway nhận; độ trễ từ lúc đặt xe đến lúc A23 thấy Offer.
