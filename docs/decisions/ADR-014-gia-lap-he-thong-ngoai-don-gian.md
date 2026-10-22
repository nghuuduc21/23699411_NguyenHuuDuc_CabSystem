# ADR-014 — Giả lập hệ thống ngoài ở mức đơn giản nhất

- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — góp ý của giảng viên ngày 2026-10-03, ghi trong `CLAUDE.md` dòng "Hệ thống ngoài". Chi tiết hiện thực (tên biến, tên field, mã lỗi) là BA đề xuất.
- Liên quan: `docs/design/02` mục 4.1 (C2), 4.5, 8.2; `docs/design/03` mục 8.4, 9, 13; `docs/design/04` A07, A31, A32, mục 2.6, 5; `docs/design/05` SW14, QT05, QT10, QT16, QT17; NFR13; FR18, FR19, FR39, FR40, FR21–FR24; mục chấm 19, 21, 30. Đóng Q43, Q50, Q57 (bổ sung `MANUAL`, sinh viên chốt 2026-10-03); ảnh hưởng Q42.

## Bối cảnh

SRS có ba hệ thống ngoài: Payment Provider, Map / GPS Provider, Notification Provider (kèm kênh gửi OTP). Thiết kế trước giả lập sau adapter nhưng còn phần phức tạp: callback thanh toán ký HMAC-SHA256 trên nguyên văn body, Postman phải tự tính chữ ký trong script; Gateway phải chuyển nguyên byte body. Giảng viên yêu cầu **giả lập thật đơn giản để dễ chấm và dễ chạy**. Mỗi mục chấm chỉ có khoảng 30 giây.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Container giả lập riêng cho mỗi Provider (HTTP server) | Giống tích hợp thật nhất | Thêm container ngoài 8 service; thêm đường mạng; khó chạy |
| B | Adapter trong service; callback do Postman gửi, ký HMAC (thiết kế trước) | Thấy rõ bước callback; chứng minh body không bị sửa | Postman phải tính chữ ký; Gateway phải giữ nguyên byte body; dễ sai khi demo |
| C | **Adapter trong service, trả kết quả ngay; callback thanh toán đi qua cùng một hàm xử lý; endpoint callback giữ lại, xác thực bằng khóa bí mật cố định trong header** | Không có bước chờ; Postman không tính gì; một hàm xử lý cho mọi callback nên replay hoạt động giống nhau | Không chứng minh tính toàn vẹn của body; callback ở mục 19 là lần hai |

## Quyết định

Chọn **C**.

| Hệ thống ngoài | Adapter ở | Giả lập |
|---|---|---|
| Cổng thanh toán — thu | `payment-service` | A31 tạo lần thử → adapter sinh `provider_transaction_id` → gọi ngay hàm xử lý callback, mặc định `SUCCESS`. `simulate_result` trong body A31 chỉ có hiệu lực khi `SIMULATION_MODE=true`: `FAILED` → callback thất bại; **`MANUAL`** → adapter **không** gọi callback, giao dịch và Payment đứng `PENDING` đến khi A32 tới (bổ sung 2026-10-03, Q57) |
| Cổng thanh toán — hoàn | `payment-service` | Gọi ngay hàm xử lý kết quả, luôn thành công |
| Callback từ ngoài (A32) | `gateway` → `payment-service` | Giữ để demo mục 19, 30. Header `X-Callback-Secret` = `PAYMENT_CALLBACK_SECRET`, so sánh thời gian hằng; sai / thiếu → 401 `INVALID_CALLBACK_SECRET`. **Bỏ HMAC**. Giao dịch `PENDING` (sau `MANUAL`) → xử lý, Payment `PENDING → COMPLETED` / `FAILED`. Giao dịch đã có kết quả → trả response đã lưu, `Idempotency-Replayed: true` |
| Bản đồ | `booking-service` (quãng đường), `driver-service` (tìm quanh tọa độ, SQL) | Công thức Haversine; quãng đường ước tính × 1,3 |
| Thông báo, SMS | `notification-service` | Chỉ lưu vào database và ghi một dòng log; bỏ field `status` của thông báo |
| OTP | `auth-service` | Ghi log mã; `SIMULATION_MODE=true` thì trả `otp` trong response A07 |

Biến môi trường: `SIMULATION_MODE` (auth, payment; từ 2026-10-03 cũng bật chạy seed ở mọi service có seed, thay `SEED_ON_START`; `true` trong `.env.example`, phải `false` khi chạy thật), `PAYMENT_CALLBACK_SECRET` (payment; bí mật, để trống trong `.env.example`, đặt giá trị ngắn trong `.env` — ADR-022). Mã giao dịch giả lập theo quy luật `SIM-<payment_id>-<attempt_no>` để gõ tay được (`docs/design/03` mục 8.4).

## Vì sao

1. **30 giây mỗi mục chấm**: luồng mặc định chỉ cần A19 → A31 là đã `COMPLETED`; không script tính chữ ký, không chờ. Mục 19 dùng `MANUAL` để thấy rõ bước "nhận callback → COMPLETED". Sửa 2026-10-03 theo luật thi (Postman không lưu sẵn biến, tối đa khoảng 3 request): dùng booking seed **B7** (đang chờ thanh toán, payment 7): A31 `MANUAL` cho payment 7 (`PENDING`, `txn_id` = `SIM-7-1`) → A32 callback với header `X-Callback-Secret:<khóa trong .env>` (response trả luôn trạng thái `COMPLETED`) — 2 request, tùy chọn thêm A30 để xem (`docs/design/03` mục 14, D17; chuỗi chi tiết ở file 04 / kịch bản thi).
2. **Một hàm xử lý callback** cho cả đường nội bộ và A32: chống lặp theo `provider_transaction_id` và `callback_response` dùng chung, nên mục 30 chứng minh được cho cả hai đường.
3. **NFR13 vẫn giữ**: nghiệp vụ chỉ gọi adapter; nối Provider thật thì thay adapter (thêm HMAC hoặc chữ ký của Provider), không sửa luồng Payment.
4. Không thêm container, không thêm đường giao tiếp giữa 8 service.

## Đánh đổi

- Không chứng minh được tích hợp thật.
- Khóa cố định trong header không chống được việc sửa body như HMAC; lộ khóa là giả được callback. Chấp nhận cho môi trường học tập; chỉ Gateway mở ra ngoài.
- Luồng mặc định: adapter đã xử lý callback trong A31, nên A32 gửi sau đó là **callback lần hai** (trả kết quả cũ). Để người chấm thấy callback từ ngoài làm đổi trạng thái, đã thêm `simulate_result: "MANUAL"` (Q57, 2026-10-03): không thêm trạng thái, bảng hay đường giao tiếp; chỉ thêm một nhánh "không gọi callback" trong adapter. Đánh đổi: mục 19 dài thêm một request; một lần thử `MANUAL` bị bỏ dở chặn lần thử mới (409 `PAYMENT_IN_PROGRESS`) cho đến khi có callback hoặc thanh toán hết hạn; response replay của A31 ở mục 30 ghi `PENDING` (response lần đầu), trạng thái thật xem bằng A30.
- `SIMULATION_MODE` bật mà đem chạy thật thì OTP lộ trong response và ai cũng làm thanh toán thất bại được: phải tắt; service ghi cảnh báo khi khởi động nếu đang bật.
- Adapter hoàn tiền luôn thành công nên nhánh lỗi hoàn tiền (Q42) không demo được.

## Câu trả lời mẫu khi vấn đáp

"Cổng thanh toán em giả lập bằng một module ngay trong payment-service: nhận yêu cầu thu là gọi luôn phần xử lý callback, mặc định thành công, nên đặt xe xong trả tiền là có kết quả ngay. Endpoint callback em vẫn giữ để chứng minh hệ thống nhận được callback từ bên ngoài; nó xác thực bằng một khóa bí mật trong header, và đi qua đúng hàm xử lý đó, nên gửi lại bao nhiêu lần cũng chỉ trả kết quả cũ, không thu tiền hai lần. Khi demo mục 19 em gửi thêm tham số `MANUAL` để module giả lập không tự callback: thanh toán đứng ở PENDING, em đóng vai cổng thanh toán gửi callback từ Postman, lúc đó thanh toán mới chuyển COMPLETED. Bản đồ em dùng công thức khoảng cách, thông báo thì chỉ lưu database và ghi log, OTP ghi log và trả trong response khi bật chế độ giả lập. Muốn nối nhà cung cấp thật thì chỉ thay adapter."

## Điều kiện xem lại

Giảng viên yêu cầu tích hợp Provider thật hoặc yêu cầu chữ ký callback. (Yêu cầu "callback từ ngoài là callback đầu tiên ở mục 19" đã được đáp ứng bằng `MANUAL` — Q57 đóng 2026-10-03.)
