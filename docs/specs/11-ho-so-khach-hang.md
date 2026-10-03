# Spec 11 — Hồ sơ khách hàng: tạo, xem, sửa, xem theo mã

> Vòng 2, viết 2026-10-03; **sửa 2026-10-03 theo luật thi**: mã số nguyên (`/customers/1`), khách xem mã khác mình → 403 ngay (ADR-015), mã hóa không AAD và không byte phiên bản (03 mục 11.4), seed KH1 / KH2 / KH3 / KH9 theo 03 mục 14, response ngắn, rút gọn tiêu chí chấp nhận.
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
| Luồng chính | 1. Khách xem hồ sơ: A38, hoặc A09 với mã của mình. 2. Chưa có → 404. 3. Gửi A37 (họ tên bắt buộc, ngày sinh tùy chọn) → `customer-service` lấy `customer_id` = `x-account-id`, kiểm tra, mã hóa, lưu → 201. 4. Xem lại → 200. 5. Sửa bằng A10 → 200 |
| Luồng admin | A09 với mã bất kỳ → 200 nếu có hồ sơ, 404 nếu không. Admin không tạo, không sửa (BRULE18) |
| Ngoại lệ | Thiếu họ tên, sai ngày sinh → 400. Văn bản chứa `<` / `>` → 400 `TEXT_CONTAINS_HTML`, không lưu. Tạo khi đã có → 409. Sửa / xem khi chưa có → 404. Khách gọi A09 với mã khác mình → 403. Tài xế gọi bất kỳ API nào ở đây → 403 |
| Hậu điều kiện | Mỗi tài khoản `customer` có **nhiều nhất một** hồ sơ (C1); chỉ họ tên, ngày sinh — **không có số điện thoại** (Q58); hai trường lưu dạng mã hóa |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `customer-service` | **Sở hữu** hồ sơ; kiểm tra chủ dữ liệu; mã hóa / giải mã | `customer-db` → database `customer`, bảng `customer_profiles` |
| `gateway` | Kiểm tra token, role, hình thức; chặn `<` `>` lớp 1 | — |

`auth-service` **không** tham gia: Customer tin `x-account-id` do Gateway lấy từ token (ADR-013).

## 4. API REST tại Gateway

Tất cả cần token; xác thực theo spec 09-10 mục 4.1. Route `/customers/me` được so khớp **trước** `/customers/{customer_id}`.

### 4.1 Kiểm tra field (A37, A10)

| Field | Gateway (hình thức) | `customer-service` (kiểm tra lại) | Lỗi |
|---|---|---|---|
| `full_name` | Chuỗi; không chứa `<`, `>` | Cắt khoảng trắng hai đầu; 1–100 ký tự (đếm ký tự, không đếm byte); không chứa `<`, `>` | Sai kiểu, rỗng, quá dài → 400 `INVALID_INPUT`; có `<` / `>` → 400 `TEXT_CONTAINS_HTML` |
| `date_of_birth` | Chuỗi, hoặc `null` (chỉ A10) | Mẫu `YYYY-MM-DD`; ngày có thật; từ `1900-01-01` đến hôm nay (giờ Việt Nam) | 400 `INVALID_INPUT` |

Kiểm tra `<` / `>` ở **cả hai lớp** (04 mục 1.6): Gateway chặn sớm; service là chủ dữ liệu nên vẫn chặn.

### 4.2 A37 `POST /api/v1/customers/me` — tạo hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `CreateCustomer` |
| Request | `{ "full_name": "Pham Minh Duc", "date_of_birth": "2001-03-10" }` — `date_of_birth` có thể bỏ. Không nhận `customer_id` (field lạ → 400) |
| Response 201 | `{ "customer_id": 3, "full_name": "Pham Minh Duc", "date_of_birth": "2001-03-10" }`; không có ngày sinh → `"date_of_birth": null` |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| Không token / token sai / hết hạn / đã thu hồi | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body không phải JSON | 400 | `INVALID_JSON` |
| Thiếu `full_name`, sai kiểu, field lạ, ngày sinh sai | 400 | `INVALID_INPUT` |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` |
| Đã có hồ sơ | 409 | `CUSTOMER_ALREADY_EXISTS` |
| `customer-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

### 4.3 A38 `GET /api/v1/customers/me` — xem hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `GetCustomer` với `customer_id = sub` (Gateway chỉ điền tham số — 04 mục 2.2) |
| Response 200 | Như A37 |

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
| Response 200 | Như A37 |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A37 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã không phải số nguyên dương (`abc`, `1 OR 1=1`) | 400 | `INVALID_ID` | Gateway |
| Khách gọi mã **khác** mã của mình | 403 | `NOT_OWNER` | Service |
| Không có hồ sơ với mã này (khách xem mã của mình, hoặc admin) | 404 | `CUSTOMER_NOT_FOUND` | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

Thứ tự ở service [BA HS1]: role `customer` và mã ≠ `x-account-id` → **403 ngay, không đọc database**; sau đó mới tìm hồ sơ → 404. Lý do: mã là số nhỏ, dễ đoán (đổi `/customers/1` thành `/customers/2`); nếu tìm trước rồi mới so chủ thì 404 / 403 lộ ra "mã này đã có hồ sơ hay chưa". Kiểm tra được ngay vì `customer_id` = `account_id`.

### 4.5 A10 `PUT /api/v1/customers/me` — sửa hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `UpdateCustomer` |
| Request | `full_name` và / hoặc `date_of_birth`, **ít nhất một**. Field vắng = giữ nguyên; `"date_of_birth": null` = xóa ngày sinh [BA]; `"full_name": null` → 400 |
| Response 200 | Hồ sơ sau khi sửa, như A37 |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại | 401 | như A37 |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body `{}`, sai kiểu, field lạ, `full_name: null`, ngày sinh sai | 400 | `INVALID_INPUT` |
| Body không phải JSON | 400 | `INVALID_JSON` |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` (hồ sơ không đổi) |
| Chưa có hồ sơ | 404 | `CUSTOMER_NOT_FOUND` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

"Trùng" không áp dụng cho A10, A38, A09 (không tạo đối tượng mới).

Mọi response có `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` (spec 00) — lớp 2 chống XSS.

## 5. Hợp đồng gRPC — `proto/customer.proto`

`package cab.customer.v1; service CustomerService`.

| Message | Field |
|---|---|
| `Customer` | `int64 customer_id = 1; string full_name = 2; optional string date_of_birth = 3;` |
| `CreateCustomerRequest` | `string full_name = 1; optional string date_of_birth = 2;` |
| `GetCustomerRequest` | `int64 customer_id = 1;` |
| `UpdateCustomerRequest` | `optional string full_name = 1; optional string date_of_birth = 2; bool clear_date_of_birth = 3;` — Gateway đặt `clear_date_of_birth = true` khi JSON có `"date_of_birth": null` |

| rpc | Vào → ra | Đọc metadata | Lỗi (status → `details`) |
|---|---|---|---|
| `CreateCustomer` | `CreateCustomerRequest` → `Customer` | `x-account-id` (làm `customer_id`), `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu metadata — chỉ khi gọi không qua Gateway); `PERMISSION_DENIED` → `FORBIDDEN` (`x-role` ≠ `customer`); `INVALID_ARGUMENT` → `INVALID_INPUT` / `TEXT_CONTAINS_HTML`; `ALREADY_EXISTS` → `CUSTOMER_ALREADY_EXISTS`; `INTERNAL` |
| `GetCustomer` | `GetCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN` (`driver`); `PERMISSION_DENIED` → `NOT_OWNER` (`customer`, mã ≠ `x-account-id`); `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `INTERNAL` |
| `UpdateCustomer` | `UpdateCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` / `TEXT_CONTAINS_HTML`; `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `INTERNAL` |

Cài đặt trong `customer-service`:

| Việc | Cách làm | Truy vết |
|---|---|---|
| Tạo | `INSERT … ON CONFLICT (customer_id) DO NOTHING RETURNING customer_id`; không có dòng trả về → `CUSTOMER_ALREADY_EXISTS` | C1, BRULE18 |
| Sửa | Một giao dịch: `SELECT … FOR UPDATE` → không có → 404; giải mã giá trị cũ, áp thay đổi, mã hóa lại, `UPDATE … SET updated_at = now()` | C5 |
| Xem | `SELECT` theo PK → giải mã → trả | C2 |
| Mã hóa [ĐC 03 mục 11.4] | AES-256-GCM, khóa `CUSTOMER_DATA_KEY` (32 byte base64), IV 12 byte ngẫu nhiên **mỗi giá trị**; lưu `IV ‖ bản mã ‖ tag 16 byte`. Ngày sinh mã hóa dạng chuỗi `YYYY-MM-DD` | C3; mục 24 |
| Giải mã lỗi | `INTERNAL`, log `error` kèm `customer_id` (không kèm dữ liệu) → Gateway 503 | Không trả dữ liệu hỏng |
| Log | `customer_created` / `customer_updated` kèm `customer_id`. **Không** ghi họ tên, ngày sinh | NFR08, NFR10 |
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

### 7.2 Seed `customer-service` (03 mục 14) [ĐC]

Chỉ cần mã 1, 2, 9; **không** gọi `auth-service`. Mã hóa bằng cùng module với A37. `ON CONFLICT DO NOTHING`.

| Mã | `customer_id` | Họ tên | Ngày sinh | Dùng cho |
|---|---|---|---|---|
| KH1 | 1 | Nguyễn Văn An | 2000-01-01 | 11 (xem → 200), 24, 26 |
| KH2 | 2 | Trần Thị Bình | 2000-02-02 | 11 (KH1 xem mã 2 → 403) |
| KH3 | — | **Chưa có hồ sơ** | — | 11 phụ (xem → 404, tạo → 201) |
| KH9 | 9 | Lê Văn Chín | — (NULL) | Tài khoản khóa; một hồ sơ không ngày sinh |

Đặt lại (KH3 về "chưa có hồ sơ"): `docker compose down -v` rồi `docker compose up -d --build` (spec 00).

## 8. Tiêu chí chấp nhận

Tiền điều kiện: spec 00, 09-10 đạt; seed đã chạy. Token lấy bằng A05 (`0900000001` / `12345678` …) rồi copy.

| AC | Mục | Given | When | Then |
|---|---|---|---|---|
| AC-HS-01 | 11 | Token KH1 | A09 `/api/v1/customers/1` | 200 `{ customer_id: 1, full_name: "Nguyễn Văn An", date_of_birth: "2000-01-01" }` |
| AC-HS-02 | 11 (403) | Token KH1 | A09 `/customers/2` | 403 `NOT_OWNER` (C2, AC29) |
| AC-HS-03 | 11 (404) | Token KH3 (chưa có hồ sơ) | A09 `/customers/3`; A38; A10 `{ "full_name": "X" }` | 404 `CUSTOMER_NOT_FOUND` cả ba (C5, AC28) |
| AC-HS-04 | 11 | Sau AC-HS-03 | A37 `{ "full_name": "Pham Minh Duc" }` → A09 `/customers/3` | 201 `customer_id = 3`, `date_of_birth = null`; 200 cùng nội dung |
| AC-HS-05 | 11 (409) | Sau AC-HS-04 | A37 lần hai | 409 `CUSTOMER_ALREADY_EXISTS` (C1, BRULE18) |
| AC-HS-06 | 11 | Token AD1 | A09 `/customers/1`; A09 `/customers/3000` | 200 hồ sơ KH1; 404 `CUSTOMER_NOT_FOUND` (UC19) |
| AC-HS-07 | 11, 28 (403) | Token TX1; token AD1 | TX1: A09 `/customers/1`; AD1: A37 | 403 `FORBIDDEN` cả hai |
| AC-HS-08 | 11 (401) | — | A09 `/customers/1` không token | 401 `TOKEN_MISSING` |
| AC-HS-09 | 11 (400) | Token KH1 | A09 `/customers/abc` | 400 `INVALID_ID` |
| AC-HS-10 | 11 (400) | Token KH3 | A37 thiếu `full_name`; A37 `date_of_birth: "15/01/2000"`; A37 có thêm `customer_id` | 400 `INVALID_INPUT` tất cả |
| AC-HS-11 | 11 | Token KH1 | A10 `{ "date_of_birth": "1999-12-31" }` | 200; họ tên giữ nguyên, ngày sinh mới |
| AC-HS-12 | 11 (503) | `docker compose stop customer-service` | A38 bằng token KH1 | 503 `SERVICE_UNAVAILABLE`; A05 vẫn 200 (NFR05) |
| AC-HS-13 | 24 | Seed KH1 | A09 `/customers/1` (token KH1) | 200, họ tên rõ cho đúng chủ |
| AC-HS-14 | 24 | Seed KH1 | `docker exec customer-db psql -U cab -d customer -c "select * from customer_profiles"` | `full_name_enc`, `date_of_birth_enc` hiện dạng `\x…`; không thấy "Nguyễn Văn An", "2000-01-01" |
| AC-HS-15 | 24 | Repo | `git ls-files .env` | Rỗng — khóa thật nằm trong `.env`, không trên Git (spec 00) |
| AC-HS-16 | 26 | Token KH1 | A10 `{ "full_name": "<script>alert(1)</script>" }` → A38 | 400 `TEXT_CONTAINS_HTML`; 200, `full_name` vẫn "Nguyễn Văn An", header có `nosniff` và CSP |
| AC-HS-17 | 25 | Token KH1 | A09 `/customers/1 OR 1=1` | 400 `INVALID_ID`; không 200, không 5xx |

Chuỗi gõ tay khi thi (≤ 3 request):

| Mục | Request | Kết quả |
|---|---|---|
| 11 | A05 KH1 → A09 `/customers/1` → A09 `/customers/2` | 200 token; 200 hồ sơ; 403 `NOT_OWNER` |
| 11 phụ (tạo hồ sơ) | A05 KH3 → A37 `{ "full_name": "Pham Minh Duc" }` → A09 `/customers/3` | 200; 201; 200 |
| 24 | A09 `/customers/1` (token KH1) + lệnh `psql` ở `customer-db` và `auth-db` (spec 00 mục 3.7) | API trả rõ; database chỉ có `\x…`; `password_hash` bắt đầu `scrypt$` |
| 26 | A10 họ tên `<script>…` → A38 | 400; hồ sơ không đổi |

Kết quả mong đợi theo phiếu chấm mục 11: có token xem được khách hàng theo mã số; khách khác bị 403; không token 401.

### 8.1 Có thể làm sau (vượt phiếu chấm)

| Kiểm tra | Vì sao để sau |
|---|---|
| Hai A37 đồng thời cho cùng tài khoản → một 201, một 409 | PK đã bảo đảm |
| Họ tên 100 ký tự tiếng Việt có dấu không bị 400 (đếm ký tự, không đếm byte) | Chi tiết cài đặt |
| A10 `{ "date_of_birth": null }` xóa ngày sinh; `{}` → 400 | Không chấm |
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
| HS1 | A09: khách gọi mã khác mình → 403 trước khi đọc database | Mã số dễ đoán; không lộ "mã nào đã có hồ sơ" | Mục 4.4; 04 mục 1 ghi thứ tự chung "404 → 403" |
| HS2 | A10 cập nhật từng phần; `date_of_birth: null` xóa ngày sinh | Ngày sinh tùy chọn nên phải có cách bỏ | Mục 4.5, `UpdateCustomer` |
| HS3 | Response chỉ `customer_id`, `full_name`, `date_of_birth` (bỏ `created_at`, `updated_at`) | 04 mục 2.2 ghi ba field; response ngắn dễ đọc khi chấm | Mục 4.2, `Customer` |
| HS4 | Mã `IDENTITY_MISSING` khi thiếu metadata | Service không được mặc định một danh tính | Mục 5 |
| HS5 | Ngày sinh từ 1900-01-01 đến hôm nay theo giờ Việt Nam | Chặn năm nhập nhầm | Mục 4.1 |

### 9.2 Chỗ thiết kế chưa khớp (ghi lại, không tự sửa design)

| # | Chỗ | Ghi chú |
|---|---|---|
| HS-M1 | 04 mục 1 dòng "ID: UUID" và mục 4 "ID là UUID không đoán được nên 403 không lộ gì" | Đã đổi sang số nguyên (ADR-015); spec theo `CLAUDE.md` và dùng HS1 |
| HS-M2 | 04 mục 5.2 chuỗi mục 11 có 4 request dùng tài khoản vừa đăng ký | Spec rút còn 3 request dùng seed KH1 (luật thi: ≤ 3 request) |
| HS-M3 | 04 mục 5.3 mục 24 ghi `accounts.phone_enc` | Đã bỏ; mục 24 phía auth chỉ chứng minh `password_hash` |

### 9.3 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| HS-Q1 | Mục 24 ghi "POSTMAN" nhưng dữ liệu at rest chỉ thấy trong database (Q52) | (a) Postman + lệnh `psql`; (b) API admin trả bản mã | (a) | GV |
| HS-Q2 | Chống XSS bằng từ chối `<`, `>` (Q51) | (a) Từ chối; (b) lưu nguyên, escape khi trả | (a) | SV / GV |
| HS-Q3 | Tên field có nên rút ngắn (`name`, `dob`) để gõ tay nhanh hơn? 04 đang dùng `full_name`, `date_of_birth` | (a) Giữ theo 04; (b) rút ngắn, sửa 04 | (a) — tên đầy đủ dễ nhớ nghĩa; chỉ một request gõ họ tên | SV |
| HS-Q4 | A10 dùng `PUT` nhưng cập nhật từng phần | (a) Giữ như 04; (b) `PATCH` | (a) | SV |
| HS-Q5 | Seed họ tên có dấu ("Nguyễn Văn An"); ví dụ tạo hồ sơ dùng không dấu ("Pham Minh Duc") để gõ nhanh | Giữ | Giữ — API nhận cả hai | — |
