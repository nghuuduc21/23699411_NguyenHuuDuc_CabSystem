# ADR-007 — Giao tiếp quanh Booking, Trip, Rating: giữ chỗ tài xế bằng gRPC, đánh giá hỏi Trip bằng gRPC

- Ngày: 2026-10-02. Sửa 2026-10-02 lần 3. Tên file giữ nguyên (`…-review.md`) để không gãy liên kết; service nay tên `rating-service`.
- Trạng thái từng phần:

| Quyết định | Trạng thái |
|---|---|
| 1 — Giữ chỗ tài xế: Booking → Driver gRPC `ReserveDriver` | **Đề xuất**, khớp nguyên tắc "đồng bộ là mặc định" trong `CLAUDE.md`; chưa được xác nhận riêng |
| 2 — Bàn giao Booking → Trip bằng event | **Bị thay thế bởi ADR-008** (gRPC `CreateTrip`, đã chốt trong `CLAUDE.md`) |
| 3 — Rating hỏi Trip bằng gRPC `GetTripForRating` | **Đề xuất**, khớp nguyên tắc "đồng bộ là mặc định"; chưa được xác nhận riêng. Khác thiết kế tham chiếu (review nghe event) |
| 4 — Trip và Payment chỉ nối bằng event | **Đã chấp nhận**: `CLAUDE.md` chốt Payment nghe event hủy và event hoàn thành. Nội dung đổi theo ADR-009 |

- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` đường S3, S7, K5, mục 10.1; ADR-005, ADR-006, ADR-008, ADR-009; FR07, FR17, FR25, FR40; BRULE01, BRULE11, BRULE14; NFR05, NFR14; mục chấm 16, 17, 18, 20.

## Bối cảnh

ADR-006 vạch ba ranh giới. Mỗi ranh giới cần một quyết định "đồng bộ hay bất đồng bộ", theo nguyên tắc của giảng viên trong `CLAUDE.md`: **gRPC là mặc định**; Kafka chỉ khi bên phát không được chờ, không được thất bại theo bên nhận, hoặc nhiều bên cùng cần biết.

## Quyết định 1 — Tài xế nhận chuyến: Booking gọi gRPC `ReserveDriver` sang Driver

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Booking tự ghi phân công, phát event; Driver nghe và chuyển tài xế sang bận | Không phụ thuộc đồng bộ | Trong lúc event chưa tới, tài xế vẫn hiện là rảnh và có thể nhận chuyến thứ hai |
| B | **Booking gọi `ReserveDriver(driver_id, booking_id)`; Driver đổi Online → bận nếu còn rảnh; thành công mới làm tiếp** | Một nơi duy nhất quyết định "tài xế còn rảnh" — chính nơi giữ trạng thái đó. BRULE01 được kiểm tra đúng lúc nhận | Nhận chuyến phụ thuộc Driver đang chạy; có khe hở khi lỗi sau khi giữ chỗ |

Chọn **B**. Lý do: tài xế đang chờ câu trả lời, và Booking **không được** xác nhận phân công khi chưa chắc tài xế còn rảnh (BRULE01, NFR14). Kèm theo `ReleaseDriver` để nhả chỗ khi không tạo được chuyến (ADR-008).

Trả tài xế về rảnh **sau chuyến** thì Driver nghe `trip.status-changed` (giả định GĐ-14, Q41): sự kiện này Payment và Notification cũng cần nên topic đằng nào cũng có, và việc kết thúc chuyến không được lỗi theo Driver.

## Quyết định 2 — Bàn giao Booking → Trip

Bản trước chọn event `booking.driver-assigned`. **Không còn hiệu lực.** Xem ADR-008.

## Quyết định 3 — Rating kiểm tra chuyến: gRPC hỏi Trip

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Rating gọi `GetTripForRating(trip_id)` mỗi lần có đánh giá** | Luôn là sự thật mới nhất; Rating không giữ bản sao dữ liệu chuyến; Rating không cần Kafka | Trip dừng thì không đánh giá được (trả 503) |
| B | Rating nghe `trip.status-changed` (hoàn thành), lưu bảng "chuyến được phép đánh giá" — cách của thiết kế tham chiếu | Đánh giá được cả khi Trip dừng | Thêm một bảng sao chép và một consumer; đánh giá ngay sau khi hoàn thành có thể bị từ chối vì event chưa tới |

Chọn **A**. Lý do: Rating phải biết ngay "chuyến hoàn thành chưa, của ai" để nhận hay từ chối (BRULE11); không có lý do nào buộc phải bất đồng bộ. Đánh giá không phải chức năng sống còn: Trip dừng mà tạm không đánh giá được thì không vi phạm NFR05.

## Quyết định 4 — Trip và Payment: chỉ event, không gRPC

Thiết kế tham chiếu có gRPC "validate completed trip" giữa Trip và Payment vì ở đó thanh toán diễn ra **sau** chuyến. Ở đây thanh toán diễn ra **trước** (ADR-009), nên:

| Payment cần gì từ Trip | Cách | Vì sao không gRPC |
|---|---|---|
| Biết chuyến hoàn thành → ghi nhận tiền mặt (FR17) | Nghe `trip.status-changed` | Hoàn thành chuyến không được lỗi theo Payment (NFR05) |
| Biết chuyến bị hủy → hoàn tiền (FR40, BRULE14) | Nghe `trip.status-changed` | Hủy chuyến không được lỗi theo Payment (NFR05) |

Trip không cần gì từ Payment: không quy tắc nào của Trip phụ thuộc trạng thái tiền.

## Đánh đổi

- **Khe hở khi giữ chỗ** (quyết định 1): Driver đã chuyển tài xế sang bận nhưng bước sau lỗi → tài xế kẹt bận. Xử lý: `ReserveDriver` gọi lặp được nên tài xế bấm nhận lại; Offer hết hạn mà chưa phân công thì Booking gọi `ReleaseDriver` (Q35).
- **Đánh giá phụ thuộc Trip** (quyết định 3).
- **Tiền mặt được ghi nhận và tiền được hoàn sau sự việc một nhịp** (quyết định 4); mất event là mất khoản hoàn. Từ 2026-10-03 không dùng outbox: gửi event ngay sau commit, rủi ro này được chấp nhận (ADR-017, thay ADR-005).
- Quyết định 3 và 4 **khác thiết kế đã được duyệt**; sinh viên phải nói được bảng 10.1 của file 02 khi vấn đáp.

## Điều kiện xem lại

- Giảng viên trả lời Q41 là "Trip gọi gRPC sang Driver" → sửa các dòng ghi ở GĐ-14 (file 02, mục 11).
- Việc xử lý khe hở giữ chỗ tốn công hơn lợi ích → đổi quyết định 1 sang A và chấp nhận rủi ro một tài xế bị mời thừa.
