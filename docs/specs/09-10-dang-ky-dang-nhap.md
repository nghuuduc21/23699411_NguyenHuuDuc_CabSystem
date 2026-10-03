# Spec 09-10 — Đăng ký tài khoản khách, đăng nhập, JWT, đăng xuất

> Vòng 2, viết 2026-10-03. Mục chấm **9, 10, 25, 27**. FR26, FR42.
> Đầu vào: `CLAUDE.md`; `srs.md` (FR26, FR42, UC01, UC02, UC33, AC27, RTM26, RTM27); `docs/design/01` quy tắc A1–A5, A8; `docs/design/02` mục 2.2, G1, G10; `docs/design/03` mục 2, 3.1, 11.4, 12, 14; `docs/design/04` A04–A06, mục 1, 1.1, 1.7, 3, 5.1, 5.3; ADR-010, ADR-012, ADR-013.
> Phụ thuộc: **spec 00** (Compose, migration, seed, bảng đổi lỗi, header bảo vệ).
> Ngoài phạm vi: rate limit (mục 29, spec riêng — middleware để chỗ trống ở bước 1 của mục 4.1); OTP và đăng ký tài xế (mục 21, bảng `otp_verifications`); toàn bộ ma trận role (mục 28 — spec này chỉ dựng cơ chế).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn trong spec này (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 9 Đăng ký khách → đăng nhập được | BG05 | BR05 | FR26 | A1, A2, A4, A8 | UC01 | AC27 / RTM27 | NFR08 |
| 10 Đăng nhập → cấp token | BG05 | BR05 | FR26, FR32 | A3, A5, BRULE12 | UC02 | AC27 / RTM27 | NFR06, NFR07 |
| 25 SQL injection | BG05 | BR15 | FR26 | — | UC02 | — | NFR08 |
| 27 JWT bị sửa → 401 | BG05 | BR15 | FR42 | A5 | UC33 | RTM26 | NFR06 |

## 2. Luồng nghiệp vụ

### 2.1 UC01 — Đăng ký tài khoản (A04)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (chưa đăng nhập) |
| Tiền điều kiện | Số điện thoại / email chưa thuộc tài khoản nào |
| Luồng chính | 1. Khách gửi số điện thoại, email (tùy chọn), mật khẩu. 2. Gateway kiểm tra hình thức. 3. `auth-service` chuẩn hóa, kiểm tra định dạng, kiểm tra trùng bằng chỉ mục mù. 4. Băm mật khẩu, mã hóa số điện thoại / email, lưu Account `role = customer`, `status = ACTIVE`. 5. Trả 201 `account_id`, `role` |
| Ngoại lệ | Thiếu / sai kiểu → 400. Sai định dạng số, email, mật khẩu quá ngắn → 400. Số hoặc email đã có → 409, không tạo gì. `auth-service` dừng → 503 |
| Hậu điều kiện | Một Account `customer`; **chưa có hồ sơ** (A8, ADR-013); không gọi service nào |

### 2.2 UC02 — Đăng nhập (A05)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng, tài xế, admin |
| Tiền điều kiện | Đã có tài khoản |
| Luồng chính | 1. Gửi `identifier` (số điện thoại hoặc email) và mật khẩu. 2. `auth-service` chuẩn hóa → tính chỉ mục mù → tìm Account. 3. So mật khẩu (scrypt, so sánh thời gian hằng). 4. Kiểm tra `status = ACTIVE`. 5. Ký JWT RS256, trả token |
| Ngoại lệ | Định danh sai định dạng → 400. Không có tài khoản **hoặc** sai mật khẩu → cùng một lỗi 401 (không lộ số nào đã đăng ký). Mật khẩu đúng nhưng tài khoản `LOCKED` → 403 |
| Hậu điều kiện | Client có token mang `sub`, `role`, `jti`, `exp`. Auth không lưu phiên (JWT tự chứa) |

### 2.3 Gateway kiểm tra token (mọi route có token)

| | Nội dung |
|---|---|
| Luồng chính | Lấy token → kiểm tra chữ ký bằng khóa công khai, thuật toán, `iss`, hạn → kiểm tra claim → tra Redis `revoked:{jti}` → so role với route → gọi service kèm metadata |
| Ngoại lệ | Xem bảng 4.1 |

### 2.4 UC33 — Đăng xuất (A06)

| | Nội dung |
|---|---|
| Tác nhân | Người dùng có token (cả ba role) |
| Luồng chính | 1. Gateway kiểm tra token như 2.3. 2. Ghi `revoked:{jti}` vào Redis, sống đúng thời gian còn lại của token. 3. Trả 200. **Không gọi `auth-service`** [ĐC] |
| Ngoại lệ | Token thiếu / sai / hết hạn / đã thu hồi → 401. Redis lỗi khi ghi → 503 (đăng xuất **chưa** có hiệu lực, client phải biết) [BA, DN-Q2] |
| Hậu điều kiện | Mọi request sau dùng token đó → 401 `TOKEN_REVOKED`. Token khác của cùng tài khoản vẫn dùng được |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `auth-service` | **Sở hữu** Account, băm, mã hóa, ký JWT | `auth-db.accounts` |
| `gateway` | Kiểm tra hình thức, kiểm tra JWT, thu hồi token, chuyển danh tính qua metadata | Redis: `revoked:{jti}` |
| `redis` | Danh sách thu hồi | — |

Không service nào khác tham gia. `auth-service` không gọi service nào và không phát event (02 mục 1).

## 4. API REST tại Gateway

### 4.1 Cơ chế xác thực và phân quyền của Gateway (dùng cho mọi route có token)

Thứ tự xử lý một request [ĐC 04 mục 1]:

| Bước | Việc | Lỗi |
|---|---|---|
| 0 | Sinh `X-Request-Id`; khớp route (spec 00) | 404 `ROUTE_NOT_FOUND` |
| 1 | *(Rate limit — spec mục 29, chưa làm)* | 429 |
| 2 | Route có token: đọc header `Authorization` | Không có header, hoặc `Bearer` với token rỗng → 401 `TOKEN_MISSING`. Có header nhưng không đúng dạng `Bearer <token>` → 401 `TOKEN_INVALID` |
| 3 | Kiểm tra JWS: **chỉ chấp nhận `alg = RS256`**, khóa `JWT_PUBLIC_KEY_B64`, `iss = JWT_ISSUER`, có `exp` | Sai chữ ký, bị sửa, sai định dạng, `alg` khác (kể cả `none`, `HS256`), sai `iss` → 401 `TOKEN_INVALID`. Chữ ký đúng nhưng `exp` ≤ hiện tại → 401 `TOKEN_EXPIRED` |
| 4 | Kiểm tra claim: `sub` là UUID; `role` ∈ {`customer`, `driver`, `admin`}; `jti` là UUID | Sai → 401 `TOKEN_INVALID` |
| 5 | Redis `EXISTS revoked:{jti}` | Có → 401 `TOKEN_REVOKED`. Redis lỗi / dừng → **cho qua**, log `warn` [ĐC] |
| 6 | So `role` với danh sách role của route (một bảng khai báo duy nhất trong Gateway, ví dụ `src/routes.js`) | Không có trong danh sách → 403 `FORBIDDEN` |
| 7 | Đọc body JSON (sau bước 2–6: request không token nhận 401 trước 400) | Không phải JSON hợp lệ hoặc `Content-Type` không phải `application/json` với route có body → 400 `INVALID_JSON` |
| 8 | Kiểm tra hình thức theo route (mục 4.2–4.4) | 400 |
| 9 | Gọi gRPC, deadline `GATEWAY_GRPC_DEADLINE_MS`, metadata ở bảng dưới; đổi lỗi theo spec 00 mục 5.1 | 400 / 401 / 403 / 404 / 409 / 503 |

Metadata Gateway gửi cho service [ĐC 04 mục 1.7]:

| Key | Giá trị | Khi nào |
|---|---|---|
| `x-request-id` | UUID của request | Luôn |
| `x-account-id` | `sub` của token | Route có token |
| `x-role` | `role` của token | Route có token |

Gateway **tự dựng** metadata, **không chuyển tiếp** bất kỳ header nào của client có tên `x-account-id`, `x-role`, `x-request-id` (client gửi lên thì bị bỏ qua). Lý do: service tin metadata vì chỉ Gateway vào được mạng nội bộ; nếu Gateway chuyển header của client thì ai cũng giả được danh tính.

Quy tắc chung cho body (A04, A05 và mọi route sau) [BA]: body phải là **object JSON**; có field không nằm trong danh sách của route → 400 `INVALID_INPUT` (chặn client tự gửi `role`, `account_id`…).

### 4.2 A04 `POST /api/v1/auth/register`

| | |
|---|---|
| Token / role | Không / — (có token cũng bỏ qua) |
| Service — rpc | `auth-service` — `RegisterCustomer` |
| Request | `{ "phone": "0912345678", "email": "an@example.com", "password": "matkhau123" }` |

| Field | Bắt buộc | Gateway kiểm tra (hình thức) | `auth-service` kiểm tra (định dạng, nghiệp vụ) |
|---|---|---|---|
| `phone` | Có | Chuỗi, 1–20 ký tự | Bỏ khoảng trắng, `.`, `-`; khớp `^(?:\+84\|84\|0)([35789][0-9]{8})$`; chuẩn hóa thành `+84` + 9 chữ số. Sai → `INVALID_PHONE` |
| `email` | Không (vắng hoặc `null`) | Chuỗi, 1–254 ký tự | Cắt khoảng trắng hai đầu, chữ thường; khớp `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$`. Sai → `INVALID_EMAIL` |
| `password` | Có | Chuỗi, 1–128 ký tự | Độ dài 8–128 ký tự. Sai → `INVALID_PASSWORD`. Không kiểm tra `<`, `>` (không bao giờ hiển thị) |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **201** | `{ "account_id": "<uuid>", "role": "customer" }` — không có mật khẩu, hồ sơ, số điện thoại |
| Thiếu field, sai kiểu, field lạ | 400 | `INVALID_INPUT` |
| Body không phải JSON | 400 | `INVALID_JSON` |
| Số điện thoại sai định dạng | 400 | `INVALID_PHONE` |
| Email sai định dạng | 400 | `INVALID_EMAIL` |
| Mật khẩu < 8 ký tự | 400 | `INVALID_PASSWORD` |
| Số điện thoại đã có | 409 | `PHONE_ALREADY_EXISTS` |
| Email đã có | 409 | `EMAIL_ALREADY_EXISTS` |
| Cả hai đã có | 409 | `PHONE_ALREADY_EXISTS` (kiểm tra số trước) |
| `auth-service` dừng / quá deadline | 503 | `SERVICE_UNAVAILABLE` |

"Chưa đăng nhập" và "sai quyền" không áp dụng: route công khai, role nào cũng gọi được (04 mục 3).

### 4.3 A05 `POST /api/v1/auth/login`

| | |
|---|---|
| Token / role | Không / — |
| Service — rpc | `auth-service` — `Login` |
| Request | `{ "identifier": "0912345678", "password": "matkhau123" }` — `identifier` là số điện thoại **hoặc** email (UC02) [BA] |

| Field | Bắt buộc | Gateway | `auth-service` |
|---|---|---|---|
| `identifier` | Có | Chuỗi, 1–254 ký tự | Có `@` → xử lý như email (mục 4.2); không có → như số điện thoại. Không khớp định dạng nào → `INVALID_INPUT` |
| `password` | Có | Chuỗi, 1–128 ký tự | Không kiểm tra độ dài tối thiểu (không lộ chính sách mật khẩu) |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **200** | `{ "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600, "account_id": "<uuid>", "role": "customer" }` |
| Thiếu field, sai kiểu, field lạ; định danh sai định dạng (gồm chuỗi `' OR 1=1 --`) | 400 | `INVALID_INPUT` |
| Không có tài khoản với định danh này | 401 | `INVALID_CREDENTIALS` |
| Sai mật khẩu (gồm chuỗi `' OR '1'='1`) | 401 | `INVALID_CREDENTIALS` |
| Mật khẩu đúng, tài khoản `LOCKED` | 403 | `ACCOUNT_LOCKED` |
| Mật khẩu sai, tài khoản `LOCKED` | 401 | `INVALID_CREDENTIALS` (không lộ trạng thái khóa cho người không biết mật khẩu) |
| `auth-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

JWT [BA theo GĐ-8 / Q19 (a); đã chốt thời hạn đọc từ biến môi trường]:

| Phần | Giá trị |
|---|---|
| Header | `{ "alg": "RS256", "typ": "JWT" }` |
| `sub` | `account_id` |
| `role` | `customer` / `driver` / `admin` |
| `jti` | UUID v4 mới mỗi lần đăng nhập (để thu hồi riêng từng token) |
| `iat` | Giây Unix lúc cấp |
| `exp` | `iat + JWT_TTL_SECONDS` |
| `iss` | `JWT_ISSUER` |
| Không chứa | Số điện thoại, email, họ tên, trạng thái tài khoản (payload JWT chỉ mã base64, ai cũng đọc được) |
| Ký | Khóa riêng `JWT_PRIVATE_KEY_B64`, chỉ `auth-service` có |

### 4.4 A06 `POST /api/v1/auth/logout`

| | |
|---|---|
| Token / role | Có / `customer`, `driver`, `admin` |
| Service | **Không** — Gateway + Redis [ĐC] |
| Request | Không body (có body thì bỏ qua) |
| Xử lý | Sau bước 2–6 của mục 4.1: `SET revoked:{jti} 1 EX <exp − now>` (tối thiểu 1 giây) |

| Kết quả | HTTP | Body |
|---|---|---|
| Thành công | **200** | `{ "status": "LOGGED_OUT" }` |
| Không token | 401 | `TOKEN_MISSING` |
| Token bị sửa / sai chữ ký / sai thuật toán | 401 | `TOKEN_INVALID` |
| Token hết hạn | 401 | `TOKEN_EXPIRED` |
| Token đã đăng xuất | 401 | `TOKEN_REVOKED` |
| Redis lỗi khi ghi | 503 | `SERVICE_UNAVAILABLE` [BA] |

"Thiếu dữ liệu", "sai kiểu", "trùng", "không tìm thấy" không áp dụng (không có body, không có đối tượng).

## 5. Hợp đồng gRPC — `proto/auth.proto`

`package cab.auth.v1; service AuthService`. Spec 21 sẽ thêm `RequestDriverOtp`, `RegisterDriver` vào cùng service.

| rpc | Vào | Ra | Lỗi (status → `details`) |
|---|---|---|---|
| `RegisterCustomer` | `RegisterCustomerRequest { string phone = 1; optional string email = 2; string password = 3; }` | `RegisterCustomerResponse { string account_id = 1; string role = 2; }` | `INVALID_ARGUMENT` → `INVALID_INPUT` (thiếu field) / `INVALID_PHONE` / `INVALID_EMAIL` / `INVALID_PASSWORD`; `ALREADY_EXISTS` → `PHONE_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS`; `INTERNAL` khi lỗi database |
| `Login` | `LoginRequest { string identifier = 1; string password = 2; }` | `LoginResponse { string access_token = 1; string token_type = 2; int32 expires_in = 3; string account_id = 4; string role = 5; }` | `INVALID_ARGUMENT` → `INVALID_INPUT`; `UNAUTHENTICATED` → `INVALID_CREDENTIALS`; `PERMISSION_DENIED` → `ACCOUNT_LOCKED`; `INTERNAL` |

Cả hai rpc là công khai: không đọc `x-account-id` / `x-role`; chỉ dùng `x-request-id` để ghi log. Service **tự kiểm tra lại** mọi điều Gateway đã kiểm tra (không tin dữ liệu chỉ vì đã qua Gateway).

Cài đặt bên trong `auth-service`:

| Việc | Cách làm | Truy vết |
|---|---|---|
| Băm mật khẩu | `scrypt`, N = 16384, r = 8, p = 1, salt 16 byte ngẫu nhiên, khóa ra 64 byte. Lưu `scrypt$16384$8$1$<salt base64>$<hash base64>`. So sánh bằng `timingSafeEqual` | 03 mục 2; A4 |
| Đăng nhập với định danh không tồn tại | Vẫn chạy scrypt với một hash giả cố định rồi trả `INVALID_CREDENTIALS` | Thời gian phản hồi không lộ số nào đã đăng ký |
| Mã hóa | AES-256-GCM, khóa `AUTH_DATA_KEY`, IV 12 byte ngẫu nhiên mỗi giá trị. Lưu `0x01 ‖ IV ‖ bản mã ‖ tag 16 byte`. AAD = `accounts.phone` / `accounts.email` (bản mã không chép được sang cột khác) | ADR-012; 03 mục 11.4 |
| Chỉ mục mù | `HMAC-SHA256(AUTH_BLIND_INDEX_KEY, "phone:" + số đã chuẩn hóa)`; email: tiền tố `"email:"`. 32 byte | ADR-012 |
| Kiểm tra trùng | Tra `phone_bidx`, rồi `email_bidx`; rồi `INSERT`. Hai request đồng thời: bắt lỗi `23505` theo **tên ràng buộc** (`accounts_phone_bidx_key` → `PHONE_ALREADY_EXISTS`, `accounts_email_bidx_key` → `EMAIL_ALREADY_EXISTS`) | A2 |
| SQL | Chỉ câu lệnh có tham số (`$1`). Giá trị định danh đi vào SQL dưới dạng **byte HMAC**, không bao giờ là chuỗi người dùng nhập | Mục 25; `CLAUDE.md` |
| Log | Thành công: `register_ok` / `login_ok` kèm `account_id`, `request_id`. Thất bại: `login_failed` kèm mã lỗi, `request_id`. **Không** ghi định danh, mật khẩu, token | NFR08, NFR10 |
| Thiếu / sai khóa khi khởi động | `JWT_PRIVATE_KEY_B64` không đọc được thành khóa RSA, hoặc `AUTH_DATA_KEY` / `AUTH_BLIND_INDEX_KEY` không đúng 32 byte → thoát 1 | 03 mục 11.4 |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `auth-service` `RegisterCustomer`, `Login` (G1) | gRPC | Khách đang chờ kết quả đăng ký / token |
| Gateway → Redis `SET` / `EXISTS revoked:{jti}` (G10) | Redis | FR42: đăng xuất có hiệu lực ngay ở nơi kiểm tra token |
| `auth-service` → service khác | **Không có** | Đăng ký chỉ tạo tài khoản (A8, ADR-013); không ai cần biết có tài khoản mới |
| Event Kafka | **Không có** | Không FR nào cần thông báo khi đăng ký / đăng nhập (02 mục 9) |

## 7. Dữ liệu

### 7.1 Migration `services/auth-service/migrations/001_tao-accounts.sql`

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `account_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` |
| `phone_enc` | `bytea` | `NOT NULL` |
| `phone_bidx` | `bytea` | `NOT NULL`, `CONSTRAINT accounts_phone_bidx_key UNIQUE`, `CHECK (octet_length(phone_bidx) = 32)` |
| `email_enc` | `bytea` | NULL |
| `email_bidx` | `bytea` | NULL, `CONSTRAINT accounts_email_bidx_key UNIQUE`, `CHECK (email_bidx IS NULL OR octet_length(email_bidx) = 32)` |
| `password_hash` | `text` | `NOT NULL`, `CHECK (password_hash LIKE 'scrypt$%')` |
| `role` | `text` | `NOT NULL`, `CHECK (role IN ('customer','driver','admin'))` |
| `status` | `text` | `NOT NULL DEFAULT 'ACTIVE'`, `CHECK (status IN ('ACTIVE','LOCKED'))` |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Ràng buộc mức bảng: `CONSTRAINT accounts_email_pair CHECK ((email_enc IS NULL) = (email_bidx IS NULL))`.

Không thêm index nào khác: hai UNIQUE đã là index cho đăng nhập (03 mục 3.1). Bảng `otp_verifications` thuộc spec 21 (migration `002_…`).

### 7.2 Redis (Gateway)

| Key | Giá trị | TTL |
|---|---|---|
| `revoked:{jti}` | `1` | Thời gian sống còn lại của token, tối thiểu 1 giây |

### 7.3 Seed `auth-service` (`src/seed.js`)

Mật khẩu mọi tài khoản seed = `SEED_PASSWORD`. Số điện thoại, email mã hóa và tính chỉ mục bằng **cùng module** với A04. Tài khoản tài xế được tạo ở đây để ID cố định ngay từ đầu; hồ sơ tài xế do seed của `driver-service` (spec 12/13).

| Mã | `account_id` | Role | Status | Số điện thoại (nhập vào Postman) | Email | Dùng cho mục |
|---|---|---|---|---|---|---|
| AD1 | `00000000-0000-4000-8000-000000000001` | admin | ACTIVE | `0900000001` | `admin@cab.test` | 22, 28 |
| KH1 | `00000000-0000-4000-8000-000000000011` | customer | ACTIVE | `0900000011` | `kh1@cab.test` | 10, 11, 14–20, 24, 26 |
| KH2 | `00000000-0000-4000-8000-000000000012` | customer | ACTIVE | `0900000012` | `kh2@cab.test` | 11, 28 |
| KH3 | `00000000-0000-4000-8000-000000000013` | customer | ACTIVE | `0900000013` | — | 11 (dự phòng) |
| KH9 | `00000000-0000-4000-8000-000000000019` | customer | **LOCKED** | `0900000019` | — | 10 (đường lỗi) |
| TX1…TX8 | `00000000-0000-4000-8000-000000000021` … `…000000000028` | driver | ACTIVE | `0900000021` … `0900000028` | — | 12–23 |

`--reset`: xóa các dòng có 13 `account_id` trên rồi chèn lại (KH9 về `LOCKED`). Không đụng tài khoản tạo qua API.

## 8. Tiêu chí chấp nhận

Tiền điều kiện chung: spec 00 đạt; seed đã chạy; Postman có biến `base_url = http://localhost:3000`, `seed_password` (lấy từ `.env`). Script Postman sinh số mới dạng `09` + 8 chữ số ngẫu nhiên.

### 8.1 Mục 9 — đăng ký

| AC | Given | When | Then |
|---|---|---|---|
| AC-DN-01 | Số `phone_new` chưa có | A04 `{ phone: phone_new, email: <email mới>, password: "matkhau123" }` | 201; body đúng hai khóa `account_id` (UUID), `role = "customer"`; script lưu `account_id_new` |
| AC-DN-02 | Sau AC-DN-01 | A05 `{ identifier: phone_new, password: "matkhau123" }` | 200; `role = customer`; `account_id` = `account_id_new`; script lưu `token_new` — "đăng ký xong đăng nhập được" (AC27) |
| AC-DN-03 | Sau AC-DN-01 | A04 lần hai cùng `phone_new` (email khác) | 409 `PHONE_ALREADY_EXISTS`; số dòng `accounts` không đổi |
| AC-DN-04 | Sau AC-DN-01 | A04 số mới khác nhưng **cùng email** | 409 `EMAIL_ALREADY_EXISTS` |
| AC-DN-05 | — | A04 viết số dạng `+84 9xx xxx xxx` của `phone_new` | 409 `PHONE_ALREADY_EXISTS` — chuẩn hóa trước khi so trùng |
| AC-DN-06 | — | A04 thiếu `password`; `phone` là số `912345678` (kiểu number); có thêm field `role: "admin"` | Đều 400 `INVALID_INPUT` — không tạo được admin qua đăng ký (A1) |
| AC-DN-07 | — | A04 `phone: "12345"`; `email: "khong-hop-le"`; `password: "1234567"` | 400 `INVALID_PHONE`; 400 `INVALID_EMAIL`; 400 `INVALID_PASSWORD` |
| AC-DN-08 | — | A04 body `{phone:` (JSON hỏng) | 400 `INVALID_JSON` |
| AC-DN-09 | — | A04 không có `email` | 201; đăng nhập bằng email không được (401) |
| AC-DN-10 | `docker compose stop auth-service` | A04 hợp lệ | 503 `SERVICE_UNAVAILABLE` trong ≤ `GATEWAY_GRPC_DEADLINE_MS` + 0,5 giây |
| AC-DN-11 | `docker compose stop customer-service` | A04 với số mới | **201** — đăng ký không phụ thuộc Customer (ADR-013, NFR05) |

### 8.2 Mục 10 — đăng nhập

| AC | Given | When | Then |
|---|---|---|---|
| AC-DN-12 | Seed KH1 | A05 `{ identifier: "0900000011", password: seed_password }` | 200; `token_type = "Bearer"`; `expires_in = JWT_TTL_SECONDS`; giải mã phần payload thấy đúng `sub`, `role = customer`, `jti`, `iat`, `exp`, `iss`; **không** có số điện thoại / email |
| AC-DN-13 | Seed KH1 | A05 bằng email `kh1@cab.test`, và bằng `KH1@CAB.TEST` | 200 cả hai |
| AC-DN-14 | Seed AD1, TX1 | A05 bằng số của AD1, TX1 | 200, `role = admin`, `role = driver` — cả ba role đăng nhập cùng một API (UC02) |
| AC-DN-15 | Seed KH1 | A05 sai mật khẩu | 401 `INVALID_CREDENTIALS` |
| AC-DN-16 | — | A05 với số chưa đăng ký `0999999999` | 401 `INVALID_CREDENTIALS` (giống hệt AC-DN-15) |
| AC-DN-17 | — | A05 thiếu `password`; `identifier` rỗng; `password` là số | 400 `INVALID_INPUT` |
| AC-DN-18 | Seed KH9 (`LOCKED`) | A05 đúng mật khẩu | 403 `ACCOUNT_LOCKED` |
| AC-DN-19 | Seed KH9 | A05 sai mật khẩu | 401 `INVALID_CREDENTIALS` |
| AC-DN-20 | Hai lần A05 liên tiếp cho KH1 | So hai token | `jti` khác nhau |

Chuỗi demo mục 10 (04 mục 5.1): AC-DN-12 → AC-DN-15 → AC-DN-17 (thiếu mật khẩu) → AC-DN-18: 200, 401, 400, 403.

### 8.3 Mục 25 — SQL injection

| AC | Given | When | Then |
|---|---|---|---|
| AC-DN-21 | Seed KH1 | A05 `{ identifier: "0900000011", password: "' OR '1'='1" }` | 401 `INVALID_CREDENTIALS` |
| AC-DN-22 | — | A05 `{ identifier: "' OR 1=1 --", password: "x" }` | 400 `INVALID_INPUT` |
| AC-DN-23 | — | A05 `{ identifier: "admin@cab.test' --", password: "x" }`; A04 `{ phone: "09'; DROP--", … }` (≤ 20 ký tự nên qua Gateway, tới service) | 400 `INVALID_INPUT`; 400 `INVALID_PHONE`; sau đó bảng `accounts` vẫn còn, AC-DN-12 vẫn 200 |
| AC-DN-24 | Sau AC-DN-21…23 | Xem `docker compose logs auth-service auth-db` | Không có lỗi cú pháp SQL; không lần nào 200 hay 5xx |
| AC-DN-25 | Rà mã nguồn `auth-service` (test-agent đọc code) | Tìm mọi câu SQL | Không có ghép chuỗi giá trị vào SQL; mọi giá trị dùng `$n` |

### 8.4 Mục 27 — JWT bị sửa, đăng xuất (FR42)

Dùng token riêng `token_m27` (đăng nhập KH2), không dùng token của mục khác.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DN-26 | `token_m27` hợp lệ | A06 với token đã **đổi một ký tự** ở phần payload (ví dụ đổi `role` sang `admin` rồi mã base64 lại) | 401 `TOKEN_INVALID` |
| AC-DN-27 | — | A06 với token đổi một ký tự ở phần chữ ký | 401 `TOKEN_INVALID` |
| AC-DN-28 | — | A06 không header `Authorization`; với `Authorization: Bearer ` (rỗng) | 401 `TOKEN_MISSING` cả hai |
| AC-DN-29 | — | A06 với `Authorization: Basic abc` | 401 `TOKEN_INVALID` |
| AC-DN-30 | Unit test Gateway | Token `alg: none`; token HS256 ký bằng chính khóa công khai làm bí mật; token RS256 ký bằng khóa RSA **khác**; token đúng chữ ký nhưng `iss` khác; `role: "superadmin"` | 401 `TOKEN_INVALID` tất cả |
| AC-DN-31 | `JWT_TTL_SECONDS=2` (hoặc unit test với đồng hồ giả) | Đăng nhập, chờ hết hạn, A06 | 401 `TOKEN_EXPIRED` |
| AC-DN-32 | `token_m27` hợp lệ | A06 | 200 `{ "status": "LOGGED_OUT" }`; Redis có `revoked:<jti>` với TTL ≤ `JWT_TTL_SECONDS` |
| AC-DN-33 | Sau AC-DN-32 | A06 lần hai với `token_m27` | 401 `TOKEN_REVOKED` |
| AC-DN-34 | Sau AC-DN-32, KH2 có token khác `token_m27b` (đăng nhập trước đó) | A06 với `token_m27b` | 200 — chỉ token đã đăng xuất bị thu hồi |
| AC-DN-35 | `docker compose stop redis` | A06 với token mới | 503 `SERVICE_UNAVAILABLE`; log Gateway có cảnh báo Redis. Route khác có token vẫn đi qua (kiểm ở spec 11) |
| AC-DN-36 | Unit test Gateway | Request có token hợp lệ kèm header client `x-account-id: <id khác>`, `x-role: admin` | Metadata gửi sang service mang `sub` và `role` của **token**, không phải giá trị client gửi |

Chuỗi demo mục 27 theo 04 mục 5.3 dùng A09 (spec 11). Trước khi có spec 11, chứng minh bằng A06 như trên: AC-DN-26 → AC-DN-28 → AC-DN-32 → AC-DN-33.

### 8.5 Dữ liệu lưu đúng (bổ trợ mục 24)

| AC | When | Then |
|---|---|---|
| AC-DN-37 | `docker compose exec auth-db psql -U auth -d auth -c "SELECT encode(phone_enc,'hex'), encode(phone_bidx,'hex'), left(password_hash,7) FROM accounts WHERE account_id='00000000-0000-4000-8000-000000000011'"` | `phone_enc` bắt đầu `01` và không chứa chuỗi số điện thoại; `password_hash` bắt đầu `scrypt$` |
| AC-DN-38 | Đăng ký hai tài khoản rồi so `phone_enc` của hai số khác nhau; so `phone_enc` mã hóa lại cùng một số (unit test) | Cùng giá trị cho ra bản mã khác nhau (IV ngẫu nhiên), nhưng `phone_bidx` giống nhau |
| AC-DN-39 | Unit test: sửa một byte của `phone_enc` rồi giải mã | Báo lỗi xác thực GCM, không trả dữ liệu sai |

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn trong spec này

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| DN1 | Field đăng nhập tên `identifier` (số **hoặc** email) | UC02 "số điện thoại/email"; một field để Postman đơn giản | Request A05 |
| DN2 | Thêm mã lỗi `INVALID_EMAIL`, `INVALID_PASSWORD`, `EMAIL_ALREADY_EXISTS` (04 mục 1.1 chưa có) | UC01: "số điện thoại **hoặc email** đã có → từ chối"; lỗi cụ thể giúp test rõ | Mục 4.2, 5 |
| DN3 | Mật khẩu 8–128 ký tự, không bắt buộc ký tự đặc biệt | SRS không quy định; độ dài là yếu tố chính | Mục 4.2 |
| DN4 | Field lạ trong body → 400 | Chặn gán thừa (`role`, `account_id`) | Quy tắc chung mục 4.1 |
| DN5 | Không tồn tại / sai mật khẩu cùng một mã 401; `ACCOUNT_LOCKED` chỉ khi mật khẩu đúng | Không lộ số đã đăng ký, không lộ tài khoản bị khóa | Mục 4.3 |
| DN6 | RS256, khóa PEM base64 trong biến môi trường | Q19 đề xuất (a) | Spec 00 biến JWT |
| DN7 | AAD của AES-GCM là `<bảng>.<cột>` | Bản mã không chép sang cột khác được; không cần biết ID trước khi ghi | Module mã hóa, seed |

### 9.2 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| DN-Q1 | Q19 vẫn mở: JWT bất đối xứng hay khóa chung? | (a) RS256; (b) HS256 | (a) — spec đã viết theo (a) | SV |
| DN-Q2 | Đăng xuất khi Redis dừng trả gì? `CLAUDE.md` chỉ chốt "cho request đi qua" | (a) 503: đăng xuất chưa có hiệu lực, client biết để thử lại; (b) 200 dù không ghi được | (a) — trả 200 là báo sai sự thật | SV |
| DN-Q3 | Tài khoản bị khóa **sau** khi đã có token thì token cũ còn dùng đến hết hạn | (a) Chấp nhận (không có API khóa tài khoản); (b) Gateway hỏi Auth mỗi request | (a) | SV |
| DN-Q4 | Postman cần `SEED_PASSWORD`, giá trị này sinh ngẫu nhiên trong `.env` | (a) Người chạy chép vào biến môi trường Postman (không commit); (b) đặt mật khẩu seed cố định công khai trong `.env.example` | (a) | SV |
| DN-Q5 | Đăng nhập bằng email cho tài xế / admin: tài khoản seed TX không có email | Giữ | Giữ | — |
