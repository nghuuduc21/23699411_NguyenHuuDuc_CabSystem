# ADR-006 — Chia 8 service: Booking (gồm ghép tài xế), Trip, Rating là ba service riêng

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** (giảng viên chốt danh sách, ghi trong `CLAUDE.md`). Sửa 2026-10-02 lần 3: `review-service` → `rating-service`; cập nhật theo ADR-008 (bàn giao bằng gRPC) và ADR-009 (trả trước, hoàn tiền, hủy).
- Thay thế: ADR-002 (gộp Booking, Trip, Rating vào `ride-service`) và ADR-003 (tách `dispatch-service`).
- Liên quan: `docs/design/01-bounded-contexts.md` mục 3, 6.4, 6.5, 6.8, 7; ADR-007, ADR-008, ADR-009; FR05–FR12, FR25, FR35–FR37, FR41; BRULE01–07, BRULE11, BRULE16; NFR05, NFR14; mục chấm 14–18, 20.

## Bối cảnh

Bản nháp đầu chia 7 service: gộp Booking + Trip + Rating thành `ride-service` (ADR-002) và tách ghép tài xế thành `dispatch-service` (ADR-003). Sinh viên đưa thiết kế 10 service đã được giảng viên duyệt cho nhóm khác; giảng viên nhận xét hơi nhiều và chốt **8 bounded context = 8 service**: auth, customer, driver (gộp Vehicle), booking (gồm ghép tài xế), trip, payment, notification, rating. Không có service riêng cho dispatch, report, audit.

Danh sách là cố định. ADR này ghi **lý do nghiệp vụ** của ba ranh giới, để sinh viên giải thích được chứ không chỉ nói "thầy bảo vậy".

## Các lựa chọn đã xét

| # | Lựa chọn | Kết luận |
|---|---|---|
| A | 7 service của bản nháp (ride + dispatch) | Loại: trái danh sách đã chốt |
| B | 10 service của thiết kế tham chiếu | Loại: giảng viên đã bỏ report, audit |
| C | **8 service theo danh sách đã chốt** | Chọn |

Trong phạm vi C, phần còn được chọn là **vạch ranh giới ở đâu**:

| Ranh giới | Phương án | Chọn |
|---|---|---|
| Booking — Trip | (1) Mốc là lúc tạo Booking: Trip lo cả ghép tài xế; (2) **mốc là lúc tài xế nhận** | (2) |
| Offer, Assignment | (1) Ở Driver; (2) **ở Booking** | (2) |
| Hủy | (1) Một nơi xử lý mọi lần hủy; (2) **mỗi giai đoạn tự hủy phần của mình** | (2) — đã chốt trong `CLAUDE.md` |
| Điểm trung bình tài xế | (1) Ở Driver; (2) **ở Rating** | (2), chờ Q28 |

## Quyết định

| Service | Sở hữu | Không sở hữu |
|---|---|---|
| `booking-service` | Booking (yêu cầu đặt xe, số tiền cước đã chốt, trạng thái chờ thanh toán), DriverOffer, DriverAssignment; việc chạy nền đếm giờ; hủy khi chưa có tài xế | Trạng thái nhận chuyến và vị trí của tài xế (Driver); bảng giá, thanh toán, hoàn tiền (Payment); mọi thứ sau khi phân công (Trip) |
| `trip-service` | Trip, TripStatusHistory, hủy chuyến đã có tài xế (khách hoặc tài xế, trước khi đón khách), giám sát của admin | Yêu cầu gốc (chỉ giữ bản chụp lúc bàn giao); tiền; đánh giá |
| `rating-service` | Rating gắn `trip_id`, điểm trung bình của tài xế | Trạng thái chuyến (hỏi Trip) |

Mốc chuyển Booking → Trip: **lúc tài xế nhận lời mời** (FR07). Bàn giao đúng một lần bằng lời gọi `CreateTrip` (ADR-008); sau đó Booking không đổi nữa.

## Vì sao

**Ghép tài xế nằm trong Booking, không phải service riêng:**

1. **Offer chỉ có nghĩa với một Booking.** "Hỏi ai, hỏi mấy người rồi, ai nhận" là trạng thái của chính yêu cầu đặt xe đang tìm tài xế (UC06).
2. **Hủy và nhận cùng lúc thành một giao dịch cục bộ** (quy tắc B12, NFR14): Booking, Offer, Assignment chung một database, khóa một dòng là xong.
3. **Bớt các đường giao tiếp** giữa hai service core mà lý do tồn tại duy nhất là "vì đã tách".

**Booking và Trip là hai service:**

1. **Hai giai đoạn khác tác nhân và khác quy tắc.** Trước khi có tài xế: hệ thống điều khiển (chờ thanh toán, tìm, mời, đếm giờ), quy tắc là BRULE01–07 và BRULE13. Sau khi có tài xế: tài xế điều khiển, quy tắc là trình tự trạng thái (mục chấm 17) và BRULE16.
2. **SRS đã mô tả hai thực thể**: Booking là "yêu cầu đặt xe của khách hàng", Trip là "chuyến đi thực tế sau khi có tài xế" (bảng Entity).
3. **Cô lập lỗi (NFR05).** Ghép tài xế là phần nặng và hay đổi nhất; nó chậm hoặc dừng thì chuyến đang chạy vẫn cập nhật trạng thái và hoàn thành được, vì Trip giữ bản chụp đủ dùng.
4. **Mốc bàn giao rõ và chỉ xảy ra một lần**, dữ liệu đi một chiều.

**Rating là service riêng:**

1. Đánh giá xảy ra **sau khi chuyến đã đóng**, do khách làm, và không làm đổi trạng thái nào của chuyến hay thanh toán. Lỗi ở đây không được ảnh hưởng chuyến đang chạy.
2. Mục chấm 20 chấm riêng "Review được lưu và liên kết với chuyến đi": liên kết bằng `trip_id` (tham chiếu chéo bằng ID, không khóa ngoại).
3. Điểm trung bình tính từ Rating nên đặt cùng chỗ để cập nhật trong một giao dịch (quy tắc V5).

## Đánh đổi

- **Một chuyến xe nằm ở hai service.** Phải có bước bàn giao; "nhận chuyến" chạm ba service (Booking, Driver, Trip) — ADR-008.
- **Hai thao tác hủy** (hủy booking khi chưa có tài xế, hủy chuyến khi đã có tài xế). Client phải gọi đúng nơi; gọi sai nhận 409.
- **Danh sách booking (mục chấm 14) không tự hiện kết cục chuyến**; muốn có thì Booking phải nghe event của Trip (Q27).
- `booking-service` vừa phục vụ request vừa chạy việc nền đếm giờ; đổi thuật toán ghép là triển khai lại service nhận booking.
- `rating-service` chỉ gánh 1 FR, 1 mục chấm, và phải gọi Trip để kiểm tra BRULE11.

## Điều kiện xem lại

Danh sách service chỉ đổi khi giảng viên đổi. Ranh giới chi tiết xem lại nếu câu trả lời Q27, Q28 khác đề xuất.
