# Spec 11 — Hồ sơ khách hàng: tạo, xem, sửa, xem theo mã

> Vòng 2, viết 2026-10-03. Mục chấm **11**, **24** (phần hồ sơ), **26**; bổ trợ **25**, **27**, **28**. FR27.
> Đầu vào: `CLAUDE.md` (dòng "Đăng ký và hồ sơ khách hàng", "Hồ sơ khách hàng"); `srs.md` (FR27, BRULE12, BRULE18, UC03, UC19, AC28, AC29, RTM28); `docs/design/01` quy tắc C1–C6; `docs/design/03` mục 4.1, 11.4, 14; `docs/design/04` A09, A10, A37, A38, mục 1.6, 3, 4, 5.2, 5.3; ADR-012, ADR-013.
> Phụ thuộc: **spec 00** (khung, bảng đổi lỗi, header bảo vệ) và **spec 09-10** (token, cơ chế xác thực / phân quyền ở Gateway, seed tài khoản).
> Ký hiệu: **[ĐC]** đã chốt; **[BA]** BA chọn trong spec này (gom ở mục 9).

## 1. Truy vết

| Mục chấm | BG | BR | FR | BRULE / quy tắc | UC | AC / RTM | NFR |
|---|---|---|---|---|---|---|---|
| 11 Xem khách hàng theo mã (có token) | BG03 | BR05 | FR27 | BRULE18, BRULE12; C1, C2, C4, C5, C6 | UC03, UC19 | AC28, AC29 / RTM28 | NFR06, NFR07 |
| 24 Mã hóa at rest + quản lý khóa (phần hồ sơ) | BG05 | BR15 | FR27 | C3 | UC03 | — | NFR08, NFR16 |
| 26 XSS | BG05 | BR15 | FR27 | — | UC03 (ngoại lệ "văn bản chứa mã HTML") | AC28 | NFR08 |
| 25, 27, 28 (bổ trợ qua A09) | BG05 | BR15, BR13 | FR32, FR42 | BRULE12 | UC02, UC33 | — | NFR06, NFR07 |

## 2. Luồng nghiệp vụ (UC03, UC19)

| | Nội dung |
|---|---|
| Tác nhân | Khách hàng (tạo, xem, sửa hồ sơ **của mình**); admin (chỉ xem — UC19) |
| Tiền điều kiện | Đã đăng nhập (token hợp lệ) |
| Luồng chính | 1. Khách mở màn hình hồ sơ: A38 (hoặc A09 với mã của mình). 2. Chưa có → 404 `CUSTOMER_NOT_FOUND`. 3. Khách nhập họ tên (bắt buộc), ngày sinh (tùy chọn), gửi A37 → `customer-service` lấy `customer_id` = `x-account-id`, kiểm tra, mã hóa, lưu → 201. 4. Xem lại → 200. 5. Sửa bằng A10 → 200 |
| Luồng admin | Admin gọi A09 với mã bất kỳ → 200 nếu có hồ sơ, 404 nếu không. Admin không tạo, không sửa (BRULE18) |
| Ngoại lệ | Thiếu họ tên, sai định dạng ngày sinh → 400. Văn bản chứa `<` hoặc `>` → 400 `TEXT_CONTAINS_HTML`, không lưu. Tạo khi đã có → 409. Sửa / xem khi chưa có → 404. Khách xem hồ sơ người khác → 403. Tài xế gọi bất kỳ API nào ở đây → 403 |
| Hậu điều kiện | Mỗi tài khoản `customer` có **nhiều nhất một** hồ sơ (C1); hồ sơ chỉ có họ tên, ngày sinh — **không có số điện thoại** (Q58, 03 mục 4.1); họ tên và ngày sinh lưu dạng mã hóa |

## 3. Service tham gia

| Thành phần | Vai trò | Dữ liệu |
|---|---|---|
| `customer-service` | **Sở hữu** hồ sơ; kiểm tra chủ dữ liệu; mã hóa / giải mã | `customer-db.customer_profiles` |
| `gateway` | Kiểm tra token, role, hình thức; chống XSS lớp 1; header bảo vệ | — |

`auth-service` **không** tham gia: Customer tin `x-account-id` do Gateway lấy từ token Auth đã ký (ADR-013). Không service nào khác tham gia.

## 4. API REST tại Gateway

Tất cả cần token; thứ tự kiểm tra và metadata theo spec 09-10 mục 4.1. Route `/customers/me` được so khớp **trước** `/customers/{customer_id}`.

### 4.1 Kiểm tra field (dùng chung cho A37, A10)

| Field | Gateway (hình thức) | `customer-service` (kiểm tra lại + nghiệp vụ) | Lỗi |
|---|---|---|---|
| `full_name` | Chuỗi; không chứa `<` hoặc `>` | Cắt khoảng trắng hai đầu; chuẩn hóa Unicode NFC; 1–100 ký tự (đếm theo ký tự Unicode, không theo byte); không chứa ký tự điều khiển U+0000–U+001F, U+007F; không chứa `<`, `>` | Sai kiểu, rỗng sau khi cắt, quá dài, ký tự điều khiển → 400 `INVALID_INPUT`. Có `<` / `>` → 400 `TEXT_CONTAINS_HTML` |
| `date_of_birth` | Chuỗi hoặc `null` (chỉ A10 cho `null`) | Đúng mẫu `YYYY-MM-DD`; là ngày có thật (không `2001-02-30`); ≥ `1900-01-01`; ≤ ngày hôm nay theo giờ Việt Nam (UTC+7) | 400 `INVALID_INPUT` |

Kiểm tra `<` / `>` ở **cả hai lớp** (04 mục 1.6): Gateway chặn sớm; service là chủ dữ liệu nên vẫn chặn, kể cả khi bị gọi không qua Gateway.

### 4.2 A37 `POST /api/v1/customers/me` — tạo hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `CreateCustomer` |
| Request | `{ "full_name": "Nguyễn Văn An", "date_of_birth": "2000-01-15" }` — `date_of_birth` có thể vắng. **Không** nhận `customer_id` (field lạ → 400) |
| Response 201 | `{ "customer_id": "<= sub của token>", "full_name": "Nguyễn Văn An", "date_of_birth": "2000-01-15", "created_at": "…Z", "updated_at": "…Z" }`; không có ngày sinh thì `"date_of_birth": null` |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| Không token / token sai / hết hạn / đã thu hồi | 401 | `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body không phải JSON | 400 | `INVALID_JSON` |
| Thiếu `full_name`, sai kiểu, field lạ, ngày sinh sai | 400 | `INVALID_INPUT` |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` |
| Đã có hồ sơ (trùng) | 409 | `CUSTOMER_ALREADY_EXISTS` |
| `customer-service` dừng | 503 | `SERVICE_UNAVAILABLE` |

"Không tìm thấy" không áp dụng (tạo mới).

### 4.3 A38 `GET /api/v1/customers/me` — xem hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `GetCustomer` với `customer_id = sub` (Gateway chỉ điền tham số, không phải logic nghiệp vụ — 04 mục 2.2) |
| Response 200 | Như response A37 |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại | 401 | như A37 |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Chưa có hồ sơ | 404 | `CUSTOMER_NOT_FOUND` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

Không có body, không có tham số → "thiếu dữ liệu", "sai kiểu", "trùng" không áp dụng.

### 4.4 A09 `GET /api/v1/customers/{customer_id}` — xem khách hàng theo mã (mục 11)

| | |
|---|---|
| Token / role | Có / `customer` (chỉ hồ sơ của mình), `admin` (mọi hồ sơ) |
| rpc | `GetCustomer` |
| Kiểm tra ở Gateway | `customer_id` khớp `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`, đổi về chữ thường trước khi gửi. Sai → 400 `INVALID_ID` |
| Response 200 | Như response A37 |

| Đường lỗi | HTTP | Mã | Ai trả |
|---|---|---|---|
| 401 các loại | 401 | như A37 | Gateway |
| Role `driver` | 403 | `FORBIDDEN` | Gateway |
| Mã không phải UUID (gồm `1 OR 1=1`, `abc`) | 400 | `INVALID_ID` | Gateway |
| Không có hồ sơ với mã này | 404 | `CUSTOMER_NOT_FOUND` | Service |
| Khách xem hồ sơ **có thật** của người khác | 403 | `NOT_OWNER` | Service |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` | Gateway |

Thứ tự ở service: tìm hồ sơ → không có thì 404 → có nhưng khách không phải chủ thì 403 [ĐC 04 mục 1, mục 4]. Hệ quả cần nói được: khách gọi mã của người chưa có hồ sơ nhận 404 chứ không phải 403 — chấp nhận vì mã là UUID không đoán được (04 mục 4).

### 4.5 A10 `PUT /api/v1/customers/me` — sửa hồ sơ của tôi

| | |
|---|---|
| Token / role | Có / `customer` |
| rpc | `UpdateCustomer` |
| Request | `full_name` và / hoặc `date_of_birth`; **ít nhất một field**. `"date_of_birth": null` = xóa ngày sinh [BA]. `"full_name": null` → 400 |
| Ngữ nghĩa | Field vắng = giữ nguyên (cập nhật từng phần) [BA]. Dùng `PUT` theo 04, dù ngữ nghĩa gần `PATCH` |
| Response 200 | Hồ sơ sau khi sửa, như response A37; `updated_at` mới |

| Đường lỗi | HTTP | Mã |
|---|---|---|
| 401 các loại | 401 | như A37 |
| Role `driver`, `admin` | 403 | `FORBIDDEN` |
| Body `{}`, sai kiểu, field lạ, `full_name: null`, ngày sinh sai | 400 | `INVALID_INPUT` |
| Body không phải JSON | 400 | `INVALID_JSON` |
| Họ tên chứa `<` / `>` | 400 | `TEXT_CONTAINS_HTML` (hồ sơ không đổi) |
| Chưa có hồ sơ | 404 | `CUSTOMER_NOT_FOUND` |
| Service dừng | 503 | `SERVICE_UNAVAILABLE` |

"Trùng" không áp dụng: sửa không tạo đối tượng mới.

Mọi response (kể cả lỗi) có `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` (spec 00) — lớp 2 chống XSS và không để proxy / trình duyệt lưu dữ liệu cá nhân.

## 5. Hợp đồng gRPC — `proto/customer.proto`

`package cab.customer.v1; service CustomerService`. Thời điểm truyền dạng chuỗi ISO 8601 UTC có `Z` [BA] (đơn giản hơn `google.protobuf.Timestamp`, Gateway trả thẳng).

| Message | Field |
|---|---|
| `Customer` | `string customer_id = 1; string full_name = 2; optional string date_of_birth = 3; string created_at = 4; string updated_at = 5;` |
| `CreateCustomerRequest` | `string full_name = 1; optional string date_of_birth = 2;` |
| `GetCustomerRequest` | `string customer_id = 1;` |
| `UpdateCustomerRequest` | `optional string full_name = 1; optional string date_of_birth = 2; bool clear_date_of_birth = 3;` — Gateway đặt `clear_date_of_birth = true` khi JSON có `"date_of_birth": null` |

| rpc | Vào → ra | Đọc metadata | Lỗi (status → `details`) |
|---|---|---|---|
| `CreateCustomer` | `CreateCustomerRequest` → `Customer` | `x-account-id` (làm `customer_id`), `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING` (thiếu metadata — chỉ xảy ra khi bị gọi không qua Gateway); `PERMISSION_DENIED` → `FORBIDDEN` (`x-role` ≠ `customer`); `INVALID_ARGUMENT` → `INVALID_INPUT` / `TEXT_CONTAINS_HTML`; `ALREADY_EXISTS` → `CUSTOMER_ALREADY_EXISTS`; `INTERNAL` |
| `GetCustomer` | `GetCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `INVALID_ARGUMENT` → `INVALID_ID`; `PERMISSION_DENIED` → `FORBIDDEN` (`x-role` = `driver`); `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `PERMISSION_DENIED` → `NOT_OWNER` (`customer` và mã ≠ `x-account-id`); `INTERNAL` |
| `UpdateCustomer` | `UpdateCustomerRequest` → `Customer` | `x-account-id`, `x-role` | `UNAUTHENTICATED` → `IDENTITY_MISSING`; `PERMISSION_DENIED` → `FORBIDDEN`; `INVALID_ARGUMENT` → `INVALID_INPUT` (không field nào được gửi; có cả `date_of_birth` lẫn `clear_date_of_birth`) / `TEXT_CONTAINS_HTML`; `NOT_FOUND` → `CUSTOMER_NOT_FOUND`; `INTERNAL` |

Cài đặt bên trong `customer-service`:

| Việc | Cách làm | Truy vết |
|---|---|---|
| Tạo | `INSERT … ON CONFLICT (customer_id) DO NOTHING RETURNING …`; không có dòng trả về → `CUSTOMER_ALREADY_EXISTS`. Không cần đọc trước, hai request đồng thời vẫn chỉ một dòng | C1, BRULE18, NFR14 |
| Sửa | Một giao dịch: `SELECT … FOR UPDATE` → không có → 404; giải mã giá trị cũ, áp thay đổi, mã hóa lại, `UPDATE … SET updated_at = now()` | C5 |
| Xem | `SELECT` theo PK → giải mã → trả | C2 |
| Mã hóa | AES-256-GCM, khóa `CUSTOMER_DATA_KEY`, IV 12 byte ngẫu nhiên mỗi giá trị, định dạng `0x01 ‖ IV ‖ bản mã ‖ tag`, AAD = `customer_profiles.full_name` / `customer_profiles.date_of_birth` (cùng quy ước spec 09-10, DN7). Mã hóa **chuỗi** đã chuẩn hóa (`YYYY-MM-DD` cho ngày sinh) | ADR-012; C3 |
| Giải mã lỗi (tag sai, phiên bản khóa lạ) | Trả `INTERNAL`, log `error` kèm `customer_id` (không kèm dữ liệu) → Gateway 503 | Không bao giờ trả dữ liệu hỏng |
| Log | `customer_created` / `customer_updated` kèm `customer_id`, `request_id`. **Không** ghi họ tên, ngày sinh | NFR08, NFR10 |
| SQL | Chỉ câu lệnh có tham số | Mục 25 |
| Thiếu / sai `CUSTOMER_DATA_KEY` | Không khởi động (spec 00) | 03 mục 11.4 |

## 6. Giao tiếp giữa các service

| Đường | Kiểu | Lý do nghiệp vụ |
|---|---|---|
| Gateway → `customer-service` `CreateCustomer`, `GetCustomer`, `UpdateCustomer` (G2) | gRPC | Khách / admin chờ kết quả ngay |
| `customer-service` ↔ `auth-service` | **Không có** | `customer_id` lấy từ token; không cần Auth xác nhận (ADR-013, 02 mục 9) |
| `customer-service` → service khác, event Kafka | **Không có** | Không context nào cần hồ sơ khách; đặt xe không yêu cầu có hồ sơ (Q56) |

## 7. Dữ liệu

### 7.1 Migration `services/customer-service/migrations/001_tao-customer-profiles.sql`

| Cột | Kiểu | Ràng buộc | Vì sao |
|---|---|---|---|
| `customer_id` | `uuid` | `PRIMARY KEY` (tên `customer_profiles_pkey`), **không DEFAULT** | Bằng `account_id`; PK chặn hồ sơ thứ hai (C1) |
| `full_name_enc` | `bytea` | `NOT NULL`, `CHECK (octet_length(full_name_enc) >= 30)` | 1 + 12 + ≥ 1 + 16 byte: chặn ghi nhầm dữ liệu rõ ngắn |
| `date_of_birth_enc` | `bytea` | NULL, `CHECK (date_of_birth_enc IS NULL OR octet_length(date_of_birth_enc) >= 30)` | Tùy chọn (C6) |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | |

Không index nào khác (03 mục 4.1). Không cột số điện thoại.

### 7.2 Seed `customer-service` (`src/seed.js`)

Chỉ cần `account_id` cố định của spec 09-10 mục 7.3; **không** gọi `auth-service`. Mã hóa bằng cùng module với A37.

| Mã | `customer_id` | Họ tên | Ngày sinh | Dùng cho |
|---|---|---|---|---|
| KH1 | `00000000-0000-4000-8000-000000000011` | Nguyễn Văn An | 2000-01-15 | 11 (dự phòng: xem → 200), 24, 26 |
| KH2 | `00000000-0000-4000-8000-000000000012` | Trần Thị Bình | 1998-07-20 | 11 (xem hồ sơ người khác → 403) |
| KH3 | — | **Không có hồ sơ** | — | 11 (dự phòng: xem → 404, tạo → 201) |
| KH9 | `00000000-0000-4000-8000-000000000019` | Lê Văn Cường | — | Đủ dữ liệu theo 03 mục 14 |

`--reset`: xóa dòng của KH1, KH2, **KH3**, KH9 (KH3 có thể đã được tạo khi demo) rồi chèn lại KH1, KH2, KH9.

## 8. Tiêu chí chấp nhận

Tiền điều kiện chung: spec 00, 09-10 đạt; seed đã chạy. Postman có `token_kh1`, `token_kh2`, `token_kh3`, `token_ad1`, `token_tx1` (đăng nhập bằng seed), và `token_new`, `account_id_new` từ mục 9.

### 8.1 Mục 11 — chuỗi chính (04 mục 5.2)

| AC | Given | When | Then |
|---|---|---|---|
| AC-HS-01 | `token_new` của tài khoản vừa đăng ký (chưa có hồ sơ) | A09 `account_id_new` | 404 `CUSTOMER_NOT_FOUND` (C5, AC28 "xem trước khi tạo → không tìm thấy") |
| AC-HS-02 | Như trên | A37 `{ full_name: "Phạm Minh Đức", date_of_birth: "2001-03-10" }` | 201; `customer_id = account_id_new`; đúng họ tên, ngày sinh; có `created_at`, `updated_at` |
| AC-HS-03 | Sau AC-HS-02 | A09 `account_id_new` | 200, cùng nội dung AC-HS-02 |
| AC-HS-04 | Seed KH2 có hồ sơ | A09 mã KH2 bằng `token_new` | 403 `NOT_OWNER` (C2, AC29 "người khác bị từ chối") |
| AC-HS-05 | Dự phòng | Lặp AC-HS-01 … 04 bằng `token_kh3` và mã KH3 | 404; 201; 200; 403 |

### 8.2 Mục 11 — đường phụ, admin, phân quyền

| AC | Given | When | Then |
|---|---|---|---|
| AC-HS-06 | Sau AC-HS-02 | A37 lần hai (bất kỳ nội dung hợp lệ) | 409 `CUSTOMER_ALREADY_EXISTS`; hồ sơ không đổi (C1, BRULE18) |
| AC-HS-07 | Sau AC-HS-02 | A38 | 200 hồ sơ của `account_id_new` |
| AC-HS-08 | `token_kh3` trước khi tạo | A38; A10 `{ full_name: "X" }` | 404 `CUSTOMER_NOT_FOUND` cả hai |
| AC-HS-09 | Unit / tích hợp | Gửi đồng thời hai A37 cho cùng tài khoản chưa có hồ sơ | Đúng một 201, một 409; bảng có đúng một dòng |
| AC-HS-10 | `token_ad1` | A09 mã KH1; A09 một UUID không có hồ sơ | 200 hồ sơ KH1; 404 `CUSTOMER_NOT_FOUND` (UC19, AC29 "Admin xem được") |
| AC-HS-11 | `token_ad1` | A37; A38; A10 | 403 `FORBIDDEN` cả ba (BRULE18: admin chỉ xem) |
| AC-HS-12 | `token_tx1` | A09 mã KH1; A37; A38; A10 | 403 `FORBIDDEN` tất cả (bổ trợ mục 28) |
| AC-HS-13 | Không token | A09; A37; A38; A10 | 401 `TOKEN_MISSING` tất cả |
| AC-HS-14 | `token_kh1` | A09 với mã `abc` | 400 `INVALID_ID` |
| AC-HS-15 | `token_kh1` | A37 thiếu `full_name`; `full_name: "   "`; `full_name` 101 ký tự; `full_name: 123`; `date_of_birth: "15/01/2000"`; `"2001-02-30"`; ngày mai; `"1899-12-31"`; có thêm `customer_id` | 400 `INVALID_INPUT` tất cả (KH1 đã có hồ sơ nhưng lỗi hình thức trả trước) |
| AC-HS-16 | `token_kh1` | A37 với `full_name` đúng 100 ký tự tiếng Việt có dấu (ví dụ 100 chữ "Đ") | Không bị 400 vì độ dài (đếm ký tự, không đếm byte); trả 409 vì KH1 đã có hồ sơ |
| AC-HS-17 | `token_kh1` | A10 `{}`; `{ full_name: null }`; `{ foo: 1 }` | 400 `INVALID_INPUT` |
| AC-HS-18 | `token_kh1` | A10 `{ date_of_birth: "1999-12-31" }` | 200; họ tên giữ nguyên, ngày sinh mới; `updated_at` > `created_at` |
| AC-HS-19 | `token_kh1` | A10 `{ date_of_birth: null }` rồi A38 | 200, `date_of_birth: null` |
| AC-HS-20 | Header client giả | A38 bằng `token_kh1` kèm header `x-account-id: <mã KH2>` | 200 hồ sơ **KH1** (Gateway không chuyển header của client — spec 09-10 AC-DN-36) |
| AC-HS-21 | `docker compose stop customer-service` | A38 bằng `token_kh1` | 503 `SERVICE_UNAVAILABLE`; A05 (đăng nhập) vẫn 200 (NFR05) |
| AC-HS-22 | `docker compose stop auth-service` | A38, A10 bằng `token_kh1` còn hạn | 200 — hồ sơ không phụ thuộc Auth (02 mục 4.6) |
| AC-HS-23 | `docker compose stop redis` | A38 bằng `token_kh1` | 200; log Gateway có cảnh báo Redis (Redis dừng thì cho qua [ĐC]) |

### 8.3 Mục 24 — dữ liệu hồ sơ trên đĩa là bản mã hóa

Bằng chứng gồm ba phần (04 mục 5.3, Q52 đề xuất (a)):

| AC | Given | When | Then |
|---|---|---|---|
| AC-HS-24 | Seed KH1 | Postman A09 mã KH1 bằng `token_kh1` | 200, `full_name = "Nguyễn Văn An"` — API trả dữ liệu rõ cho đúng chủ |
| AC-HS-25 | Seed KH1 | `docker compose exec customer-db psql -U customer -d customer -c "SELECT customer_id, encode(full_name_enc,'hex') AS full_name_enc, encode(date_of_birth_enc,'hex') AS dob_enc FROM customer_profiles WHERE customer_id='00000000-0000-4000-8000-000000000011';"` | Hai cột là chuỗi hex bắt đầu `01`, độ dài ≥ 60 ký tự hex; không thấy "Nguyễn Văn An" hay "2000-01-15" |
| AC-HS-26 | Như trên | `… -c "SELECT count(*) FROM customer_profiles WHERE convert_from(full_name_enc,'UTF8') LIKE '%An%'"` | Lỗi giải mã UTF-8 hoặc `0` — database không đọc được họ tên |
| AC-HS-27 | Như trên | Cùng câu lệnh ở `auth-db` (spec 09-10 AC-DN-37) | `phone_enc` là byte; `password_hash` bắt đầu `scrypt$` |
| AC-HS-28 | Quản lý khóa | `git ls-files .env` ; `docker compose exec customer-service printenv AUTH_DATA_KEY` ; `docker compose exec auth-service printenv CUSTOMER_DATA_KEY` | Rỗng cả ba — khóa không nằm trong Git; mỗi service chỉ có khóa của mình |
| AC-HS-29 | Unit test | Mã hóa cùng một họ tên hai lần | Hai bản mã khác nhau; giải mã ra cùng chuỗi; sửa một byte → giải mã báo lỗi |
| AC-HS-30 | Unit test | Giải mã `full_name_enc` với AAD `customer_profiles.date_of_birth` | Báo lỗi — bản mã không đổi chỗ giữa hai cột được |

### 8.4 Mục 26 — XSS

| AC | Given | When | Then |
|---|---|---|---|
| AC-HS-31 | `token_kh1`, KH1 có hồ sơ | A10 `{ full_name: "<script>alert(1)</script>" }` | 400 `TEXT_CONTAINS_HTML` |
| AC-HS-32 | Sau AC-HS-31 | A38 | 200; `full_name` vẫn `"Nguyễn Văn An"`; header `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Content-Type: application/json; charset=utf-8` |
| AC-HS-33 | `token_kh3` chưa có hồ sơ | A37 `{ full_name: "<img src=x onerror=alert(1)>" }`; A37 `{ full_name: "An > Bình" }` | 400 `TEXT_CONTAINS_HTML` cả hai; KH3 vẫn chưa có hồ sơ (A38 → 404) |
| AC-HS-34 | Unit test service (gọi gRPC thẳng, không qua Gateway) | `CreateCustomer` với `full_name` chứa `<b>` | `INVALID_ARGUMENT` / `TEXT_CONTAINS_HTML` — lớp service vẫn chặn |
| AC-HS-35 | `token_kh1` | A10 `{ full_name: "Nguyễn Văn An & 'Bình' \"Chi\"" }` | 200; trả nguyên văn (ký tự `&`, `'`, `"` được phép; JSON tự thoát dấu `"`) |

### 8.5 Mục 25, 27 qua A09 (chuỗi demo của 04 mục 5.3)

| AC | Given | When | Then |
|---|---|---|---|
| AC-HS-36 | `token_kh1` | A09 với mã `1 OR 1=1` (URL mã hóa `1%20OR%201=1`); với `00000000-0000-4000-8000-000000000011' OR '1'='1` | 400 `INVALID_ID` cả hai; không 200, không 5xx |
| AC-HS-37 | Token riêng của KH2 | A09 mã KH2 với token bị sửa một ký tự → A09 không token → A06 → A09 với token vừa đăng xuất | 401 `TOKEN_INVALID`; 401 `TOKEN_MISSING`; 200; 401 `TOKEN_REVOKED` |

## 9. Quyết định BA tự chọn và câu hỏi còn mở

### 9.1 Tự chọn trong spec này

| # | Quyết định | Lý do | Nếu đổi thì sửa |
|---|---|---|---|
| HS1 | A10 cập nhật từng phần; `date_of_birth: null` xóa ngày sinh | Ngày sinh tùy chọn nên phải có cách bỏ; field vắng giữ nguyên để client không phải gửi lại họ tên | Mục 4.5, rpc `UpdateCustomer` |
| HS2 | "Không ở tương lai" so với ngày hôm nay theo giờ Việt Nam; cận dưới 1900-01-01 | Người dùng ở Việt Nam; cận dưới chặn năm nhập nhầm | Mục 4.1 |
| HS3 | Họ tên đếm theo ký tự Unicode, chuẩn hóa NFC trước khi lưu | Tên tiếng Việt có dấu; hai cách gõ dấu cho cùng chữ phải như nhau | Mục 4.1 |
| HS4 | Thêm mã `IDENTITY_MISSING` (chỉ gặp khi gọi gRPC không qua Gateway) | Service không được mặc định một danh tính khi thiếu metadata | Mục 5 |
| HS5 | Thời điểm trong proto là chuỗi ISO 8601 | Gateway trả thẳng, không phải đổi kiểu | `customer.proto` |
| HS6 | Seed KH9 có hồ sơ, không ngày sinh | 03 mục 14 ghi KH9 có hồ sơ ở customer; một hồ sơ seed có `date_of_birth` NULL để test đường đó | Seed |

### 9.2 Chỗ thiết kế chưa khớp (ghi lại, không tự sửa design)

| # | Chỗ | Ghi chú |
|---|---|---|
| HS-M1 | 02 mục 8.1 sơ đồ ghi `GetCustomer` "(metadata x-account-id)" nhưng không nêu admin; 04 ma trận ghi admin A09 → 200 / 404 | Spec theo 04 (admin xem được) |
| HS-M2 | 04 mục 1.1 liệt kê `NOT_OWNER` là `PERMISSION_DENIED`, nhưng Gateway cũng trả `FORBIDDEN` cho sai role với cùng HTTP 403 | Hai mã khác nhau có chủ ý: `FORBIDDEN` = sai role (Gateway), `NOT_OWNER` = đúng role nhưng không phải chủ (service). Nên nêu khi vấn đáp mục 28 |

### 9.3 Câu hỏi còn mở

| # | Câu hỏi | Lựa chọn | Đề xuất | Hỏi ai |
|---|---|---|---|---|
| HS-Q1 | Q52 vẫn mở: mục 24 ghi "POSTMAN" nhưng dữ liệu at rest chỉ thấy trong database | (a) Postman + 2 lệnh `psql` + `printenv` (mục 8.3); (b) thêm API admin trả bản mã | (a) | GV |
| HS-Q2 | Q51 vẫn mở: chống XSS bằng từ chối `<`, `>` | (a) Từ chối; (b) lưu nguyên, escape khi trả | (a) — spec viết theo (a) | SV / GV |
| HS-Q3 | Q58: hồ sơ không có số điện thoại; màn hình hồ sơ có cần hiện số đăng nhập không? | (a) Không; (b) thêm API Auth "tài khoản của tôi" | (a) — ngoài 30 mục chấm | SV |
| HS-Q4 | Thứ tự 404 trước 403 ở A09 cho phép khách biết một mã tài khoản đã có hồ sơ hay chưa | (a) Giữ theo 04 (UUID không đoán được); (b) khách gọi mã khác mình → 403 luôn, không tra database | (a) giữ thiết kế; (b) an toàn hơn nếu giảng viên hỏi về lộ thông tin | SV |
| HS-Q5 | A10 dùng `PUT` nhưng cập nhật từng phần | (a) Giữ `PUT` như 04; (b) đổi sang `PATCH` | (a) — đổi phải sửa 04 | SV |
