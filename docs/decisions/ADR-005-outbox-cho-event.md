# ADR-005 — Phát event Kafka qua outbox

- Ngày: 2026-10-02. Trạng thái: **Đề xuất — giả định tạm GĐ-6**, chờ câu trả lời Q20. Sửa 2026-10-02 theo danh sách 8 service: đổi tên service và topic; quyết định không đổi.
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` mục 6.3; NFR14, NFR15; BRULE07, BRULE08; mục chấm 7, 15, 16, 19.

## Bối cảnh

Bốn service phát event: `booking-service`, `trip-service`, `payment-service`, `driver-service`. Mỗi lần phát gồm hai việc ở hai hệ thống khác nhau: ghi database và gửi Kafka. Không có giao dịch chung cho cả hai. NFR14 yêu cầu dữ liệu Booking, Trip, Payment nhất quán "đặc biệt khi xảy ra lỗi hoặc mất kết nối".

Từ khi Booking và Trip là hai service, việc bàn giao giữa chúng đi bằng event `booking.driver-assigned` (ADR-007), nên mất event này là mất cả chuyến.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Ghi database, commit, rồi gửi Kafka | Đơn giản nhất | Service chết hoặc Kafka mất kết nối giữa hai bước → event mất vĩnh viễn: tài xế đã nhận mà không có Trip, chuyến không được tính cước |
| B | Gửi Kafka trước, ghi database sau | — | Có thể phát event cho một thay đổi không bao giờ được lưu; tệ hơn A |
| C | **Outbox:** ghi event vào bảng `outbox` trong cùng giao dịch với thay đổi nghiệp vụ; tiến trình nền đọc bảng và gửi Kafka, gửi xong đánh dấu | Thay đổi và event cùng thành công hoặc cùng thất bại; Kafka dừng thì event nằm chờ, có lại thì gửi tiếp | Thêm một bảng và một tiến trình nền cho mỗi service phát event; event có thể bị gửi hai lần |
| D | A + tác vụ quét định kỳ tìm bản ghi bị kẹt | Không cần bảng outbox | Phải viết logic quét riêng cho từng loại kẹt; dễ sót |

## Quyết định (tạm)

Chọn **C** cho cả bốn service phát event.

## Vì sao

1. Ba event mà mất là hỏng nghiệp vụ: `booking.driver-assigned` (FR11 — tài xế đã bị giữ ở trạng thái bận nhưng không có Trip), `trip.status-changed` lúc hoàn thành (BRULE08 — không tính cước, tài xế không được trả về rảnh), `booking.no-driver-found` (BRULE07 — khách không được báo).
2. Trả lời trực tiếp NFR14 và NFR15 khi vấn đáp: "Kafka dừng thì sao?" — event nằm trong outbox, không mất.
3. Outbox gửi lặp là chấp nhận được vì mọi consumer đã phải chịu message lặp (bảng 6.2 của file 02).

## Đánh đổi

- Mỗi service phát event thêm một bảng `outbox` (file 03) và một vòng lặp nền — bốn lần cùng một đoạn code.
- Event đến trễ hơn một nhịp quét (đề xuất dưới 1 giây). Nhịp này cộng vào độ trễ tạo Trip sau khi tài xế nhận chuyến (ADR-007).
- Nhiều thứ hơn để sinh viên phải giải thích.

## Phương án rút gọn nếu thiếu thời gian

Dùng C cho `booking-service`, `trip-service` và `payment-service` (nơi mất event là mất chuyến, mất tiền hoặc kẹt tài xế); dùng A cho `driver-service` (chỉ phát `driver.application-reviewed`, mất thì tài xế thiếu một thông báo), ghi rõ rủi ro đã chấp nhận. Không dùng A cho tất cả mà không ghi rủi ro.
