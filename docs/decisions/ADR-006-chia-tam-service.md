# ADR-006 — Chia 8 service: Booking (gồm ghép tài xế), Trip, Rating & Review là ba service riêng

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** về danh sách service (giảng viên chốt, ghi trong `CLAUDE.md`). Ranh giới chi tiết bên dưới là **đề xuất** của BA, chờ sinh viên xác nhận.
- Thay thế: ADR-002 (gộp Booking, Trip, Rating vào `ride-service`) và ADR-003 (tách `dispatch-service`).
- Liên quan: `docs/design/01-bounded-contexts.md` mục 3, 6.4, 6.5, 6.8, 7; ADR-007; FR05–FR12, FR25, FR35–FR37; BRULE01–08, BRULE11; NFR05, NFR14; mục chấm 14–18, 20.

## Bối cảnh

Bản nháp trước chia 7 service: gộp Booking + Trip + Rating thành `ride-service` (ADR-002) và tách ghép tài xế thành `dispatch-service` (ADR-003). Sinh viên đưa thiết kế 10 service đã được giảng viên duyệt cho nhóm khác; giảng viên nhận xét hơi nhiều và chốt **8 bounded context = 8 service**: auth, customer, driver (gộp Vehicle), booking (gồm ghép tài xế), trip, payment, notification, review. Không có service riêng cho dispatch, report, audit.

Danh sách là cố định. ADR này ghi **lý do nghiệp vụ** của ba ranh giới thay đổi, để sinh viên giải thích được chứ không chỉ nói "thầy bảo vậy".

## Các lựa chọn đã xét

| # | Lựa chọn | Kết luận |
|---|---|---|
| A | 7 service của bản nháp (ride + dispatch) | Loại: trái danh sách đã chốt |
| B | 10 service của thiết kế tham chiếu | Loại: giảng viên đã bỏ report, audit |
| C | **8 service theo danh sách đã chốt** | Chọn |

Trong phạm vi C, phần còn được chọn là **vạch ranh giới ở đâu**:

| Ranh giới | Phương án | Chọn |
|---|---|---|
| Booking — Trip | (1) Mốc là lúc tạo Booking: Booking chỉ giữ yêu cầu, Trip lo cả ghép tài xế; (2) **mốc là lúc tài xế nhận**: Booking lo đến khi có tài xế, Trip lo từ đó về sau | (2) |
| Offer, Assignment | (1) Ở Driver (vì liên quan tài xế); (2) **ở Booking** | (2) |
| Hủy | (1) Một nơi xử lý mọi lần hủy; (2) **mỗi giai đoạn tự hủy phần của mình** | (2) |
| Điểm trung bình tài xế | (1) Ở Driver; (2) **ở Review** | (2), chờ Q28 |

## Quyết định

| Service | Sở hữu | Không sở hữu |
|---|---|---|
| `booking-service` | Booking (yêu cầu đặt xe), DriverOffer (lời mời, hạn, kết quả), DriverAssignment (ai được phân công); việc chạy nền đếm giờ; hủy khi đang tìm | Trạng thái nhận chuyến và vị trí của tài xế (Driver); mọi thứ sau khi phân công (Trip) |
| `trip-service` | Trip, TripStatusHistory, quãng đường và thời lượng, hủy chuyến đã có tài xế, giám sát của admin | Yêu cầu gốc (chỉ giữ bản chụp lúc bàn giao); tiền; đánh giá |
| `review-service` | Review gắn `trip_id`, điểm trung bình của tài xế | Trạng thái chuyến (hỏi Trip) |

Mốc chuyển Booking → Trip: **lúc tài xế nhận lời mời** (FR07). Bàn giao đúng một lần, bằng bản chụp dữ liệu; sau đó Booking không đổi nữa.

## Vì sao

**Ghép tài xế nằm trong Booking, không phải service riêng:**

1. **Offer chỉ có nghĩa với một Booking.** "Hỏi ai, hỏi mấy người rồi, ai nhận" là trạng thái của chính yêu cầu đặt xe đang tìm tài xế (UC06: "Booking đã được tạo" → "một tài xế được phân công cho Booking").
2. **Hủy và nhận cùng lúc thành một giao dịch cục bộ** (quy tắc B12, NFR14). Ở bản nháp trước đây là điểm yếu nhất: hai service phải thống nhất ai thắng, cần một lời gọi gRPC riêng (`AssignDriver`) chỉ để phân xử. Giờ Booking, Offer, Assignment chung một database, khóa một dòng là xong.
3. **Bớt ba đường giao tiếp** giữa hai service core (`booking.created` → dispatch, `booking.canceled` → dispatch, `dispatch.no-driver-found` → ride) mà lý do tồn tại duy nhất là "vì đã tách".

**Booking và Trip là hai service:**

1. **Hai giai đoạn khác tác nhân và khác quy tắc.** Trước khi có tài xế: hệ thống điều khiển (tìm, mời, đếm giờ), quy tắc là BRULE01–07. Sau khi có tài xế: tài xế điều khiển (đã đến, đã đón, hoàn thành), quy tắc là trình tự trạng thái (mục chấm 17) và BRULE08.
2. **SRS đã mô tả hai thực thể**: Booking là "yêu cầu đặt xe của khách hàng", Trip là "chuyến đi thực tế sau khi có tài xế" (bảng Entity).
3. **Cô lập lỗi (NFR05).** Ghép tài xế là phần nặng và hay đổi nhất; nó chậm hoặc dừng thì chuyến đang chạy vẫn cập nhật trạng thái và hoàn thành được, vì Trip giữ bản chụp đủ dùng.
4. **Mốc bàn giao rõ và chỉ xảy ra một lần**, dữ liệu đi một chiều. Đây là điều kiện để tách hai service mà không phải đồng bộ qua lại.

**Rating & Review là service riêng:**

1. Đánh giá xảy ra **sau khi chuyến đã đóng**, do khách làm, và không làm đổi bất kỳ trạng thái nào của chuyến hay thanh toán. Lỗi ở đây không được ảnh hưởng chuyến đang chạy.
2. Mục chấm 20 chấm riêng "Review được lưu và liên kết với chuyến đi": liên kết bằng `trip_id` (tham chiếu chéo bằng ID, không khóa ngoại).
3. Điểm trung bình tính từ Review nên đặt cùng chỗ với Review để cập nhật trong một giao dịch (quy tắc V5).

## Đánh đổi

- **Một chuyến xe nằm ở hai service.** Phải có bước bàn giao (ADR-007); ngay sau khi tài xế nhận có một khoảng ngắn Booking đã `DRIVER_ASSIGNED` mà Trip chưa tồn tại.
- **Hai thao tác hủy** (hủy booking khi đang tìm, hủy chuyến khi đã có tài xế). Client phải gọi đúng nơi; gọi sai nhận 409 (Q29). ADR-002 từng nêu đây là lý do để gộp.
- **Danh sách booking (mục chấm 14) không tự hiện kết cục chuyến** (hoàn thành / đã hủy chuyến); muốn có thì Booking phải nghe event của Trip (Q27).
- **"Nhận chuyến" vẫn chạm hai service** (Booking và Driver, để giữ chỗ tài xế) — nhưng không còn chạm ba như bản nháp trước.
- `booking-service` vừa phục vụ request vừa chạy việc nền đếm giờ; đổi thuật toán ghép là triển khai lại service nhận booking (ADR-003 từng nêu đây là lý do để tách).
- `review-service` chỉ gánh 1 FR, 1 mục chấm, và phải gọi Trip để kiểm tra BRULE11.
- Thêm một service, một database, một file proto so với bản nháp (8 thay vì 7).

## Điều kiện xem lại

Danh sách service chỉ đổi khi giảng viên đổi. Ranh giới chi tiết xem lại nếu câu trả lời Q27, Q28, Q29 khác đề xuất.
