# ADR-017 — Gửi event Kafka ngay sau khi commit, không dùng outbox

- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — ghi trong `CLAUDE.md` dòng "Phát event Kafka". **Thay ADR-005** (outbox).
- Liên quan: `docs/design/02` mục 6.3, 6.4, 11.1 (GĐ-6), 12.1 (Q20); `docs/design/03` mục 1.1, 11.1, 11.3, 13; NFR14, NFR15; BRULE13, BRULE14; mục chấm 7, 15–19.

## Bối cảnh

Bốn service phát event: `booking-service`, `trip-service`, `payment-service`, `driver-service`. Ghi database và gửi Kafka là hai hệ thống, không có giao dịch chung. ADR-005 chọn outbox: thêm 4 bảng `outbox`, 4 tiến trình nền, biến `OUTBOX_POLL_INTERVAL_MS`. Luật thi (2026-10-03): không mở tài liệu, phải tự giải thích mọi thứ; thứ gì không phục vụ mục chấm hoặc không giải thích được thì bỏ. Không mục chấm nào kiểm tra "Kafka dừng giữa chừng".

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Commit, rồi gửi Kafka ngay trong cùng request** | Ít bảng, không tiến trình nền, event đến ngay | Service hoặc Kafka dừng đúng giữa hai bước → mất event |
| B | Gửi Kafka trước, commit sau | — | Có thể phát event cho thay đổi không được lưu; tệ hơn A |
| C | Outbox (ADR-005) | Không mất event | Thêm 4 bảng, 4 tiến trình nền, một khái niệm phải giải thích; event trễ một nhịp |

## Quyết định

Chọn **A**.

| Điểm | Thiết kế |
|---|---|
| Thứ tự | Ghi database (commit) → gửi Kafka (producer thử lại tối đa 3 lần, tổng ≤ 1 giây — hằng số trong code) → trả response |
| Gửi thất bại sau commit | Không hoàn tác; vẫn trả thành công; log `error` mã `EVENT_PUBLISH_FAILED` kèm topic, key (không dữ liệu cá nhân) |
| Bên nghe | Vẫn phải chịu được event lặp (producer thử lại có thể gửi hai lần): chống lặp bằng trạng thái nghiệp vụ hoặc UNIQUE (`docs/design/03` mục 11.3) |
| Đã bỏ | 4 bảng `outbox`, tiến trình gửi nền, `OUTBOX_POLL_INTERVAL_MS` |

## Vì sao

1. Ít thứ phải giải thích: không bảng phụ, không tiến trình chạy nền.
2. Event đến trong khoảng một giây, đúng "Ràng buộc khi chấm".
3. Khe hở chỉ mở khi có sự cố **đúng** thời điểm giữa commit và gửi; không xảy ra trong demo.

## Đánh đổi

Event mất thì hỏng nghiệp vụ, cần xử lý tay theo log:

| Event mất | Hậu quả |
|---|---|
| `payment.status-changed` (`COMPLETED`) | Khách đã trả, Booking chờ thanh toán mãi (BRULE13) |
| `booking.canceled`, `booking.no-driver-found`, `trip.status-changed` (`CANCELED`) | Không hoàn tiền (BRULE14) |
| `trip.status-changed` (`COMPLETED`) | Tiền mặt không được ghi nhận; tài xế kẹt bận |

NFR14, NFR15 chỉ đáp ứng ở mức "bên nghe chịu được event lặp", **không** đáp ứng "không mất event khi sự cố". Phải nói rõ khi vấn đáp.

## Câu trả lời mẫu khi vấn đáp

"Service ghi database xong thì gửi event ngay, không dùng bảng outbox. Em chấp nhận rủi ro: nếu service chết đúng giữa lúc ghi xong và lúc gửi thì event bị mất, ví dụ khách đã trả tiền mà booking không chuyển sang tìm tài xế; khi đó phải xử lý tay theo log. Muốn không mất event thì dùng outbox: ghi event vào một bảng trong cùng giao dịch rồi tiến trình nền gửi đi. Em không làm vì thêm bốn bảng và bốn tiến trình nền mà không mục chấm nào cần. Bên nhận vẫn chống lặp vì Kafka có thể giao một event hai lần."

## Điều kiện xem lại

Giảng viên hỏi hoặc chấm trường hợp Kafka / service dừng giữa chừng; khi đó quay lại ADR-005.
