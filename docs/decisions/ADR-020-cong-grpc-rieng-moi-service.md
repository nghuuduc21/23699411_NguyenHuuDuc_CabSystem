# ADR-020 — Mỗi service một cổng gRPC riêng (50051–50058)

- Ngày: 2026-10-05; bổ sung 2026-10-21 (`waitForReady`, mục "Hệ quả"). Trạng thái: **Đã chấp nhận** (sinh viên chốt 2026-10-05, sửa lỗi L3 khi kiểm thử). Thay quyết định H1 của spec `00-ha-tang` ("mọi service nghe cùng 50051").
- Liên quan: `docs/design/02` mục 2.3; `docs/design/03` mục 13 (hằng số); spec `00-ha-tang` mục 2.1, 3.1, 3.2, 3.5, AC-HT-11, AC-HT-14, AC-HT-15; mục chấm 5, 6, 8; NFR04, NFR15.

## Bối cảnh

Mọi service nghe gRPC cùng cổng `50051`, phân biệt bằng tên host trong Compose (`auth-service:50051`, `trip-service:50051`…). Kênh gRPC của Node phân giải tên thành IP một lần rồi giữ kết nối, tự nối lại theo IP đó khi đứt.

Lỗi L3 (gặp khi kiểm thử): restart một container thì Docker có thể cấp **IP cũ của nó cho container khác**. Kênh gRPC đang giữ IP cũ nối lại được ngay vì container mới ở IP đó **cũng nghe 50051** — nhưng là service khác. Request đi nhầm service, trả `UNIMPLEMENTED` hoặc lỗi lạ, `/health/services` có thể báo `SERVING` sai (Health/Check có ở mọi service).

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Giữ 50051 chung, bắt kênh gRPC phân giải lại tên mỗi lần nối lại / đặt IP tĩnh cho từng container | Không đổi cổng | Phụ thuộc chi tiết thư viện và mạng Docker; IP tĩnh thêm cấu hình mạng phải giải thích |
| B | **Mỗi service một cổng riêng** theo thứ tự 8 service: auth 50051, customer 50052, driver 50053, booking 50054, trip 50055, payment 50056, notification 50057, rating 50058 | Nối nhầm IP thì bị **từ chối kết nối** (không service nào khác nghe cổng đó) → kênh báo lỗi và phân giải lại tên; dễ nhớ (thứ tự = số cuối) | Thêm một con số mỗi service; biến `*_GRPC_ADDR` phải đúng cổng |
| C | Health/Check kiểm thêm tên service trong response | Phát hiện được nhầm | Vẫn nhầm, chỉ là biết; mọi rpc nghiệp vụ vẫn đi sai |

## Quyết định

Chọn **B**.

| Điểm | Thiết kế |
|---|---|
| Cổng | Hằng số trong code của từng service; `healthcheck.js` dùng cùng hằng số |
| Bên gọi | `AUTH_GRPC_ADDR=auth-service:50051` … `RATING_GRPC_ADDR=rating-service:50058` trong `compose.yaml` (Gateway 8 biến; booking: driver, payment, trip; rating: trip). Trip: không còn (S6 bỏ 2026-10-21) |
| Mở ra ngoài | **Không** — không service nào có `ports`; mục chấm 8 vẫn chỉ có Gateway 3000 và Kafka UI 8080 |
| Quy luật nhớ | Số cuối = thứ tự trong bảng 8 service của `CLAUDE.md` |

## Vì sao

1. Sửa tận gốc kiểu lỗi "kết nối thành công nhưng sai đối tượng": cổng khác nhau biến nó thành lỗi kết nối, thứ mà kênh gRPC đã biết tự xử lý.
2. Không phụ thuộc cách Docker cấp IP hay cách thư viện gRPC giữ địa chỉ.
3. Dễ nói khi thi: "mỗi service một cổng, auth 1 đến rating 8".

## Đánh đổi

- Thêm 8 con số phải nhớ và cấu hình đúng; sai một biến `*_GRPC_ADDR` thì service đó `UNREACHABLE` (dễ thấy ở `/health/services`).
- Không loại trừ hẳn mọi lỗi do IP bị cấp lại (ví dụ hai bản cùng service), nhưng không còn đi nhầm sang service khác.

## Hệ quả và bổ sung 2026-10-21: `waitForReady` (lỗi L2)

Cổng riêng biến "nối nhầm" thành "bị từ chối", nhưng lời gọi **đầu tiên** sau khi service chạy lại vẫn có thể gặp kênh đang ở trạng thái lỗi (vừa bị từ chối ở IP cũ, chưa phân giải lại tên) → grpc-js trả `UNAVAILABLE` ngay (3–8 ms) → Gateway 503 dù `/health/services` báo `healthy` (báo cáo `docs/test-reports/2026-10-21-hoi-quy-gop-y-giang-vien.md`, L2: AC-HT-15 đỏ 3/8 lần).

| | Nội dung |
|---|---|
| Quyết định (sinh viên chốt 2026-10-21) | **Mọi** lời gọi gRPC — Gateway → service (gồm `Health/Check`) và service → service — bật **`waitForReady`**, đặt bằng `new grpc.Metadata({ waitForReady: true })` (cách `@grpc/grpc-js` đọc tùy chọn này). **Giữ deadline**: Gateway → service 3 s, health 1 s, service → service 1 s |
| Vì sao | Lời gọi chờ kênh tự tìm lại địa chỉ và nối xong rồi mới gửi, trong hạn deadline; không phải tự viết vòng gọi lại (gọi lại thao tác ghi có thể gửi lặp) hay tự tạo lại kênh |
| Đánh đổi | Service dừng hẳn thì 503 đến **sau khi hết deadline** (≤ 3 s) thay vì ngay; `/health/services` khi có service dừng mất ≈ 1 s; lời gọi nội bộ chờ tối đa 1 s mỗi lần (ví dụ bộ ghép thử S2 ba lần → `NO_DRIVER_FOUND` khi Driver dừng đến chậm hơn) |
| Kiểm tra | Spec 00: AC-HT-15 (đổi), AC-HT-18, AC-HT-19 (mới); H14 |

## Câu trả lời mẫu khi vấn đáp

"Mỗi service nghe gRPC một cổng riêng, auth 50051 đến rating 50058, chỉ trong mạng Compose, không mở ra ngoài. Trước đây cùng 50051 thì khi restart, Docker có thể cấp IP cũ cho container khác và Gateway nối nhầm sang service khác mà không báo lỗi. Cổng riêng thì nối nhầm sẽ bị từ chối, kênh tự tìm lại đúng service. Thêm nữa mọi lời gọi gRPC bật `waitForReady` có deadline: service vừa bật lại thì lời gọi chờ kênh nối xong rồi mới gửi, nên không bị 503 oan; service chết hẳn thì 503 sau tối đa 3 giây."

## Điều kiện xem lại

Chuyển sang nền tảng có service discovery (Kubernetes Service, DNS có TTL ngắn) hoặc chạy nhiều bản của cùng một service.
