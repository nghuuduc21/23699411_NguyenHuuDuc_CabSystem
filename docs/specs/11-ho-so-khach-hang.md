# Spec 11 — Hồ sơ khách hàng: tạo, xem, sửa, xem theo mã

> Vòng 2, viết 2026-10-03; **sửa 2026-10-03 theo luật thi**: mã số nguyên (`/api/v1/customers/1`), khách xem mã khác mình → 403 ngay (ADR-015), mã hóa không AAD và không byte phiên bản (03 mục 11.4), seed KH1 / KH2 / KH3 / KH9 theo 03 mục 14, response ngắn, rút gọn tiêu chí chấp nhận. **Đồng bộ với 04 lần 3 (2026-10-03):** field API là **`name`**, **`dob`** (cột database giữ `full_name_enc`, `date_of_birth_enc`); Gateway đọc body là JSON bất kể `Content-Type`; chuỗi mục 11 phụ theo 04 mục 5.2; đóng HS-Q3, HS-M1–M3. **Đồng bộ với 04 lần 4 (ADR-018):** mọi đường dẫn dưới `/api/v1/`; A37 = `POST /api/v1/customers` (không còn `POST …/me`); A10 = `PATCH /api/v1/customers/me` (đóng HS-Q4); chuỗi mục 11, 24, 25, 26 dùng lại tab GET (04 mục 5).
> **Sửa 2026-10-05 (sinh viên chốt) — ADR-019:** hồ sơ có thêm **`email`**: tùy chọn, kiểm định dạng, tối đa 254 ký tự, lưu chữ thường, **không UNIQUE**, **không mã hóa**. Nhận ở A37, A10; trả ở A09, A38. Migration mới `002_them-email.sql`; seed KH1 `kh1@cab.vn`, KH2 `kh2@cab.vn`. **Không thêm API `/me` mới**: khách xem hồ sơ của mình bằng A09 với mã = `account_id` (từ response đăng nhập); giữ A38, A10 như cũ. AC mới: AC-HS-19 … AC-HS-24; AC đổi: AC-HS-01, AC-HS-04.
> Mục chấm **11**, **24** (phần hồ sơ), **26**; bổ trợ **25**, **27**, **28**. FR27.
> Đầu vào: `CLAUDE.md` (dòng "Đăng ký và hồ sơ khách hàng", "Hồ sơ khách hàng", "Khóa chính", "Mã hóa"); `srs.md` (FR27, BRULE12, BRULE18, UC03, UC19, AC28, AC29, RTM28); `docs/design/01` C1–C6; `docs/design/03` mục 4.1, 11.4, 13, 14; `docs/design/04` A09, A10, A37, A38, mục 1.6, 3, 4; ADR-012, ADR-013, ADR-015.
> Phụ thuộc: **spec 00** và **spec 09-10** (token, cơ chế xác thực ở Gateway, seed tài khoản).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 11 Xem khách hàng theo mã (có token) | BG03 | BR05 | FR27 | BRULE18, BRULE12; C1, C2, C4, C5, C6 | UC03, UC19 | AC28, AC29 / RTM28 | NFR06, NFR07 |
| 24 Mã hóa at rest + quản lý khóa (phần hồ sơ) | BG05 | BR15 | FR27 | C3 | UC03 | — | NFR08, NFR16 |
| 26 XSS | BG05 | BR15 | FR27 | — | UC03 | AC28 | NFR08 |
| 25, 27, 28 (bổ trợ qua A09) | BG05 | BR15, BR13 | FR32, FR42 | BRULE12 | UC02, UC33 | — | NFR06, NFR07 |

## 2. Luồng nghiệp vụ (UC03, UC19)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (tạo, xem, sửa hồ sơ **của mình**); admin (chỉ xem — UC19) |
| Tiền điều kiện | Đã đăng nhập |
| Luồng chính | 1. Khách xem hồ sơ: A09 với mã của mình (= `account_id` trong response đăng nhập), hoặc A38. 2. Chưa có → 404. 3. Gửi A37 (họ tên bắt buộc; ngày sinh, email tùy chọn) → `customer-service` lấy `customer_id` = `x-account-id`, kiểm tra, mã hóa, lưu → 201. 4. Xem lại → 200. 5. Sửa bằng A10 → 200 |
| Luồng admin | A09 với mã bất kỳ → 200 nếu có hồ sơ, 404 nếu không. Admin không tạo, không sửa (BRULE18) |
| Ngoại lệ | Thiếu họ tên, sai ngày sinh → 400 `INVALID_INPUT`. Email sai định dạng / quá 254 ký tự → 400 `INVALID_EMAIL`. Văn bản chứa `<` / `>` → 400 `TEXT_CONTAINS_HTML`, không lưu. Tạo khi đã có → 409. Sửa / xem khi chưa có → 404. Khách gọi A09 với mã khác mình → 403. Tài xế gọi bất kỳ API nào ở đây → 403 |
| Hậu điều kiện | Mỗi tài khoản `customer` có **nhiều nhất một** hồ sơ (C1); họ tên, ngày sinh, email — **không có số điện thoại** (Q58); họ tên, ngày sinh lưu dạng mã hóa; email lưu rõ (ADR-019) |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `customer-service` | **Sở hữu** hồ sơ; kiểm tra chủ dữ liệu; mã hóa / giải mã | `customer-db` → database `customer`, bảng `customer_profiles` |
| `gateway` | Kiểm tra token, role, hình thức; chặn `<` `>` lớp 1 | — |

`auth-service` **không** tham gia: Customer tin `x-account-id` do Gateway lấy từ token (ADR-013).

## 4. API REST tại Gateway

Tất cả cần token; xác thực theo spec 09-10 mục 4.1. Route `/api/v1/customers/me` được so khớp **trước** `/api/v1/customers/{customer_id}`.

### 4.1 Kiểm tra field (A37, A10)

| Field | Gateway (hình thức) | `customer-service` (kiểm tra lại) | Lỗi |
|---|---|---|---|
| `name` (họ tên) | Chuỗi; không chứa `<`, `>` | Cắt khoảng trắng hai đầu; 1–100 ký tự (đếm ký tự, không đếm byte); không chứa `<`, `>` | Sai kiểu, rỗng, quá dài → 400 `INVALID_INPUT`; có `<` / `>` → 400 `TEXT_CONTAINS_HTML` |
| `dob` (ngày sinh) | Chuỗi, hoặc `null` (chỉ A10) | Mẫu `YYYY-MM-DD`; ngày có thật; từ `1900-01-01` đến hôm nay (giờ Việt Nam) | 400 `INVALID_INPUT` |
| `email` (thêm 2026-10-05) | Chuỗi, hoặc `null` (chỉ A10 — xóa email). Tùy chọn ở cả A37 và A10 | Cắt khoảng trắng hai đầu, đổi **chữ thường**; 1–254 ký tự; khớp `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$` (biểu thức này đã loại `<`, `>`). **Không** kiểm tra trùng | Sai kiểu (số, object, `null` ở A37) → 400 `INVALID_INPUT`; chuỗi rỗng, sai định dạng, quá 254 ký tự → 400 `INVALID_EMAIL` |

Kiểm tra `<` / `>` ở **cả hai lớp** (04 mục 1.6): Gateway chặn sớm; service là chủ dữ liệu nên vẫn chặn.

Tên field ngắn ở lớp API (04 mục 1.8, luật thi gõ tay); tên đầy đủ chỉ còn ở cột database (`full_name_enc`, `date_of_birth_enc` — mục 7.1). Gateway đọc body là JSON bất kể `Content-Type` (spec 09-10 mục 4.1 bước 7).

### 4.2 A37 `POST /api/v1/customers` — tạo hồ sơ của tôi

| | |
|---|---|
| Vì sao đường dẫn này | Tạo = `POST` vào tập `customers` (04 mục 1.9). Không có mã trong đường dẫn hay body: `customer_id` = `account_id` trong token |
| Token / role | Có / `customer` |
| rpc | `CreateCustomer` |
| Request | `{ "name": "Pham Duc" }` — thêm `"dob": "2001-03-10"`, `"email": "duc@cab.vn"` nếu muốn. Không nhận `customer_id` (field lạ → 400) |
| Response 201 | `{ "customer_id": 1000, "name": "Pham Duc", "dob": null, "email": null }` (`customer_id` = `account_id` trong token; có ngày sinh / email thì trả giá trị đã lưu, email ở dạng chữ thường) |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| Không token / token sai / hết hạn / đã thu hồi | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body không phân tích được thành JSON | 400 | `INVALID_JSON` |
| Thiếu `name`, sai kiểu, field lạ, `dob` sai | 400 | `INVALID_INPUT` |
| `email` sai định dạng / rỗng / quá 254 ký tự | 400 | `INVALID_EMAIL` |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` |
| Đã có hồ sơ | 409 | `CUSTOMER_ALREADY_EXISTS` |
| Email trùng hồ sơ khác | — | **Không lỗi**: email không UNIQUE (ADR-019) |
| `customer-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

### 4.3 A38 `GET /api/v1/customers/me` — xem hồ sơ của tôi

| | |
|---|---|
| Vì sao đường dẫn này | `me` = mã của người trong token (04 mục 1.9 R6) |
| Token / role | Có / `customer` |
| rpc | `GetCustomer` với `customer_id = sub` (Gateway chỉ điền tham số — 04 mục 2.2) |
| Response 200 | `{ "customer_id": 1, "name": "Nguyễn Văn An", "dob": "2000-01-01", "email": "kh1@cab.vn" }` (không có email → `"email": null`) |
| Ghi chú | Giữ nguyên route (sinh viên chốt 2026-10-05: không thêm route `/me` mới, không xóa route `/me` cũ). Cách được khuyến nghị khi thi vẫn là A09 với mã của mình |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại | 401 | như A37 |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Chưa có hồ sơ | 404 | `CUSTOMER_NOT_FOUND` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

### 4.4 A09 `GET /api/v1/customers/{customer_id}` — xem khách hàng theo mã (mục 11)

| | |
|---|---|
| Token / role | Có / `customer` (chỉ mã của mình), `admin` (mọi mã) |
| rpc | `GetCustomer` |
| Kiểm tra ở Gateway | `customer_id` khớp `^[1-9][0-9]{0,15}$`. Sai → 400 `INVALID_ID` |
| Response 200 | Như A38 (có `email`) |
| Xem hồ sơ của mình | Mã = `account_id` trả về ở A05 (spec 09-10). Đây là cách duy nhất cần nhớ cho mục 11; không có API `/me` mới |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A37 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã không phải số nguyên dương (`abc`, `1 OR 1=1`) | 400 | `INVALID_ID` | Gateway |
| Khách gọi mã **khác** mã của mình | 403 | `NOT_OWNER` | Service |
| Không có hồ sơ với mã này (khách xem mã của mình, hoặc admin) | 404 | `CUSTOMER_NOT_FOUND` | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

Thứ tự ở service [BA HS1]: role `customer` và mã ≠ `x-account-id` → **403 ngay, không đọc database**; sau đó mới tìm hồ sơ → 404. Lý do: mã là số nhỏ, dễ đoán (đổi `/api/v1/customers/1` thành `/api/v1/customers/2`); nếu tìm trước rồi mới so chủ thì 404 / 403 lộ ra "mã này đã có hồ sơ hay chưa". Kiểm tra được ngay vì `customer_id` = `account_id`.

### 4.5 A10 `PATCH /api/v1/customers/me` — sửa hồ sơ của tôi

| | |
|---|---|
| Vì sao đường dẫn này | `PATCH` vì sửa **một phần** (field vắng giữ nguyên) — đổi từ `PUT` ở 04 lần 4, đóng HS-Q4 |
| Token / role | Có / `customer` |
| rpc | `UpdateCustomer` |
| Request | **Ít nhất một** trong `name`, `dob`, `email`, ví dụ `{ "name": "An Nguyen" }`, `{ "email": "an@cab.vn" }`. Field vắng = giữ nguyên; `"dob": null` = xóa ngày sinh [BA]; `"email": null` = xóa email [BA HS6]; `"name": null` → 400 |
| Response 200 | Hồ sơ sau khi sửa, cùng dạng A38 |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại | 401 | như A37 |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body rỗng / `{}`, sai kiểu, field lạ, `name: null`, `dob` sai | 400 | `INVALID_INPUT` |
| Body không phân tích được thành JSON | 400 | `INVALID_JSON` |
| `email` sai định dạng / rỗng / quá 254 ký tự | 400 | `INVALID_EMAIL` (hồ sơ không đổi) |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` (hồ sơ không đổi) |
| Chưa có hồ sơ | 404 | `CUSTOMER_NOT_FOUND` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

"Trùng" không áp dụng cho A10, A38, A09 (không tạo đối tượng mới).

Mọi response có `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` (spec 00) — lớp 2 chống XSS.

## 5. Hợp đồng gRPC — `proto/customer.proto`

`package cab.customer.v1; service CustomerService`.

| Message | Field |
|---|---|
| `Customer` | `int64 customer_id = 1; string name = 2; optional string dob = 3; optional string email = 4;` (thêm `email` 2026-10-05) |
| `CreateCustomerRequest` | `string name = 1; optional string dob = 2; optional string email = 3;` |
| `GetCustomerRequest` | `int64 customer_id = 1;` |
| `UpdateCustomerRequest` | `optional string name = 1; optional string dob = 2; bool clear_dob = 3; optional string email = 4; bool clear_email = 5;` — Gateway đặt `clear_dob = true` khi JSON có `"dob": null`, `clear_email = true` khi `"email": null` |

Field mới thêm số tiếp theo, không đổi số cũ (client và server cũ vẫn đọc được). Field proto cùng tên với JSON (`name`, `dob`, `email`) để Gateway chuyển thẳng, không đổi tên [BA]; `customer-service` đổi sang cột `full_name_enc`, `date_of_birth_enc` khi ghi database.

| rpc | Vào → ra | Đọc metadata | Lỗi (status → `details`) |
|---|---|---|---|
| `CreateCustomer` | `CreateCustomerRequest` → `Customer` | `x-account-id` (làm `customer_id`), `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu metadata — chỉ khi gọi không qua Gateway); `PERMISSION_DENIED` → `FORBIDDEN` (`x-role` ≠ `customer`); `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_EMAIL` / `TEXT_CONTAINS_HTML`; `ALREADY_EXISTS` → `CUSTOMER_ALREADY_EXISTS`; `INTERNAL` |
| `GetCustomer` | `GetCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN` (`driver`); `PERMISSION_DENIED` → `NOT_OWNER` (`customer`, mã ≠ `x-account-id`); `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `INTERNAL` |
| `UpdateCustomer` | `UpdateCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` / `INVALID_EMAIL` / `TEXT_CONTAINS_HTML`; `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `INTERNAL` |

Cài đặt trong `customer-service`:

| Việc | Cách làm | Truy vết |
|---|---|---|
| Tạo | `INSERT … ON CONFLICT (customer_id) DO NOTHING RETURNING customer_id`; không có dòng trả về → `CUSTOMER_ALREADY_EXISTS` | C1, BRULE18 |
| Sửa | Một giao dịch: `SELECT … FOR UPDATE` → không có → 404; giải mã giá trị cũ, áp thay đổi, mã hóa lại, `UPDATE … SET updated_at = now()` | C5 |
| Email (2026-10-05) | Chuẩn hóa (cắt khoảng trắng, chữ thường) rồi kiểm tra; ghi thẳng cột `email` dạng rõ, **không** qua module mã hóa | C7; ADR-019 |
| Xem | `SELECT` theo PK → giải mã → trả | C2 |
| Mã hóa [ĐC 03 mục 11.4] | AES-256-GCM, khóa `CUSTOMER_DATA_KEY` (32 byte base64), IV 12 byte ngẫu nhiên **mỗi giá trị**; lưu `IV ‖ bản mã ‖ tag 16 byte`. Ngày sinh mã hóa dạng chuỗi `YYYY-MM-DD` | C3; mục 24 |
| Giải mã lỗi | `INTERNAL`, log `error` kèm `customer_id` (không kèm dữ liệu) → Gateway 503 | Không trả dữ liệu hỏng |
| Log | `customer_created` / `customer_updated` kèm `customer_id`. **Không** ghi họ tên, ngày sinh, email | NFR08, NFR10 |
| SQL | Chỉ câu lệnh có tham số | Mục 25 |
| Thiếu / sai `CUSTOMER_DATA_KEY` | Không khởi động (spec 00) | 03 mục 11.4 |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `customer-service` `CreateCustomer`, `GetCustomer`, `UpdateCustomer` (G2) | gRPC | Khách / admin chờ kết quả ngay |
| `customer-service` ↔ `auth-service` | **Không có** | `customer_id` lấy từ token (ADR-013) |
| `customer-service` → service khác; event Kafka | **Không có** | Không context nào cần hồ sơ khách; đặt xe không cần hồ sơ (Q56) |

## 7. Dữ liệu

### 7.1 Migration `services/customer-service/migrations/001_tao-customer-profiles.sql`

| Cột | Kiểu | Ràng buộc | Vì sao |
|---|---|---|---|
| `customer_id` | `bigint` | `PRIMARY KEY`, **không identity, không DEFAULT** | Bằng `account_id` trong token; PK chặn hồ sơ thứ hai (C1) |
| `full_name_enc` | `bytea` | `NOT NULL` | Họ tên mã hóa; bắt buộc (C6) |
| `date_of_birth_enc` | `bytea` | NULL | Tùy chọn (C6) |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | |

Không index nào khác. Không cột số điện thoại.

### 7.1a Migration mới `services/customer-service/migrations/002_them-email.sql` (2026-10-05, ADR-019)

| Lệnh | Vì sao |
|---|---|
| `ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS email text NULL CONSTRAINT customer_profiles_email_len CHECK (char_length(email) <= 254);` | Email tùy chọn (NULL); 254 = giới hạn độ dài địa chỉ email (RFC 5321); **không UNIQUE** (không phải định danh đăng nhập, hai khách dùng chung email gia đình vẫn hợp lệ); **không mã hóa** (theo quyết định "không mã hóa email" — chỉ họ tên, ngày sinh mã hóa). Định dạng kiểm ở ứng dụng. **Không sửa `001`** |

Không thêm index: không API nào tìm theo email.

### 7.2 Seed `customer-service` (03 mục 14) [ĐC]

Chỉ cần mã 1, 2, 9; **không** gọi `auth-service`. Mã hóa bằng cùng module với A37. `ON CONFLICT DO NOTHING`. Database đã seed trước ngày 2026-10-05 thì KH1, KH2 chưa có email (seed không ghi đè) → `docker compose down -v` rồi dựng lại.

| Mã | `customer_id` | Họ tên | Ngày sinh | Email (thêm 2026-10-05) | Dùng cho |
|---|---|---|---|---|---|
| KH1 | 1 | Nguyễn Văn An | 2000-01-01 | `kh1@cab.vn` | 11 (xem → 200), 24, 26 |
| KH2 | 2 | Trần Thị Bình | 2000-02-02 | `kh2@cab.vn` | 11 (KH1 xem mã 2 → 403) |
| KH3 | — | **Chưa có hồ sơ** | — | — | 11 phụ (xem → 404, tạo → 201) |
| KH9 | 9 | Lê Văn Chín | — (NULL) | — (NULL) | Tài khoản khóa; một hồ sơ không ngày sinh, không email |

Đặt lại (KH3 về "chưa có hồ sơ"): `docker compose down -v` rồi `docker compose up -d --build` (spec 00).

## 8. Tiêu chí chấp nhận

Tiền điều kiện: spec 00, 09-10 đạt; seed đã chạy. Token lấy bằng A05 (`0900000001` / `12345678` …) rồi copy.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-HS-01 (**đổi 2026-10-05**) | 11 | Token KH1 | A09 `/api/v1/customers/1` | 200 `{ customer_id: 1, name: "Nguyễn Văn An", dob: "2000-01-01", email: "kh1@cab.vn" }` (thêm `email`) |
| AC-HS-02 | 11 (403) | Token KH1 | A09 `/api/v1/customers/2` | 403 `NOT_OWNER` (C2, AC29) |
| AC-HS-03 | 11 (404) | Token KH3 (chưa có hồ sơ) | A09 `/api/v1/customers/3`; A38; A10 `{ "name": "X" }` | 404 `CUSTOMER_NOT_FOUND` cả ba (C5, AC28) |
| AC-HS-04 (**đổi 2026-10-05**) | 11 | Sau AC-HS-03 | A37 `{ "name": "Pham Duc" }` → A09 `/api/v1/customers/3` | 201 `customer_id = 3`, `dob = null`, `email = null`; 200 cùng nội dung |
| AC-HS-05 | 11 (409) | Sau AC-HS-04 | A37 lần hai | 409 `CUSTOMER_ALREADY_EXISTS` (C1, BRULE18) |
| AC-HS-06 | 11 | Token AD1 | A09 `/api/v1/customers/1`; A09 `/api/v1/customers/3000` | 200 hồ sơ KH1; 404 `CUSTOMER_NOT_FOUND` (UC19) |
| AC-HS-07 | 11, 28 (403) | Token TX1; token AD1 | TX1: A09 `/api/v1/customers/1`; AD1: A37 | 403 `FORBIDDEN` cả hai |
| AC-HS-08 | 11 (401) | — | A09 `/api/v1/customers/1` không token | 401 `TOKEN_MISSING` |
| AC-HS-09 | 11 (400) | Token KH1 | A09 `/api/v1/customers/abc` | 400 `INVALID_ID` |
| AC-HS-10 | 11 (400) | Token KH3 | A37 thiếu `name`; A37 `dob: "15/01/2000"`; A37 có thêm `customer_id` | 400 `INVALID_INPUT` tất cả |
| AC-HS-11 | 11 | Token KH1 | A10 `{ "dob": "1999-12-31" }` | 200; họ tên giữ nguyên, ngày sinh mới |
| AC-HS-12 | 11 (503) | `docker compose stop customer-service` | A38 bằng token KH1 | 503 `SERVICE_UNAVAILABLE`; A05 vẫn 200 (NFR05) |
| AC-HS-13 | 24 | Seed KH1 | A09 `/api/v1/customers/1` (token KH1) | 200, họ tên rõ cho đúng chủ |
| AC-HS-14 | 24 | Seed KH1 | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | Cột `full_name_enc`, `date_of_birth_enc` hiện dạng `\x…`; không thấy "Nguyễn Văn An", "2000-01-01" |
| AC-HS-15 | 24 | Repo | `git ls-files .env` | Rỗng — khóa thật nằm trong `.env`, không trên Git (spec 00) |
| AC-HS-16 | 26 | Token KH1 | A10 `PATCH /api/v1/customers/me` `{ "name": "<script>alert(1)</script>" }` → sửa tab sang `GET` (A38), body giữ nguyên | 400 `TEXT_CONTAINS_HTML`; 200, `name` vẫn "Nguyễn Văn An", header có `nosniff` và CSP |
| AC-HS-17 | 25 | Token KH1 | A09 `/api/v1/customers/1 OR 1=1` | 400 `INVALID_ID`; không 200, không 5xx |
| AC-HS-19 (mới 2026-10-05) | 11 | Token tài khoản mới (đăng ký A04 → A05, chưa có hồ sơ) | A37 `{ "name": "Pham Duc", "email": "  Duc@Cab.VN " }` → A09 `/api/v1/customers/<account_id>` | 201 `email = "duc@cab.vn"` (đã cắt khoảng trắng, chữ thường); 200 cùng nội dung |
| AC-HS-20 (mới) | 11 (400) | Token KH3 chưa có hồ sơ | A37 `{ "name": "X", "email": "abc" }`; `"email": ""`; `"email": "<a>@x.vn"`; email 255 ký tự; `"email": 123`; `"email": null` | 400 `INVALID_EMAIL` cho bốn trường hợp đầu; 400 `INVALID_INPUT` cho `123` và `null`; không tạo hồ sơ (A09 mã 3 vẫn 404) |
| AC-HS-21 (mới) | 11 | Token KH2 | A10 `{ "email": "kh1@cab.vn" }` (trùng email của KH1) | 200 `email = "kh1@cab.vn"` — email **không** UNIQUE; họ tên, ngày sinh KH2 giữ nguyên |
| AC-HS-22 (mới) | 11 | Token KH1 | A10 `{ "email": null }` → A38; rồi A10 `{ "email": "kh1@cab.vn" }` | 200 `email = null`; 200 `email = null`; 200 `email = "kh1@cab.vn"`. A10 `{ "email": "sai" }` → 400 `INVALID_EMAIL`, email cũ giữ nguyên |
| AC-HS-23 (mới) | 24 | Seed KH1 | `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | Cột `email` hiện rõ `kh1@cab.vn`, `kh2@cab.vn`; `full_name_enc`, `date_of_birth_enc` vẫn `\x…` — nói được: email không mã hóa theo quyết định đã chốt (ADR-019, 03 mục 11.4) |
| AC-HS-24 (mới) | Migration | Database customer đã chạy `001` (không có cột `email`) | Khởi động `customer-service` bản mới; `… -c "table schema_migrations"` | Có `002_them-email.sql`; hồ sơ cũ có `email = NULL`, A09 trả `"email": null`; khởi động lại không lỗi |
| AC-HS-18 | Đường dẫn | Token KH1 | `PUT /api/v1/customers/me`; `POST /api/v1/customers/me`; `GET /customers/1` (thiếu `/api/v1`) | 404 `ROUTE_NOT_FOUND` cả ba (đường dẫn cũ đã bỏ — ADR-018) |

Chuỗi gõ tay khi thi (khớp 04 mục 5; dùng lại tab GET; `(…)` = tùy chọn):

| Mục | Request | Kết quả |
|---|---|---|
| 11 | `GET /api/v1/customers/1` (token KH1 từ mục 10) → sửa tab `/api/v1/customers/2` | 200 hồ sơ; 403 `NOT_OWNER` |
| 11 phụ (tạo hồ sơ) | (A37 `POST /api/v1/customers` `{"name":"Pham Duc"}` với token của mục 9) | (201 `customer_id` 1000) |
| 24 | Tab GET `/api/v1/customers/1` (token KH1) + lệnh `psql` ở `customer-db` (spec 00 mục 3.7); (lệnh `auth-db`) | API trả rõ; database chỉ có `\x…`; (`password_hash` bắt đầu `scrypt$`) |
| 26 | Tab GET: method `PATCH`, URL `/api/v1/customers/me`, body `{"name":"<script>alert(1)</script>"}` → sửa tab: method `GET` (không cần xóa body — `GET` bỏ qua body) | 400; 200 hồ sơ không đổi, có `nosniff`, CSP |

Kết quả mong đợi theo phiếu chấm mục 11: có token xem được khách hàng theo mã số; khách khác bị 403; không token 401.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Hai A37 đồng thời cho cùng tài khoản → một 201, một 409 | PK đã bảo đảm |
| Họ tên 100 ký tự tiếng Việt có dấu không bị 400 (đếm ký tự, không đếm byte) | Chi tiết cài đặt |
| A10 `{ "dob": null }` xóa ngày sinh; `{}` → 400 | Không chấm |
| Header client `x-account-id` giả bị bỏ qua | Quy tắc ở spec 09-10 mục 4.1 |
| `auth-service` dừng / Redis dừng → hồ sơ vẫn 200 | Hiển nhiên từ thiết kế (mục 6) |
| `printenv` từng service để thấy mỗi service chỉ có khóa của mình | Compose đã ghi biến theo từng service (spec 00 mục 3.5) |
| Unit test mã hóa: cùng họ tên hai lần ra hai bản mã khác; sửa một byte → giải mã lỗi | Tính chất của AES-GCM; không chấm |
| `convert_from(full_name_enc,'UTF8')` trong `psql` không đọc được họ tên | AC-HS-14 đã đủ |
| Lớp service chặn `<b>` khi gọi gRPC thẳng (không qua Gateway); `&`, `'`, `"` được phép | Quy tắc hai lớp đã ghi ở mục 4.1 |
| Mọi biến thể 401 (`TOKEN_INVALID`, `TOKEN_REVOKED`) trên A09 | Đã ở spec 09-10 mục 27 |

## 9. Quyết định BA và câu hỏi còn mở

### 9.1 BA tự chọn

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| HS1 | A09: khách gọi mã khác mình → 403 trước khi đọc database | Mã số dễ đoán; không lộ "mã nào đã có hồ sơ" (04 mục 4 đã ghi ngoại lệ này) | Mục 4.4 |
| HS2 | A10 cập nhật từng phần; `dob: null` xóa ngày sinh | Ngày sinh tùy chọn nên phải có cách bỏ | Mục 4.5, `UpdateCustomer` |
| HS3 (**đổi 2026-10-05**) | Response chỉ `customer_id`, `name`, `dob`, `email` (bỏ `created_at`, `updated_at`); `email` luôn có mặt, `null` khi chưa có | 04 mục 2.2; response ngắn dễ đọc khi chấm; luôn có key để người chấm thấy field tồn tại | Mục 4.2, `Customer` |
| HS4 | Mã `IDENTITY_MISSING` khi thiếu metadata | Service không được mặc định một danh tính | Mục 5 |
| HS5 | Ngày sinh từ 1900-01-01 đến hôm nay theo giờ Việt Nam | Chặn năm nhập nhầm | Mục 4.1 |
| HS6 (2026-10-05) | `email: null` ở A10 xóa email; sai kiểu → `INVALID_INPUT`, sai định dạng → `INVALID_EMAIL` | Email tùy chọn nên phải có cách bỏ, giống `dob`; mã riêng cho định dạng để người dùng biết sửa gì | Mục 4.1, 4.5 |
| HS7 (2026-10-05) | Biểu thức kiểm tra email giữ nguyên như bản ở auth trước đây (`^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$`, sau khi đổi chữ thường) | Đơn giản, giải thích được; không chặn được mọi email sai nhưng đủ cho demo | Mục 4.1 |

### 9.2 Chỗ thiết kế chưa khớp (ghi lại, không tự sửa design)

| # | Chỗ | Ghi chú |
|---|---|---|
| ~~HS-M1~~ | 04 dùng mã UUID | Đã khớp: 04 lần 3 dùng số nguyên (ADR-015) và ghi ngoại lệ A09 |
| ~~HS-M2~~ | 04 mục 5.2 chuỗi mục 11 dài | Đã khớp: 04 chuỗi mục 11 dùng KH1, 2 request |
| ~~HS-M3~~ | 04 mục 24 ghi `accounts.phone_enc` | Đã khớp: 04 chỉ chứng minh `password_hash` |

### 9.3 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| HS-Q1 | Mục 24 ghi "POSTMAN" nhưng dữ liệu at rest chỉ thấy trong database (Q52) | (a) Postman + lệnh `psql`; (b) API admin trả bản mã | (a) | GV |
| HS-Q2 | Chống XSS bằng từ chối `<`, `>` (Q51) | (a) Từ chối; (b) lưu nguyên, escape khi trả | (a) | SV / GV |
| ~~HS-Q3~~ | Đã đóng 2026-10-03: rút ngắn thành `name`, `dob` ở lớp API (04 mục 1.8, `CLAUDE.md`); cột database giữ tên đầy đủ | — | — | — |
| ~~HS-Q4~~ | Đã đóng 2026-10-03: A10 đổi sang `PATCH` (sửa một phần, 04 lần 4) | — | — | — |
| HS-Q6 (2026-10-05) | Gateway có kiểm tra định dạng email ở lớp 1 không, hay chỉ kiểm tra kiểu (chuỗi / `null`) và để service kiểm định dạng? | (a) Gateway chỉ kiểm kiểu và độ dài ≤ 254; service kiểm định dạng; (b) cả hai lớp kiểm định dạng | (a) — định dạng là quy tắc của chủ dữ liệu; Gateway chỉ kiểm hình thức | Dev |
| HS-Q5 | Seed họ tên có dấu ("Nguyễn Văn An"); ví dụ tạo hồ sơ dùng không dấu ("Pham Duc") để gõ nhanh | Giữ | Giữ — API nhận cả hai | — |
