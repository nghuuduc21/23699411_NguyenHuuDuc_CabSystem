# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Chấm theo phiếu 30 mục (`docs/study/00-ban-do-phieu-cham.md`) kèm vấn đáp. Trả lời và viết tài liệu bằng tiếng Việt.

Sinh viên phải tự giải thích được mọi quyết định. Vì vậy mỗi quyết định thiết kế (chia service, chọn database, kiểu dữ liệu, cách giao tiếp) phải ghi kèm **lý do** và **đánh đổi**.

## Trạng thái

Nhánh `rebuild/agent-workflow`: xây lại từ đầu bằng quy trình ba agent. **Vòng 1 (thiết kế) đã xong:** `docs/design/01`–`05`, ADR-001 đến ADR-014 và hai ảnh sơ đồ. Đã đưa vào hai góp ý của giảng viên (2026-10-03): tách đăng ký khỏi hồ sơ khách hàng (ADR-013) và giả lập hệ thống ngoài thật đơn giản (ADR-014). Vòng 2: thiết kế, kịch bản thi (`docs/design/06`) và ba đặc tả đầu (`docs/specs/00`, `09-10`, `11`) đã đồng bộ theo luật thi và chuẩn đường dẫn `/api/v1` (ADR-015 đến ADR-018). Đã code và kiểm thử đặc tả `00-ha-tang`, `09-10`, `11`, `12-13-21-23` (tài xế), `14-15-16-19-30` (đặt xe, thanh toán). Đã code `17-18` (chuyến đi, hủy, hoàn tiền, thông báo), `20-29` (đánh giá, rate limit), cổng gRPC riêng (ADR-020), email trong hồ sơ khách (ADR-019), tài xế nộp lại hồ sơ (FR43). **Hồi quy 2026-10-07: cả 30 mục chấm đạt** (`docs/test-reports/2026-10-07-hoi-quy-toan-he-thong.md`). **Góp ý giảng viên 2026-10-14** (health trả `healthy`/`ready`; khách đăng ký và đăng nhập bằng email ở `/api/v1/auth/…`, số điện thoại khách vào hồ sơ; tài xế chỉ xem mã của mình; booking theo mã khách `customers/{id}/bookings`): đã code. Thêm 2026-10-21: khách xem tài xế của chuyến qua `GET /trips/{mã}` (tên, biển số chụp lúc nhận chuyến, bỏ S6), mọi lời gọi gRPC bật `waitForReady`. **Hồi quy cuối 2026-10-22: cả 30 mục đạt** (`docs/test-reports/2026-10-22-hoi-quy-cuoi.md`). Bộ luyện tập Postman: `postman/luyen-tap/`, hướng dẫn `docs/study/03-luyen-tap-postman.md`. Còn lại: push GitHub và ôn thi. Bản cũ nằm ở nhánh `codex/customer-registration`, chỉ để tham khảo, không sao chép lại nguyên trạng.

## Tài liệu

| Cần biết | Xem | Trạng thái |
|---|---|---|
| Nghiệp vụ: BG01–06, BR, FR01–FR43, BRULE01–19, NFR01–17, UC01–UC33, AC01–AC32, RTM01–RTM31 | `srs.md` | Có, đã rà |
| 30 mục phiếu chấm | `docs/study/00-ban-do-phieu-cham.md` | Có |
| Truy vết yêu cầu → mục chấm; quyết định nghiệp vụ đã chốt | `docs/study/01-nghiep-vu-va-truy-vet.md` | Có |
| Cẩm nang hệ thống: chức năng và API theo role, đường đi của request trong code, cấu trúc source, công nghệ, máy trạng thái, tình huống sự cố, lệnh vận hành | `docs/study/02-cam-nang-he-thong.md` | Có |
| Thiết kế tham chiếu đã được giảng viên duyệt (kiến trúc, bảng) và điều chỉnh của giảng viên | `docs/reference/thiet-ke-da-duyet.md` + hai ảnh cùng thư mục | Có |
| Bounded context, aggregate, quy tắc | `docs/design/01-bounded-contexts.md` | Có |
| Service, đường giao tiếp, topic Kafka, nhiệm vụ Gateway | `docs/design/02-kien-truc-giao-tiep.md` | Có |
| Database từng service, bảng, kiểu dữ liệu, ERD, seed, mã hóa | `docs/design/03-du-lieu.md` | Có |
| API REST của Gateway, ma trận phân quyền, chuỗi request từng mục chấm | `docs/design/04-api.md` | Có |
| Quy trình nghiệp vụ theo mô hình 5 thành phần (Procedures, People, Hardware, Software, Data) | `docs/design/05-quy-trinh-5-thanh-phan.md` | Có |
| Ảnh kiến trúc và ảnh bounded context / database (vẽ từ `docs/design/02` và `03`; sửa thiết kế thì sửa file `.html` cùng thư mục rồi xuất lại ảnh) | `docs/architecture/kien-truc.png`, `bounded-context-db.png` | Có |
| Kịch bản thi: request gõ tay, lệnh, câu trả lời vấn đáp cho từng mục chấm; những thứ phải nhớ | `docs/design/06-kich-ban-thi.md` | Có |
| Luyện tập 30 mục: Postman environment + collection theo thứ tự thi, 3 cấp độ, bảng bấm giờ | `docs/study/03-luyen-tap-postman.md`, `postman/luyen-tap/` | Có |
| Lộ trình 3 ngày đọc code và hiểu sâu hệ thống (15 giờ, file:dòng, câu tự kiểm) | `docs/study/04-lo-trinh-3-ngay.md` | Có |
| Hướng dẫn ôn tập trọn bộ dạng Word (hiểu hệ thống, 30 mục kèm code chạy, DevOps, câu hỏi vấn đáp, checklist ngày thi) | `docs/study/05-huong-dan-on-thi.docx` | Có |
| Đặc tả từng phần việc | `docs/specs/` | `00-ha-tang`, `09-10-dang-ky-dang-nhap`, `11-ho-so-khach-hang`, `12-13-21-23-tai-xe`, `14-15-16-19-30-dat-xe-thanh-toan`, `17-18-chuyen-di-thong-bao`, `20-29-danh-gia-gioi-han` (đã code, đã kiểm thử) |
| Quyết định thiết kế kèm lý do | `docs/decisions/` | ADR-001 đến ADR-022 |
| Báo cáo kiểm thử | `docs/test-reports/` | test-agent viết |

## Danh sách service (giảng viên chốt, không tự ý thêm bớt)

Tám bounded context, mỗi context một service:

| # | Bounded context | Service |
|---|---|---|
| 1 | Identity & Access | `auth-service` |
| 2 | Customer | `customer-service` |
| 3 | Driver & Vehicle (gộp; chỉ tách khi khách được tự chọn xe) | `driver-service` |
| 4 | Booking (gồm cả ghép tài xế) | `booking-service` |
| 5 | Trip (giảng viên gọi là Ride hoặc Trip; project dùng tên Trip) | `trip-service` |
| 6 | Fare & Payment | `payment-service` |
| 7 | Notification | `notification-service` |
| 8 | Rating | `rating-service` |

Không có service riêng cho ghép tài xế (dispatch), báo cáo (report) và lưu vết (audit). Thiết kế tham chiếu ở `docs/reference/` là mốc so sánh; mỗi quyết định vẫn phải truy vết về `srs.md` và có lý do, không sao chép nguyên trạng.

## Quy tắc kiến trúc (theo yêu cầu của giảng viên)

- **Client → Gateway: REST/JSON.** Gateway là cổng duy nhất mở ra ngoài (mục chấm 8).
- **Gateway → service: gRPC**, hợp đồng trong `proto/`.
- **Gateway:** authentication (JWT), authorization (role), rate limiting, routing REST → gRPC, log. Không chứa logic nghiệp vụ, không truy cập database nghiệp vụ. Gateway tự đảm nhận vai trò reverse proxy; **không đặt Nginx riêng** phía trước (giảng viên: bản chất Gateway đã bao gồm Nginx).
- **Redis ở Gateway**, chỉ cho hai việc có yêu cầu: bộ đếm rate limit (mục chấm 29) và danh sách token đã thu hồi khi đăng xuất. Không dùng Redis làm cache dữ liệu nghiệp vụ.
- **Database-per-service.** Loại database chọn theo nhu cầu của từng service và phải ghi lý do. Service không đọc database của service khác; tham chiếu chéo bằng ID, không có khóa ngoại.
- **Mỗi đường giao tiếp phải theo nghiệp vụ.** Không phải service nào cũng giao tiếp cả đồng bộ lẫn bất đồng bộ. Trước khi thêm một lời gọi gRPC giữa hai service hoặc một event Kafka, phải chỉ ra FR/BRULE/NFR cần nó:
  - **Đồng bộ (gRPC) là mặc định** khi hai service cần làm việc với nhau (giảng viên: các service thường giao tiếp đồng bộ bằng gRPC).
  - **Bất đồng bộ (Kafka) chỉ khi nghiệp vụ bắt buộc:** bên phát không được phép chờ hoặc không được phép thất bại theo bên nhận (ví dụ NFR05 với Payment và Notification), hoặc nhiều bên cùng cần biết một sự kiện. Mỗi topic ghi rõ service publish, service subscribe và lý do bắt buộc đó.
  - Không có lý do nghiệp vụ thì không thêm.
- **Kafka phải kiểm tra được** (mục chấm 7): topic được đăng ký rõ ràng, và xem được event qua giao diện Kafka UI ở một cổng trong Compose.
- **Message broker: Kafka** (đã chốt; giảng viên dạy Kafka ở slide 13). Thiết kế tham chiếu dùng RabbitMQ; khi tham khảo danh sách event của nó thì chuyển thành topic Kafka.

## Quyết định nghiệp vụ đã chốt

| Điểm | Quyết định |
|---|---|
| Vai trò | `customer`, `driver`, `admin` (SRS gọi là Operator) |
| Đăng ký | Khách đăng ký bằng email + mật khẩu `POST /api/v1/auth/register` (chỉ tạo `customer`). Tài xế đăng ký theo luồng riêng bằng số điện thoại: `POST /api/v1/auth/otp` → `POST /api/v1/auth/driver-register` → hồ sơ chờ duyệt → Admin duyệt (FR39). **Đăng nhập** `POST /api/v1/auth/login`: khách và admin bằng email, tài xế bằng số điện thoại (ADR-021). Hồ sơ bị từ chối thì tài xế nộp lại bằng chính `POST /api/v1/drivers`, hồ sơ về chờ duyệt (FR43). Tài xế xem lý do từ chối ở `GET /api/v1/drivers/{mã của mình}` |
| Ghép tài xế | Tài xế đang sẵn sàng, đúng loại xe, trong bán kính 1 km, gần điểm đón nhất được hỏi trước (BRULE01–03) |
| Cước | **Cước cố định**, tính một lần khi đặt xe, áp dụng cho cả hai phương thức (FR16, BRULE08). Công thức: `cước = giá mở cửa + đơn giá mỗi km × quãng đường ước tính`; `quãng đường ước tính = khoảng cách đường thẳng × 1,3`; làm tròn lên 1.000 đ; không thấp hơn cước tối thiểu. Không tính theo thời gian, không có giá giờ cao điểm, không có phí hủy |
| Loại xe và bảng giá (số minh họa) | Xe máy: mở cửa 10.000 đ, 5.000 đ/km, tối thiểu 15.000 đ. Ô tô 4 chỗ: 20.000 đ, 12.000 đ/km, tối thiểu 30.000 đ. Ô tô 7 chỗ: 25.000 đ, 15.000 đ/km, tối thiểu 40.000 đ |
| Thanh toán | Khách chọn phương thức khi đặt xe. **Điện tử: trả trước**, thanh toán thành công rồi hệ thống mới tìm tài xế (BRULE13); khách có tối đa 10 phút và 3 lần thử, quá thì booking bị hủy (BRULE17). **Tiền mặt:** trả cho tài xế khi chuyến hoàn thành, hệ thống ghi nhận (FR17) |
| Hoàn tiền | Hoàn đủ khi chuyến không được thực hiện: khách hủy trước khi có tài xế; khách hủy sau khi có tài xế; không tìm được tài xế; tài xế hủy chuyến đã nhận (BRULE14). **Không hoàn** khi chuyến đã hoàn thành, và khi tài xế chỉ từ chối lời mời (BRULE15) |
| Điều kiện đặt xe | Có thông tin cần thiết là đặt được: tài khoản `customer` đã đăng ký (email đã có ở auth) và đủ dữ liệu của yêu cầu đặt xe (điểm đón, điểm đến, loại xe, phương thức thanh toán). **Không bắt buộc đã tạo hồ sơ khách hàng**; Booking không gọi sang Customer để kiểm tra (Q56) |
| Hồ sơ khách hàng | Họ tên và số điện thoại (bắt buộc, không UNIQUE), ngày sinh (tùy chọn). **Email ở tài khoản (auth, để đăng nhập), số điện thoại của khách ở hồ sơ (customer, để liên hệ)**: mỗi dữ liệu một nơi (ADR-021, thay ADR-019). Khách và tài xế chỉ xem dữ liệu của mình theo mã (`account_id` trả khi đăng nhập), mã người khác → 403; admin xem mọi mã. Hồ sơ tài xế theo mã (`/drivers/{id}`) chỉ admin và chính tài xế xem được. Danh sách booking theo mã khách: `GET /api/v1/customers/{id}/bookings` |
| "COMPLETED" ở mục chấm 19 | Là trạng thái của **giao dịch thanh toán** (Payment), không phải của chuyến |
| Hủy và từ chối | Chỉ hủy được **trước khi chuyến bắt đầu** (BRULE16). **Khách hàng** hủy kèm lý do: trước khi có tài xế thì hủy Booking, sau khi có tài xế thì hủy Trip (mục chấm 18). **Tài xế từ chối lời mời** (FR08): không hủy gì, hệ thống hỏi tài xế kế tiếp. **Tài xế hủy chuyến đã nhận** (FR41): Trip chuyển CANCELED, khách được hoàn tiền; hệ thống không tự tìm tài xế khác, khách đặt lại |

## Quyết định kỹ thuật đã chốt

| Điểm | Quyết định | Lý do | Đánh đổi |
|---|---|---|---|
| Đăng ký và hồ sơ khách hàng | **Tách làm hai bước** (giảng viên đề xuất 2026-10-03). Đăng ký chỉ tạo tài khoản ở `auth-service` (email, mật khẩu); khách và admin đăng nhập bằng email, tài xế bằng số điện thoại (ADR-021). Sau khi đăng nhập, khách mở màn hình khác để tạo và cập nhật hồ sơ ở `customer-service`; `customer_id` lấy từ mã tài khoản trong token. **`auth-service` và `customer-service` không gọi nhau** | Giống thực tế: đăng ký → đăng nhập → cập nhật hồ sơ. Không còn tình huống một bên lỗi giữa chừng khiến tài khoản có mà hồ sơ không, nên không cần xử lý bù trừ | Ngay sau đăng ký chưa có hồ sơ: xem hồ sơ trả 404 cho đến khi khách tạo. Mục chấm 11 cần thêm một request tạo hồ sơ, hoặc dùng tài khoản seed đã có hồ sơ |
| Tài xế nhận chuyến | `booking-service` gọi gRPC đồng bộ `CreateTrip` sang `trip-service` | Tài xế nhận xong phải có ngay mã chuyến để cập nhật trạng thái (mục chấm 16 → 17). Một lần nhận chuyến mà không có Trip là vô nghĩa, nên Booking được phép chờ và lỗi theo Trip. Đúng nguyên tắc đồng bộ là mặc định | Trip lỗi thì tài xế không nhận được chuyến |
| Đặt xe → cước và thanh toán | `booking-service` gọi gRPC đồng bộ sang `payment-service` để tính cước cố định và tạo thanh toán | Booking phải trả ngay cho khách số tiền và mã thanh toán | Payment lỗi thì không đặt được xe. Đây là hệ quả của trả trước và là đánh đổi so với NFR05; cần nêu khi trình bày |
| Kết quả thanh toán, hoàn tiền | Payment phát event Kafka; Booking nghe kết quả thanh toán để bắt đầu tìm tài xế. Payment nghe event hủy và không tìm được tài xế để hoàn tiền | Tiền đã trừ thì Payment phải ghi nhận xong dù Booking đang lỗi; việc hủy phải thành công dù Payment đang lỗi (NFR05); nhiều bên cùng nghe | Có khoảng trễ ngắn giữa thanh toán xong và bắt đầu tìm tài xế |
| Trả tài xế về rảnh sau chuyến | `driver-service` nghe topic `trip.status-changed` (Kafka), không dùng gRPC | Chuyến kết thúc ngoài đời thật thì phải được ghi nhận dù `driver-service` đang lỗi; sự kiện này đã có Payment và Notification cùng nghe. Khác với tài xế nhận chuyến (gRPC): ở đó bên gọi nên lỗi theo bên nhận | Tài xế được trả về rảnh chậm khoảng một giây |
| Tính cước | `booking-service` tính quãng đường ước tính từ tọa độ rồi gửi quãng đường (số nguyên, đơn vị mét) và loại xe cho `payment-service`; `payment-service` giữ bảng giá, tính cước và lưu từng thành phần của cước | Booking có tọa độ; quy tắc giá thuộc context Fare & Payment, đổi giá chỉ sửa một nơi. Lưu từng thành phần để giải thích được con số cuối | Hai service cùng tham gia một phép tính |
| Redis dừng | Gateway vẫn cho request đi qua và ghi log cảnh báo | Hệ thống không dừng chỉ vì thiếu bộ đếm rate limit | Trong lúc Redis dừng không có rate limit, và token đã đăng xuất tạm dùng lại được |
| Đăng xuất | Gateway xử lý: ghi mã của token vào danh sách thu hồi trong Redis, tự hết hạn cùng lúc với token (FR42) | Gateway là nơi kiểm tra token ở mọi request nên tra danh sách tại chỗ, không phải gọi sang Auth | Phụ thuộc Redis |
| Khóa chính | **Số nguyên** (`bigint GENERATED ALWAYS AS IDENTITY`), không dùng UUID (đổi 2026-10-03 vì luật thi) | Khi thi phải gõ tay mọi request: `/customers/3` gõ được trong vài giây, UUID 36 ký tự thì không. Phiếu chấm ghi "lấy thông tin … với **mã số**". Thiết kế tham chiếu đã duyệt cũng dùng INT. Mỗi service tự cấp số cho dữ liệu của mình nên không trùng giữa các bảng của nó | Mã dễ đoán: đổi `/customers/3` thành `/customers/4` là thử được dữ liệu người khác. Vì vậy **mọi API theo mã phải kiểm tra quyền sở hữu** và trả 403 |
| Ký JWT | **HS256** với một khóa bí mật `JWT_SECRET` dùng chung cho auth (ký) và Gateway (kiểm tra) | Một biến môi trường, không cần script sinh cặp khóa; dễ nhớ và dễ giải thích khi thi. Đủ cho mục chấm 27: sửa payload thì chữ ký không khớp → 401 | Ai có khóa đều ký được token, nên khóa chỉ được nằm ở auth và Gateway; khi demo mục 27 (dán token lên jwt.io, sửa payload → 401) **không nhập `JWT_SECRET`** vào jwt.io. RS256 an toàn hơn nhưng thêm bước sinh khóa (sinh viên chọn giữ HS256, 2026-10-14) |
| Mã hóa dữ liệu nhạy cảm (mục chấm 24) | **Mật khẩu băm** (scrypt, có salt). **Mã hóa AES-256-GCM** các trường cá nhân **không dùng để tìm kiếm**: họ tên và ngày sinh trong hồ sơ khách, số giấy phép lái xe. Khóa lấy từ biến môi trường riêng của từng service. **Không mã hóa số điện thoại, email** (email ở `accounts`, số điện thoại khách ở `customer_profiles`, số điện thoại tài xế ở `accounts`; đều lưu rõ), không có chỉ mục mù (blind index) | Ví dụ trong phiếu chấm là mật khẩu: băm là đúng yêu cầu. Trường cần tìm kiếm (đăng nhập bằng số điện thoại, ràng buộc trùng) mà mã hóa thì phải thêm chỉ mục mù, thêm một khái niệm phải giải thích. Giữ phạm vi nhỏ để tự giải thích được | Số điện thoại và email nằm dạng rõ |
| Phát event Kafka | Service ghi database xong (commit) rồi **gửi event ngay**; không dùng bảng outbox | Ít bảng, ít tiến trình chạy nền, ít khái niệm phải giải thích; event đến trong khoảng một giây | Nếu service dừng đúng giữa lúc ghi xong và lúc gửi thì event bị mất. Bên nghe vẫn phải chịu được event lặp |
| Phân quyền | Ba role cố định trong cột `role`; **không có bảng PERMISSION** | Phiếu chấm chỉ kiểm tra theo role (mục 28); quyền không đổi lúc chạy | Thêm quyền mới phải sửa code Gateway |
| Cổng gRPC | Mỗi service một cổng riêng: auth 50051, customer 50052, driver 50053, booking 50054, trip 50055, payment 50056, notification 50057, rating 50058 (ADR-020) | Docker cấp lại IP khi container chạy lại; nếu mọi service cùng cổng 50051 thì kênh gRPC cũ có thể nối nhầm sang service khác. Khác cổng thì nối nhầm bị từ chối ngay và kênh tự tìm lại | Phải nhớ 8 số cổng (theo số thứ tự service) |
| Chống lặp event | Bên nghe chịu được event lặp: Payment, Driver, Booking đổi trạng thái có điều kiện (đã đổi rồi thì bỏ qua); Notification có UNIQUE `(event_id, recipient_id)`. Không có bảng "event đã xử lý" | Ít bảng, ít khái niệm; trạng thái nghiệp vụ đã đủ để biết việc đã làm chưa | Mỗi consumer phải tự viết điều kiện chống lặp đúng |
| Lỗi sai trạng thái | gRPC `FAILED_PRECONDITION` → HTTP 409 | Thao tác hợp lệ nhưng sai thời điểm (ví dụ hoàn thành chuyến chưa bắt đầu, mục chấm 17) là lỗi của request, không phải lỗi hạ tầng | — |
| Hệ thống ngoài | **Giả lập đơn giản nhất** để dễ chấm và dễ chạy (giảng viên, 2026-10-03), đặt sau một lớp adapter. **Cổng thanh toán:** module giả lập nằm trong `payment-service`; nhận yêu cầu thu hoặc hoàn tiền rồi gọi ngay phần xử lý callback, mặc định thành công; tham số `simulate_result` chỉ có hiệu lực khi bật chế độ giả lập: `FAILED` cố ý làm thất bại để demo thanh toán lỗi; `MANUAL` giữ thanh toán ở trạng thái chờ, **không** tự gọi callback, để người demo tự gửi callback từ Postman và người chấm thấy rõ bước "hệ thống nhận callback" → COMPLETED (mục chấm 19, Q57). Endpoint callback xác thực bằng một khóa bí mật cố định trong header, không dùng chữ ký HMAC. **Bản đồ:** công thức khoảng cách trên tọa độ. **Kênh thông báo và SMS:** chỉ lưu vào database và ghi log. **OTP:** ghi log; khi bật chế độ giả lập thì trả luôn mã trong response để Postman dùng tiếp | Demo không phụ thuộc mạng, tài khoản và khóa API bên ngoài; mỗi mục chấm làm được trong 30 giây; adapter giữ được NFR13 | Không chứng minh được tích hợp thật; chế độ giả lập phải tắt khi chạy thật |

## Ràng buộc khi chấm

Mỗi mục chấm chỉ có khoảng **30 giây** để thực hiện trên Postman, và mọi request phải gõ tay (xem "Ràng buộc khi thi"). Vì vậy:

- Luồng thành công không có bước nào phải chờ: mọi thao tác phản hồi ngay, event Kafka được xử lý trong khoảng một giây.
- Mọi giới hạn thời gian (hạn chờ thanh toán, hạn tài xế trả lời lời mời, cửa sổ rate limit) là **giới hạn trên** và đọc từ biến môi trường, để chỉnh ngắn lại khi cần demo trường hợp hết hạn.
- Cổng thanh toán giả lập gửi callback ngay sau khi nhận yêu cầu thanh toán, trừ khi gửi `simulate_result: "MANUAL"` (dùng cho mục chấm 19 để người demo tự gửi callback).
- Dữ liệu cần có sẵn (tài khoản, tài xế đã duyệt và đang Online, booking mẫu) được tạo bằng seed, không tạo tay lúc chấm.
- Postman collection trong `postman/` chỉ dùng để **test-agent kiểm thử và để sinh viên luyện tập**; khi thi không được dùng. Chuỗi request của mỗi mục phải gõ tay được trong 30 giây.

## Ràng buộc khi thi (2026-10-03)

Khi thi, sinh viên **không được mở tài liệu**, phải tự giải thích và tự thao tác:

| Luật | Hệ quả bắt buộc cho thiết kế và code |
|---|---|
| Postman **không được lưu sẵn** gì; gõ mọi request từ đầu | Mỗi mục chấm tối đa khoảng **3 request**. Body JSON ít trường, tên trường ngắn, có giá trị mặc định hợp lý (ví dụ loại xe, phương thức thanh toán). Header phụ tối thiểu, giá trị ngắn (ví dụ `Idempotency-Key: k1`). Response trả luôn kết quả cần xem để khỏi gọi thêm request kiểm tra |
| Đường dẫn và tên trường API | **Theo cấu trúc chuẩn của bài giảng: `/api/{version}/{resource}/{id}?{query-params}`**, ví dụ `GET http://localhost:3000/api/v1/customers/1`, `GET /api/v1/drivers?lat=10.82&lng=106.68&page=1&limit=2`. Tài nguyên là danh từ số nhiều; **không đặt động từ trong đường dẫn** (ngoại lệ có chủ đích: nhóm `/api/v1/auth/…` gồm `register`, `login`, `logout`, `otp`, `driver-register`, theo giảng viên 2026-10-14): đổi trạng thái bằng `PATCH /api/v1/{resource}/{id}` với body `{"status": ...}` (nhận/từ chối lời mời, cập nhật hay hủy chuyến, hủy booking, Online/Offline). Tên trường ngắn (`name`, `dob`, `vehicle`, `pay`, `from`, `to`); tên cột database vẫn đầy đủ. Giảng viên xác nhận 2026-10-03: bỏ `/api/v1` sẽ gây ấn tượng xấu |
| **Được copy/paste** giá trị từ response | Token, mã booking, mã thanh toán lấy bằng copy từ response trước |
| **Được dùng lại tab Postman** đã gõ ở mục trước và mở tab mới; **vừa làm vừa giải thích** trong cùng 30 giây | Chuỗi request phải ngắn hơn nữa vì thời gian giải thích nằm trong 30 giây; mục cần lặp (đổi trạng thái chuyến, gửi lại request cũ) dùng lại tab, chỉ sửa một giá trị |
| Cấu hình bí mật | `.env.example` chỉ có tên biến; **5 biến bí mật để trống**, khóa thật chỉ nằm trong `.env` trên máy thi (không commit). Thi trên máy cá nhân, mở VS Code, không clone lại nên `.env` luôn có sẵn (ADR-022, 2026-10-22; trước đó giảng viên cho phép khóa mẫu) |
| Lệnh terminal **phải gõ đầy đủ**, không chạy script soạn sẵn | Ít lệnh, lệnh ngắn: dựng hệ thống bằng `docker compose up -d --build`; tên container, database, user ngắn và theo một quy luật (ví dụ container `auth-db`, user `cab`, database `auth`). `.env` đã có sẵn trên máy thi; dựng lại từ đầu chỉ cần `docker compose down -v` rồi `docker compose up -d --build` |
| Không mở ghi chú; phải **học thuộc và giải thích** | Dữ liệu seed dễ nhớ và theo quy luật (khách `kh1@cab.vn`…, admin `admin@cab.vn`, tài xế `0910000001`…, cùng một mật khẩu; tài xế seed ở quanh một tọa độ mẫu dễ nhớ). Ít khái niệm kỹ thuật nhất có thể; thứ gì không phục vụ mục chấm hoặc không giải thích được thì bỏ |

## Cấu trúc thư mục mục tiêu

```
proto/                    hợp đồng gRPC, mỗi service một file
services/<tên>/           mỗi service: package.json, Dockerfile, src/, migrations/ riêng
tests/                    test tích hợp và end-to-end
postman/                  collection theo số mục chấm
compose.yaml              toàn hệ thống (8 service, database, Redis, Kafka, Kafka UI); chỉ gateway và Kafka UI có `ports`
.env.example              mẫu biến môi trường, biến bí mật để trống (không commit .env)
```

## Quy ước code

- Node.js ≥ 20, ES Modules, phiên bản dependency ghi chính xác. Chú thích trong code bằng tiếng Việt, giải thích **vì sao**.
- Tách logic nghiệp vụ khỏi tầng giao tiếp; truyền dependency từ ngoài vào để test không cần database thật.
- SQL luôn dùng tham số (`$1`). Thay đổi schema bằng file migration mới, không sửa migration đã chạy.
- Mọi lời gọi gRPC có deadline. Gateway đổi gRPC status sang HTTP: `INVALID_ARGUMENT` 400, `UNAUTHENTICATED` 401, `PERMISSION_DENIED` 403, `NOT_FOUND` 404, `ALREADY_EXISTS` 409, `FAILED_PRECONDITION` 409, còn lại 503.
- Lỗi trả `{ "error": "MA_LOI" }`. Không trả stack trace; không log mật khẩu, token, dữ liệu cá nhân.
- Service lắng nghe `0.0.0.0` trong container và gọi nhau bằng tên service của Compose. Mỗi service một cổng gRPC riêng theo số thứ tự: auth 50051 … rating 50058 (ADR-020).
- Test dùng `node:test`. Commit: `feat(identity): ...`, `test(gateway): ...`, `docs: ...`.

## Quy trình ba agent

1. **ba-agent** thiết kế và viết đặc tả (`docs/design/`, `docs/specs/`). Không viết code.
2. **dev-agent** code đúng theo đặc tả. Đặc tả thiếu thì dừng và báo.
3. **test-agent** viết, chạy test và Postman, ghi báo cáo. Không sửa code; lỗi thì báo để dev-agent sửa.

Lộ trình và prompt mẫu: `docs/HUONG-DAN-AGENT.md`.
