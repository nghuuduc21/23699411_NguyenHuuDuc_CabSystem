# ADR-009 — Thanh toán trả trước với cước cố định, hoàn tiền và hủy

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** về nghiệp vụ và đường giao tiếp — ghi trong `CLAUDE.md` (mục "Quyết định nghiệp vụ đã chốt", "Quyết định kỹ thuật đã chốt") và `srs.md`. Các chi tiết BA thêm (tên trạng thái, quy tắc M11, cách hiện thực hạn thanh toán) là **đề xuất**. Đóng Q6, Q7, Q13 (một phần), Q23, Q29. Sửa 2026-10-02 lần 4: công thức cước, ai tính quãng đường và hạn thanh toán **đã chốt** trong `CLAUDE.md` / `srs.md` (FR16, BRULE17) — đóng Q37, Q38; xem mục "Bổ sung" bên dưới.
- Liên quan: `docs/design/01-bounded-contexts.md` mục 3.2, 3.3, 6.4, 6.5, 6.6; `docs/design/02-kien-truc-giao-tiep.md` đường S4, K3–K6, mục 4.6, 8.2, 8.4, 8.5; ADR-005, ADR-007, ADR-008; FR16–FR20, FR35, FR36, FR40, FR41; BRULE08, BRULE13–16; UC14, UC31, UC32; AC11, AC12, AC13, AC21–AC24; NFR05, NFR14; mục chấm 15, 18, 19, 30.

## Bối cảnh

Bản trước theo mô hình **trả sau**: chuyến hoàn thành → Payment tính cước từ quãng đường thực tế → khách thanh toán. Khi đó Payment đứng ngoài luồng đặt xe và không có hoàn tiền.

Sinh viên và giảng viên chốt lại: cước cố định biết ngay khi đặt; thanh toán điện tử trả trước; chuyến không thực hiện thì hoàn tiền; chỉ hủy được trước khi chuyến bắt đầu.

## Các lựa chọn về mô hình thanh toán

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Trả sau, cước theo quãng đường thực tế | Payment đứng ngoài luồng đặt xe (NFR05 trọn vẹn); không cần hoàn tiền | Khách không biết giá trước; có rủi ro chuyến xong mà không thu được tiền; Trip phải đo quãng đường |
| B | **Cước cố định khi đặt; điện tử trả trước; hoàn đủ khi chuyến không thực hiện** | Khách biết giá trước; đã có tài xế nghĩa là tiền đã thu; Trip không phải đo quãng đường | Payment nằm trong luồng đặt xe; phải có hoàn tiền; thêm trạng thái chờ thanh toán |
| C | Tạm giữ tiền khi đặt, thu thật khi hoàn thành | Không phải hoàn tiền (chỉ nhả tạm giữ) | Cần Provider hỗ trợ tạm giữ; nhiều trạng thái hơn; vượt phạm vi 30 mục chấm |

## Quyết định

Chọn **B**.

### Quy tắc nghiệp vụ

| Điểm | Quyết định | Nguồn |
|---|---|---|
| Cước | Tính **một lần** khi đặt xe từ loại xe và khoảng cách điểm đón → điểm đến; không đổi; áp dụng cho cả hai phương thức | FR16, BRULE08 |
| Điện tử | Trả trước. Booking ở `PENDING_PAYMENT`; thanh toán thành công mới chuyển `SEARCHING` | FR18, FR35, BRULE13, AC21 |
| Tiền mặt | Booking vào `SEARCHING` ngay. Chuyến hoàn thành thì hệ thống tự ghi nhận đã thu | FR17, AC11 |
| Thất bại | Payment `FAILED`, khách được báo, Booking vẫn chờ, khách thanh toán lại | FR19, BRULE10, AC13 |
| Hạn thanh toán | Tối đa 10 phút và 3 lần thử; quá thì booking bị hủy | BRULE17, AC25 |
| Hoàn đủ | (1) khách hủy trước khi có tài xế; (2) khách hủy sau khi có tài xế; (3) không tìm được tài xế; (4) tài xế hủy chuyến đã nhận | FR40, BRULE14, AC22, AC24 |
| Không hoàn | (1) chuyến đã hoàn thành; (2) tài xế chỉ **từ chối lời mời** — hệ thống hỏi tài xế kế tiếp | BRULE15, BRULE05, AC23 |
| Hủy | Chỉ trước khi chuyến bắt đầu (chưa đón khách). Chưa có tài xế: khách hủy **Booking**. Đã có tài xế: khách hoặc tài xế hủy **Trip**; hệ thống không tự tìm tài xế khác | FR36, FR41, BRULE16 |
| "COMPLETED" ở mục 19 | Trạng thái của giao dịch thanh toán | `CLAUDE.md` |

### Trạng thái

| Đối tượng | Trạng thái | Bước chuyển chính |
|---|---|---|
| Booking | `PENDING_PAYMENT`, `SEARCHING`, `DRIVER_ASSIGNED`, `NO_DRIVER_FOUND`, `CANCELED` | Điện tử: `PENDING_PAYMENT` → `SEARCHING`. Tiền mặt: bắt đầu ở `SEARCHING`. `SEARCHING` → `DRIVER_ASSIGNED` / `NO_DRIVER_FOUND`. Hủy từ `PENDING_PAYMENT` hoặc `SEARCHING` |
| Trip | `ACCEPTED`, `ARRIVED`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED`, `CANCELED` | Đúng trình tự. Hủy chỉ từ `ACCEPTED` hoặc `ARRIVED` |
| Payment | `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`, `CANCELED` | `PENDING` → `COMPLETED` (callback thành công, hoặc tiền mặt khi chuyến hoàn thành). `PENDING` → `FAILED` → `PENDING` (thanh toán lại). `COMPLETED` → `REFUNDED` (chỉ điện tử). `PENDING` / `FAILED` → `CANCELED` (chưa thu thì hủy bỏ) |

### Đường giao tiếp

| Việc | Đường | Kiểu | Vì sao kiểu đó |
|---|---|---|---|
| Tính cước và tạo thanh toán | Booking → Payment `CreatePayment` | **gRPC** | Booking phải trả ngay cho khách số tiền và mã thanh toán. Đồng bộ là mặc định |
| Kết quả thanh toán | Payment → topic `payment.status-changed` → Booking, Notification | **Kafka** | Kết quả do Provider gửi về lúc không biết trước; tiền đã thu thì Payment phải ghi xong dù Booking đang lỗi; hai bên cùng cần |
| Khách hủy khi chưa có tài xế | Booking → `booking.canceled` → Payment, Notification | **Kafka** | Hủy phải thành công dù Payment đang lỗi (NFR05); hai bên cùng cần |
| Không tìm được tài xế | Booking → `booking.no-driver-found` → Payment, Notification | **Kafka** | Do tiến trình nền kết luận, không ai chờ; hai bên cùng cần |
| Hủy chuyến đã có tài xế (khách hoặc tài xế) | Trip → `trip.status-changed` (`CANCELED`) → Payment, Driver, Notification | **Kafka** | Hủy không được lỗi theo Payment; ba bên cùng cần |
| Chuyến hoàn thành, tiền mặt | Trip → `trip.status-changed` (`COMPLETED`) → Payment | **Kafka** | Hoàn thành chuyến không được lỗi theo Payment |
| Tài xế từ chối lời mời | **Không có đường nào** | — | Không context nào cần biết. Payment không được báo nên không thể hoàn nhầm (BRULE15) |

Payment gắn với **`booking_id`** (lúc trả trước chưa có Trip). Mọi event liên quan đều mang `booking_id`.

## Vì sao

1. **Nghiệp vụ đã chốt** trong `srs.md` (FR16–FR18, FR40, BRULE08, BRULE13–16).
2. **Cước do Payment tính, không phải Booking**: bảng giá thuộc context Fare & Payment (BR12, danh sách service của giảng viên). Booking chỉ giữ bản sao số tiền để hiển thị.
3. **Booking gọi Payment đồng bộ**: khách bấm đặt xe phải thấy ngay giá và cách trả. Nếu dùng event thì response đặt xe không có số tiền.
4. **Payment không gọi ngược Booking bằng gRPC** khi có kết quả: Payment đã nhận tiền của khách thì việc ghi nhận phải xong bất kể Booking có đang chạy hay không; nếu gọi đồng bộ mà Booking lỗi thì callback của Provider thất bại trong khi tiền đã trừ.
5. **Hoàn tiền do Payment tự quyết khi nghe sự kiện**, không phải Booking hay Trip ra lệnh: quy tắc "trường hợp nào hoàn" (BRULE14, BRULE15) nằm một chỗ. Booking và Trip chỉ báo sự việc đã xảy ra.
6. **Trip không còn đo quãng đường**: cước đã cố định, không FR nào còn cần số đó.

## Đánh đổi

### So với NFR05 (phải nêu khi trình bày)

NFR05: "Lỗi của một thành phần như Payment hoặc Notification không được làm toàn bộ hệ thống đặt xe ngừng hoạt động."

| Khi `payment-service` dừng | Kết quả |
|---|---|
| Tạo booking mới (cả tiền mặt lẫn điện tử) | **Không được** — 503. Đây là phần NFR05 bị nhượng bộ |
| Booking điện tử đang chờ thanh toán | Chờ tiếp; callback không được nhận |
| Booking đã vào `SEARCHING`: ghép, mời, nhận chuyến | Vẫn chạy |
| Chuyến đang chạy: cập nhật, hoàn thành | Vẫn chạy; tiền mặt được ghi nhận khi Payment chạy lại |
| Hủy booking, hủy chuyến | Vẫn chạy; tiền được hoàn khi Payment chạy lại |
| Thông báo, đánh giá | Vẫn chạy |

Lý do chấp nhận: đã chọn "khách biết giá và trả trước" thì việc đặt xe **về bản chất** cần Payment; không thể vừa trả trước vừa đặt được xe khi không thu được tiền. Phần giữ được của NFR05: Payment lỗi không làm hỏng những gì đã bắt đầu.

Các cách giảm phụ thuộc đã xét và **không chọn**:

| Cách | Vì sao không |
|---|---|
| Đặt bảng giá trong `booking-service` | Cước thuộc context Fare & Payment theo danh sách giảng viên chốt; một quy tắc nằm hai nơi |
| Booking giữ bản sao bảng giá, tiền mặt không cần gọi Payment | Thêm đồng bộ dữ liệu giữa hai service; hai nhánh xử lý khác nhau cho hai phương thức |
| Booking tạo trước, tính cước sau bằng event | Response đặt xe không có giá; trái FR35 ("tạo Booking kèm cước cố định") |

### Đánh đổi khác

- **Có khoảng trễ ngắn** giữa "thanh toán xong" và "bắt đầu tìm tài xế" (một nhịp event).
- **Tiền đi theo event**: mất event là khách trả tiền mà không được phục vụ, hoặc không được hoàn. Cần outbox (ADR-005).
- **Hủy đúng lúc đang trả tiền**: Booking đã `CANCELED` nhưng callback "thành công" đến sau. Quy tắc M11: Payment vẫn ghi nhận rồi hoàn ngay. Booking nhận `payment.status-changed` khi không còn ở `PENDING_PAYMENT` thì bỏ qua.
- ~~Booking có thể chờ thanh toán mãi nếu khách bỏ đi~~ — đã giải quyết bằng BRULE17 (10 phút, 3 lần thử); đổi lại `payment-service` có thêm một tiến trình nền tìm thanh toán quá hạn.
- **Tài xế hủy thì khách phải đặt lại và trả lại từ đầu** (FR41): đơn giản, nhưng trải nghiệm kém hơn tự tìm tài xế khác.
- **Thứ tự demo**: booking điện tử phải qua callback mới có lời mời, nên mục 15–17 nên dùng booking tiền mặt và mục 19, 30 dùng booking điện tử riêng (Q44).
- **Khác thiết kế tham chiếu** (trả sau, Payment nghe "COMPLETED" để tính cước).

## Câu trả lời mẫu khi vấn đáp

**"Hoàn tiền khi nào?"** — "Hoàn đủ trong bốn trường hợp chuyến không được thực hiện: khách hủy trước khi có tài xế, khách hủy sau khi có tài xế, không tìm được tài xế, tài xế hủy chuyến đã nhận. Không hoàn khi chuyến đã hoàn thành, và khi tài xế chỉ từ chối lời mời vì lúc đó hệ thống hỏi tài xế khác."

**"Sao Payment lại nằm trong luồng đặt xe, NFR05 thì sao?"** — "Vì em chọn trả trước với cước cố định: khách phải thấy giá và trả tiền trước khi tìm tài xế. Đánh đổi là Payment dừng thì không tạo được booking mới. Phần em giữ được: booking đã tạo, chuyến đang chạy, hủy và thông báo đều không phụ thuộc Payment vì các đường đó đi bằng Kafka."

**"Vì sao kết quả thanh toán đi bằng Kafka mà tạo thanh toán lại là gRPC?"** — "Tạo thanh toán thì Booking cần số tiền ngay để trả cho khách. Kết quả thì đến từ nhà cung cấp vào lúc không biết trước, và khi tiền đã trừ thì Payment phải ghi nhận xong dù Booking có lỗi, nên Payment không được chờ Booking."

## Bổ sung 2026-10-02 lần 4 — công thức cước và hạn thanh toán

### Công thức cước (đã chốt: FR16, `CLAUDE.md`)

`cước = giá mở cửa + đơn giá mỗi km × quãng đường ước tính`; `quãng đường ước tính = khoảng cách đường thẳng × 1,3`; làm tròn lên 1.000 đ; không thấp hơn cước tối thiểu. Ba loại xe với bảng giá minh họa trong `CLAUDE.md`.

| Việc | Ai làm | Vì sao |
|---|---|---|
| Tính quãng đường ước tính từ tọa độ | `booking-service` | Booking có tọa độ; đây là phần của adapter bản đồ |
| Giữ bảng giá, tính cước, lưu từng thành phần | `payment-service` | Quy tắc giá thuộc context Fare & Payment; đổi giá chỉ sửa một nơi; giải thích được con số cuối |

Chi tiết BA thêm (file 03 mục 2, 6.3, 8.1, 8.2 — **đề xuất**): quãng đường truyền và lưu bằng **mét, số nguyên**; tiền là số nguyên đồng; mọi phép tính từ sau bước làm tròn quãng đường đều là số nguyên, để việc làm tròn lên 1.000 đ không lệch vì sai số số thực.

### Hạn thanh toán (đã chốt: BRULE17) — ai giữ hạn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | **Payment giữ hạn (`expires_at`) và đếm lượt; quá hạn hoặc hết lượt thì Payment `CANCELED` và phát `payment.status-changed`; Booking nghe và tự chuyển `CANCELED`** | Chính sách thanh toán nằm một chỗ; Payment tự từ chối lần thử quá hạn mà không hỏi ai; không thêm topic | K6 có thêm một giá trị `status`; Booking biết chậm một nhịp event |
| B | Booking giữ hạn, quá hạn thì hủy và phát `booking.canceled`; Payment chỉ đếm lượt | Booking tự quyết trạng thái của mình | Hạn nằm ở Booking nhưng Payment vẫn phải biết để từ chối lần thử muộn: một quy tắc ở hai nơi |

Chọn **A** (BA đề xuất, chưa được xác nhận riêng). Luồng: Payment `CANCELED` → K6 (`CANCELED`, kèm `PAYMENT_EXPIRED` hoặc `ATTEMPTS_EXHAUSTED`) → Booking `PENDING_PAYMENT` → `CANCELED` (người hủy: hệ thống) → K4 → Notification báo khách. Khi Payment nhận lại K4 thì đã `CANCELED` nên bỏ qua.

Cả hai con số là **giới hạn trên**, đọc từ `PAYMENT_TIMEOUT_SECONDS` và `PAYMENT_MAX_ATTEMPTS` (`CLAUDE.md`, "Ràng buộc khi chấm").

## Điều kiện xem lại

Nghiệp vụ chỉ đổi khi sinh viên và giảng viên đổi `srs.md` / `CLAUDE.md`. Chi tiết đề xuất xem lại theo câu trả lời Q42, Q44 và Q50 (ai gửi callback giả lập — file 04).
