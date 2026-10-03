# ADR-005 — Phát event Kafka qua outbox

- Ngày: 2026-10-02. Trạng thái: **Bị thay thế bởi ADR-017** (2026-10-03). Theo luật thi, sinh viên chốt gửi event ngay sau commit, không outbox (`CLAUDE.md` dòng "Phát event Kafka"); 4 bảng `outbox` và `OUTBOX_POLL_INTERVAL_MS` đã bỏ khỏi `docs/design/03`. File này giữ lại để giải thích phương án "không mất event" khi vấn đáp và làm phương án quay lại.
- Lịch sử: đề xuất (giả định GĐ-6, chờ Q20); sửa 2026-10-02 lần 3: danh sách event và hậu quả đổi theo luồng trả trước, hoàn tiền (ADR-009) và bàn giao bằng gRPC (ADR-008).
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` mục 6.3; NFR14, NFR15; BRULE07, BRULE13, BRULE14; mục chấm 7, 15, 18, 19.

## Bối cảnh

Bốn service phát event: `booking-service`, `trip-service`, `payment-service`, `driver-service`. Mỗi lần phát gồm hai việc ở hai hệ thống khác nhau: ghi database và gửi Kafka. Không có giao dịch chung cho cả hai. NFR14 yêu cầu dữ liệu Booking, Trip, Payment nhất quán "đặc biệt khi xảy ra lỗi hoặc mất kết nối".

Từ khi thanh toán là trả trước, event mang theo **tiền**: mất event kết quả thanh toán thì khách đã trả mà không được tìm tài xế; mất event hủy thì khách không được hoàn tiền.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Ghi database, commit, rồi gửi Kafka | Đơn giản nhất | Service chết hoặc Kafka mất kết nối giữa hai bước → event mất vĩnh viễn |
| B | Gửi Kafka trước, ghi database sau | — | Có thể phát event cho một thay đổi không bao giờ được lưu; tệ hơn A |
| C | **Outbox:** ghi event vào bảng `outbox` trong cùng giao dịch với thay đổi nghiệp vụ; tiến trình nền đọc bảng và gửi Kafka, gửi xong đánh dấu | Thay đổi và event cùng thành công hoặc cùng thất bại; Kafka dừng thì event nằm chờ | Thêm một bảng và một tiến trình nền cho mỗi service phát event; event có thể bị gửi hai lần |
| D | A + tác vụ quét định kỳ tìm bản ghi bị kẹt | Không cần bảng outbox | Phải viết logic quét riêng cho từng loại kẹt; dễ sót |

## Quyết định (tạm, đã bị thay thế)

~~Chọn **C** cho cả bốn service phát event.~~ Từ 2026-10-03 chọn **A** — xem ADR-017 (lý do, đánh đổi, câu trả lời mẫu).

## Vì sao

1. Các event mà mất là hỏng nghiệp vụ:

| Event | Mất thì |
|---|---|
| `payment.status-changed` (`COMPLETED`) | Khách đã trả tiền nhưng Booking chờ thanh toán mãi (BRULE13, AC21) |
| `booking.canceled`, `booking.no-driver-found`, `trip.status-changed` (`CANCELED`) | Chuyến không thực hiện mà không hoàn tiền (BRULE14, AC22) |
| `trip.status-changed` (`COMPLETED`) | Tiền mặt không được ghi nhận (FR17); tài xế kẹt ở trạng thái bận (BRULE01) |
| `booking.no-driver-found` | Khách không được báo (BRULE07) |

2. Trả lời trực tiếp NFR14 và NFR15 khi vấn đáp: "Kafka dừng thì sao?" — event nằm trong outbox, không mất.
3. Outbox gửi lặp là chấp nhận được vì mọi consumer đã phải chịu message lặp (bảng 6.2 của file 02).

## Đánh đổi

- Mỗi service phát event thêm một bảng `outbox` (file 03) và một vòng lặp nền — bốn lần cùng một đoạn code.
- Event đến trễ hơn một nhịp gửi. Sửa 2026-10-02 lần 4 theo "Ràng buộc khi chấm" trong `CLAUDE.md` (event phải được xử lý trong khoảng một giây): tiến trình gửi được **đánh thức ngay sau khi giao dịch commit**; quét định kỳ (`OUTBOX_POLL_INTERVAL_MS`, đề xuất 200 ms) chỉ là lưới an toàn cho event còn sót. Chuỗi dài nhất là callback → `payment.status-changed` → Booking → `booking.offer-created` (hai nhịp). Cấu trúc bảng `outbox`: file 03 mục 11.3.
- Thêm một event mang tiền kể từ BRULE17: `payment.status-changed` (`CANCELED` do quá hạn / hết lượt); mất thì Booking chờ thanh toán mãi.
- Nhiều thứ hơn để sinh viên phải giải thích.

## Phương án rút gọn nếu thiếu thời gian

Dùng C cho `booking-service`, `trip-service` và `payment-service` (nơi mất event là mất tiền hoặc kẹt tài xế); dùng A cho `driver-service` (chỉ phát `driver.application-reviewed`, mất thì tài xế thiếu một thông báo), ghi rõ rủi ro đã chấp nhận. Không dùng A cho tất cả mà không ghi rủi ro.
