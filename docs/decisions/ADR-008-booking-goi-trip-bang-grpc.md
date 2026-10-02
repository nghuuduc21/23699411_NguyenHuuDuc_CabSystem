# ADR-008 — Tài xế nhận chuyến: Booking gọi gRPC `CreateTrip` sang Trip

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** — ghi trong `CLAUDE.md`, mục "Quyết định kỹ thuật đã chốt". Thay thế quyết định 2 của ADR-007 (bàn giao bằng event `booking.driver-assigned`). Đóng Q33 và giả định GĐ-10.
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` đường S3, S5, K5, mục 8.3; `docs/design/01-bounded-contexts.md` mục 3.1, quy tắc B11, B12, B17, T1, T8; ADR-006, ADR-007; FR07, FR11, FR12, FR22; BRULE01; NFR05, NFR14; mục chấm 16, 17.

## Bối cảnh

Booking và Trip là hai service (ADR-006). Mốc bàn giao là lúc tài xế bấm **nhận** lời mời (FR07): từ lúc đó phải tồn tại một Trip để tài xế cập nhật trạng thái (FR12).

Phiếu chấm chạy mục 16 (tài xế nhận chuyến) rồi **ngay sau đó** mục 17 (cập nhật trạng thái chuyến). Mục 17 cần mã chuyến.

Nguyên tắc của giảng viên: hai service cần làm việc với nhau thì **đồng bộ (gRPC) là mặc định**; chỉ dùng Kafka khi nghiệp vụ bắt buộc — bên phát không được chờ, không được thất bại theo bên nhận, hoặc nhiều bên cùng cần biết.

## Hai lựa chọn

| | A — Event Kafka `booking.driver-assigned` | B — gRPC đồng bộ `CreateTrip` |
|---|---|---|
| Cách làm | Booking ghi "đã phân công", trả lời tài xế, phát event. Trip nghe và tạo Trip sau đó | Booking gọi Trip tạo chuyến, **chờ** nhận `trip_id`, rồi mới ghi "đã phân công" và trả lời tài xế |
| Tài xế nhận được gì | "Đã nhận" nhưng **chưa có mã chuyến**; phải hỏi lại theo `booking_id` | "Đã nhận" **kèm `trip_id`** |
| Trip dừng thì | Tài xế vẫn nhận được; Trip tạo bù khi chạy lại | Tài xế **không nhận được** (503), bấm lại sau |
| Trạng thái trung gian | Có: Booking đã `DRIVER_ASSIGNED` mà Trip chưa tồn tại. Hủy trong khoảng đó: hủy booking trả 409, hủy chuyến trả 404 | Không có: Booking chỉ `DRIVER_ASSIGNED` khi Trip đã tồn tại |
| Mất event | Tài xế đã nhận, đã bị giữ bận, nhưng **không bao giờ có Trip** → bắt buộc cần outbox | Không có event bàn giao để mất |
| Ưu | Booking không phụ thuộc Trip (NFR05). Giống thiết kế tham chiếu (`driver.accepted`) | Đơn giản để hiểu và để test; mục 17 chạy được ngay sau mục 16; đúng nguyên tắc đồng bộ là mặc định |
| Nhược | Trip có trễ; test mục 17 phải chờ và hỏi lại; có trạng thái trung gian vô nghĩa về nghiệp vụ | Một thao tác phải thành công ở ba service (Driver, Trip, Booking); lỗi giữa chừng phải xử lý bù |

## Quyết định

Chọn **B**: `booking-service` gọi gRPC `CreateTrip` sang `trip-service`.

Thứ tự khi tài xế bấm nhận:

| Bước | Ai | Làm gì | Lỗi thì |
|---|---|---|---|
| 1 | Booking | Khóa Booking; kiểm tra còn `SEARCHING`, Offer còn hạn và đúng tài xế | 409 (B9, B12) |
| 2 | Booking → Driver | `ReserveDriver(driver_id, booking_id)` | Tài xế không còn rảnh: 409. Driver không trả lời: 503 |
| 3 | Booking → Trip | `CreateTrip(bản chụp)` → `trip_id` | 503; Booking vẫn `SEARCHING`, Offer vẫn chờ |
| 4 | Booking | Ghi Offer `ACCEPTED`, Booking `DRIVER_ASSIGNED`, DriverAssignment kèm `trip_id`; trả lời tài xế | Xem "Đánh đổi" |
| 5 | Trip | Phát `trip.status-changed` (`ACCEPTED`) | — |

**Notification biết "tài xế đã nhận chuyến" (FR22) qua topic `trip.status-changed` với `status = ACCEPTED`** do Trip phát ở bước 5. Không còn topic `booking.driver-assigned`: sau khi bàn giao là gRPC, event đó chỉ còn Notification nghe, và trạng thái đầu của Trip đã mang đủ thông tin (`trip_id`, `booking_id`, `customer_id`, `driver_id`).

## Vì sao

Xét ba lý do buộc phải bất đồng bộ — **không lý do nào đúng ở đây**:

| Lý do buộc bất đồng bộ | Ở bước bàn giao |
|---|---|
| Bên phát không được chờ? | Booking **được** chờ: tài xế đang giữ máy đợi câu trả lời, và câu trả lời hữu ích duy nhất là mã chuyến |
| Bên phát không được thất bại theo bên nhận? | Booking **được** lỗi theo Trip: một lần "nhận chuyến" mà không có Trip là vô nghĩa — tài xế không làm gì tiếp được. NFR05 nêu Payment và Notification, không nêu Trip, vì Trip là một nửa của chính việc đặt xe |
| Nhiều bên cùng cần biết? | Việc **tạo chuyến** chỉ Trip cần. Việc **báo khách** thì Notification cần — phần này vẫn đi bằng Kafka (bước 5) |

Thêm vào đó:

1. Mục chấm 17 chạy ngay sau mục 16 và cần `trip_id`.
2. Không có khoảng thời gian "đã phân công nhưng chưa có chuyến", nên không phải giải thích hay test trạng thái đó.
3. Bớt một topic và bớt một chỗ mà mất event là mất chuyến.

## Đánh đổi

- **Trip lỗi thì không tài xế nào nhận được chuyến.** Đặt xe, thanh toán và ghép đến bước gửi lời mời vẫn chạy; chuyến đang chạy không bị ảnh hưởng.
- **Nhận chuyến chạm ba service** và không có giao dịch chung. Hai khe hở:

| Khe hở | Hậu quả nếu không xử lý | Xử lý đề xuất (Q35, chi tiết ở spec mục 16) |
|---|---|---|
| Bước 2 xong, bước 3 lỗi | Tài xế bị giữ bận mà không có chuyến | Tài xế bấm nhận lại khi Offer còn hạn (`ReserveDriver`, `CreateTrip` gọi lặp theo `booking_id` cho kết quả như cũ). Offer hết hạn: Booking gọi `ReleaseDriver`, hỏi người kế tiếp |
| Bước 3 xong, bước 4 lỗi | Có Trip nhưng Booking vẫn `SEARCHING` | Coi "Trip đã tạo" là điểm không quay lại: khi Offer hết hạn, Booking hỏi Trip theo `booking_id`; đã có Trip thì ghi nốt phân công thay vì hỏi người khác |

- Booking giữ khóa trên dòng Booking trong lúc gọi hai service khác (mỗi lời gọi có deadline). Khách bấm hủy đúng lúc đó phải chờ khóa rồi nhận 409.
- **Khác thiết kế tham chiếu** (bản đã duyệt cho Trip nghe `driver.accepted`).

## Câu trả lời mẫu khi vấn đáp

**"Vì sao chỗ này dùng gRPC mà không dùng Kafka?"**

"Thưa thầy, vì khi tài xế bấm nhận, tài xế cần ngay mã chuyến để cập nhật trạng thái ở bước kế tiếp. Nhận chuyến mà chưa có Trip thì không có nghĩa, nên Booking được phép chờ Trip và được phép lỗi theo Trip. Kafka em chỉ dùng khi bên phát không được chờ, không được lỗi theo bên nhận, hoặc nhiều bên cùng cần biết — ba điều đó ở đây đều không có. Phần nhiều bên cần biết là báo cho khách thì Trip phát `trip.status-changed` lên Kafka cho Notification. Đánh đổi là Trip dừng thì tài xế không nhận được chuyến."

**"Trip dừng thì hệ thống đặt xe chết à, NFR05 thì sao?"**

"Chỉ bước nhận chuyến lỗi và tài xế bấm lại được; khách vẫn đặt xe, thanh toán, chuyến đang chạy vẫn hoàn thành. NFR05 nêu Payment và Notification; Trip là một phần của chính luồng đặt xe nên em chấp nhận phụ thuộc này."

## Điều kiện xem lại

Quyết định đã chốt trong `CLAUDE.md`; muốn đổi phải hỏi lại sinh viên và giảng viên. Phương án lùi nếu việc xử lý hai khe hở tốn công hơn lợi ích: A kèm outbox; khi đó thêm lại topic `booking.driver-assigned` và sửa S5, K5, mục 8.3 của file 02.
