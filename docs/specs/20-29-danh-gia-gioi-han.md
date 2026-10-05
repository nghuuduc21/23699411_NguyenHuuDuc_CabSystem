# Spec 20-29 — Đánh giá chuyến đi; giới hạn tần suất request (rate limit) tại Gateway

> Vòng 2, viết 2026-10-05. Mục chấm **20, 29**; bổ trợ **26** (nhận xét là văn bản tự do), **28** (tài xế / admin gửi đánh giá → 403), **3** (Gateway có rate limit). FR25; NFR04, NFR06, NFR14, NFR17.
> Đầu vào: `CLAUDE.md` (Quyết định kỹ thuật "Redis dừng", "Khóa chính", "Lỗi sai trạng thái"; quy tắc "Redis ở Gateway"; Ràng buộc khi thi); `srs.md` (BG03, BG05, BR11, FR25, BRULE11, UC17, AC14, RTM15, NFR04, NFR06, NFR14); `docs/design/01` mục 6.8 (V1–V5), R10, R11; `docs/design/02` mục 2.2, G8, G10, S7, mục 9; `docs/design/03` mục 10, 12, 13, 14; `docs/design/04` A34–A36, mục 1, 1.5, 1.6, 1.10, 3, 4, 5; `docs/design/06` mục 20, 29; ADR-007, ADR-010, ADR-015, ADR-018.
> Phụ thuộc: **spec 00** (Redis, Compose, `.env.example` có 3 biến `RATE_LIMIT_*`), **spec 09-10** (xác thực Gateway mục 4.1, seed tài khoản, tab đăng nhập), **spec 14-15-16-19-30** (bảng `trips`, seed T3, T4, T5, quy ước `x-role: system` mục 5.5), **spec 17-18** (đang viết — trình tự trạng thái chuyến, giá trị `COMPLETED`).
> Ngoài phạm vi: API liệt kê đánh giá; tài xế đánh giá khách; sửa / xóa đánh giá (không FR nào yêu cầu).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 20 Đánh giá chuyến đi, lưu và liên kết với chuyến | BG03 | BR11 | FR25 | BRULE11; V1–V5; R10 | UC17 | AC14 / RTM15 | NFR14 (V5), NFR08 |
| 20 (bổ trợ) Xem đánh giá của chuyến, điểm của tài xế | BG03 | BR11 | FR25 | V2 | UC17 bước 5 | AC14 / RTM15 | NFR08 |
| 29 Spam → 429 | BG05 | BR15 | — (không có FR; yêu cầu của phiếu chấm) | — | — | — | **NFR17** (giới hạn tần suất truy cập — thêm 2026-10-05, GH-Q5); NFR04 (ổn định khi tải cao), NFR06 (chặn dò mật khẩu) |
| 26 (bổ trợ) `comment` có `<` `>` → 400 | BG05 | BR15 | FR25 | 04 mục 1.6 | UC17 | — | NFR08 |
| 28 (bổ trợ) Tài xế, admin gửi đánh giá → 403 | BG05 | BR15 | FR32 | BRULE12 | — | — | NFR07 |

## 2. Luồng nghiệp vụ

### 2.1 UC17 — Khách đánh giá chuyến (A34)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (role `customer`) |
| Tiền điều kiện | Đã đăng nhập; chuyến đã `COMPLETED` (trạng thái cuối — spec 17-18) |
| Luồng chính | 1. Gửi `trip_id`, `score` (+ `comment`). 2. Gateway kiểm token, role, hình thức. 3. Rating gọi **S7 `GetTripForRating(trip_id)`** sang Trip. 4. Rating kiểm: chuyến có (404), là khách của chuyến (V2 → 403), đã `COMPLETED` (V1 → 409). 5. **Một giao dịch:** thêm Rating (UNIQUE `trip_id` — V3) và cộng điểm vào `driver_ratings` (V5). 6. 201 kèm điểm trung bình mới của tài xế |
| Ngoại lệ | Đã đánh giá → 409 `RATING_ALREADY_EXISTS` (Exception UC17). Trip dừng / quá deadline → 503, không lưu gì (02 S7) |
| Hậu điều kiện | Một Rating gắn `trip_id`, `customer_id`, `driver_id` (lấy từ Trip, không lấy từ client); `driver_ratings` của tài xế tăng `rating_count` 1, `rating_sum` thêm `score` |

### 2.2 Xem đánh giá (A35) và điểm tài xế (A36)

Chỉ đọc. A35: khách hoặc tài xế của chuyến, admin. A36: mọi role đã đăng nhập (điểm tài xế là thông tin công khai — UC17 bước 5).

### 2.3 Rate limit (mọi route nghiệp vụ, mục 29)

| | Nội dung |
|---|---|
| Tác nhân | Bất kỳ client nào gọi Gateway |
| Luồng chính | 1. Gateway khớp route. 2. Route công khai: tăng bộ đếm theo **IP**; route có token: xác thực token xong thì tăng bộ đếm theo **`account_id`**. 3. Chưa vượt ngưỡng → xử lý tiếp, response có header `RateLimit-*`. 4. Vượt ngưỡng → 429, **không** gọi service |
| Ngoại lệ | Redis dừng / quá 500 ms → cho qua, log `warn` [ĐC] |
| Hậu điều kiện | Bộ đếm tự hết hạn sau `RATE_LIMIT_WINDOW_SECONDS` tính từ request **đầu tiên** của cửa sổ (mục 5.4) |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `rating-service` | **Sở hữu** Rating, DriverRating; kiểm V1–V5 | `rating-db` → `ratings`, `driver_ratings` |
| `trip-service` | **Sở hữu** Trip; chỉ trả lời S7 (trạng thái, khách, tài xế). Không biết chuyến đã được đánh giá chưa | `trip-db` → `trips` (không đổi schema) |
| `gateway` | Token, role, hình thức; chọn biến thể A35 / A36; **rate limit** (mục 29) | — |
| `redis` | Bộ đếm rate limit (key mục 7.3) | Chỉ Gateway dùng |

`auth`, `customer`, `driver`, `booking`, `payment`, `notification` không đổi. Rating **không** dùng Kafka (02 mục 1): không context nào cần biết có đánh giá mới (Notification: FR21–FR24 không nhắc; Driver: điểm thuộc Rating — GĐ-11).

## 4. API REST tại Gateway

Route có token: xác thực theo spec 09-10 mục 4.1, **có thêm bước rate limit** (mục 4.5). Quy tắc chung như spec 14-15-16-19-30 mục 4.1 (field / query lạ → 400 `INVALID_INPUT`; văn bản có `<` / `>` → 400 `TEXT_CONTAINS_HTML` ở Gateway **và** service; field `optional` rỗng thì không có key).

### 4.1 A34 `POST /api/v1/ratings` — đánh giá chuyến (mục 20)

| | |
|---|---|
| Token / role | Có / `customer` (role kiểm **trước** body — mục 28) |
| rpc | `rating-service` — `CreateRating` (gọi S7) |
| Request | `{ "trip_id": 4, "score": 5 }` (+ `comment`) |
| Response **201** | `{ "rating_id": 1000, "trip_id": 4, "driver_id": 13, "score": 5, "driver_avg": 5, "driver_count": 1 }`. Có `comment` thì thêm `"comment": "…"` |

| Field | Bắt buộc | Gateway | `rating-service` |
|---|---|---|---|
| `trip_id` | Có | Số nguyên JSON, 1 … 2^53 − 1 (chuỗi `"4"`, `0`, âm, số lẻ → `INVALID_INPUT`) | Kiểm lại |
| `score` | Có | Số nguyên JSON 1–5 (`4.5`, `"5"`, `0`, `6` → `INVALID_INPUT`) | Kiểm lại; CHECK trong database |
| `comment` | Không | Chuỗi; cắt khoảng trắng hai đầu; 1–500 ký tự (rỗng sau khi cắt → `INVALID_INPUT`); không `<` `>` | Kiểm lại; CHECK ≤ 500 |

`driver_avg` = `rating_sum / rating_count`, làm tròn **1 chữ số thập phân** [BA DG4]; JSON in `5` chứ không in `5.0`.

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` | Gateway |
| Vượt ngưỡng | 429 | `RATE_LIMITED` | Gateway |
| Role `driver`, `admin` | 403 | `FORBIDDEN` | Gateway |
| Body không phải JSON | 400 | `INVALID_JSON` | Gateway |
| Thiếu `trip_id` / `score`, sai kiểu, `score` ngoài 1–5, field lạ (gồm `driver_id`, `customer_id`) | 400 | `INVALID_INPUT` | Gateway + service |
| `comment` có `<` / `>` | 400 | `TEXT_CONTAINS_HTML` | Gateway + service |
| Chuyến không có | 404 | `TRIP_NOT_FOUND` | Service (từ S7) |
| Không phải khách của chuyến | 403 | `NOT_OWNER` | Service |
| Chuyến chưa `COMPLETED` (gồm `CANCELED`) | 409 | `TRIP_NOT_COMPLETED` | Service |
| Chuyến đã được đánh giá | 409 | `RATING_ALREADY_EXISTS` | Service (UNIQUE) |
| `rating-service` hoặc `trip-service` dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

Thứ tự trong service: 404 → 403 → 409 `TRIP_NOT_COMPLETED` → 409 `RATING_ALREADY_EXISTS` (04 mục 1). Kiểm chủ **trước** "đã đánh giá" để người khác không dò được chuyến nào đã có đánh giá [BA DG2].

### 4.2 `GET /api/v1/ratings?trip_id | ?driver_id` — A35, A36 (biến thể, 04 mục 1.10)

Role của đường dẫn: `customer`, `driver`, `admin`. Gateway chọn theo query:

| Query | Biến thể → rpc | Response 200 |
|---|---|---|
| `trip_id=4` | A35 → `GetRatingByTrip` | `{ "rating_id": 1000, "trip_id": 4, "driver_id": 13, "score": 5, "created_at": "…Z" }` (+ `comment` nếu có) |
| `driver_id=11` | A36 → `GetDriverRating` | `{ "driver_id": 11, "avg": 5, "count": 1 }`. Chưa ai đánh giá → `{ "driver_id": 999, "count": 0 }` (không có `avg`) |
| Thiếu cả hai; có cả hai; query lạ (`page`, `limit`…) | — | 400 `INVALID_INPUT` |
| `trip_id` / `driver_id` không khớp `^[1-9][0-9]{0,15}$` (`abc`, `4 OR 1=1`) | — | 400 `INVALID_ID` [BA DG5] |

Gateway luôn ghi `count` (kể cả 0) vì proto nạp `defaults: false` sẽ bỏ số 0.

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại / 429 | 401 / 429 | như A34 | Gateway |
| A35: không có đánh giá cho chuyến | 404 | `RATING_NOT_FOUND` | Service |
| A35: không phải khách / tài xế của chuyến (admin bỏ qua) | 403 | `NOT_OWNER` | Service (so `ratings.customer_id` / `ratings.driver_id` theo role) |
| A36: tài xế không tồn tại | 200 `count: 0` | — | Rating không giữ danh sách tài xế (04 mục 4) |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

"Sai quyền theo role" không áp dụng (cả ba role được gọi); "trùng" không áp dụng (chỉ đọc).

### 4.3 Header rate limit trên mọi route bị đếm

| Header | Khi nào | Giá trị |
|---|---|---|
| `RateLimit-Limit` | Mọi response của route bị đếm (200, 4xx, 429, 503) | Ngưỡng của route: `RATE_LIMIT_PUBLIC_MAX` hoặc `RATE_LIMIT_ACCOUNT_MAX` |
| `RateLimit-Remaining` | Như trên | `max(0, ngưỡng − số đếm)` |
| `RateLimit-Reset` | Như trên | Số giây còn lại của cửa sổ (TTL của key, ≥ 1) |
| `Retry-After` | **Chỉ** 429 | Bằng `RateLimit-Reset` |

Response 429: body `{ "error": "RATE_LIMITED" }`, vẫn có `X-Request-Id`, `nosniff`, CSP, `no-store` (04 mục 1). Redis dừng → **không** có header `RateLimit-*` (04 mục 1.5).

### 4.4 Route nào bị đếm (04 mục 1.5)

| Nhóm | Route | Đếm theo | Ngưỡng (`.env.example`) |
|---|---|---|---|
| Công khai | A04 `POST /api/v1/accounts`, A05 `POST /api/v1/auth/login`, A07 `POST /api/v1/otps`, A08 `POST /api/v1/driver-accounts` | IP — **một bộ đếm chung** cho cả bốn route | `RATE_LIMIT_PUBLIC_MAX` = 5 / 10 s |
| Có token | Mọi route có `roles` (gồm A06 đăng xuất, A34–A36) | `account_id` (`sub` của token **đã xác thực**) — một bộ đếm chung cho mọi route | `RATE_LIMIT_ACCOUNT_MAX` = 30 / 10 s |
| Không đếm | A01–A03 health; A32 callback; đường dẫn không tồn tại (404 `ROUTE_NOT_FOUND`) | — | — |

IP = địa chỉ kết nối TCP (`req.socket.remoteAddress`, giữ nguyên chuỗi); **không** đọc `X-Forwarded-For` (không có proxy trước Gateway — [ĐC] không Nginx).

### 4.5 Vị trí trong chuỗi kiểm tra của Gateway (bổ sung spec 09-10 mục 4.1)

| Bước | Route công khai | Route có token |
|---|---|---|
| 0 | Khớp route → 404 | Khớp route → 404 |
| 1 | **Rate limit theo IP → 429** | — |
| 2–5 | — | Token, chữ ký, claim, thu hồi → 401 |
| 5a | — | **Rate limit theo `account_id` → 429** |
| 6 | — | Role của đường dẫn → 403 |
| 7–9 | Body, hình thức, gọi gRPC | Body, hình thức, biến thể, gọi gRPC |

Vì sao route có token đếm **sau** khi xác thực [BA GH2]: `account_id` chỉ đáng tin khi chữ ký đúng; đọc `sub` từ token chưa kiểm thì kẻ xấu tự ghi `sub` của người khác để làm người đó bị chặn. Hệ quả: trên route có token, 401 đứng trước 429 (khác 04 mục 1 — GH-M1). Request sai token không bị đếm: kiểm chữ ký HS256 tại chỗ, không gọi service nên rẻ (GH-Q4).

## 5. Hợp đồng gRPC

Gateway nạp proto `longs: Number`, `defaults: false`, `oneofs: true`. Tên field proto trùng tên JSON. Service **tự kiểm tra lại** mọi điều Gateway đã kiểm. Lỗi theo spec 00 mục 4.1 (`details` = mã lỗi).

### 5.1 `proto/rating.proto` (mới) — `package cab.rating.v1; service RatingService`

| Message | Field |
|---|---|
| `CreateRatingRequest` | `int64 trip_id = 1; int32 score = 2; optional string comment = 3;` |
| `CreateRatingResponse` | `int64 rating_id = 1; int64 trip_id = 2; int64 driver_id = 3; int32 score = 4; optional string comment = 5; double driver_avg = 6; int32 driver_count = 7;` |
| `GetRatingByTripRequest` → `Rating` | `int64 trip_id = 1;` → `int64 rating_id = 1; int64 trip_id = 2; int64 driver_id = 3; int32 score = 4; optional string comment = 5; string created_at = 6;` |
| `GetDriverRatingRequest` → `DriverRating` | `int64 driver_id = 1;` → `int64 driver_id = 1; optional double avg = 2; int32 count = 3;` |

| rpc | Ai gọi | Role (`x-role`) | Lỗi (status → `details`) |
|---|---|---|---|
| `CreateRating` | GW (A34) | `customer` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` / `TEXT_CONTAINS_HTML`; `NOT_FOUND` → `TRIP_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER`; `FAILED_PRECONDITION` → `TRIP_NOT_COMPLETED`; `ALREADY_EXISTS` → `RATING_ALREADY_EXISTS`; `UNAVAILABLE` (S7 lỗi / quá deadline); `INTERNAL` |
| `GetRatingByTrip` | GW (A35) | `customer`, `driver`, `admin` | `IDENTITY_MISSING`; `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT`; `NOT_FOUND` → `RATING_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER`; `INTERNAL` |
| `GetDriverRating` | GW (A36) | `customer`, `driver`, `admin` | `IDENTITY_MISSING`; `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT`; `INTERNAL` |

### 5.2 `proto/trip.proto` — thêm một rpc vào `TripService` (S7)

| rpc | Vào | Ra | Ai gọi / danh tính | Lỗi |
|---|---|---|---|---|
| `GetTripForRating` | `int64 trip_id = 1;` | `TripForRating { int64 trip_id = 1; string status = 2; int64 customer_id = 3; int64 driver_id = 4; }` | rating (S7) / **chỉ** `x-role = system` (spec 14-15-16-19-30 mục 5.5) | `UNAUTHENTICATED` → `IDENTITY_MISSING` (không có `x-role`); `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` (`trip_id ≤ 0`); `NOT_FOUND` → `TRIP_NOT_FOUND`; `INTERNAL` |

Cài đặt: `SELECT trip_id, status, customer_id, driver_id FROM trips WHERE trip_id = $1` (khóa chính, không khóa dòng). **Trip chỉ báo sự thật**, không quyết định "được đánh giá không" — quy tắc V1, V2 thuộc Rating (01 mục 6.8). `status` trả nguyên giá trị cột; giá trị và trình tự trạng thái theo **spec 17-18**. Không phát event, không cần migration.

### 5.3 Cài đặt trong `rating-service`

| Việc | Cách làm | Truy vết |
|---|---|---|
| `CreateRating` | 1. Kiểm metadata, dữ liệu. 2. Gọi S7 (deadline **1 000 ms**, metadata `x-role: system`, `x-request-id`; **không** gửi `x-account-id`). 3. S7 `NOT_FOUND` → `TRIP_NOT_FOUND`; lỗi khác / quá deadline → `UNAVAILABLE`. 4. `customer_id` của chuyến ≠ `x-account-id` → `NOT_OWNER`. 5. `status ≠ 'COMPLETED'` → `TRIP_NOT_COMPLETED`. 6. Giao dịch (dưới). 7. Log `rating_created` kèm `rating_id`, `trip_id`, `driver_id` (**không** ghi `comment`) | V1, V2, R10 |
| Giao dịch V5 | `INSERT INTO ratings (trip_id, customer_id, driver_id, score, comment) VALUES ($1…$5) ON CONFLICT (trip_id) DO NOTHING RETURNING rating_id` → không có dòng → rollback, `RATING_ALREADY_EXISTS`. Rồi `INSERT INTO driver_ratings (driver_id, rating_count, rating_sum) VALUES ($1, 1, $2) ON CONFLICT (driver_id) DO UPDATE SET rating_count = driver_ratings.rating_count + 1, rating_sum = driver_ratings.rating_sum + EXCLUDED.rating_sum, updated_at = now() RETURNING rating_count, rating_sum` → commit | V3, V5; NFR14 |
| Vì sao không cần khóa thêm | UNIQUE `trip_id` chặn hai đánh giá đồng thời; `ON CONFLICT DO UPDATE` khóa dòng `driver_ratings` nên hai đánh giá cùng tài xế cộng tuần tự. `COMPLETED` là trạng thái cuối (spec 17-18) nên kết quả S7 không đổi giữa lúc hỏi và lúc ghi | V3, V5 |
| `driver_avg` | `Math.round(rating_sum * 10 / rating_count) / 10` | DG4 |
| `GetRatingByTrip` | `SELECT … FROM ratings WHERE trip_id = $1`; không có → `RATING_NOT_FOUND`; `customer` so `customer_id`, `driver` so `driver_id`, `admin` bỏ qua → khác → `NOT_OWNER` | NFR08 |
| `GetDriverRating` | `SELECT rating_count, rating_sum FROM driver_ratings WHERE driver_id = $1`; không có → `count = 0`, không `avg` | UC17 bước 5 |

### 5.4 Cài đặt rate limit trong Gateway (không phải gRPC)

| Việc | Cách làm | Lý do |
|---|---|---|
| Key | `rl:ip:{ip}` (route công khai), `rl:acc:{account_id}` (route có token) | 03 mục 12, **bỏ phần `{cửa sổ}`** [BA GH1] |
| Một lần đếm | Một `MULTI`: `SET key 0 EX <RATE_LIMIT_WINDOW_SECONDS> NX` → `INCR key` → `TTL key` → `EXEC`. Hạn **500 ms** (như spec 09-10 bước 5) | Request đầu tiên tạo key kèm hạn; các request sau chỉ tăng số, **không** kéo dài hạn (`INCR` giữ TTL). Gộp ba lệnh trong `MULTI` nên không có key "mất hạn" khi Gateway dừng giữa chừng |
| Cửa sổ | **Cố định, bắt đầu từ request đầu tiên** (key hết hạn thì cửa sổ mới bắt đầu ở request kế tiếp) [BA GH1] | Bấm Send 6 lần liên tục **luôn** thấy 429 ở lần 6 (cửa sổ chia theo đồng hồ có ~30 % khả năng 6 lần bấm rơi vào hai cửa sổ → lần 6 vẫn 200, demo hỏng) |
| Quyết định | `count > max` → 429 | Lần thứ `max + 1` bị chặn |
| `TTL` trả `-1` (không có hạn — không xảy ra khi đúng cách trên) | Gọi `EXPIRE key <window>` rồi dùng `window` | Phòng key kẹt mãi |
| Spam trong lúc bị chặn | Vẫn `INCR` (số đếm tăng) nhưng **không** kéo dài cửa sổ | Hết `Retry-After` giây là gọi lại được, dù có spam |
| Redis lỗi / quá 500 ms | Cho qua, **không** header `RateLimit-*`; log `warn` `rate_limit_skipped` kèm `request_id` (như token.js khi không tra được danh sách thu hồi) [ĐC] | `CLAUDE.md` "Redis dừng" |
| Log khi chặn | `info` `rate_limited` kèm `scope` (`ip` / `account`), `account_id` (nếu có), `path`, `request_id`. **Không** ghi IP, token | NFR10; không log dữ liệu cá nhân |
| Bảng route | Thêm một cột `rateLimit: 'ip' \| 'account' \| 'none'` vào bảng route (`src/routes.js`); route có `roles` mặc định `account`, A04/A05/A07/A08 `ip`, health và A32 `none` | Một chỗ khai báo, test-agent đọc được |
| Biến môi trường | `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_PUBLIC_MAX`, `RATE_LIMIT_ACCOUNT_MAX` (đã đọc trong `config.js`) | 03 mục 13 |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `rating-service` `CreateRating`, `GetRatingByTrip`, `GetDriverRating` (G8) | gRPC | Khách / tài xế chờ kết quả ngay |
| `rating` → `trip` **S7** `GetTripForRating` | gRPC | Chưa biết chuyến đã `COMPLETED` và thuộc khách này thì **không được** nhận đánh giá (BRULE11, V1, V2) — cần kết quả ngay để trả lời khách; đồng bộ là mặc định (ADR-007) |
| Gateway → `redis` (G10) | Lệnh Redis | Bộ đếm phải dùng chung và còn sau khi Gateway khởi động lại (ADR-010) |
| `rating` → Kafka | **Không có** | Không ai cần biết có đánh giá mới (FR21–FR24 không nhắc; Driver không giữ điểm — GĐ-11) |
| `trip` → `rating` (event "chuyến xong") | **Không có** | Rating hỏi khi cần (S7), không giữ bản sao danh sách chuyến (02 mục 10, dòng "review nghe trip events") |
| `rating` ↔ `driver`, `booking`, `payment`, `customer`, `auth` | **Không có** | `driver_id`, `customer_id` lấy từ Trip; đánh giá không cần thanh toán (02 mục 9) |

## 7. Dữ liệu

### 7.1 Migration `services/rating-service/migrations/001_tao-bang-danh-gia.sql`

`ratings` (03 mục 10.1):

| Cột | Kiểu | Ràng buộc | Vì sao |
|---|---|---|---|
| `rating_id` | `bigint` | `GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY` | ADR-015 |
| `trip_id` | `bigint` | `NOT NULL`, `CONSTRAINT ratings_trip_id_key UNIQUE` | V3; "liên kết với chuyến đi" (mục 20). Không khóa ngoại (khác database) |
| `customer_id` | `bigint` | `NOT NULL` | Lấy từ S7; A35 kiểm chủ |
| `driver_id` | `bigint` | `NOT NULL` | Lấy từ S7; A35 kiểm chủ |
| `score` | `smallint` | `NOT NULL`, `CHECK (score BETWEEN 1 AND 5)` | V4; số nhỏ nên `smallint` |
| `comment` | `text` | NULL, `CHECK (char_length(comment) BETWEEN 1 AND 500)` | Văn bản tự do (mục 26) |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Quy ước chung |

Không tạo index `(driver_id, created_at DESC)` của 03 mục 10.1: không API nào liệt kê đánh giá theo tài xế (DG-M1).

`driver_ratings` (03 mục 10.2):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `driver_id` | `bigint` | `PRIMARY KEY` (không identity — bằng mã tài xế) |
| `rating_count` | `integer` | `NOT NULL`, `CHECK (rating_count >= 1)` |
| `rating_sum` | `integer` | `NOT NULL`, **`CHECK (rating_sum BETWEEN rating_count AND 5 * rating_count)`** [BA DG6] |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

`rating_count ≥ 1`: dòng chỉ được tạo cùng đánh giá đầu tiên. CHECK tổng: mỗi điểm 1–5 nên tổng nằm giữa `count` và `5 × count` — database tự chặn số liệu lệch.

`trip-db`: **không** đổi schema (S7 đọc theo khóa chính).

### 7.2 Seed `rating-service` (03 mục 14) [ĐC]

Một giao dịch, chạy khi `SIMULATION_MODE=true`, không gọi service khác:

| Bảng | Dòng | Ghi chú |
|---|---|---|
| `ratings` | `rating_id` **3**, `trip_id` 3, `customer_id` 1, `driver_id` 11, `score` 5, không `comment` | `OVERRIDING SYSTEM VALUE … ON CONFLICT DO NOTHING RETURNING rating_id`; mã = mã chuyến (quy luật 03 mục 14) |
| `driver_ratings` | `driver_id` 11, `rating_count` 1, `rating_sum` 5 | **Chỉ chèn khi dòng `ratings` vừa được tạo** (như lịch sử chuyến — spec 14 mục 7.4): khởi động lại sau demo không ghi đè số đã cộng |

T4 (TX3, `COMPLETED`) **không** có đánh giá → dùng cho mục 20. T5 `ACCEPTED` → demo `TRIP_NOT_COMPLETED`.

### 7.3 Redis (Gateway)

| Key | Kiểu | Giá trị | Hạn |
|---|---|---|---|
| `rl:ip:{ip}` | string | Số đếm (`INCR`) | `RATE_LIMIT_WINDOW_SECONDS`, đặt khi tạo key |
| `rl:acc:{account_id}` | string | Số đếm | Như trên |

`revoked:{jti}` giữ nguyên (spec 09-10).

## 8. Tiêu chí chấp nhận

Tiền điều kiện: spec 00, 09-10, 14-15-16-19-30 đạt; với AC-DG-08 cần spec 17-18 đạt. `docker compose down -v` rồi `up -d --build`; `SIMULATION_MODE=true`; giá trị `RATE_LIMIT_*` của `.env.example` (10 s, 5, 30). Token lấy bằng A05 (`[KH1]`, `[KH2]`, `[TX1]`, `[TX3]`, `[AD1]`). Nhóm AC-DG chạy **trước** nhóm AC-GH, mỗi request cách nhau ≥ 2 giây (không chạm ngưỡng 5 / 10 s của route công khai khi lấy token).

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-DG-01 | 20 (AC14) | Seed | A34 `{"trip_id":4,"score":5}` `[KH1]` | 201 `{ rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1 }`, không có key `comment`; `docker exec rating-db psql -U cab -d rating -c "table ratings"` có dòng `trip_id` 4, `customer_id` 1, `driver_id` 13; `driver_ratings` có `13 | 1 | 5` |
| AC-DG-02 | 20 (V3) | Sau AC-DG-01 | Gửi lại y hệt; A34 `{"trip_id":3,"score":4}` `[KH1]` | 409 `RATING_ALREADY_EXISTS` cả hai; `driver_ratings` của 13 vẫn `1 | 5`, của 11 vẫn `1 | 5` |
| AC-DG-03 | 20 (V1) | Seed (T5 `ACCEPTED`) | A34 `{"trip_id":5,"score":5}` `[KH1]` | 409 `TRIP_NOT_COMPLETED`; `ratings` không thêm dòng. Sau khi T5 bị hủy (spec 18) → vẫn 409 `TRIP_NOT_COMPLETED` |
| AC-DG-04 | 20 (V2, 404) | Seed | A34 `{"trip_id":3,"score":1}` `[KH2]`; `{"trip_id":999,"score":5}` `[KH1]` | 403 `NOT_OWNER` (**không** phải 409 dù T3 đã có đánh giá — DG2); 404 `TRIP_NOT_FOUND` |
| AC-DG-05 | 20, 26 (400) | — | A34 `[KH1]`: thiếu `score`; `score` 0; 6; 4.5; `"5"`; `trip_id` `"4"`; 0; −1; thêm `"driver_id":13`; `comment` `"<b>x</b>"`; `comment` 501 ký tự; `comment` `"   "`; body `{abc` | 400 `INVALID_INPUT` ×9; `TEXT_CONTAINS_HTML`; `INVALID_INPUT` ×2; `INVALID_JSON`; `ratings` không thêm dòng |
| AC-DG-06 | 20, 28 (401/403) | — | A34 không token; `[TX1]` **không body**; `[AD1]` | 401 `TOKEN_MISSING`; 403 `FORBIDDEN` (role trước body); 403 `FORBIDDEN` |
| AC-DG-07 | 20 (503) | Database vừa đặt lại (chạy **thay cho** bước When của AC-DG-01); `docker compose stop trip-service` | A34 `{"trip_id":4,"score":5}` `[KH1]` | 503 `SERVICE_UNAVAILABLE`; `ratings` không có dòng trip 4, `driver_ratings` không có dòng 13. `start trip-service` → gửi lại → 201 như AC-DG-01 |
| AC-DG-08 | 20 (V5) | Spec 17-18: trip 1000 của KH1 với TX1 đã `COMPLETED` | A34 `{"trip_id":1000,"score":4,"comment":"Tai xe vui ve"}` `[KH1]` | 201 `driver_id` 11, `comment` "Tai xe vui ve", **`driver_avg` 4.5, `driver_count` 2**; `driver_ratings` 11 = `2 | 9` |
| AC-DG-09 | 20 (A35) | Sau AC-DG-01 | `GET /api/v1/ratings?trip_id=4` bằng `[KH1]`; `[TX3]`; `[AD1]`; `[TX1]`; `[KH2]`; `?trip_id=5` `[KH1]` | 200 `rating_id` 1000, `score` 5, có `created_at` ×3; 403 `NOT_OWNER` ×2; 404 `RATING_NOT_FOUND` |
| AC-DG-10 | 20 (A36) | Seed | `?driver_id=11` `[KH1]`; `[TX1]`; `[AD1]`; `?driver_id=999` `[KH1]` | 200 `{ driver_id: 11, avg: 5, count: 1 }` ×3; 200 `{ driver_id: 999, count: 0 }` (không `avg`) |
| AC-DG-11 | 20, 25 (400) | — | `GET /api/v1/ratings` `[KH1]`; `?trip_id=4&driver_id=11`; `?trip_id=abc`; `?trip_id=4 OR 1=1`; `?trip_id=4&page=1`; không token | 400 `INVALID_INPUT`; 400 `INVALID_INPUT`; 400 `INVALID_ID` ×2; 400 `INVALID_INPUT`; 401 `TOKEN_MISSING` |
| AC-DG-12 | 20 (S7) | Test gọi thẳng `trip-service:50051` trong mạng Compose | `GetTripForRating(4)` với `x-role: system`; `(999)`; `(0)`; không `x-role`; `x-role: customer` | `{ trip_id: 4, status: "COMPLETED", customer_id: 1, driver_id: 13 }`; `NOT_FOUND` `TRIP_NOT_FOUND`; `INVALID_ARGUMENT` `INVALID_INPUT`; `UNAUTHENTICATED` `IDENTITY_MISSING`; `PERMISSION_DENIED` `FORBIDDEN` |
| AC-DG-13 | 20 (seed) | Sau AC-DG-01 | Đếm `ratings`, xem `driver_ratings`; `docker compose restart rating-service`; đếm lại | Số dòng và số liệu **y hệt trước restart** (không nhân đôi seed, không ghi đè `driver_ratings` đã cộng khi demo) |
| AC-DG-14 | 7, 4 | Sau AC-DG-01 | Kafka UI | Không có topic nào của `rating-service`; không có message mới khi tạo đánh giá |
| AC-GH-01 | 29 | Không request công khai nào trong 10 s trước | A05 tab đăng nhập KH1 bấm Send **6 lần liên tục** (< 10 s) | Lần 1–5: 200, `RateLimit-Limit: 5`, `RateLimit-Remaining` 4, 3, 2, 1, 0, `RateLimit-Reset` 1–10. Lần 6: **429 `{ "error": "RATE_LIMITED" }`**, `Retry-After` 1–10, `RateLimit-Remaining: 0`, có `X-Request-Id`; log Gateway có `rate_limited` `scope: ip`. Unit test Gateway: khi vượt ngưỡng, handler gọi gRPC **không** được gọi |
| AC-GH-02 | 29 | Ngay sau AC-GH-01 | Bấm Send liên tục thêm 5 lần trong `Retry-After` giây; chờ đến hết `Retry-After` của lần 6; Send | 429 cả 5 lần; `Retry-After` **giảm dần**, không quay lại 10 (spam không kéo dài cửa sổ); lần cuối 200, `RateLimit-Remaining: 4` |
| AC-GH-03 | 29 | Ngay sau AC-GH-01 (IP đang bị chặn) | A04 `POST /api/v1/accounts` số mới; A07 `POST /api/v1/otps`; A38 `GET /api/v1/customers/me` `[KH1]` (token có sẵn); A01 `/health`; A05 kèm header `X-Forwarded-For: 1.2.3.4` | 429; 429 (chung bộ đếm IP); **200** kèm `RateLimit-Limit: 30` (bộ đếm tài khoản riêng); 200 không có header `RateLimit-*`; 429 (không tin header) |
| AC-GH-04 | 29 | — | A32 `POST /api/v1/payment-callbacks` `{"txn_id":"SIM-999-1"}` gửi 10 lần liên tục | 401 / 404 cả 10 lần, **không** 429, không header `RateLimit-*` |
| AC-GH-05 | 29 (tài khoản) | `.env`: `RATE_LIMIT_ACCOUNT_MAX=3`, `docker compose up -d` | A38 `[KH1]` ×4 liên tục; ngay sau A38 `[KH2]`; A06 `[KH1]` | 200 ×3, lần 4 429 `scope: account`; KH2 200 (tài khoản khác); 429 (A06 chung bộ đếm tài khoản). Trả `.env` về 30 |
| AC-GH-06 | 29 (thứ tự) | Như AC-GH-05, KH1 đang bị chặn | A38 không token; A38 token KH1 sửa một ký tự; A19 `POST /api/v1/bookings` `[KH1]` không body | 401 `TOKEN_MISSING`; 401 `TOKEN_INVALID` (401 trước 429 — GH2); 429 (429 trước 403 / 400) |
| AC-GH-07 | 29 (Redis dừng) | `docker compose stop redis` | A05 KH1 ×7 liên tục; `docker compose logs gateway` | 200 cả 7, **không** header `RateLimit-*`; log có `warn` `rate_limit_skipped` kèm `request_id`. `start redis`, chờ 2 s, Send ×6 → lần 6 429 |
| AC-GH-08 | 29 (Redis) | Trong AC-GH-01 | `docker exec redis redis-cli --scan --pattern "rl:*"`; `docker exec redis redis-cli ttl <key>` | Có `rl:ip:<ip>`; TTL 1–10; sau 10 s key biến mất |

Tổng: **22 tiêu chí** (14 AC-DG, 8 AC-GH).

Chuỗi gõ tay khi thi (khớp 06 mục 20, 29 và 04 mục 5; thời gian gồm cả giải thích theo 04 mục 5.4):

| Mục | Request | Kết quả | Thời gian |
|---|---|---|---|
| 20 | Tab mới: `POST localhost:3000/api/v1/ratings`, `[KH1]` (copy token từ tab đăng nhập KH1), body `{"trip_id":4,"score":5}` → Send lại y hệt → (tùy chọn) sửa `"trip_id":5` | 201 `trip_id` 4, `driver_id` 13, `driver_avg` 5, `driver_count` 1; 409 `RATING_ALREADY_EXISTS`; (409 `TRIP_NOT_COMPLETED`) | Gõ ~17 s + gửi lại ~2 s + nói ~6 s = **~25 s, Ổn** |
| 29 | Tab đăng nhập KH1 (`POST …/api/v1/auth/login`, mục 10) → bấm **Send** (hoặc **Ctrl+Enter**) 6 lần liên tục → mở tab **Headers** của response | Lần 1–5: 200; lần 6: **429 `RATE_LIMITED`**; Headers: `Retry-After`, `RateLimit-Limit: 5`, `RateLimit-Remaining: 0` | Bấm ~4 s + mở Headers ~4 s + nói ~10 s = **~18 s, Ổn** |

Phù hợp luật thi mục 29: **không** dùng Collection Runner (Runner cần collection lưu sẵn — luật cấm) và không script; chỉ bấm Send trên tab đã gõ ở mục 10. Tab đăng nhập gửi sai mật khẩu vẫn được (401 cũng bị đếm) — lần 6 vẫn 429.

Ràng buộc thứ tự: **20 sau 17** (nếu muốn demo thêm trip 1000) và **trước 18** (T5 còn `ACCEPTED` cho phần tùy chọn — 04 mục 5.5); **29 làm cuối** (khóa route công khai theo IP tối đa 10 giây: đăng nhập lấy token trong lúc đó bị 429); trước khi làm 29 đừng gửi request công khai nào trong 10 giây (nếu không, 429 đến sớm hơn lần 6 — vẫn đúng, nhưng phải giải thích).

Câu nói (bổ sung 06): **20** — "Rating hỏi Trip bằng gRPC chuyến đã `COMPLETED` chưa và có phải của tôi không; lưu đánh giá và cộng điểm tài xế trong một giao dịch; UNIQUE `trip_id` nên mỗi chuyến một đánh giá". **29** — "Gateway đếm bằng Redis: route công khai theo IP, 5 lần mỗi 10 giây, để chặn dò mật khẩu; route có token theo tài khoản, 30 lần. Cửa sổ bắt đầu từ request đầu tiên, `Retry-After` cho biết bao lâu nữa gọi lại được. Redis dừng thì cho qua và ghi log".

Kết quả mong đợi theo phiếu chấm: **20** — đánh giá được lưu, response có `trip_id` (liên kết với chuyến), gửi lại bị 409; **29** — gửi liên tục bị chặn bằng 429 kèm `Retry-After`, do Gateway + Redis làm, không request nào tới service.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Hai A34 đồng thời cùng `trip_id` → một 201, một 409; `driver_ratings` cộng đúng một lần | UNIQUE + giao dịch bảo đảm; khó demo bằng tay |
| Hai A34 đồng thời cho hai chuyến của cùng tài xế → `rating_count` +2 | `ON CONFLICT DO UPDATE` khóa dòng |
| Gateway chạy nhiều bản cùng một Redis → bộ đếm chung | Compose chỉ có một Gateway |
| Rate limit theo IP cho request sai token trên route có token | GH-Q4 |
| Unit test `driver_avg` làm tròn (9/2 = 4.5; 14/3 = 4.7) | Test-agent làm ở unit test |
| Bộ test tự động của các spec khác chạy với ngưỡng cao | GH-Q3 |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| DG1 | Thang điểm số nguyên 1–5 (V4) | Phổ biến ở ứng dụng đặt xe; đã có CHECK ở 03 | Mục 4.1, 7.1; DG-Q1 |
| DG2 | Thứ tự trong `CreateRating`: S7 → chủ → `COMPLETED` → UNIQUE | Không lộ "chuyến của người khác đã được đánh giá" | Mục 4.1, 5.3 |
| DG3 | S7 gửi `x-role: system`, không gửi `x-account-id`; Trip không kiểm chủ | Một quy ước nội bộ (spec 14 DX2); quy tắc chủ đánh giá là của Rating (V2) | Mục 5.2, 5.3 |
| DG4 | `driver_avg` làm tròn 1 chữ số; lưu tổng + số lượng | Không trôi sai số; hiển thị như ứng dụng thật | Mục 5.3; DG-Q2 |
| DG5 | Mã trong query (`trip_id`, `driver_id`) sai định dạng → `INVALID_ID`; trong body → `INVALID_INPUT` | Query là mã như mã trong đường dẫn (mục 25); body theo 04 A34 | Mục 4.1, 4.2 |
| DG6 | CHECK `rating_sum BETWEEN rating_count AND 5 * rating_count`, `rating_count >= 1` | Database tự chặn số liệu tổng hợp lệch | Mục 7.1 |
| DG7 | `comment` cắt khoảng trắng, 1–500 ký tự; không gửi thì không có key | Như các field văn bản khác (spec 14 mục 4.1) | Mục 4.1 |
| GH1 | Cửa sổ cố định **bắt đầu từ request đầu tiên**, key không có số cửa sổ; `MULTI` `SET NX EX` + `INCR` + `TTL` | Lần 6 **luôn** 429 khi bấm liên tục — demo 30 giây không phụ thuộc may rủi; vẫn một vòng gọi Redis | Mục 5.4; GH-Q1 |
| GH2 | Route có token đếm **sau** khi xác thực token (401 trước 429) | `account_id` chỉ đáng tin sau khi kiểm chữ ký | Mục 4.5; GH-Q2 |
| GH3 | Bốn route công khai **chung một** bộ đếm IP; mọi route có token chung một bộ đếm tài khoản | Ít key, dễ giải thích; dò mật khẩu qua A05 hay spam đăng ký A04 đều bị chặn chung | Mục 4.4 |
| GH4 | Không ghi IP vào log | Không log dữ liệu cá nhân (`CLAUDE.md`) | Mục 5.4 |

### 9.2 Chỗ thiết kế chưa khớp hoặc thiếu (ghi lại, không tự sửa design)

| # | Chỗ | Ghi chú | Spec theo |
|---|---|---|---|
| DG-M1 | 03 mục 10.1 có index `ratings (driver_id, created_at DESC)` | Không API nào dùng → không tạo (quy tắc "không truy vết được thì bỏ") | Mục 7.1 |
| DG-M2 | 04 A34 ví dụ `"comment": null`, `"driver_avg": 5.0` | Spec: không gửi `comment` thì không có key (quy ước spec 14); JSON in `5`. **Đã sửa 04, 06 (2026-10-05)** | Mục 4.1 |
| DG-M3 | 04 A35, A36 chưa nói mã lỗi khi mã trong query sai định dạng | DG5. **Đã sửa 04 (2026-10-05)** | Mục 4.2 |
| DG-M4 | 03 mục 10.2 `driver_ratings` thiếu `created_at`, `updated_at` và CHECK tổng | Thêm theo quy ước chung + DG6 | Mục 7.1 |
| DG-M5 | 01 V4 ghi "thang 1–5 là suy đoán, xác nhận ở spec mục 20" | Spec giữ 1–5 (DG1). **DG-Q1 đã chốt; đã sửa 01 V4 (2026-10-05)** | — |
| GH-M1 | 04 mục 1 thứ tự "429 → 401 → 403"; spec 09-10 mục 4.1 đặt rate limit ở bước 1 cho mọi route | Chỉ đúng với route công khai; route có token: 401 → **429** → 403 (GH2). **Dev-agent đặt bước 5a** khi làm spec này. **Đã sửa 04 mục 1, 1.5 (2026-10-05)** | Mục 4.5 |
| GH-M2 | 03 mục 12 key `rl:ip:{ip}:{cửa sổ}`, `{cửa sổ} = floor(giờ / window)` | Đổi sang cửa sổ bắt đầu từ request đầu tiên (GH1); key `rl:ip:{ip}`. **Đã sửa 03 mục 12 (2026-10-05)** | Mục 5.4, 7.3 |
| GH-M3 | `srs.md` không có FR / NFR nào về giới hạn tần suất | **Đã xử lý 2026-10-05:** thêm NFR17 vào `srs.md` (GH-Q5) | Mục 1 |
| GH-M4 | 04 mục 5 / 06 mục 29 ghi "Tab KH1" | Là **tab đăng nhập** KH1 (route công khai, ngưỡng 5) — không phải tab có token (ngưỡng 30). **Đã sửa 04 mục 5.3, 5.5 và 06 (2026-10-05)** | Mục 8 |

### 9.3 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
Tất cả câu hỏi dưới đây **đã chốt 2026-10-05** theo đề xuất của BA (sinh viên đồng ý).

| # | Câu hỏi | Lựa chọn | Đã chốt | Hỏi ai |
|---|---|---|---|---|
| DG-Q1 | Thang điểm đánh giá (V4)? | (a) Số nguyên 1–5; (b) 1–10; (c) cho nửa sao | **Đã chốt (a)** (sinh viên 2026-10-05) — giống ứng dụng thật, CHECK đơn giản | — |
| DG-Q2 | Điểm trung bình hiển thị mấy chữ số? | (a) 1 chữ số (4.5); (b) 2 chữ số (4.67) | **Đã chốt (a)** (sinh viên 2026-10-05) | — |
| DG-Q3 | Có hạn đánh giá (ví dụ trong 7 ngày sau chuyến)? | (a) Không hạn; (b) có hạn | **Đã chốt (a)** (sinh viên 2026-10-05) — SRS không nói; thêm hạn là thêm quy tắc không truy vết được | — |
| GH-Q1 | Cửa sổ rate limit: neo theo request đầu (GH1) hay chia theo đồng hồ (03 mục 12)? | (a) Neo theo request đầu; (b) chia theo đồng hồ — lần 6 có ~30 % khả năng vẫn 200 khi demo | **Đã chốt (a)** (sinh viên 2026-10-05); đã sửa 03 mục 12 | — |
| GH-Q2 | Route có token: 401 hay 429 trước? | (a) 401 trước (đếm theo tài khoản đã xác thực); (b) đếm thêm theo IP trước khi xác thực | **Đã chốt (a)** (sinh viên 2026-10-05); đã sửa 04 mục 1 | — |
| GH-Q3 | Bộ test tự động (test-agent) gọi đăng nhập nhiều lần trong 10 giây sẽ bị 429 khi bật rate limit | (a) Chạy các bộ test khác với `.env` `RATE_LIMIT_PUBLIC_MAX=1000`, `RATE_LIMIT_ACCOUNT_MAX=1000`; chỉ bộ test mục 29 dùng giá trị mẫu; (b) test tự chờ giữa các lần đăng nhập | **Đã chốt (a)** (sinh viên 2026-10-05) — test-agent phải biết **trước** khi chạy lại các báo cáo cũ | — |
| GH-Q4 | Có giới hạn request sai token trên route có token (theo IP)? | (a) Không — kiểm chữ ký tại chỗ, rẻ; (b) có, thêm một bộ đếm | **Đã chốt (a)** (sinh viên 2026-10-05); để ở mục 8.1 "có thể làm sau" | — |
| GH-Q5 | Thêm mã yêu cầu cho rate limit vào `srs.md` (ví dụ NFR17 "Giới hạn tần suất truy cập", RTM mới)? | (a) Thêm — mục 29 truy vết thẳng; (b) giữ truy vết qua NFR04, NFR06 | **Đã chốt (a)** (sinh viên 2026-10-05); đã thêm NFR17 vào `srs.md` (bảng RTM của `srs.md` không có cột NFR nên không thêm dòng RTM; mục 1 truy vết thẳng về NFR17) | — |
