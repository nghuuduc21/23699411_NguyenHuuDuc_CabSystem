# ADR-019 — Email thuộc hồ sơ khách hàng, không thuộc tài khoản

- Ngày: 2026-10-05. Trạng thái: **Đã chấp nhận** (sinh viên chốt 2026-10-05). Sửa một phần ADR-012 (phạm vi "lưu rõ" của email) và quyết định D7 ở `docs/design/03` mục 16.1.
- Liên quan: `srs.md` FR26, FR27, UC01, UC02, UC03; `docs/design/01` A2, A8, C6, C7 (Q59); `docs/design/03` mục 3.1, 4.1, 11.4, 14, 15; `docs/design/04` A04, A05, A09, A10, A37, A38, mục 1.8; spec `09-10`, `11`; mục chấm 9, 10, 11, 24.

## Bối cảnh

Bản trước: tài khoản ở `auth-service` có `phone` (bắt buộc, UNIQUE) và `email` (tùy chọn, UNIQUE); đăng nhập bằng `phone` **hoặc** `email`. Hồ sơ khách ở `customer-service` có họ tên, ngày sinh, **không** có số điện thoại (Q58: mỗi thông tin chỉ lưu một nơi).

Vấn đề: email không phục vụ mục chấm nào ở phía tài khoản. Đăng nhập bằng hai định danh làm A05 có luật "đúng một trong hai", thêm hai mã lỗi (`INVALID_EMAIL`, `EMAIL_ALREADY_EXISTS`) và một ràng buộc UNIQUE phải giải thích khi thi. Về nghiệp vụ, email là **thông tin liên hệ** của khách (giống họ tên, ngày sinh), không phải danh tính đăng nhập. Tài xế và admin cũng không cần email.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Giữ email ở tài khoản, đăng nhập bằng số hoặc email (bản cũ) | Đăng nhập linh hoạt; email UNIQUE | Hai định danh, thêm luật và mã lỗi; email nằm ở Auth trong khi các thông tin cá nhân khác nằm ở Customer |
| B | **Email chuyển sang hồ sơ khách; tài khoản chỉ số điện thoại + mật khẩu; đăng nhập chỉ bằng số** | Một định danh đăng nhập; mỗi thông tin chỉ lưu một nơi (số ở Auth, email ở Customer — như Q58 theo chiều ngược lại); A04, A05 ngắn hơn | Tài xế, admin không có email; không đăng nhập bằng email được |
| C | Email ở cả hai nơi | Linh hoạt nhất | Hai bản có thể lệch nhau — đúng điều Q58 đã tránh |

## Quyết định

Chọn **B**.

| Điểm | Thiết kế |
|---|---|
| Tài khoản (auth) | Chỉ `phone` + `password_hash` (+ `role`, `status`). Migration mới `003_bo-email-accounts.sql`: `ALTER TABLE accounts DROP COLUMN IF EXISTS email` — **không sửa migration `001`** |
| A04 đăng ký | Chỉ nhận `phone`, `password`. Gửi `email` → 400 `INVALID_INPUT` (field lạ) |
| A05 đăng nhập | Chỉ nhận `phone`, `password` |
| Proto auth | Bỏ field `email` khỏi `RegisterCustomer`, `Login`; `reserved 2; reserved "email";` để không dùng lại số field |
| Hồ sơ khách (customer) | Cột mới `email text NULL`, `CHECK (char_length(email) <= 254)`, **không UNIQUE**, **không mã hóa**. Migration mới `002_them-email.sql` |
| A37, A10 | Nhận `email` tùy chọn; cắt khoảng trắng, đổi chữ thường, kiểm định dạng → sai: 400 `INVALID_EMAIL`. A10 `"email": null` xóa email |
| A09, A38 | Trả `email` (hoặc `null`) |
| Seed | KH1 `kh1@cab.vn`, KH2 `kh2@cab.vn`; KH9 không có |
| Mã lỗi | Bỏ `EMAIL_ALREADY_EXISTS`. `INVALID_EMAIL` chuyển từ auth sang customer |

Vì sao **không UNIQUE**: email không còn là định danh đăng nhập; hai khách dùng chung email gia đình vẫn hợp lệ; bớt một đường lỗi "trùng".

Vì sao **không mã hóa**: `CLAUDE.md` đã chốt "không mã hóa số điện thoại, email"; mục chấm 24 chứng minh trên mật khẩu (băm), họ tên, ngày sinh, số giấy phép (AES-256-GCM). Giữ phạm vi hẹp để tự giải thích được.

## Vì sao

1. Email là thông tin liên hệ của khách, cùng loại với họ tên, ngày sinh → thuộc context Customer.
2. Mỗi thông tin chỉ lưu **một nơi**: số điện thoại ở Auth (Q58), email ở Customer. Không có hai bản lệch nhau, không cần Auth và Customer gọi nhau (giữ ADR-013).
3. Đăng nhập bằng số điện thoại là đủ cho cả ba role và cho mọi mục chấm; bỏ luật "đúng một trong hai định danh" và hai mã lỗi.

## Đánh đổi

| Mất gì | Ghi chú |
|---|---|
| Tài xế và admin không có email | Không FR nào cần |
| Không đăng nhập bằng email được | UC02 đã sửa thành "số điện thoại và mật khẩu" |
| Email nằm rõ trong `customer-db` | Bảo vệ bằng quyền ở API (chỉ chủ hồ sơ và admin xem — C2) và mạng nội bộ |
| Database đang chạy mất email đã lưu ở `accounts` | Không chuyển dữ liệu (hai database tách rời); dữ liệu demo đặt lại bằng `docker compose down -v` |

## Câu trả lời mẫu khi vấn đáp

"Tài khoản chỉ có số điện thoại và mật khẩu, đăng nhập bằng số điện thoại. Email là thông tin liên hệ nên em để trong hồ sơ khách hàng, tùy chọn. Mỗi thông tin chỉ lưu một nơi: số điện thoại ở auth, email ở hồ sơ, nên không có hai bản lệch nhau và auth với customer vẫn không phải gọi nhau. Email không bắt buộc duy nhất vì không dùng để đăng nhập, và không mã hóa vì em chỉ mã hóa họ tên, ngày sinh, số giấy phép. Đánh đổi là tài xế và admin không có email, và không đăng nhập bằng email được."

## Điều kiện xem lại

Có yêu cầu đăng nhập bằng email, quên mật khẩu qua email, hoặc gửi thông báo qua email thật cho tài xế / admin.
