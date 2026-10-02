# ADR-001 — Tách Auth và Customer thành hai service

- Ngày: 2026-10-01. Trạng thái: **Đã chấp nhận** (2026-10-02) — danh sách 8 service giảng viên chốt trong `CLAUDE.md` có `auth-service` và `customer-service` riêng. Rà lại 2026-10-02: còn đúng với cách chia mới, chỉ sửa số mục dẫn chiếu.
- Liên quan: `docs/design/01-bounded-contexts.md` mục 6.1, 6.2, 7.1; FR26, FR27, FR32; NFR06–NFR08; mục chấm 9, 10, 11, 21, 24.

## Bối cảnh

Bản cũ có một service Identity giữ cả tài khoản đăng nhập lẫn hồ sơ khách hàng. Giảng viên nhận xét kiến trúc chưa đúng và giao bài mẫu gồm Gateway + AuthService + CustomerService. Bảng Entity trong `srs.md` còn để `password_hash` nằm trong cả ba bảng Customer, Driver, Operator.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Một service Identity (tài khoản + hồ sơ khách) | Đăng ký là một giao dịch; ít service | Trộn hai mô hình: tài khoản phục vụ 3 role, hồ sơ chỉ của khách. Hồ sơ tài xế lại nằm ở service khác nên không nhất quán. Trái nhận xét của giảng viên |
| B | **Auth riêng, Customer riêng** | Mỗi service một trách nhiệm; đối xứng với Driver; mật khẩu tách khỏi dữ liệu cá nhân | Đăng ký khách chạm hai service |
| C | Auth riêng; hồ sơ khách và hồ sơ tài xế chung một service "User Profile" | Một nơi cho mọi hồ sơ | Hồ sơ tài xế gắn chặt với xe, trạng thái nhận chuyến, vị trí (BRULE01, BRULE02); kéo nó ra khỏi Driver làm truy vấn mục 13 phải ghép hai nơi |

## Quyết định

Chọn **B**.

## Vì sao

1. **Hai mô hình khác nhau.** Auth trả lời "bạn là ai, được làm gì" cho cả `customer`, `driver`, `admin` (FR26, FR32). Customer trả lời "khách này tên gì, sinh ngày nào" (FR27). Từ "khách hàng" ở Auth là một Account có role; ở Customer là một hồ sơ.
2. **Đối xứng.** Tài xế đã có hồ sơ ở Driver. Nếu hồ sơ khách nằm trong Auth thì Auth vừa là xác thực chung vừa là service của riêng khách.
3. **Bảo mật.** Mật khẩu băm và dữ liệu cá nhân nằm ở hai database; lộ một nơi không lộ nơi kia (NFR08, mục chấm 24).
4. **Tốc độ thay đổi khác nhau.** Hồ sơ hay thêm trường; cơ chế đăng nhập ít đổi và đổi thì ảnh hưởng toàn hệ thống.
5. Khớp bài mẫu của giảng viên nên dễ trình bày.

## Đánh đổi

- **Đăng ký khách không còn là một giao dịch.** Có thể tạo được tài khoản mà hồ sơ chưa có. File 02 phải chọn cách xử lý (câu hỏi Q3), và mục chấm 11 phải chạy được ngay sau mục 9.
- `customer-service` nhỏ: một FR chính, một đến hai mục chấm.
- Thêm một service, một database, một file proto phải vận hành.
- Phải quyết định số điện thoại / email nằm ở đâu (định danh đăng nhập ở Auth; thông tin liên lạc để hiển thị ở hồ sơ) — chốt ở file 03.
