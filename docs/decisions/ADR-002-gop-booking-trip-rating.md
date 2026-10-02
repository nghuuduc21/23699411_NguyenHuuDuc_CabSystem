# ADR-002 — Gộp Booking, Trip và Rating vào một `ride-service`

- Ngày: 2026-10-01. Trạng thái: **Đề xuất**, chờ sinh viên xác nhận.
- Liên quan: `docs/design/01-bounded-contexts.md` mục 5.4, 5.7, 6.1; FR07, FR11, FR12, FR25, FR35–FR37; BRULE08, BRULE11; NFR14; mục chấm 14–18, 20.

## Bối cảnh

Bản cũ có ba service riêng: Booking, Trip, Rating. `CLAUDE.md` yêu cầu số service vừa đủ cho 30 mục chấm và không tách chỉ để có nhiều service.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Ba service: Booking, Trip, Rating | Mỗi service nhỏ, dễ hiểu riêng lẻ | Xem phần "Vì sao" |
| B | **Một service `ride-service`**: context Ride (Booking + Trip) và context Rating chạy chung | Nhất quán bằng giao dịch cục bộ; ít đường giao tiếp | Service lớn nhất hệ thống |
| C | Hai service: Ride (Booking + Trip) và Rating riêng | Rating độc lập | Một service cho 1 FR, 1 mục chấm, và phải hỏi ngược Ride để kiểm tra BRULE11 |

## Quyết định

Chọn **B**. Rating vẫn là bounded context riêng về mặt mô hình (module riêng, bảng riêng, không khóa ngoại sang bảng Trip) để sau này tách được.

## Vì sao

**Booking + Trip:**

1. **Một vòng đời liên tục.** Booking là giai đoạn "chưa có tài xế", Trip là giai đoạn "đã có tài xế" của cùng một chuyến xe.
2. **Thời điểm tài xế nhận** phải vừa đổi trạng thái Booking vừa tạo Trip (FR07, FR11). Chung service thì đó là một giao dịch cục bộ; hai service thì phải xử lý trường hợp một bên thành công một bên lỗi (NFR14).
3. **FR36 là một yêu cầu hủy** cho cả "yêu cầu đặt xe" lẫn "chuyến". Hai service thì client phải biết đang ở giai đoạn nào để gọi đúng nơi.
4. **Mục chấm 14** cần danh sách booking của khách; khách muốn thấy luôn chuyến đang ở trạng thái nào. Hai service thì phải ghép dữ liệu.
5. Giữa Booking và Trip không có đường giao tiếp nào có lý do nghiệp vụ ngoài việc "chuyển tiếp trạng thái" — tách ra chỉ sinh thêm đường nối.

**Rating:**

1. BRULE11 cần biết chuyến đã hoàn thành và thuộc về khách nào; dữ liệu đó nằm ngay tại Ride, kiểm tra tại chỗ không cần gọi service khác.
2. Rating chỉ phục vụ 1 FR (FR25) và 1 mục chấm (20).

## Đánh đổi

- `ride-service` gánh nhiều nhất: khoảng 10 FR, 5–6 mục chấm. Lỗi ở đây ảnh hưởng cả đặt xe, chuyến và đánh giá.
- Không mở rộng riêng được phần đọc nhiều (danh sách booking, theo dõi chuyến) với phần ghi.
- Rating không triển khai độc lập được. Nếu sau này có tài xế đánh giá khách, kiểm duyệt nhận xét thì nên tách.
- Khác tên so với cột "Service" trong `docs/study/00-ban-do-phieu-cham.md` (Booking, Trip, Rating); sinh viên cần nói được bảng đổi tên ở mục 6.2 của file thiết kế.

## Điều kiện xem lại

Tách Trip ra nếu phần theo dõi chuyến cần tải hoặc công nghệ khác hẳn (ví dụ luồng vị trí thời gian thực); tách Rating nếu nghiệp vụ đánh giá lớn lên.
