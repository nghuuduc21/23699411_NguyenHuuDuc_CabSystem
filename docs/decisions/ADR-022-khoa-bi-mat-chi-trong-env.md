# ADR-022 — Khóa bí mật chỉ nằm trong `.env`; `.env.example` để trống biến bí mật

- Ngày: 2026-10-22. Trạng thái: **Đã chấp nhận** — sinh viên chốt. Sửa quyết định "`.env.example` có khóa mẫu dùng được" (spec `00` mục 3.7, `CLAUDE.md` Ràng buộc khi thi).
- Liên quan: NFR (bảo mật cấu hình), mục chấm 2, 19, 24, 27; ADR-012, ADR-014, ADR-016; `docs/design/03` mục 13.

## Bối cảnh

Trước đây `.env.example` (có trên Git) chứa đủ 14 biến kèm giá trị mẫu, kể cả `JWT_SECRET`, hai khóa AES và mật khẩu database, để `cp .env.example .env` là chạy. Giảng viên cho phép, nhưng `.env` trên máy demo giống hệt file mẫu: thực chất mọi khóa đang chạy đều công khai. Ai đọc repo cũng ký được token `admin` (HS256) và giải mã được dữ liệu demo.

Buổi thi làm trên máy cá nhân, mở VS Code, **không clone lại**, nên `.env` luôn có sẵn; lý do "sao chép là chạy" không còn cần.

## Các lựa chọn

| Lựa chọn | Ưu | Nhược |
|---|---|---|
| A. Giữ khóa mẫu trong `.env.example` | Clone về chạy ngay | Khóa đang chạy nằm trên Git |
| B. **Để trống 5 biến bí mật, biến không bí mật giữ mặc định** | Không khóa nào trên Git; đúng cách làm production | Máy mới phải tự sinh 5 khóa |
| C. Để trống cả 14 biến | Tối giản | Phải tự nhớ cả giá trị không bí mật (TTL, ngưỡng) — vô ích |

## Quyết định

Chọn **B**. Biến bí mật: `DB_PASSWORD`, `JWT_SECRET`, `CUSTOMER_DATA_KEY`, `DRIVER_DATA_KEY`, `PAYMENT_CALLBACK_SECRET`. Giá trị thật sinh ngẫu nhiên, chỉ nằm trong `.env` (`.gitignore` chặn). Sinh khóa 32 byte:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`PAYMENT_CALLBACK_SECRET` đặt ngắn để gõ tay ở mục 19. Test e2e và Postman không ghi cứng khóa: test đọc từ `.env`, Postman dùng biến `{{cb_secret}}` (file environment trên Git để trống).

## Đánh đổi

- Máy mới (clone) phải sinh 5 khóa trước khi `docker compose up`; thiếu khóa thì service không khởi động và log nêu tên biến.
- Mất `.env` = mất khóa: dữ liệu đã mã hóa không giải được, phải `docker compose down -v` để seed lại; token cũ mất hiệu lực. Giữ một bản sao `.env` ngoài Git.
- Khóa mẫu cũ vẫn còn trong lịch sử Git nhưng không còn dùng ở đâu. Nguyên tắc: **lộ khóa thì đổi khóa**, xóa commit không đủ.

## Ngoài thực tế (để trả lời vấn đáp)

Giá trị bí mật không bao giờ nằm trong repo: máy dev dùng `.env` riêng; CI/CD dùng GitHub Secrets; server dùng Docker secrets / Kubernetes Secret / Vault / Secrets Manager; mỗi môi trường (dev, staging, production) một bộ khóa; quét bí mật trước khi commit (gitleaks, GitHub Secret Scanning).
