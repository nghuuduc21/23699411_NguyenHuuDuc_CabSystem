# ADR-012 — Mã hóa dữ liệu nhạy cảm ở mức ứng dụng, kèm chỉ mục mù cho field cần tra cứu

- Ngày: 2026-10-02. Trạng thái: **Đề xuất** — BA chọn, chờ sinh viên xác nhận.
- Liên quan: `docs/design/03-du-lieu.md` mục 2, 3, 4, 5, 11.4; NFR08, NFR16, BR15; quy tắc A2, A4, C3; mục chấm 2, 9, 10, 24.

## Bối cảnh

Mục chấm 24: "dữ liệu nhạy cảm mã hóa at rest + key management". Số điện thoại vừa là dữ liệu cá nhân, vừa là **định danh đăng nhập** và phải **duy nhất** (A2). Mã hóa tốt (IV ngẫu nhiên) cho ra kết quả khác nhau mỗi lần, nên không tra cứu và không đặt UNIQUE được trên cột đã mã hóa.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Mã hóa ổ đĩa / volume của database | Ứng dụng không phải làm gì | Ai kết nối được database vẫn đọc rõ; không chứng minh được qua dữ liệu; phụ thuộc máy chủ |
| B | `pgcrypto` mã hóa trong SQL | Không cần code mã hóa ở ứng dụng | Khóa đi kèm câu SQL nên có thể lọt vào log của database; cần extension |
| C | **Mã hóa ở ứng dụng (AES-256-GCM) + chỉ mục mù HMAC-SHA256 cho field cần tra cứu** | Database chỉ thấy byte; bản sao database không có khóa thì vô dụng; vẫn UNIQUE và đăng nhập được | Service phải tự mã hóa / giải mã; chỉ tra được bằng so sánh bằng; thêm một cột cho mỗi field cần tra |
| D | Mã hóa tất định (cùng đầu vào ra cùng kết quả) để UNIQUE ngay trên cột mã hóa | Không cần cột thứ hai | Lộ mẫu lặp; dùng lại IV với GCM là lỗi nghiêm trọng |
| E | Chỉ băm số điện thoại, không lưu bản mã hóa | Đơn giản | Không hiển thị lại được số điện thoại |

## Quyết định

Chọn **C**.

| Loại dữ liệu | Cách | Field |
|---|---|---|
| Mật khẩu | Băm scrypt, salt riêng | `accounts.password_hash` |
| OTP | HMAC-SHA256 có khóa | `otp_verifications.otp_hash` |
| Dữ liệu cá nhân cần đọc lại | AES-256-GCM, IV ngẫu nhiên từng giá trị, byte đầu là phiên bản khóa | Số điện thoại, email (auth); họ tên, số điện thoại, ngày sinh (customer); số giấy phép (driver) |
| Field mã hóa cần tra cứu / UNIQUE | Thêm cột chỉ mục mù HMAC-SHA256 trên giá trị đã chuẩn hóa | Số điện thoại, email (auth); số giấy phép (driver) |

Khóa: biến môi trường riêng của từng service, nạp từ `.env` (không commit); khóa mã hóa và khóa chỉ mục là hai khóa khác nhau; thiếu khóa thì service không khởi động.

## Vì sao

1. **Chứng minh được khi chấm**: `SELECT` thẳng trong database chỉ thấy byte; API trả về dữ liệu rõ cho đúng chủ.
2. **Giữ được A2**: UNIQUE đặt trên chỉ mục mù; đăng nhập tra theo chỉ mục mù nên vẫn dùng index.
3. **HMAC chứ không băm trần**: không gian số điện thoại nhỏ (khoảng 10⁹), băm không khóa thì dò ngược được.
4. **Không cần extension hay dịch vụ ngoài**: `node:crypto` có sẵn AES-GCM, HMAC, scrypt.
5. **Mỗi service một bộ khóa**: khớp với việc tách Auth và Customer để lộ một nơi không lộ nơi kia (ADR-001).

## Đánh đổi

- Không tìm theo một phần (ví dụ theo đầu số, theo tên); không sắp xếp theo field đã mã hóa.
- Hai dòng có cùng giá trị thì cùng chỉ mục mù: lộ quan hệ "bằng nhau", không lộ giá trị.
- Mất khóa là mất dữ liệu; đổi khóa chỉ mục phải tính lại mọi dòng.
- Khóa trong biến môi trường: ai xem được cấu hình container thì có khóa. Triển khai thật cần dịch vụ giữ bí mật — ngoài phạm vi.
- Seed phải chạy bằng code của service, không viết SQL tay được.

## Câu trả lời mẫu khi vấn đáp

"Mật khẩu em băm bằng scrypt nên không giải ngược được. Số điện thoại, họ tên, số giấy phép em mã hóa bằng AES-256-GCM ngay trong service trước khi ghi database, khóa lấy từ biến môi trường, file `.env` không đưa lên Git. Vì mã hóa có IV ngẫu nhiên nên cùng một số ra kết quả khác nhau, em không UNIQUE trên cột đó được; em lưu thêm một cột HMAC của số điện thoại để kiểm tra trùng và để đăng nhập."

## Điều kiện xem lại

Giảng viên yêu cầu mã hóa ở tầng database (TDE / pgcrypto), hoặc yêu cầu tìm kiếm gần đúng trên dữ liệu cá nhân.
