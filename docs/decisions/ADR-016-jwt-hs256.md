# ADR-016 — Ký JWT bằng HS256 với một khóa `JWT_SECRET`

- **Bổ sung 2026-10-14 (theo yêu cầu giảng viên):** giữ HS256; thêm mục "Cách demo mục chấm 27" (jwt.io) và "Rủi ro đã biết". Quyết định không đổi.
- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — ghi trong `CLAUDE.md` dòng "Ký JWT". Thay giả định GĐ-8 (ký bất đối xứng RS256) của file 02.
- Liên quan: `docs/design/02` mục 2.2, 11.1 (GĐ-8), 12.1 (Q19); `docs/design/03` mục 13 (biến 2); NFR06, NFR07; FR26, FR42; mục chấm 10, 27, 28.

## Bối cảnh

`auth-service` cấp token; Gateway kiểm tra token tại chỗ ở mọi request (không gọi Auth). Mục chấm 27: sửa token → 401. Luật thi: lệnh terminal gõ tay, không chạy script soạn sẵn, phải tự giải thích mọi khái niệm. Bản trước giả định RS256: Auth giữ khóa riêng, Gateway giữ khóa công khai, cần bước sinh cặp khóa và hai biến base64 dài.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | RS256 (cặp khóa) | Gateway chỉ kiểm tra, không ký được; lộ khóa công khai vô hại | Phải sinh cặp khóa (lệnh `openssl` hoặc script), hai biến dài; thêm khái niệm khóa công khai / khóa riêng |
| B | **HS256, một khóa bí mật chung** | Một biến môi trường; không có bước sinh khóa; dễ giải thích | Ai có khóa đều ký được token |
| C | Gateway gọi Auth kiểm tra token mỗi request | Không chia sẻ khóa | Auth thành điểm nghẽn; mỗi request thêm một lời gọi |

## Quyết định

Chọn **B**.

| Điểm | Thiết kế |
|---|---|
| Thuật toán | HS256 (HMAC-SHA256) |
| Khóa | `JWT_SECRET`, ≥ 32 ký tự; chỉ `auth-service` và `gateway` được nạp |
| Payload | `sub` (`account_id`, số), `role`, `jti` (mã token để đăng xuất), `iat`, `exp` (`JWT_TTL_SECONDS`) |
| Gateway kiểm tra | Chỉ chấp nhận `alg = HS256` (từ chối `none` và thuật toán khác); chữ ký; `exp`; `revoked:{jti}` trong Redis |
| Đã bỏ | `JWT_PRIVATE_KEY_B64`, `JWT_PUBLIC_KEY_B64`, `JWT_ISSUER` |

## Vì sao

1. Mục chấm 27 chỉ cần "sửa payload thì chữ ký không khớp → 401": HS256 làm được y như RS256.
2. Một biến, có sẵn giá trị trong `.env.example`: dựng hệ thống chỉ cần `cp .env.example .env` và `docker compose up -d --build`.
3. Chỉ hai bên giữ khóa, và cả hai đều nằm trong hệ thống của mình: lợi thế "bên kiểm tra không ký được" của RS256 không cần thiết ở đây.

## Cách demo mục chấm 27 (bổ sung theo yêu cầu giảng viên 2026-10-14)

| Bước | Làm | Kết quả |
|---|---|---|
| 1 | Copy token KH1 (response đăng nhập) → dán vào ô token của trang **jwt.io** (trình duyệt) | Trang giải ra payload `{ "sub": "1", "role": "customer", "jti": …, "iat": …, "exp": … }` — chứng minh payload chỉ là base64, ai cũng đọc được, nên không chứa email / số điện thoại / mật khẩu |
| 2 | Sửa payload: `"role": "customer"` → `"role": "admin"`. **Không** gõ `JWT_SECRET` vào ô khóa của jwt.io; nếu trang bắt nhập khóa để ký lại thì gõ một chuỗi bất kỳ khác `JWT_SECRET` (ví dụ `abc`) — đúng vị trí kẻ tấn công: không có khóa | Trang sinh token mới: header + payload mới, chữ ký cũ hoặc chữ ký bằng khóa sai |
| 3 | Dán token mới vào tab GET (`GET /api/v1/customers/me` hoặc `/customers/1`) → Send | **401 `TOKEN_INVALID`**: Gateway tính lại HMAC-SHA256 của header + payload bằng `JWT_SECRET`, không khớp chữ ký |
| Dự phòng (không có Internet) | Sửa một ký tự **ở giữa** token ngay trong Postman (không sửa ký tự cuối — bit thừa của base64url) | 401 `TOKEN_INVALID` |

## Rủi ro đã biết

| Rủi ro | Hệ quả | Cách giữ |
|---|---|---|
| **Ai có `JWT_SECRET` thì ký lại được token hợp lệ**, kể cả đổi `role` thành `admin` | Gateway không phân biệt được token giả với token thật | Khóa **chỉ** nằm ở `auth-service` (ký) và `gateway` (kiểm tra); `.env` không commit; **không** dán `JWT_SECRET` lên jwt.io hay đưa cho người khác khi demo — dán vào là chính tay mình ký token admin hợp lệ |
| Khóa mẫu trong `.env.example` nằm trên Git | Ai đọc repo cũng ký được token cho **máy demo** | Chỉ dùng cho máy demo (giảng viên cho phép); chạy thật thay khóa trong `.env` |
| Dán token thật lên trang bên ngoài | Token còn hạn có thể bị dùng lại | Chỉ dán token demo; đăng xuất (FR42) hoặc chờ hết hạn sau khi demo |

## Đánh đổi

- Lộ `JWT_SECRET` ở Gateway hoặc Auth là giả được token của bất kỳ ai, kể cả `admin`. Giảm thiểu: chỉ hai service nạp biến này; `.env` không commit.
- Muốn cho bên thứ ba tự kiểm tra token thì phải đổi sang RS256 (đổi ở Auth và Gateway, không đổi service khác).
- Khóa mẫu trong `.env.example` nằm trên Git: chỉ dùng cho máy demo, chạy thật phải thay.

## Câu trả lời mẫu khi vấn đáp

"Token em ký bằng HS256 với một khóa bí mật JWT_SECRET. Chỉ auth-service (để ký) và Gateway (để kiểm tra) có khóa này. Em dán token lên jwt.io thấy payload đọc được ngay, nên payload chỉ có mã tài khoản và role. Sửa role thành admin rồi gửi lại thì chữ ký tính lại không khớp nên Gateway trả 401. Rủi ro là ai có JWT_SECRET thì ký được token admin thật, nên khóa chỉ nằm ở auth và Gateway, em không dán khóa lên jwt.io. Em không dùng RS256 vì phải sinh cặp khóa và giải thích thêm khóa công khai, khóa riêng, trong khi chỉ có hai bên dùng khóa và cả hai đều là của hệ thống em."

## Điều kiện xem lại

Có bên ngoài hệ thống cần tự kiểm tra token, hoặc giảng viên yêu cầu ký bất đối xứng.
