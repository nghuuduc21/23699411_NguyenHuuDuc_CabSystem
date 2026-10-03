# ADR-012 — Mã hóa dữ liệu nhạy cảm ở mức ứng dụng, phạm vi hẹp (không chỉ mục mù)

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận (sửa 2026-10-03)** — phạm vi chốt trong `CLAUDE.md` dòng "Mã hóa dữ liệu nhạy cảm".
- Tên file giữ nguyên (`…-va-chi-muc-mu.md`) để không gãy liên kết; **chỉ mục mù đã bỏ**.
- Liên quan: `docs/design/03-du-lieu.md` mục 2, 3, 4.1, 5.2, 11.4, 13; NFR08, NFR16, BR15; quy tắc A2, A4, C3; mục chấm 2, 9, 10, 24.

## Lịch sử

| Ngày | Thay đổi |
|---|---|
| 2026-10-02 | Bản đầu: AES-256-GCM cho số điện thoại, email, họ tên, ngày sinh, số giấy phép; thêm cột chỉ mục mù HMAC (`*_bidx`) cho số điện thoại, email, số giấy phép để UNIQUE và tra cứu; OTP băm HMAC có khóa; byte phiên bản khóa |
| 2026-10-03 (ADR-013) | Hồ sơ khách không còn giữ số điện thoại (bỏ `customer_profiles.phone_enc`) |
| 2026-10-03 (luật thi) | **Thu hẹp**: bỏ mã hóa số điện thoại, email; bỏ mọi chỉ mục mù và khóa của chúng (`AUTH_DATA_KEY`, `AUTH_BLIND_INDEX_KEY`, `DRIVER_BLIND_INDEX_KEY`); OTP băm scrypt (bỏ `AUTH_OTP_HMAC_KEY`); bỏ byte phiên bản khóa |

## Bối cảnh

Mục chấm 24: "dữ liệu nhạy cảm mã hóa at rest + key management"; ví dụ trong phiếu chấm là mật khẩu. Số điện thoại vừa là dữ liệu cá nhân vừa là **định danh đăng nhập** phải **duy nhất** (A2). Mã hóa có IV ngẫu nhiên cho kết quả khác nhau mỗi lần, nên không tra cứu và không UNIQUE được trên cột mã hóa; muốn làm được phải thêm chỉ mục mù (một cột, một khóa, một khái niệm nữa). Luật thi: không mở tài liệu, phải tự giải thích; thứ gì không giải thích được thì bỏ.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Mã hóa ổ đĩa / volume | Ứng dụng không làm gì | Ai kết nối được database vẫn đọc rõ; không chứng minh được |
| B | `pgcrypto` trong SQL | Không cần code ở ứng dụng | Khóa đi kèm câu SQL, có thể lọt vào log database; cần extension |
| C | AES-256-GCM ở ứng dụng cho **mọi** dữ liệu cá nhân + chỉ mục mù HMAC cho field cần tra (bản 2026-10-02) | Bảo vệ cả số điện thoại, email | Thêm cột `_bidx`, thêm khóa; seed và đăng nhập phức tạp hơn; khó giải thích khi không có tài liệu |
| D | **Băm mật khẩu + AES-256-GCM ở ứng dụng chỉ cho trường cá nhân không dùng để tìm kiếm** | Đủ cho mục 24; mọi thứ còn lại tự giải thích được; số điện thoại vẫn UNIQUE trực tiếp | Số điện thoại, email nằm rõ trong `auth-db` |

## Quyết định

Chọn **D**.

| Cách | Field | Thuật toán |
|---|---|---|
| Băm | `accounts.password_hash`, `otp_verifications.otp_hash` | scrypt, salt ngẫu nhiên từng giá trị (`node:crypto`) |
| Mã hóa | `customer_profiles.full_name_enc`, `date_of_birth_enc`; `drivers.license_number_enc` | AES-256-GCM, IV 12 byte ngẫu nhiên từng giá trị; lưu `IV ‖ dữ liệu mã hóa ‖ thẻ 16 byte` trong cột `bytea` |
| Lưu rõ | `accounts.phone`, `accounts.email` (UNIQUE), `otp_verifications.phone` | — |

Khóa: `CUSTOMER_DATA_KEY` (chỉ `customer-service`), `DRIVER_DATA_KEY` (chỉ `driver-service`), mỗi khóa 32 byte base64, nạp từ `.env` (không commit). Thiếu khóa hoặc sai độ dài thì service không khởi động. Khóa ký JWT là việc khác (`JWT_SECRET`, ADR-016).

## Vì sao

1. **Đúng ví dụ phiếu chấm**: mật khẩu băm, không giải ngược được.
2. **Chứng minh được khi chấm**: `select * from customer_profiles` trong `customer-db` chỉ thấy byte; API trả họ tên rõ cho chính chủ.
3. **A2 giữ đơn giản**: số điện thoại lưu rõ nên UNIQUE và đăng nhập tra thẳng bằng index; không cần chỉ mục mù.
4. **Mỗi service một khóa**: lộ khóa của Customer không giải được dữ liệu của Driver.
5. **Không cần extension hay dịch vụ ngoài**: `node:crypto` có sẵn scrypt và AES-GCM.

## Đánh đổi

- Số điện thoại, email đọc được trong `auth-db`. Bảo vệ bằng: database không mở cổng ra ngoài (mục chấm 8), không API nào trả số điện thoại của người khác.
- Số giấy phép mã hóa nên **không UNIQUE** được: hồ sơ trùng số giấy phép do admin phát hiện khi duyệt (FR39).
- Không tìm khách theo tên; không sắp xếp theo field đã mã hóa (không FR nào trong 30 mục cần).
- Mất khóa là mất dữ liệu đã mã hóa; không có xoay khóa (bỏ byte phiên bản khóa).
- Khóa mẫu trong `.env.example` nằm trên Git để chạy demo bằng một lệnh sao chép: dữ liệu demo không thật sự bí mật; chạy thật phải thay khóa.
- Seed phải chạy bằng code của service (băm, mã hóa), không viết SQL tay được.

## Câu trả lời mẫu khi vấn đáp

"Mật khẩu em băm bằng scrypt có salt nên không giải ngược được. Họ tên, ngày sinh của khách và số giấy phép lái xe em mã hóa AES-256-GCM trong service trước khi ghi database; khóa lấy từ biến môi trường riêng của từng service, file `.env` không đưa lên Git. Số điện thoại và email em không mã hóa vì đó là thứ dùng để đăng nhập và phải không trùng: mã hóa với IV ngẫu nhiên thì không tra và không đặt UNIQUE được, phải thêm chỉ mục mù. Em chọn giữ phạm vi nhỏ và bảo vệ số điện thoại bằng mạng nội bộ cùng phân quyền ở API."

## Điều kiện xem lại

Giảng viên yêu cầu mã hóa cả số điện thoại / email (khi đó thêm lại phương án C với chỉ mục mù), hoặc mã hóa ở tầng database.
