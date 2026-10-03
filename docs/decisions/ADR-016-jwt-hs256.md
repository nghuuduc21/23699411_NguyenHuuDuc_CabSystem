# ADR-016 — Ký JWT bằng HS256 với một khóa `JWT_SECRET`

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

## Đánh đổi

- Lộ `JWT_SECRET` ở Gateway hoặc Auth là giả được token của bất kỳ ai, kể cả `admin`. Giảm thiểu: chỉ hai service nạp biến này; `.env` không commit.
- Muốn cho bên thứ ba tự kiểm tra token thì phải đổi sang RS256 (đổi ở Auth và Gateway, không đổi service khác).
- Khóa mẫu trong `.env.example` nằm trên Git: chỉ dùng cho máy demo, chạy thật phải thay.

## Câu trả lời mẫu khi vấn đáp

"Token em ký bằng HS256 với một khóa bí mật JWT_SECRET. Chỉ auth-service (để ký) và Gateway (để kiểm tra) có khóa này. Ai sửa payload, ví dụ đổi role thành admin, thì chữ ký tính lại không khớp nên Gateway trả 401. Em không dùng RS256 vì phải sinh cặp khóa và giải thích thêm khóa công khai, khóa riêng, trong khi chỉ có hai bên dùng khóa và cả hai đều là của hệ thống em."

## Điều kiện xem lại

Có bên ngoài hệ thống cần tự kiểm tra token, hoặc giảng viên yêu cầu ký bất đối xứng.
