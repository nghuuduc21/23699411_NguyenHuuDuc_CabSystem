# ADR-003 — Giữ Dispatch là service riêng, không gộp vào `ride-service`

- Ngày: 2026-10-01. Trạng thái: **Bị thay thế** bởi ADR-006 (2026-10-02). Giảng viên chốt không có service riêng cho ghép tài xế: phần này nằm trong `booking-service` (tức phương án A dưới đây, với Booking thay cho Ride). Nội dung dưới đây giữ lại để biết phương án đã từng xét; **không còn hiệu lực**.
- Liên quan: `docs/design/01-bounded-contexts.md` mục 5.5, 6.1; FR02–FR10, FR35; BRULE01–07; NFR02, NFR05, NFR12, NFR14; mục chấm 15, 16.

## Bối cảnh

Sau ADR-002, Booking và Trip đã gộp. Câu hỏi còn lại: việc ghép tài xế (tìm ứng viên, gửi Offer, đếm giờ, xử lý nhận / từ chối / hết giờ) nằm trong `ride-service` hay là service riêng?

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Gộp vào `ride-service` | "Tài xế nhận" là một giao dịch cục bộ; không có tranh chấp giữa hai service; còn 6 service | Service core duy nhất vừa giữ trạng thái chuyến vừa chạy quy trình nền có hẹn giờ; đổi thuật toán ghép là đụng service giữ dữ liệu chuyến |
| B | **`dispatch-service` riêng** | Tách hai trách nhiệm core khác bản chất; ghép lỗi hoặc chậm không chặn nhận booking | Thêm một ranh giới phải giữ nhất quán |

## Quyết định

Chọn **B**.

## Vì sao

1. **Khác bản chất.** Ride là máy trạng thái phản ứng theo thao tác người dùng. Dispatch là quy trình chạy nền kéo dài: hỏi nhiều tài xế, mỗi người một thời hạn (BRULE04, BRULE06). FR35 đã nói Booking được tạo ở trạng thái "đang tìm tài xế" — tức khách không chờ ghép xong; hai việc vốn không đồng bộ với nhau.
2. **Ngôn ngữ riêng.** Offer, ứng viên, hết giờ, đã loại không có nghĩa gì với Booking / Trip. 7/12 BRULE (01–07) thuộc về Dispatch.
3. **Hay thay đổi nhất.** Quy tắc ghép (bán kính, thứ tự ưu tiên, thời hạn) là thứ doanh nghiệp điều chỉnh thường xuyên (NFR12). Đổi nó không nên phải triển khai lại service giữ dữ liệu chuyến.
4. **Cô lập lỗi.** Dispatch chậm hoặc dừng thì khách vẫn tạo được booking, vẫn xem được danh sách và chuyến đang chạy (NFR05, NFR15).
5. **Hiệu năng.** NFR02 yêu cầu tìm tài xế nhanh; phần này mở rộng độc lập được (NFR03).

## Đánh đổi

- **"Tài xế nhận" phải được hai service ghi nhận** (Dispatch đóng phiên ghép, Ride gán tài xế và tạo Trip). Có khoảng thời gian hai bên chưa khớp; file 02 phải chọn cách nối và nêu cách xử lý khi một bên lỗi (NFR14).
- **Tranh chấp hủy — nhận:** khách hủy đúng lúc tài xế nhận. Phải có một nơi quyết định cuối; đề xuất là Ride vì nó giữ trạng thái Booking (câu hỏi Q5).
- Dispatch phải được báo khi booking bị hủy để dừng gửi Offer (FR36).
- Thêm một service, một database, một file proto.
- Nếu giảng viên coi đây là tách quá tay thì phương án A vẫn chạy được đủ mục chấm 15 và 16; khi đó DispatchRequest thành một aggregate trong `ride-service` và các quy tắc P1–P9 giữ nguyên.

## Điều kiện xem lại

Gộp lại (phương án A) nếu việc giữ nhất quán giữa hai service tốn công hơn lợi ích thu được trong phạm vi đồ án, hoặc giảng viên yêu cầu ít service hơn.
