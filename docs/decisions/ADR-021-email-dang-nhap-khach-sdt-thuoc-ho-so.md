# ADR-021 — Email là định danh đăng nhập của khách; số điện thoại khách thuộc hồ sơ

- Ngày: 2026-10-14. Trạng thái: **Đã chấp nhận** — **theo yêu cầu giảng viên 2026-10-14**, sinh viên chốt toàn bộ phương án. **Thay ADR-019** (ADR-019 chuyển sang "Bị thay thế").
- Liên quan: `srs.md` FR26, FR27, FR39, BRULE19 (mới), UC01, UC02, UC03, AC27, AC28; `docs/design/01` A2, A8, A9 (mới), C6, C7; `docs/design/03` mục 3.1, 4.1, 11.4, 14; `docs/design/04` A04, A05, A07, A08, A09, A10, A37, A38, mục 1.8, 1.9; spec `09-10`, `11`, `12-13-21-23`, `20-29`; mục chấm 9, 10, 11, 21, 24, 25, 29.

## Bối cảnh

ADR-019 (2026-10-05): tài khoản chỉ có số điện thoại + mật khẩu, mọi role đăng nhập bằng số điện thoại; email là thông tin liên hệ trong hồ sơ khách.

Giảng viên (2026-10-14) yêu cầu: **khách và admin đăng ký / đăng nhập bằng email**; tài xế vẫn dùng số điện thoại + OTP. Các route xác thực gom vào nhóm `/api/v1/auth/…`. Số điện thoại của khách là thông tin liên hệ, nằm ở hồ sơ.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Giữ ADR-019 (mọi role đăng nhập bằng số) | Không đổi gì | Trái yêu cầu giảng viên |
| B | **Tài khoản có `email` và `phone`, mỗi role dùng đúng một định danh: khách / admin = email, tài xế = số điện thoại. Số điện thoại của khách nằm ở hồ sơ** | Đúng yêu cầu; mỗi dữ liệu vẫn một nơi; luật dễ nhớ "tài xế dùng số, còn lại dùng email" | Hai cột định danh ở `accounts`, phải có CHECK theo role; đăng nhập có luật "đúng một trong hai field" |
| C | Như B nhưng số điện thoại của khách cũng ở tài khoản | Một nơi giữ mọi định danh | Khách có hai định danh, phải giải thích dùng cái nào; trái yêu cầu "khách không có phone ở tài khoản" |

## Quyết định

Chọn **B**.

| Điểm | Thiết kế |
|---|---|
| `accounts` (auth) | `email` text NULL, UNIQUE, lưu chữ thường; `phone` text NULL, UNIQUE (bỏ NOT NULL). CHECK `accounts_identity_by_role`: `driver` → có `phone`, **không** `email`; `customer`, `admin` → có `email`, **không** `phone` [BA: chặt hơn yêu cầu tối thiểu — xem "Vì sao" 3] |
| Migration | Auth: file mới `004_email-dang-nhap.sql`. Customer: file mới `003_sdt-trong-ho-so.sql`. **Không sửa migration cũ** |
| A04 đăng ký khách | `POST /api/v1/auth/register` `{"email","password"}` → 201 `{account_id, role: "customer"}`. Thay `POST /api/v1/accounts` |
| A05 đăng nhập | `POST /api/v1/auth/login`: **đúng một** trong `email` / `phone` + `password`. Thiếu cả hai hoặc có cả hai → 400 `INVALID_INPUT` |
| A07, A08 tài xế | `POST /api/v1/auth/otp` `{"phone"}`; `POST /api/v1/auth/driver-register` `{"phone","otp","password"}` (thay `/otps`, `/driver-accounts`; body, rpc, luật OTP giữ nguyên) |
| Admin seed | Email `admin@cab.vn`, **bỏ** số `0999999999` (phone NULL) |
| Seed khách | KH1 `kh1@cab.vn`, KH2 `kh2@cab.vn`, KH3 `kh3@cab.vn`, KH9 `kh9@cab.vn` (LOCKED); mã giữ nguyên |
| `customer_profiles` | Bỏ `email`; thêm `phone` **bắt buộc khi tạo hồ sơ**, `0` + 9 chữ số, **không UNIQUE**, lưu rõ. Sửa được bằng PATCH, không xóa được |
| Body tạo hồ sơ | `{"name","phone"}` (+ `dob`) |
| Seed hồ sơ | KH1 `0900000001`, KH2 `0900000002`, KH9 `0900000009` (KH3 vẫn chưa có hồ sơ) |
| Mã lỗi | Thêm lại `EMAIL_ALREADY_EXISTS` (409) ở auth; `INVALID_EMAIL` chuyển về auth; customer trả `INVALID_PHONE` cho số trong hồ sơ |
| Rate limit | Bốn route công khai `auth/register`, `auth/login`, `auth/otp`, `auth/driver-register` chung một bộ đếm IP (như cũ, chỉ đổi đường dẫn) |

Vì sao **bỏ** số `0999999999` của admin (chọn trong hai phương án sinh viên đưa):

| Phương án | Ưu | Nhược |
|---|---|---|
| **Bỏ (chọn)** | Một luật duy nhất: "tài xế dùng số điện thoại, mọi người khác dùng email"; CHECK theo role giữ được; đăng nhập bằng số chỉ có thể ra tài xế | Admin không còn số điện thoại trong hệ thống — không FR nào cần |
| Giữ làm dữ liệu phụ | Không mất dữ liệu cũ | Admin có hai định danh: hoặc phải cho đăng nhập bằng số (phá luật dễ nhớ), hoặc số nằm đó mà không dùng (dữ liệu thừa, phải nới CHECK) |

## Vì sao

1. Đúng yêu cầu giảng viên: khách và admin dùng email; tài xế giữ số điện thoại vì OTP gửi qua số điện thoại chứng minh người đó giữ số (FR39).
2. **Mỗi dữ liệu vẫn một nơi**: email ở tài khoản (để đăng nhập); số điện thoại của khách ở hồ sơ (để liên hệ); số điện thoại của tài xế ở tài khoản (để đăng nhập và OTP). Auth và Customer vẫn không gọi nhau (ADR-013 giữ nguyên).
3. CHECK "đúng một định danh theo role" làm cho dữ liệu tự bảo đảm luật: tra `WHERE phone = $1` chỉ có thể ra tài xế, `WHERE email = $1` chỉ có thể ra khách / admin. Code đăng nhập không cần thêm nhánh kiểm role.
4. Số điện thoại hồ sơ **không UNIQUE**: không dùng để đăng nhập; hai khách cùng gia đình dùng chung số vẫn hợp lệ; bớt một đường lỗi "trùng".
5. **Không mã hóa** email và số điện thoại hồ sơ: theo quyết định đã chốt "không mã hóa số điện thoại, email"; email phải UNIQUE và tra khi đăng nhập (mã hóa thì cần chỉ mục mù — ADR-012). Mục 24 vẫn chứng minh bằng mật khẩu băm, họ tên / ngày sinh / số giấy phép mã hóa.

## Đánh đổi

| Mất gì | Ghi chú |
|---|---|
| `accounts` có hai cột định danh, một CHECK theo role phải giải thích | Bù lại luật nhớ được trong một câu |
| Khách không đăng nhập bằng số điện thoại được; tài xế không đăng nhập bằng email được | Đúng yêu cầu; một role một cách đăng nhập |
| Số điện thoại hồ sơ **chưa được xác thực** (khách tự gõ, không OTP) | Chỉ là thông tin liên hệ; không dùng để đăng nhập hay gửi tiền |
| Database đang chạy có dữ liệu theo ADR-019 (khách có số, không có email) vi phạm CHECK mới → migration `004` lỗi, rollback, service thoát 1 | Không tự đoán email cho dòng cũ. Dữ liệu chỉ là dữ liệu demo: `docker compose down -v` rồi `docker compose up -d --build` |
| Lộ "email nào đã đăng ký" qua 409 ở A04 | Như số điện thoại trước đây; đăng nhập sai vẫn trả cùng 401 |

## Câu trả lời mẫu khi vấn đáp

"Theo yêu cầu của thầy, khách và admin đăng ký, đăng nhập bằng email; tài xế vẫn dùng số điện thoại vì tài xế phải xác thực số bằng OTP. Bảng `accounts` có cả `email` và `phone`, đều UNIQUE và cho phép rỗng, kèm một CHECK theo role: tài xế có số, không có email; khách và admin có email, không có số. Nhờ vậy dữ liệu tự bảo đảm mỗi người đúng một cách đăng nhập. Số điện thoại của khách là thông tin liên hệ nên nằm ở hồ sơ, bắt buộc khi tạo hồ sơ, không UNIQUE và không mã hóa. Mỗi dữ liệu vẫn một nơi, và auth với customer vẫn không gọi nhau."

## Điều kiện xem lại

Có yêu cầu khách đăng nhập bằng số điện thoại, xác thực số điện thoại hồ sơ bằng OTP, hoặc gửi thông báo qua email / SMS thật.
