# Spec 09-10 — Đăng ký tài khoản khách, đăng nhập, JWT, đăng xuất

> Vòng 2, viết 2026-10-03; **sửa 2026-10-03 theo luật thi**: mã số nguyên (ADR-015), JWT HS256 với `JWT_SECRET` (ADR-016), số điện thoại / email lưu rõ, bỏ chỉ mục mù và `AUTH_DATA_KEY` (ADR-012 sửa), seed theo 03 mục 14, đăng nhập bằng field `phone` hoặc `email`, rút gọn tiêu chí chấp nhận. **Đồng bộ với 04 lần 3 (2026-10-03):** response đăng nhập dùng field `token`; định danh sai định dạng → `INVALID_PHONE` / `INVALID_EMAIL`; Gateway đọc body là JSON bất kể `Content-Type`; chuỗi mục 27 theo 04 mục 5.3. **Đồng bộ với 04 lần 4 (ADR-018):** A04 = `POST /api/v1/accounts`, A05 = `POST /api/v1/auth/login`, A06 = `POST /api/v1/auth/logout` (hai ngoại lệ có chủ đích); chuỗi mục 9, 10 theo 04 mục 5.1 (mục 10 đăng nhập ba role, tạo ba tab token). Lần 3 từng bỏ tiền tố `/api/v1`; lần 4 **đưa trở lại** theo giảng viên (ADR-018) — mọi đường dẫn nghiệp vụ trong spec này nằm dưới `/api/v1/`.
> **Sửa 2026-10-04 theo phản hồi dev-agent sau khi code:** Gateway bắt buộc claim `exp` (mục 4.1 bước 4); ghi nhận thư viện `jsonwebtoken` 9.0.3, chữ `Bearer` không phân biệt hoa thường, lệnh Redis có hạn 500 ms, lỗi không lường trước ở `auth-service` → 503 (mục 4.1, 5); DN-Q1, DN-Q2, DN-Q4 chốt theo đề xuất (a). Tham chiếu "spec 21" đổi thành spec `12-13-21-23-tai-xe`.
> Mục chấm **9, 10, 25, 27**; bổ trợ **24** (mật khẩu băm). FR26, FR42.
> Đầu vào: `CLAUDE.md`; `srs.md` (FR26, FR42, UC01, UC02, UC33, AC27, RTM26, RTM27); `docs/design/01` quy tắc A1–A5, A8; `docs/design/02` G1, G10; `docs/design/03` mục 2, 3.1, 11.4, 12, 13, 14; `docs/design/04` A04–A06, mục 1, 1.1, 1.7, 3; ADR-010, ADR-012, ADR-013, ADR-015, ADR-016.
> Phụ thuộc: **spec 00**. Ngoài phạm vi: rate limit (mục 29), OTP và đăng ký tài xế (mục 21 — spec `12-13-21-23-tai-xe`), toàn bộ ma trận role (mục 28 — spec này chỉ dựng cơ chế).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 9 Đăng ký khách → đăng nhập được | BG05 | BR05 | FR26 | A1, A2, A4, A8 | UC01 | AC27 / RTM27 | NFR08 |
| 10 Đăng nhập → cấp token | BG05 | BR05 | FR26, FR32 | A3, A5, BRULE12 | UC02 | AC27 / RTM27 | NFR06, NFR07 |
| 25 SQL injection | BG05 | BR15 | FR26 | — | UC02 | — | NFR08 |
| 27 JWT bị sửa → 401 | BG05 | BR15 | FR42 | A5 | UC33 | RTM26 | NFR06 |
| 24 (bổ trợ) Mật khẩu băm | BG05 | BR15 | FR26 | A4 | UC01 | — | NFR08, NFR16 |

## 2. Luồng nghiệp vụ

### 2.1 UC01 — Đăng ký tài khoản (A04)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (chưa đăng nhập) |
| Tiền điều kiện | Số điện thoại / email chưa thuộc tài khoản nào |
| Luồng chính | 1. Gửi `phone`, `email` (tùy chọn), `password`. 2. Gateway kiểm tra hình thức. 3. `auth-service` chuẩn hóa số về `0` + 9 chữ số, email về chữ thường, kiểm tra định dạng. 4. Băm mật khẩu (scrypt), `INSERT` Account `role = customer`, `status = ACTIVE`; UNIQUE chặn trùng. 5. Trả 201 `account_id`, `role` |
| Ngoại lệ | Thiếu / sai kiểu / field lạ → 400. Sai định dạng số, email, mật khẩu < 8 ký tự → 400. Số hoặc email đã có → 409. `auth-service` dừng → 503 |
| Hậu điều kiện | Một Account `customer`; **chưa có hồ sơ** (A8, ADR-013); không gọi service nào |

### 2.2 UC02 — Đăng nhập (A05)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng, tài xế, admin |
| Tiền điều kiện | Đã có tài khoản |
| Luồng chính | 1. Gửi `phone` (hoặc `email`) và `password`. 2. `auth-service` chuẩn hóa → `SELECT … WHERE phone = $1`. 3. So mật khẩu scrypt (`timingSafeEqual`). 4. Kiểm tra `status = ACTIVE`. 5. Ký JWT **HS256** bằng `JWT_SECRET`, trả token |
| Ngoại lệ | Định danh sai định dạng → 400 `INVALID_PHONE` / `INVALID_EMAIL`. Không có tài khoản **hoặc** sai mật khẩu → cùng 401 `INVALID_CREDENTIALS`. Mật khẩu đúng nhưng `LOCKED` → 403 |
| Hậu điều kiện | Client có token mang `sub`, `role`, `jti`, `iat`, `exp`. Auth không lưu phiên |

### 2.3 Gateway kiểm tra token (mọi route có token)

Lấy token → kiểm tra chữ ký HS256 bằng `JWT_SECRET` và hạn → kiểm tra claim → tra Redis `revoked:{jti}` → so role với route → gọi service kèm metadata. Lỗi: bảng 4.1.

### 2.4 UC33 — Đăng xuất (A06)

| | Nội dung |
|---|---|
| Tác nhân | Người dùng có token (cả ba role) |
| Luồng chính | 1. Gateway kiểm tra token như 2.3. 2. `SET revoked:{jti} 1 EX <exp − now>`. 3. Trả 200. **Không gọi `auth-service`** [ĐC] |
| Ngoại lệ | Token thiếu / sai / hết hạn / đã thu hồi → 401. Redis lỗi khi ghi → 503 [chốt DN-Q1 (a)] |
| Hậu điều kiện | Mọi request sau dùng token đó → 401 `TOKEN_REVOKED`; token khác của cùng tài khoản vẫn dùng được |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `auth-service` | **Sở hữu** Account; băm mật khẩu; ký JWT | `auth-db` → database `auth`, bảng `accounts` |
| `gateway` | Kiểm tra hình thức, kiểm tra JWT, thu hồi token, chuyển danh tính qua metadata | Redis: `revoked:{jti}` |
| `redis` | Danh sách thu hồi | — |

`auth-service` không gọi service nào và không phát event (02 mục 1).

## 4. API REST tại Gateway

### 4.1 Cơ chế xác thực và phân quyền (dùng cho mọi route có token)

| Bước | Việc | Lỗi |
|---|---|---|
| 0 | Khớp route | 404 `ROUTE_NOT_FOUND` |
| 1 | *(Rate limit — spec mục 29)* | 429 |
| 2 | Đọc `Authorization: Bearer <token>`; chữ `Bearer` **không phân biệt hoa thường** (`bearer`, `BEARER` đều nhận) | Không có header hoặc token rỗng → 401 `TOKEN_MISSING`; sai dạng → 401 `TOKEN_INVALID` |
| 3 | Kiểm tra chữ ký bằng thư viện `jsonwebtoken` **9.0.3**: **chỉ `HS256`** (`algorithms: ['HS256']`), khóa `JWT_SECRET` | Sai chữ ký / bị sửa / sai định dạng / thuật toán khác → 401 `TOKEN_INVALID`. Đúng chữ ký nhưng hết hạn → 401 `TOKEN_EXPIRED` |
| 4 | Claim: `sub` là chuỗi số nguyên dương; `role` ∈ {`customer`, `driver`, `admin`}; có `jti`; **có `exp` là số** (bắt buộc: thư viện chỉ kiểm hạn khi có `exp`, và A06 cần `exp` để tính thời gian sống của `revoked:{jti}`) | Sai / thiếu → 401 `TOKEN_INVALID` |
| 5 | Redis `EXISTS revoked:{jti}`, **hạn 500 ms** mỗi lệnh Redis | Có → 401 `TOKEN_REVOKED`. Redis dừng hoặc quá 500 ms → **cho qua**, log `warn` [ĐC] |
| 6 | So `role` với bảng route (một bảng khai báo trong Gateway, ví dụ `src/routes.js`). Route có biến thể (04 mục 1.10, spec sau): so role của đường dẫn ở bước này, role của biến thể sau bước 8 | 403 `FORBIDDEN` |
| 7 | Đọc body là JSON **bất kể `Content-Type`** (Postman chọn "Text" hay "JSON" đều chạy — 04 mục 1); body rỗng = `{}`; request `GET` bỏ qua body | Không phân tích được thành JSON → 400 `INVALID_JSON` |
| 8 | Kiểm tra hình thức theo route | 400 |
| 9 | Gọi gRPC (deadline 3 000 ms), đổi lỗi theo spec 00 mục 4.1 | 400 / 401 / 403 / 404 / 409 / 503 |

Metadata Gateway gửi cho service [ĐC 04 mục 1.7]: `x-request-id` (luôn); `x-account-id` = `sub`, `x-role` = `role` (route có token). Gateway **tự dựng** metadata, **không chuyển** header cùng tên của client — nếu chuyển thì ai cũng giả được danh tính.

Quy tắc chung cho body (mọi route) [BA]: body phải là object JSON; field không có trong danh sách của route → 400 `INVALID_INPUT` (chặn client tự gửi `role`, `account_id`).

### 4.2 A04 `POST /api/v1/accounts`

| | |
|---|---|
| Vì sao đường dẫn này | Đăng ký = tạo một tài khoản → `POST` vào tập `accounts` (không dùng động từ `register`). Chỉ tạo `customer`; tài xế dùng `/api/v1/driver-accounts` (spec `12-13-21-23-tai-xe`) |
| Token / role | Không / — |
| Service — rpc | `auth-service` — `RegisterCustomer` |
| Request | `{ "phone": "0901234567", "password": "12345678" }` — thêm `"email"` nếu muốn. Cùng body với A05 nên mục 9 chỉ sửa URL |

| Field | Bắt buộc | Gateway (hình thức) | `auth-service` |
|---|---|---|---|
| `phone` | Có | Chuỗi, 1–20 ký tự | Bỏ khoảng trắng, `.`, `-`; khớp `^(?:\+84\|84\|0)([35789][0-9]{8})$`; lưu dạng `0` + 9 chữ số. Sai → `INVALID_PHONE` |
| `email` | Không | Chuỗi, 1–254 ký tự | Cắt khoảng trắng, chữ thường; khớp `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$`. Sai → `INVALID_EMAIL` |
| `password` | Có | Chuỗi, 1–128 ký tự | 8–128 ký tự. Sai → `INVALID_PASSWORD` |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **201** | `{ "account_id": 1000, "role": "customer" }` (mã qua API ≥ 1000) |
| Thiếu field, sai kiểu, field lạ | 400 | `INVALID_INPUT` |
| Body không phân tích được thành JSON | 400 | `INVALID_JSON` |
| Số / email / mật khẩu sai định dạng | 400 | `INVALID_PHONE` / `INVALID_EMAIL` / `INVALID_PASSWORD` |
| Số đã có (kiểm tra trước) | 409 | `PHONE_ALREADY_EXISTS` |
| Email đã có | 409 | `EMAIL_ALREADY_EXISTS` |
| `auth-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

"Chưa đăng nhập", "sai quyền", "không tìm thấy" không áp dụng: route công khai, tạo mới.

### 4.3 A05 `POST /api/v1/auth/login`

| | |
|---|---|
| Vì sao đường dẫn này | Ngoại lệ có chủ đích (04 mục 1.9): quy ước phổ biến; đăng nhập không tạo bản ghi nào (JWT không lưu phiên) |
| Token / role | Không / — |
| Service — rpc | `auth-service` — `Login` |
| Request | `{ "phone": "0900000001", "password": "12345678" }` hoặc `{ "email": "…", "password": "…" }` — **đúng một** trong `phone`, `email` [BA DN1, 04 mục 1.8] |

| Field | Gateway | `auth-service` |
|---|---|---|
| `phone` / `email` | Chuỗi, 1–254 ký tự; có đúng một trong hai | Chuẩn hóa như A04; số không khớp định dạng → `INVALID_PHONE`; email không khớp → `INVALID_EMAIL` |
| `password` | Chuỗi, 1–128 ký tự | Không kiểm tra độ dài tối thiểu |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **200** | `{ "token": "<JWT>", "account_id": 1, "role": "customer", "expires_in": 3600 }` (04 A05) |
| Thiếu field, sai kiểu, field lạ, có cả hai hoặc không có định danh | 400 | `INVALID_INPUT` |
| Số / email sai định dạng (gồm `' OR 1=1 --`) | 400 | `INVALID_PHONE` / `INVALID_EMAIL` |
| Không có tài khoản, hoặc sai mật khẩu (gồm `' OR '1'='1`) | 401 | `INVALID_CREDENTIALS` |
| Mật khẩu đúng, tài khoản `LOCKED` | 403 | `ACCOUNT_LOCKED` |
| `auth-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

"Trùng", "không tìm thấy" (404) không áp dụng: không có tài khoản trả 401 để không lộ số nào đã đăng ký.

JWT [ĐC ADR-016]:

| Phần | Giá trị |
|---|---|
| Header | `{ "alg": "HS256", "typ": "JWT" }` |
| `sub` | `account_id` dạng chuỗi, ví dụ `"1"` (chuẩn JWT: `sub` là chuỗi) |
| `role` | `customer` / `driver` / `admin` |
| `jti` | UUID ngẫu nhiên mỗi lần đăng nhập (`crypto.randomUUID()`), để thu hồi riêng từng token. Giữ UUID có chủ đích như `event_id`: không có bảng cấp số, người dùng không phải gõ (ADR-015 chỉ áp dụng cho mã gõ tay) |
| `iat`, `exp` | Giây Unix; `exp = iat + JWT_TTL_SECONDS` |
| Không chứa | Số điện thoại, email, họ tên (payload chỉ là base64, ai cũng đọc được) |
| Ký | `JWT_SECRET`, chỉ auth-service và gateway có |

### 4.4 A06 `POST /api/v1/auth/logout`

| | |
|---|---|
| Vì sao đường dẫn này | Ngoại lệ có chủ đích như A05; Gateway tự xử lý, không có tài nguyên ở service nào |
| Token / role | Có / cả ba role |
| Service | **Không** — Gateway + Redis [ĐC] |
| Request | Không body |
| Xử lý | Sau bước 2–6 mục 4.1: `SET revoked:{jti} 1 EX <exp − now>` (tối thiểu 1 giây), hạn 500 ms |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **200** | `{ "status": "LOGGED_OUT" }` |
| Không token / token sai / hết hạn / đã thu hồi | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| Redis lỗi khi ghi hoặc quá 500 ms | 503 | `SERVICE_UNAVAILABLE` [chốt DN-Q1 (a)] |

## 5. Hợp đồng gRPC — `proto/auth.proto`

`package cab.auth.v1; service AuthService`. Spec `12-13-21-23-tai-xe` thêm `RequestDriverOtp`, `RegisterDriver`.

| rpc | Vào | Ra | Lỗi (status → `details`) |
|---|---|---|---|
| `RegisterCustomer` | `{ string phone = 1; optional string email = 2; string password = 3; }` | `{ int64 account_id = 1; string role = 2; }` | `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_PHONE` / `INVALID_EMAIL` / `INVALID_PASSWORD`; `ALREADY_EXISTS` → `PHONE_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS`; `INTERNAL` khi lỗi database |
| `Login` | `{ optional string phone = 1; optional string email = 2; string password = 3; }` | `{ string token = 1; int64 account_id = 2; string role = 3; int32 expires_in = 4; }` | `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_PHONE` / `INVALID_EMAIL`; `UNAUTHENTICATED` → `INVALID_CREDENTIALS`; `PERMISSION_DENIED` → `ACCOUNT_LOCKED`; `INTERNAL` |

Cả hai rpc công khai: không đọc `x-account-id` / `x-role`. Service **tự kiểm tra lại** mọi điều Gateway đã kiểm tra.

Cài đặt trong `auth-service`:

| Việc | Cách làm | Truy vết |
|---|---|---|
| Băm mật khẩu | `scrypt` (N = 16384, r = 8, p = 1), salt 16 byte ngẫu nhiên, khóa ra 64 byte; lưu `scrypt$<salt hex>$<hash hex>`; so bằng `timingSafeEqual` | 03 mục 2; A4; mục 24 |
| Kiểm tra trùng | `INSERT` thẳng; bắt lỗi `23505` theo tên ràng buộc (`accounts_phone_key` → `PHONE_ALREADY_EXISTS`, `accounts_email_key` → `EMAIL_ALREADY_EXISTS`) | A2 |
| SQL | Chỉ câu lệnh có tham số (`$1`); không ghép chuỗi | Mục 25 |
| Log | `register_ok` / `login_ok` kèm `account_id`; `login_failed` kèm mã lỗi. **Không** ghi số điện thoại, email, mật khẩu, token | NFR08, NFR10 |
| Khởi động | `JWT_SECRET` thiếu hoặc < 32 ký tự → thoát 1 | Spec 00 |
| Lỗi không lường trước | Mọi lỗi không phải lỗi nghiệp vụ đã liệt kê → `INTERNAL` → Gateway trả 503 `SERVICE_UNAVAILABLE`, không lộ chi tiết (code đã làm 2026-10-04) | Spec 00 mục 4.1 |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `auth-service` `RegisterCustomer`, `Login` (G1) | gRPC | Khách đang chờ kết quả đăng ký / token |
| Gateway → Redis `SET` / `EXISTS revoked:{jti}` (G10) | Redis | FR42: đăng xuất có hiệu lực ngay ở nơi kiểm tra token |
| `auth-service` → service khác | **Không có** | Đăng ký chỉ tạo tài khoản (A8, ADR-013) |
| Event Kafka | **Không có** | Không FR nào cần biết có tài khoản mới (02 mục 9) |

## 7. Dữ liệu

### 7.1 Migration `services/auth-service/migrations/001_tao-accounts.sql`

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `account_id` | `bigint` | `GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY` |
| `phone` | `text` | `NOT NULL`, `CONSTRAINT accounts_phone_key UNIQUE`, `CHECK (phone ~ '^0[0-9]{9}$')` |
| `email` | `text` | NULL, `CONSTRAINT accounts_email_key UNIQUE` (nhiều NULL được phép) |
| `password_hash` | `text` | `NOT NULL`, `CHECK (password_hash LIKE 'scrypt$%')` |
| `role` | `text` | `NOT NULL`, `CHECK (role IN ('customer','driver','admin'))` |
| `status` | `text` | `NOT NULL DEFAULT 'ACTIVE'`, `CHECK (status IN ('ACTIVE','LOCKED'))` |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Không thêm index: hai UNIQUE là index cho đăng nhập. Số điện thoại, email **lưu rõ** [ĐC ADR-012 sửa]: cần tra cứu và UNIQUE; bảo vệ bằng mạng nội bộ và quyền ở API. Bảng `otp_verifications` thuộc spec `12-13-21-23-tai-xe` (migration `002`).

### 7.2 Redis (Gateway)

| Key | Giá trị | TTL |
|---|---|---|
| `revoked:{jti}` | `1` | Thời gian sống còn lại của token, tối thiểu 1 giây |

### 7.3 Seed `auth-service` (03 mục 14) [ĐC]

Mật khẩu mọi tài khoản = `SEED_PASSWORD` (`12345678`), băm bằng cùng module với A04. Ghi bằng `OVERRIDING SYSTEM VALUE`, `ON CONFLICT DO NOTHING`. Không seed email.

| Mã | `account_id` | Số điện thoại | Role | Status | Dùng cho mục |
|---|---|---|---|---|---|
| KH1 | 1 | `0900000001` | customer | ACTIVE | 10, 11, 24, 25, 26, 27 … |
| KH2 | 2 | `0900000002` | customer | ACTIVE | 11 (403), 27 |
| KH3 | 3 | `0900000003` | customer | ACTIVE | 11 (chưa có hồ sơ) |
| KH9 | 9 | `0900000009` | customer | **LOCKED** | 10 (403) |
| TX1–TX8 | 11–18 | `0910000001` … `0910000008` | driver | ACTIVE | 12–23 |
| AD1 | 99 | `0999999999` | admin | ACTIVE | 22, 27, 28 |

Quy luật: khách `090000000n` ↔ mã `n`; tài xế `091000000n` ↔ mã `10 + n`; admin toàn số 9 ↔ mã 99.

## 8. Tiêu chí chấp nhận

Tiền điều kiện: spec 00 đạt; seed đã chạy. Mỗi mục chấm ≤ 3 request gõ tay; token copy từ response.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-DN-01 | 9 | Số `0901234567` chưa có | A04 `{ "phone": "0901234567", "password": "12345678" }` | 201 `{ account_id ≥ 1000, role: "customer" }` (lần đầu sau seed: 1000) |
| AC-DN-02 | 9 | Sau AC-DN-01 | A05 cùng body | 200 có `token`, `role = customer`, cùng `account_id` — "đăng ký xong đăng nhập được" (AC27) |
| AC-DN-03 | 9 (409) | Sau AC-DN-01 | A04 lại cùng số | 409 `PHONE_ALREADY_EXISTS`; không tạo dòng mới |
| AC-DN-04 | 9 (400) | — | A04 thiếu `password`; A04 có thêm `"role": "admin"` | 400 `INVALID_INPUT` cả hai — không tạo được admin qua đăng ký (A1) |
| AC-DN-05 | 9 (400) | — | A04 `phone: "12345"`; `email: "abc"`; `password: "123"` | 400 `INVALID_PHONE`; `INVALID_EMAIL`; `INVALID_PASSWORD` |
| AC-DN-06 | 9 (503) | `docker compose stop auth-service` | A04 hợp lệ | 503 `SERVICE_UNAVAILABLE` |
| AC-DN-07 | 10 | Seed KH1 | A05 `{ "phone": "0900000001", "password": "12345678" }` | 200; có `token`; `account_id = 1`; `expires_in = 3600`; giải base64 phần giữa của token (test-agent làm) thấy `sub: "1"`, `role: "customer"`, `jti`, `exp`; **không** có số điện thoại |
| AC-DN-08 | 10 (401) | Seed KH1 | A05 sai mật khẩu; A05 số chưa đăng ký `0988888888` | 401 `INVALID_CREDENTIALS` cả hai, body giống hệt |
| AC-DN-09 | 10 (400) | — | A05 thiếu `password` | 400 `INVALID_INPUT` |
| AC-DN-10 | 10 (403) | Seed KH9 `LOCKED` | A05 `0900000009` đúng mật khẩu | 403 `ACCOUNT_LOCKED` |
| AC-DN-11 | 10 | Seed AD1, TX1 | A05 `0999999999`; A05 `0910000001` | 200 `role = admin`; 200 `role = driver` — ba role cùng một API (UC02) |
| AC-DN-12 | 25 | Seed KH1 | A05 `{ "phone": "0900000001", "password": "' OR '1'='1" }` | 401 `INVALID_CREDENTIALS` |
| AC-DN-13 | 25 | — | A05 `{ "phone": "' OR 1=1 --", "password": "x" }` | 400 `INVALID_PHONE`; sau đó AC-DN-07 vẫn 200 (bảng còn nguyên) |
| AC-DN-14 | 25 | Đọc code `auth-service` | Tìm mọi câu SQL | Mọi giá trị đi qua `$n`; không ghép chuỗi |
| AC-DN-15 | 27 | Token KH1 hợp lệ | A38 `GET /api/v1/customers/me` với token đã **sửa một ký tự ở giữa** (không phải ký tự cuối) | 401 `TOKEN_INVALID` |
| AC-DN-16 | 27 | — | A38 không header `Authorization` | 401 `TOKEN_MISSING` |
| AC-DN-17 | 27 | Token KH1 hợp lệ | A06 → A38 cùng token | 200 `LOGGED_OUT`; 401 `TOKEN_REVOKED` (FR42) |
| AC-DN-18 | 27 (503) | `docker compose stop redis` | A06 với token hợp lệ | 503 `SERVICE_UNAVAILABLE`; log Gateway có cảnh báo Redis |
| AC-DN-19 | 24 | Seed | `docker exec auth-db psql -U cab -d auth -c "table accounts"` | `password_hash` bắt đầu `scrypt$`, không thấy `12345678`; `phone` hiện rõ (đúng thiết kế, nói được lý do) |

| AC-DN-20 | 404 | — | `POST /auth/login` (thiếu `/api/v1`) | 404 `ROUTE_NOT_FOUND` |

Chuỗi gõ tay khi thi (khớp 04 mục 5; dùng lại tab, 30 giây gồm cả giải thích; `(…)` = tùy chọn):

| Mục | Request | Kết quả |
|---|---|---|
| 9 | `POST /api/v1/accounts` số mới → sửa tab `accounts` → `auth/login` → (sửa lại `accounts`) | 201; 200 token; (409) |
| 10 | Tab mục 9 sửa số KH1 → nhân bản tab số TX1 → nhân bản tab số AD1 → (tab KH1 sai mật khẩu) | 200 `customer`; 200 `driver`; 200 `admin`; (401). KH9 → 403 để test-agent kiểm (AC-DN-10) |
| 25 | Tab KH1 mật khẩu `' OR '1'='1` → tab GET `/api/v1/customers/1 OR 1=1` (spec 11) → (tab KH1 phone `' OR 1=1 --`) | 401 `INVALID_CREDENTIALS`; 400 `INVALID_ID`; (400 `INVALID_PHONE`) |
| 27 | Tab GET `/api/v1/customers/me` với token KH1 sửa một ký tự ở giữa → sửa tab: No Auth | 401 `TOKEN_INVALID`; 401 `TOKEN_MISSING`. Phụ: A06 token đúng → A38 lại token đó → 200 `LOGGED_OUT`; 401 `TOKEN_REVOKED` |

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Token `alg: none`, token ký bằng khóa lạ, `role: "superadmin"` | Thư viện đã cố định `algorithms: ['HS256']`; AC-DN-15 đủ cho mục 27 |
| Token hết hạn → `TOKEN_EXPIRED` (đặt `JWT_TTL_SECONDS=2` hoặc đồng hồ giả) | Phải chờ; không thuộc phiếu chấm |
| Token ký đúng `JWT_SECRET` nhưng thiếu `exp` → 401 `TOKEN_INVALID`; header `bearer <token>` (chữ thường) → 200 | Unit test Gateway; không chấm |
| Hai lần đăng nhập ra `jti` khác nhau; đăng xuất một token không ảnh hưởng token khác | Hành vi đúng nhưng không chấm |
| Header client `x-account-id`, `x-role` bị bỏ qua | Quy tắc vẫn bắt buộc (mục 4.1); test tự động khi có thời gian |
| Chuẩn hóa `+84 9xx…` trùng với `09xx…`; email viết hoa đăng nhập được | Không chấm |
| Hai request đăng ký đồng thời cùng số | UNIQUE đã bảo đảm |
| Đăng ký vẫn 201 khi `customer-service` dừng | Hiển nhiên vì không có đường gọi (mục 6) |
| Thời gian phản hồi giống nhau giữa "không có tài khoản" và "sai mật khẩu" (băm giả) | Chống dò số; ngoài phiếu chấm |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| DN1 | Đăng nhập dùng field `phone` **hoặc** `email` (đúng một), cùng tên field với A04 | Một tên field phải nhớ cho cả đăng ký và đăng nhập; UC02 cho cả hai | Request A05, `Login` |
| DN2 | Thêm mã `INVALID_EMAIL`, `INVALID_PASSWORD`, `EMAIL_ALREADY_EXISTS` | UC01: "số điện thoại **hoặc email** đã có → từ chối" | Mục 4.2, 5 |
| DN3 | Mật khẩu 8–128 ký tự | SRS không quy định; độ dài là yếu tố chính. Seed `12345678` vừa đủ 8 | Mục 4.2 |
| DN4 | Field lạ trong body → 400 | Chặn gán thừa `role`, `account_id` | Mục 4.1 |
| DN5 | Không tồn tại / sai mật khẩu cùng 401; `ACCOUNT_LOCKED` chỉ khi mật khẩu đúng | Không lộ số đã đăng ký | Mục 4.3 |
| DN6 | `sub` là chuỗi `"1"`, metadata `x-account-id` là chuỗi; service đổi sang số | Chuẩn JWT; một chỗ đổi kiểu | Gateway, service |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| ~~DN-Q1~~ | Đã chốt 2026-10-04 theo đề xuất (a), code đã làm: đăng xuất khi Redis dừng → 503 (trả 200 là báo sai) | — | — | — |
| ~~DN-Q2~~ | Đã chốt 2026-10-04 theo đề xuất (a), code đã làm: tài khoản bị khóa sau khi có token thì token cũ dùng đến hết hạn (không có API khóa tài khoản) | — | — | — |
| ~~DN-Q3~~ | Đã đóng 2026-10-03: 04 mục 1.8 ghi `phone` hoặc `email` (DN1) | — | — | — |
| ~~DN-Q4~~ | Đã chốt 2026-10-04 theo đề xuất (a), code đã làm: `account_id` ở response là số, `sub` trong JWT là chuỗi (DN6) | — | — | — |
