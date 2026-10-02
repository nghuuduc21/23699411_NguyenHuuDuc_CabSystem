# ADR-007 — Giao tiếp quanh Booking, Trip, Review: giữ chỗ bằng gRPC, bàn giao bằng event, đánh giá hỏi bằng gRPC

- Ngày: 2026-10-02. Trạng thái: **Đề xuất — giả định tạm GĐ-10, GĐ-12**, chờ Q33, Q34 (nên hỏi giảng viên vì khác thiết kế tham chiếu) và Q35.
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` đường S3, S5, K3, K6, mục 8.2, 8.4, 10.1; ADR-005, ADR-006; FR07, FR11, FR25; BRULE01, BRULE08, BRULE11; NFR05, NFR14; mục chấm 16, 17, 19, 20.

## Bối cảnh

ADR-006 vạch ba ranh giới mới. Mỗi ranh giới cần một quyết định "đồng bộ hay bất đồng bộ", theo quy tắc của giảng viên trong `CLAUDE.md`: gRPC chỉ khi bên gọi cần kết quả ngay mới làm tiếp được; Kafka cho sự kiện mà bên phát không cần chờ; không có lý do nghiệp vụ thì không nối.

Thiết kế tham chiếu vẽ bốn đường gRPC giữa các ô đứng cạnh nhau (customer–driver, driver–booking, booking–trip, trip–payment), không ghi chiều. ADR này xác định lại theo nghiệp vụ.

## Quyết định 1 — Tài xế nhận chuyến: Booking gọi gRPC `ReserveDriver` sang Driver

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Booking tự ghi phân công, phát event; Driver nghe và chuyển tài xế sang bận | Không phụ thuộc đồng bộ | Trong lúc event chưa tới, tài xế vẫn hiện là rảnh và có thể nhận chuyến thứ hai. Không nơi nào chặn chắc chắn |
| B | **Booking gọi `ReserveDriver(driver_id, booking_id)`; Driver đổi Online → bận nếu còn rảnh; thành công mới ghi phân công** | Một nơi duy nhất quyết định "tài xế còn rảnh" — chính nơi giữ trạng thái đó. BRULE01 được kiểm tra đúng lúc nhận | Nhận chuyến phụ thuộc Driver đang chạy; có khe hở khi Booking lỗi sau khi giữ chỗ |

Chọn **B**. Lý do: tài xế đang chờ câu trả lời, và Booking **không được** xác nhận phân công khi chưa chắc tài xế còn rảnh (BRULE01, NFR14) — đúng trường hợp "cần kết quả ngay". Trả tài xế về rảnh thì đi bằng event K6, vì lúc đó không ai chờ.

## Quyết định 2 — Bàn giao Booking → Trip: event `booking.driver-assigned`

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Booking phát event; Trip nghe và tạo Trip** | Booking không phụ thuộc Trip: Trip dừng thì tài xế vẫn nhận được chuyến, Trip tạo bù khi chạy lại. Cùng event đó Notification dùng để báo khách (FR22). Giống thiết kế tham chiếu (`driver.accepted`) | Trip có sau khi nhận một nhịp (dưới 1 giây khi dùng outbox). Câu trả lời "nhận chuyến" chưa có `trip_id` |
| B | Booking gọi gRPC `CreateTrip`, có `trip_id` rồi mới trả lời tài xế | Tài xế có `trip_id` ngay | Một thao tác phải thành công ở ba service (Driver, Trip, Booking); Trip dừng thì không ai nhận chuyến được; lỗi giữa chừng phải hoàn tác hai nơi |

Chọn **A**. Lý do: sau khi ghi phân công, Booking đã xong việc của mình và không cần kết quả nào từ Trip để trả lời tài xế — theo quy tắc thì đây là event. Mất event này là mất chuyến nên phải đi qua outbox (ADR-005).

Client lấy chuyến bằng `booking_id` (Trip có `booking_id` duy nhất). Nếu file 03 chọn khóa chính UUID (Q31), có thể để Booking sinh sẵn `trip_id` đưa vào event để tài xế có mã ngay — khi đó vẫn là phương án A.

## Quyết định 3 — Review kiểm tra chuyến: gRPC hỏi Trip

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Review gọi `GetTripForReview(trip_id)` mỗi lần có đánh giá** | Luôn là sự thật mới nhất; Review không giữ bản sao dữ liệu chuyến; Review không cần Kafka | Trip dừng thì không đánh giá được (trả 503) |
| B | Review nghe `trip.status-changed` (hoàn thành), lưu bảng "chuyến được phép đánh giá" — cách của thiết kế tham chiếu | Đánh giá được cả khi Trip dừng | Thêm một bảng sao chép và một consumer; đánh giá ngay sau khi hoàn thành có thể bị từ chối vì event chưa tới |

Chọn **A**. Lý do: Review phải biết ngay "chuyến hoàn thành chưa, của ai" để nhận hay từ chối (BRULE11) — đúng trường hợp gRPC. Đánh giá không phải chức năng sống còn: Trip dừng mà tạm không đánh giá được thì không vi phạm NFR05 (NFR05 bảo vệ luồng đặt xe).

## Quyết định 4 — Trip và Payment: chỉ event, không gRPC

Thiết kế tham chiếu vừa có gRPC "validate completed trip" giữa Trip và Payment, vừa cho Payment nghe `trip.status.changed`. Ở đây **chỉ giữ event** (K6).

Lý do: Payment tạo Fare **từ chính sự kiện hoàn thành**, nên "có Fare" đã là bằng chứng chuyến hoàn thành (quy tắc M1, BRULE08); hỏi lại bằng gRPC là nối cả hai kiểu cho cùng một việc. Thêm nữa, NFR05 nêu đích danh Payment: Payment không nên phụ thuộc đồng bộ vào Trip, và ngược lại.

## Đánh đổi

- **Khe hở khi giữ chỗ** (quyết định 1): Driver đã chuyển tài xế sang bận nhưng Booking lỗi trước khi ghi phân công → tài xế kẹt bận, không có chuyến. Xử lý đề xuất: `ReserveDriver` gọi lặp được nên tài xế bấm nhận lại; Offer hết hạn mà chưa có phân công thì Booking gọi `ReleaseDriver` bù trừ (Q35, chi tiết ở spec mục 16).
- **Trip có trễ** (quyết định 2): test tự động cho mục chấm 17 phải chờ Trip xuất hiện sau mục 16 (hỏi lại theo `booking_id`). Khách bấm hủy trong đúng khoảng này: hủy booking trả 409 (đã phân công), hủy chuyến trả 404 (chưa có) — client thử lại.
- **Đánh giá phụ thuộc Trip** (quyết định 3).
- **Cước có trễ** (quyết định 4): khách thanh toán trước khi event hoàn thành tới Payment thì nhận lỗi "chưa có cước", thử lại sau.
- Ba trong bốn quyết định **khác thiết kế đã được duyệt**; sinh viên phải nói được bảng 10.1 của file 02 khi vấn đáp.

## Điều kiện xem lại

- Giảng viên muốn giữ đúng bốn đường gRPC như bản đã duyệt → đổi quyết định 2 sang B và quyết định 4 thêm gRPC payment → trip; sửa các dòng ghi ở GĐ-10, GĐ-12 (file 02, mục 11).
- Việc xử lý khe hở giữ chỗ tốn công hơn lợi ích → đổi quyết định 1 sang A và chấp nhận rủi ro một tài xế bị mời thừa.
