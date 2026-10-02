# ADR-004 — Đăng ký khách hàng: Auth gọi đồng bộ sang Customer

- Ngày: 2026-10-02. Trạng thái: **Đề xuất — giả định tạm GĐ-1**, chờ câu trả lời Q3 (nên hỏi giảng viên). Rà lại 2026-10-02 sau khi chốt 8 service: còn đúng, không đổi nội dung. Lưu ý khi hỏi: thiết kế tham chiếu đã duyệt **không vẽ** đường Auth → Customer và cũng để hai service này ngoài message broker; đường S1 là điểm thiết kế này thêm vào (file 02, mục 10.1).
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` đường S1, mục 8.1; ADR-001; FR26, FR27; NFR05, NFR14; mục chấm 9, 11.

## Bối cảnh

ADR-001 tách Auth và Customer. Đăng ký một khách hàng giờ phải tạo hai thứ ở hai service: Account (Auth) và CustomerProfile (Customer). Điều kiện bắt buộc: mục chấm 11 (xem khách hàng theo mã) phải chạy được **ngay sau** mục chấm 9 (đăng ký).

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Auth tạo tài khoản rồi phát event; Customer nghe và tạo hồ sơ | Đăng ký không phụ thuộc Customer | Hồ sơ có thể đến trễ: gọi mục 11 ngay sau mục 9 có thể nhận 404. Event mất thì có tài khoản không hồ sơ |
| B | **Auth gọi gRPC `CreateProfile` sang Customer trong lúc đăng ký; lỗi thì hoàn tác tài khoản** | Đăng ký trả về thành công thì hồ sơ chắc chắn đã có | Đăng ký phụ thuộc Customer đang chạy |
| C | Gateway gọi lần lượt Auth rồi Customer | Hai service không biết nhau | Gateway chứa logic điều phối và hoàn tác — trái `CLAUDE.md` |
| D | Không tạo hồ sơ lúc đăng ký; tạo khi khách cập nhật lần đầu | Không có đường nối | Mục 11 trả 404 cho khách vừa đăng ký |

## Quyết định (tạm)

Chọn **B**.

## Vì sao

1. Theo quy tắc trong `CLAUDE.md`: gRPC giữa hai service chỉ khi bên gọi cần kết quả ngay. Ở đây Auth **cần** biết hồ sơ đã tạo xong mới được báo "đăng ký thành công", vì quy tắc C1 (mỗi tài khoản khách có đúng một hồ sơ).
2. Là phương án duy nhất trong A, B, D đảm bảo mục 11 chạy ngay sau mục 9 mà không đưa logic vào Gateway.
3. Không cần Kafka cho Auth và Customer: bớt hai service phải nối Kafka.

## Đánh đổi

- **Customer dừng thì không đăng ký khách mới được** (trả 503). Đăng nhập, đặt xe và mọi chức năng khác vẫn chạy, nên NFR05 chỉ bị ảnh hưởng ở đúng một chức năng.
- Họ tên của khách đi ngang qua Auth để chuyển sang Customer. Auth không lưu, không ghi log.
- Còn một khe hở hẹp: Customer đã tạo hồ sơ nhưng Auth lỗi khi lưu tài khoản → hồ sơ mồ côi. `CreateProfile` phải gọi lặp được theo `account_id`; hồ sơ mồ côi không gây sai nghiệp vụ vì không tài khoản nào trỏ tới.
- Thứ tự cụ thể (giữ giao dịch mở trong lúc gọi, hay tạo rồi xóa bù) để spec mục 9 quyết định.

## Điều kiện xem lại

Nếu giảng viên muốn cặp Auth — Customer minh họa giao tiếp bất đồng bộ (bài mẫu của thầy có đúng cặp này) thì chuyển sang A và chấp nhận hồ sơ có độ trễ; khi đó sửa các dòng ghi ở GĐ-1, mục 11 của file 02.
