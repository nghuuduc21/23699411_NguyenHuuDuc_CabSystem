# Buổi 2 — Nghiệp vụ & truy vết yêu cầu

> Tuần 1 · Giai đoạn 1. Nguồn: `srs.md`, `API document/*.yml`, phiếu chấm.
>
> **Lưu ý (2026-10-01):** `API document/` và tài liệu DDD cũ đã bỏ khi xây lại từ đầu. Cột API và Service trong bảng truy vết là **đề xuất tham khảo**; thiết kế chính thức nằm ở `docs/design/` do ba-agent viết.
> Ký hiệu: **⁺** = bổ sung trong buổi này. FR35–FR39, UC27–UC30 đã thêm vào `srs.md` (2026-10-01); các API có ⁺ còn chờ buổi rà API.

## 1. Bài toán trong ba câu

- **Ai gặp vấn đề gì:** khách gọi xe theo cách truyền thống không biết có xe hay không, bao lâu xe tới, giá bao nhiêu; công ty phân công tài xế bằng tay nên chậm và không kiểm soát được.
- **Hệ thống làm gì:** tự động nhận yêu cầu đặt xe, tìm tài xế phù hợp gần nhất, theo dõi chuyến, tính cước, thanh toán, đánh giá.
- **Giá trị:** khách chờ ít hơn, tài xế có chuyến đều hơn, công ty giám sát và đối soát được.

Bốn tác nhân chính: **Customer** (đặt xe), **Driver** (nhận và chạy chuyến), **Operator/Admin** (duyệt tài xế, giám sát), **hệ thống ngoài** (Payment, Map/GPS, Notification Provider).

## 2. Thang truy vết: mỗi tầng trả lời một câu hỏi

| Tầng | Trả lời câu hỏi | Ví dụ trong CAB |
|---|---|---|
| **BG** Business Goal | Doanh nghiệp muốn đạt gì? | BG01 Tự động hóa đặt và phân công xe |
| **BR** Business Requirement | Muốn đạt thì hệ thống phải cho phép gì? | BR02 Tìm và phân công tài xế phù hợp |
| **FR** Functional Requirement | Cụ thể hệ thống làm chức năng gì? | FR04 Tính khoảng cách tài xế → điểm đón |
| **BRULE** Business Rule | Luật nào luôn phải đúng khi làm? | BRULE01 Chỉ tài xế sẵn sàng mới được nhận chuyến |
| **NFR** | Làm tốt đến mức nào? | NFR05 Payment lỗi không làm sập hệ thống |
| **UC** Use Case | Ai thao tác, theo các bước nào? | UC06 Tìm tài xế phù hợp |
| **AC** Acceptance Criteria | Thế nào là đạt? | AC03 Chỉ tìm tài xế Available |
| **API → Service** | Lập trình ở đâu? | `GET /drivers/nearby` → Fleet |

**Cách phân biệt nhanh FR / BRULE / NFR:**

- FR là **việc phải làm**: "gửi yêu cầu cho tài xế".
- BRULE là **điều kiện ràng buộc việc đó**: "tài xế phải trả lời trong thời gian quy định".
- NFR là **chất lượng của cả hệ thống**: "tìm tài xế phải nhanh", "phải xác thực".

**Vì sao giảng viên hay hỏi truy vết:** mỗi service, mỗi bảng, mỗi API phải chỉ ra được nó
phục vụ yêu cầu nào. Không chỉ ra được nghĩa là làm thừa; yêu cầu không có API nghĩa là làm thiếu.

## 3. Bảng truy vết đầy đủ

BG dùng bản rút gọn 6 mục tiêu trong `srs.md` (BG01–BG06). API có tiền tố `/api/v1` tại Gateway.

### 3.1 Tài khoản và người dùng

| Năng lực | BG | BR | FR | BRULE | UC | API | Service | Mục chấm |
|---|---|---|---|---|---|---|---|---|
| Đăng ký khách hàng | BG03 | BR05 | FR26 | — | UC01 | `POST /auth/register` | Identity | 9 |
| Đăng nhập, cấp token | BG05 | BR05 | FR26 | Tài khoản khóa bị từ chối (Exception UC02) | UC02 | `POST /auth/login` | Identity | 10, 25, 27 |
| Thông tin khách hàng | BG03 | BR05 | FR27 | — | UC03 | `GET/PUT /customers/me`, `GET /customers/{id}`⁺ | Identity | 11 |
| Phân quyền | BG05 | BR13 | FR32 | BRULE12 | UC25 | Kiểm tra role tại Gateway | Gateway, Identity | 28 |

### 3.2 Tài xế và phương tiện

| Năng lực | BG | BR | FR | BRULE | UC | API | Service | Mục chấm |
|---|---|---|---|---|---|---|---|---|
| Đăng ký tài xế (OTP), hồ sơ chờ duyệt | BG02 | BR08 | FR26, FR39⁺ | — | UC29⁺ | Chưa có⁺ | Identity, Fleet | 21 |
| Admin duyệt / từ chối hồ sơ | BG02 | BR08 | FR28, FR39⁺ | BRULE12 | UC20, UC30⁺ | Chưa có⁺ | Fleet | 22 |
| Hồ sơ tài xế, phương tiện | BG02 | BR08 | FR28, FR29 | BRULE02 | UC20, UC21 | `GET/PUT /drivers/me`, `/drivers/me/vehicles`, `GET /drivers/{id}`⁺ | Fleet | 12 |
| Bật / tắt nhận chuyến | BG01 | BR06 | FR38⁺ | BRULE01 | UC28⁺ | `PATCH /drivers/me/status` | Fleet | 23 |
| Cập nhật vị trí tài xế | BG03 | BR03 | FR13 | — | UC12 | `POST /drivers/me/location` | Fleet | 17 |
| Tài xế quanh một tọa độ | BG01 | BR02 | FR02, FR04 | BRULE01, BRULE03 | UC06 | `GET /drivers/nearby`⁺ | Fleet | 13 |

### 3.3 Đặt xe và ghép tài xế

| Năng lực | BG | BR | FR | BRULE | UC | API | Service | Mục chấm |
|---|---|---|---|---|---|---|---|---|
| Tạo yêu cầu đặt xe | BG01 | BR01 | FR01, FR35⁺ | — | UC04, UC05 | `POST /bookings` | Booking | 15 |
| Danh sách booking của khách | BG03 | BR03 | FR37⁺ | — | UC18 | `GET /bookings`⁺ | Booking | 14 |
| Tìm, lọc, xếp hạng tài xế | BG01 | BR02 | FR02–FR05 | BRULE01–03 | UC06 | Nội bộ: Kafka + gRPC | Dispatch → Fleet | 15 |
| Gửi offer; nhận, từ chối, hết giờ | BG01 | BR02, BR07 | FR06–FR11 | BRULE04–07 | UC07–UC09 | `POST /driver-requests/{id}/accept`, `/reject` | Dispatch | 15, 16 |

### 3.4 Chuyến đi

| Năng lực | BG | BR | FR | BRULE | UC | API | Service | Mục chấm |
|---|---|---|---|---|---|---|---|---|
| Cập nhật trạng thái chuyến | BG03 | BR07 | FR12 | Đúng trình tự vòng đời | UC11 | `PATCH /trips/{id}/status` | Trip | 17 |
| Theo dõi chuyến | BG03 | BR03 | FR13–FR15 | — | UC10 | `GET /trips/{id}`, `/locations` | Trip | 17 |
| Hủy chuyến | BG03 | BR01, BR09 | FR36⁺ | — | UC27⁺ | `POST /bookings/{id}/cancel`, `POST /trips/{id}/cancel`⁺ | Booking, Trip | 18 |

### 3.5 Tiền, thông báo, đánh giá, vận hành

| Năng lực | BG | BR | FR | BRULE | UC | API | Service | Mục chấm |
|---|---|---|---|---|---|---|---|---|
| Tính cước | BG04 | BR12 | FR16 | BRULE08 | UC13 | `GET /trips/{id}/fare` | Payment | 19 |
| Thanh toán | BG04 | BR04 | FR17–FR20 | BRULE09, BRULE10 | UC14, UC15 | `POST /trips/{id}/payments`, `/payments/{id}/webhook`, `/retry` | Payment | 19, 30 |
| Thông báo | BG03 | BR10 | FR21–FR24 | BRULE07 | UC16 | `GET /notifications` | Notification | 16, 18 |
| Đánh giá tài xế | BG03 | BR11 | FR25 | BRULE11 | UC17 | `POST /trips/{id}/rating` | Rating | 20 |
| Giám sát, sự cố, báo cáo | BG02, BG06 | BR09, BR14 | FR30, FR31, FR33 | BRULE12 | UC22–UC24, UC26 | `/operator/*` | Operations | Không có trong phiếu |
| Bảo vệ dữ liệu, lưu vết | BG05 | BR15 | FR34 | BRULE09 | — | Cắt ngang | Mọi service | 24–27, 29 |

## 4. Những lỗ hổng phát hiện khi truy vết

### 4.1 Đã sửa trong buổi này

| Lỗi | Sửa |
|---|---|
| `srs.md` có **hai hệ đánh số UC**: danh sách UC01–UC26, nhưng phần đặc tả lại đánh UC01–UC08 theo thứ tự khác (UC01 vừa là "Đăng ký" vừa là "Đăng nhập") | Đặc tả đổi theo danh sách: UC02 Đăng nhập, UC04 Đặt xe, UC06 Tìm tài xế, UC10 Theo dõi, UC11 Thực hiện chuyến, UC14 Thanh toán, UC17 Đánh giá, UC22 Giám sát |
| Bảng đặc tả Đăng nhập bị lặp hai lần | Bỏ một bảng |
| RTM dùng mã UC cũ và ghi `RULE01` thay vì `BRULE01` | Đổi mã UC, thống nhất `BRULE` |
| RTM02 gắn FR02 "Tìm tài xế" vào BR01 "Đặt xe" | Chuyển sang BR02 |
| File DDD dùng mã UC cũ ở bảng mapping và ba chỗ khác | Đổi theo danh sách UC |
| File DDD ghi "tài khoản khóa bị từ chối (BR05)", nhưng BR05 trong SRS là "quản lý thông tin khách hàng" | Dẫn chiếu đúng: Exception UC02 + NFR06 |
| DDD không gán FR27 cho context nào | Gán vào Identity & Access |

Bản gốc của hai file trước khi sửa được lưu trong thư mục tạm của phiên làm việc.

### 4.2 Yêu cầu thiếu so với phiếu chấm (đã thêm vào `srs.md` kèm AC16–AC20, RTM17–RTM21)

Phiếu chấm có những mục mà `srs.md` chưa có FR/UC tương ứng:

| Đề xuất | Nội dung | Lý do |
|---|---|---|
| **FR35**⁺ Tạo yêu cầu đặt xe | Nhận điểm đón, điểm đến, loại xe; tạo Booking ở trạng thái đang tìm tài xế | BR01 nói "đặt xe" nhưng FR01 chỉ là "xác định vị trí". Không có FR nào tạo Booking; AC01, AC02 đang không có FR để bám |
| **FR36**⁺ Hủy yêu cầu / hủy chuyến | Khách hủy kèm lý do; chuyển CANCELED; báo các bên | Mục chấm 18 |
| **FR37**⁺ Xem danh sách booking | Có giới hạn và phân trang | Mục chấm 14; UC18 có nhưng không có FR |
| **FR38**⁺ Tài xế bật / tắt nhận chuyến | Online / Offline | Mục chấm 23; BR06 có nhưng không có FR riêng |
| **FR39**⁺ Đăng ký và duyệt hồ sơ tài xế | OTP → hồ sơ chờ duyệt → Admin duyệt / từ chối | Mục chấm 21, 22 |
| **UC27–UC30**⁺ | Hủy chuyến; Bật/tắt nhận chuyến; Đăng ký tài xế; Duyệt hồ sơ tài xế | Đi kèm các FR trên |

API còn thiếu trong `API document/`: `GET /customers/{id}`, `GET /drivers/{id}`, `GET /drivers/nearby`,
`GET /bookings` (phân trang), `POST /trips/{id}/cancel`, nhóm đăng ký/duyệt tài xế, và ba endpoint health.
Phần này làm ở buổi rà API.

### 4.3 Câu hỏi bạn cần tự quyết (giảng viên có thể hỏi)

1. ~~Hai danh sách BG~~ **Đã chốt:** danh sách 6 mục tiêu là chính thức, danh sách 12 mục bỏ mã; BG05 thêm "bảo mật". Gốc vấn đề: `srs.md` có danh sách 12 mục tiêu rồi một danh sách "quan trọng nhất" 6 mục tiêu, **đánh lại số từ BG01**. BG03 ở danh sách đầu là "Giảm thời gian tìm tài xế", ở danh sách sau là "Nâng cao trải nghiệm khách hàng". RTM dùng danh sách sau. Nên giữ một danh sách.
2. **RTM09:** FR12 "Cập nhật trạng thái chuyến" đang gắn BRULE08 "Chỉ tính cước khi chuyến hoàn thành". Hai thứ này không liên quan trực tiếp.
3. **RTM11:** FR16 "Tính cước" đang gắn AC11 "Ghi nhận thanh toán tiền mặt". Chưa có AC nào cho tính cước.
4. **RTM12:** FR17 "Thanh toán tiền mặt" gắn BRULE09 "Không lưu thông tin thanh toán nhạy cảm". Tiền mặt không có thông tin thẻ.
5. ~~Admin hay Operator~~ **Đã chốt:** một vai trò, tên trong hệ thống là `admin`. Gốc vấn đề: phiếu chấm gọi người duyệt hồ sơ là "Admin"; SRS chỉ có "Operator". Là một vai trò hay hai?
6. **Mục "Bước 6: Business Process" và "Exception"** trong `srs.md` đang để trống.
7. **Mô hình dữ liệu:** SRS có ba bảng Customer, Driver, Admin/Operator, mỗi bảng tự giữ `password_hash`; DDD và code dùng một bảng `Account`. Phần này giải quyết ở buổi DDD.

## 5. Tự kiểm tra cuối buổi

1. Nói bài toán nghiệp vụ của CAB trong ba câu, không nhìn tài liệu.
2. BR02, FR04 và BRULE03 khác nhau thế nào? Chúng liên quan gì đến nhau?
3. Truy vết mục chấm 15 (đặt xe) ngược lên: API nào → UC nào → FR nào → BR nào → BG nào?
4. BRULE04 và BRULE06 dẫn đến quyết định kỹ thuật nào ở Dispatch?
5. BRULE11 được đảm bảo ở service nào, bằng cách nào?
6. Vì sao cần thêm FR35? Thiếu nó thì bảng truy vết hỏng ở đâu?
7. NFR05 ảnh hưởng thế nào đến việc chọn Kafka cho Notification?

## 6. Quyết định đã chốt trong buổi

| Quyết định | Nội dung | Ảnh hưởng tiếp theo |
|---|---|---|
| Tiêu chí ghép tài xế | Tài xế sẵn sàng, đúng loại xe, **gần điểm đón nhất** được hỏi trước (BR02, FR05, BRULE03, AC05 đã sửa) | Dispatch sắp xếp theo khoảng cách tăng dần |
| Vai trò quản trị | Một vai trò `admin` (SRS gọi là Operator) | DB: đổi `operator` → `admin` trong ràng buộc `role`; DDD và API `/operator/*` cần rà lại |
| Business Goal | Dùng danh sách 6 mục tiêu BG01–BG06 | RTM giữ nguyên mã |
| Phương thức thanh toán | Khách chọn tiền mặt / online khi đặt xe (FR35) | Booking có cột `payment_method` |
| Thời điểm thanh toán | **Trả sau**: tính cước và thanh toán sau khi chuyến hoàn thành (BRULE08 giữ nguyên) | Payment nghe event `trip-completed`; không cần luồng hoàn tiền |
| Bán kính tìm tài xế | **1 km** quanh điểm đón, theo mục chấm 13 (FR02 đã ghi) | Fleet nhận tham số bán kính, mặc định 1 km |
