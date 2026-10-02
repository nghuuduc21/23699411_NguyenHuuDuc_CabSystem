# ADR-005 — Phát event Kafka qua outbox

- Ngày: 2026-10-02. Trạng thái: **Đề xuất — giả định tạm GĐ-6**, chờ câu trả lời Q20.
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` mục 6.3; NFR14, NFR15; BRULE07, BRULE08; mục chấm 7, 15, 19.

## Bối cảnh

Bốn service phát event: `ride-service`, `dispatch-service`, `payment-service`, `driver-service`. Mỗi lần phát gồm hai việc ở hai hệ thống khác nhau: ghi database và gửi Kafka. Không có giao dịch chung cho cả hai. NFR14 yêu cầu dữ liệu Booking, Trip, Payment nhất quán "đặc biệt khi xảy ra lỗi hoặc mất kết nối".

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Ghi database, commit, rồi gửi Kafka | Đơn giản nhất | Service chết hoặc Kafka mất kết nối giữa hai bước → event mất vĩnh viễn: booking treo ở "đang tìm", chuyến không được tính cước |
| B | Gửi Kafka trước, ghi database sau | — | Có thể phát event cho một thay đổi không bao giờ được lưu; tệ hơn A |
| C | **Outbox:** ghi event vào bảng `outbox` trong cùng giao dịch với thay đổi nghiệp vụ; tiến trình nền đọc bảng và gửi Kafka, gửi xong đánh dấu | Thay đổi và event cùng thành công hoặc cùng thất bại; Kafka dừng thì event nằm chờ, có lại thì gửi tiếp | Thêm một bảng và một tiến trình nền cho mỗi service phát event; event có thể bị gửi hai lần |
| D | A + tác vụ quét định kỳ tìm bản ghi bị kẹt | Không cần bảng outbox | Phải viết logic quét riêng cho từng loại kẹt; dễ sót |

## Quyết định (tạm)

Chọn **C** cho cả bốn service phát event.

## Vì sao

1. Ba event mà mất là hỏng nghiệp vụ: `booking.created` (BG01 — không ai đi tìm tài xế), `trip.status-changed` lúc hoàn thành (BRULE08 — không tính cước), `dispatch.no-driver-found` (BRULE07 — khách không được báo).
2. Trả lời trực tiếp NFR14 và NFR15 khi vấn đáp: "Kafka dừng thì sao?" — event nằm trong outbox, không mất.
3. Outbox gửi lặp là chấp nhận được vì mọi consumer đã phải chịu message lặp (bảng 6.2 của file 02).

## Đánh đổi

- Mỗi service phát event thêm một bảng `outbox` (file 03) và một vòng lặp nền — bốn lần cùng một đoạn code.
- Event đến trễ hơn một nhịp quét (đề xuất dưới 1 giây).
- Nhiều thứ hơn để sinh viên phải giải thích.

## Phương án rút gọn nếu thiếu thời gian

Dùng C cho `ride-service` và `payment-service` (nơi mất event là mất tiền hoặc treo chuyến); dùng A cho `dispatch-service` và `driver-service`, ghi rõ rủi ro đã chấp nhận. Không dùng A cho tất cả mà không ghi rủi ro.
