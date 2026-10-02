# ADR-011 — Tìm tài xế trong 1 km bằng Haversine trên cột lat/lng, không dùng PostGIS

- Ngày: 2026-10-02. Trạng thái: **Đề xuất** — BA chọn, chờ sinh viên xác nhận. Khác thiết kế tham chiếu (PostgreSQL + PostGIS).
- Liên quan: `docs/design/03-du-lieu.md` mục 5.2, 5.4; `docs/design/02-kien-truc-giao-tiep.md` đường S2; FR02, FR04, FR05; BRULE01–03; NFR02; mục chấm 5, 13, 15.

## Bối cảnh

`driver-service` phải trả lời: "tài xế nào đang Online, đã duyệt, đúng loại xe, trong bán kính 1 km quanh tọa độ này, sắp từ gần đến xa, có limit và paging" (mục chấm 13; S2 cho bộ ghép). Dữ liệu khi chấm là seed: dưới 10 tài xế. Sinh viên phải giải thích được cách tính khi vấn đáp, và hệ thống phải dựng được bằng một lệnh Compose.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Hai cột `double precision` + công thức Haversine trong SQL**, lọc trước bằng khung chữ nhật | Image PostgreSQL thường, giống 6 service kia; không extension; seed là hai con số; công thức giải thích được trên bảng; dùng lại cho ước tính quãng đường tính cước ở `booking-service` | Không có index không gian: với rất nhiều tài xế, bước khung chữ nhật kém hiệu quả hơn GiST |
| B | PostGIS: cột `geography(Point, 4326)`, index GiST, `ST_DWithin`, `ST_Distance` | Đúng công cụ cho bài toán; nhanh ở quy mô lớn; là cách của thiết kế tham chiếu | Image riêng (`postgis/postgis`), phải bật extension trong migration; seed phải dựng kiểu `geography`; thêm khái niệm phải giải thích (SRID, geography so với geometry, GiST) |
| C | Lấy hết tài xế Online về service rồi tính bằng JavaScript | Không cần SQL lượng giác | Phân trang và sắp xếp phải làm trong bộ nhớ; không mở rộng được |

## Quyết định

Chọn **A**.

## Vì sao

1. **Quy mô thật của bài toán** là vài tài xế seed; lợi thế của index không gian không xuất hiện.
2. **Dựng trong Docker đơn giản và đồng nhất**: cả 7 service PostgreSQL dùng cùng một image; bớt một nguồn lỗi khi chấm mục 5.
3. **Giải thích được**: Haversine là công thức khoảng cách trên mặt cầu; cùng công thức dùng cho FR16 (khoảng cách đường thẳng × 1,3), nên chỉ một công thức cho cả hai chỗ.
4. **Vẫn làm trong database** (không chọn C): `ORDER BY` khoảng cách và `LIMIT` / `OFFSET` chạy trong SQL nên limit và paging của mục 13 đúng và ổn định.
5. **Đường lùi rõ ràng**: đổi sang B chỉ sửa một câu truy vấn và một migration trong `driver-service`; hợp đồng gRPC `FindNearbyDrivers` không đổi.

## Đánh đổi

- Không đạt hiệu năng của PostGIS khi số tài xế lớn (NFR02, NFR03). Giảm nhẹ bằng index có điều kiện trên tài xế đủ điều kiện và lọc khung chữ nhật trước khi tính lượng giác.
- Haversine coi Trái Đất là hình cầu: sai số khoảng 0,3 %, tức vài mét trên 1 km — nhỏ hơn sai số GPS.
- **Khác thiết kế đã được duyệt.** Câu trả lời phải nói được cả hai phía.

## Câu trả lời mẫu khi vấn đáp

"Bản tham chiếu dùng PostGIS. Em dùng hai cột vĩ độ, kinh độ và công thức Haversine ngay trong câu SQL, vì dữ liệu của em chỉ có vài tài xế nên chưa cần index không gian, và em không phải dựng thêm một image database khác. Em lọc trước bằng một khung chữ nhật quanh điểm đón để dùng được index thường, rồi mới tính khoảng cách chính xác và sắp xếp. Nếu số tài xế lên hàng chục nghìn thì em đổi sang PostGIS, chỉ sửa một câu truy vấn trong `driver-service`."

## Điều kiện xem lại

Giảng viên yêu cầu đúng PostGIS như bản đã duyệt, hoặc có yêu cầu hiệu năng với dữ liệu lớn → chuyển sang B.
