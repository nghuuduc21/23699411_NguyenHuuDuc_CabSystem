# ADR-004 — Đăng ký khách hàng: Auth gọi đồng bộ sang Customer

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** (2026-10-02) — ghi trong `CLAUDE.md`, mục "Quyết định kỹ thuật đã chốt". Đóng câu hỏi Q3 và giả định GĐ-1.
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` đường S1, mục 8.1; `docs/design/01-bounded-contexts.md` quy tắc A8, C1; ADR-001; FR26, FR27; NFR05, NFR14; mục chấm 9, 11.
- Khác thiết kế tham chiếu: bản đã duyệt **không vẽ** đường Auth → Customer; S1 là đường thiết kế này thêm vào (file 02, mục 10.1).

## Bối cảnh

ADR-001 tách Auth và Customer. Đăng ký một khách hàng phải tạo hai thứ ở hai service: Account (Auth) và CustomerProfile (Customer). Điều kiện bắt buộc: mục chấm 11 (xem khách hàng theo mã) phải chạy được **ngay sau** mục chấm 9 (đăng ký).

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Auth tạo tài khoản rồi phát event; Customer nghe và tạo hồ sơ | Đăng ký không phụ thuộc Customer | Hồ sơ có thể đến trễ: gọi mục 11 ngay sau mục 9 có thể nhận 404. Event mất thì có tài khoản không hồ sơ |
| B | **Auth gọi gRPC `CreateProfile` sang Customer trong lúc đăng ký; không tạo được hồ sơ thì không có tài khoản** | Đăng ký trả về thành công thì hồ sơ chắc chắn đã có | Đăng ký phụ thuộc Customer đang chạy |
| C | Gateway gọi lần lượt Auth rồi Customer | Hai service không biết nhau | Gateway chứa logic điều phối và hoàn tác — trái `CLAUDE.md` |
| D | Không tạo hồ sơ lúc đăng ký; tạo khi khách cập nhật lần đầu | Không có đường nối | Mục 11 trả 404 cho khách vừa đăng ký |

## Quyết định

Chọn **B**.

## Vì sao

1. **Đồng bộ là mặc định** (nguyên tắc của giảng viên trong `CLAUDE.md`), và ở đây không có lý do nào buộc phải bất đồng bộ: Auth **cần** biết hồ sơ đã tạo xong mới được báo "đăng ký thành công" (quy tắc A8, C1).
2. Là phương án duy nhất trong A, B, D đảm bảo mục 11 chạy ngay sau mục 9 mà không đưa logic vào Gateway.
3. Auth và Customer không cần Kafka: bớt hai service phải nối broker — khớp thiết kế tham chiếu ở điểm này.

## Đánh đổi

- **Customer dừng thì không đăng ký khách mới được** (trả 503). Đăng nhập, đặt xe và mọi chức năng khác vẫn chạy.
- Họ tên của khách đi ngang qua Auth để chuyển sang Customer. Auth không lưu, không ghi log.
- Hai lần ghi ở hai database không nằm chung một giao dịch. Khóa chính là UUID nên Auth sinh `account_id` trước, gọi `CreateProfile` rồi mới lưu Account. Khe hở còn lại: hồ sơ đã tạo nhưng Auth lỗi khi lưu tài khoản → hồ sơ mồ côi, vô hại vì không tài khoản nào trỏ tới; `CreateProfile` gọi lặp được theo `account_id` (C1).
- Thứ tự cụ thể để spec mục 9 chốt.

## Câu trả lời mẫu khi vấn đáp

"Đăng ký khách chạm hai service vì tài khoản và hồ sơ là hai context. Em cho Auth gọi gRPC sang Customer vì Auth phải biết hồ sơ đã có mới báo thành công; nếu dùng Kafka thì xem hồ sơ ngay sau khi đăng ký có thể ra 404. Đánh đổi là Customer lỗi thì không đăng ký được."
