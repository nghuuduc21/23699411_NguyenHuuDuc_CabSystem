# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Chấm theo phiếu 30 mục (`docs/study/00-ban-do-phieu-cham.md`) kèm vấn đáp. Trả lời và viết tài liệu bằng tiếng Việt.

Sinh viên phải tự giải thích được mọi quyết định. Vì vậy mỗi quyết định thiết kế (chia service, chọn database, kiểu dữ liệu, cách giao tiếp) phải ghi kèm **lý do** và **đánh đổi**.

## Trạng thái

Nhánh `rebuild/agent-workflow`: xây lại từ đầu bằng quy trình ba agent. **Vòng 1 (thiết kế) đã có đủ bốn file** `docs/design/01`–`04` và ADR-001 đến ADR-012; sinh viên chưa rà hết và chưa hỏi giảng viên. Chưa có đặc tả trong `docs/specs/` và chưa có code. Bản cũ nằm ở nhánh `codex/customer-registration`, chỉ để tham khảo, không sao chép lại nguyên trạng.

## Tài liệu

| Cần biết | Xem | Trạng thái |
|---|---|---|
| Nghiệp vụ: BG01–06, BR, FR01–FR42, BRULE01–17, NFR01–16, UC01–UC33, AC01–AC26, RTM01–RTM26 | `srs.md` | Có, đã rà |
| 30 mục phiếu chấm | `docs/study/00-ban-do-phieu-cham.md` | Có |
| Truy vết yêu cầu → mục chấm; quyết định nghiệp vụ đã chốt | `docs/study/01-nghiep-vu-va-truy-vet.md` | Có |
| Thiết kế tham chiếu đã được giảng viên duyệt (kiến trúc, bảng) và điều chỉnh của giảng viên | `docs/reference/thiet-ke-da-duyet.md` + hai ảnh cùng thư mục | Có |
| Bounded context, aggregate, quy tắc | `docs/design/01-bounded-contexts.md` | Có |
| Service, đường giao tiếp, topic Kafka, nhiệm vụ Gateway | `docs/design/02-kien-truc-giao-tiep.md` | Có |
| Database từng service, bảng, kiểu dữ liệu, ERD, seed, mã hóa | `docs/design/03-du-lieu.md` | Có |
| API REST của Gateway, ma trận phân quyền, chuỗi request từng mục chấm | `docs/design/04-api.md` | Có |
| Quy trình nghiệp vụ theo mô hình 5 thành phần (Procedures, People, Hardware, Software, Data) | `docs/design/05-quy-trinh-5-thanh-phan.md` | Có |
| Ảnh kiến trúc và ảnh bounded context / database (vẽ từ `docs/design/02` và `03`; sửa thiết kế thì sửa file `.html` cùng thư mục rồi xuất lại ảnh) | `docs/architecture/kien-truc.png`, `bounded-context-db.png` | Có |
| Đặc tả từng phần việc | `docs/specs/` | Chưa có |
| Quyết định thiết kế kèm lý do | `docs/decisions/` | ADR-001 đến ADR-012 |
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
| Đăng ký | Đăng ký tài khoản công khai chỉ tạo `customer`. Tài xế đăng ký theo luồng riêng: OTP → hồ sơ chờ duyệt → Admin duyệt (FR39) |
| Ghép tài xế | Tài xế đang sẵn sàng, đúng loại xe, trong bán kính 1 km, gần điểm đón nhất được hỏi trước (BRULE01–03) |
| Cước | **Cước cố định**, tính một lần khi đặt xe, áp dụng cho cả hai phương thức (FR16, BRULE08). Công thức: `cước = giá mở cửa + đơn giá mỗi km × quãng đường ước tính`; `quãng đường ước tính = khoảng cách đường thẳng × 1,3`; làm tròn lên 1.000 đ; không thấp hơn cước tối thiểu. Không tính theo thời gian, không có giá giờ cao điểm, không có phí hủy |
| Loại xe và bảng giá (số minh họa) | Xe máy: mở cửa 10.000 đ, 5.000 đ/km, tối thiểu 15.000 đ. Ô tô 4 chỗ: 20.000 đ, 12.000 đ/km, tối thiểu 30.000 đ. Ô tô 7 chỗ: 25.000 đ, 15.000 đ/km, tối thiểu 40.000 đ |
| Thanh toán | Khách chọn phương thức khi đặt xe. **Điện tử: trả trước**, thanh toán thành công rồi hệ thống mới tìm tài xế (BRULE13); khách có tối đa 10 phút và 3 lần thử, quá thì booking bị hủy (BRULE17). **Tiền mặt:** trả cho tài xế khi chuyến hoàn thành, hệ thống ghi nhận (FR17) |
| Hoàn tiền | Hoàn đủ khi chuyến không được thực hiện: khách hủy trước khi có tài xế; khách hủy sau khi có tài xế; không tìm được tài xế; tài xế hủy chuyến đã nhận (BRULE14). **Không hoàn** khi chuyến đã hoàn thành, và khi tài xế chỉ từ chối lời mời (BRULE15) |
| "COMPLETED" ở mục chấm 19 | Là trạng thái của **giao dịch thanh toán** (Payment), không phải của chuyến |
| Hủy và từ chối | Chỉ hủy được **trước khi chuyến bắt đầu** (BRULE16). **Khách hàng** hủy kèm lý do: trước khi có tài xế thì hủy Booking, sau khi có tài xế thì hủy Trip (mục chấm 18). **Tài xế từ chối lời mời** (FR08): không hủy gì, hệ thống hỏi tài xế kế tiếp. **Tài xế hủy chuyến đã nhận** (FR41): Trip chuyển CANCELED, khách được hoàn tiền; hệ thống không tự tìm tài xế khác, khách đặt lại |

## Quyết định kỹ thuật đã chốt

| Điểm | Quyết định | Lý do | Đánh đổi |
|---|---|---|---|
| Đăng ký khách hàng | `auth-service` gọi gRPC đồng bộ sang `customer-service` để tạo hồ sơ | Mục chấm 11 chạy ngay sau mục 9: đăng ký xong phải xem được hồ sơ | Customer lỗi thì đăng ký lỗi theo |
| Tài xế nhận chuyến | `booking-service` gọi gRPC đồng bộ `CreateTrip` sang `trip-service` | Tài xế nhận xong phải có ngay mã chuyến để cập nhật trạng thái (mục chấm 16 → 17). Một lần nhận chuyến mà không có Trip là vô nghĩa, nên Booking được phép chờ và lỗi theo Trip. Đúng nguyên tắc đồng bộ là mặc định | Trip lỗi thì tài xế không nhận được chuyến |
| Đặt xe → cước và thanh toán | `booking-service` gọi gRPC đồng bộ sang `payment-service` để tính cước cố định và tạo thanh toán | Booking phải trả ngay cho khách số tiền và mã thanh toán | Payment lỗi thì không đặt được xe. Đây là hệ quả của trả trước và là đánh đổi so với NFR05; cần nêu khi trình bày |
| Kết quả thanh toán, hoàn tiền | Payment phát event Kafka; Booking nghe kết quả thanh toán để bắt đầu tìm tài xế. Payment nghe event hủy và không tìm được tài xế để hoàn tiền | Tiền đã trừ thì Payment phải ghi nhận xong dù Booking đang lỗi; việc hủy phải thành công dù Payment đang lỗi (NFR05); nhiều bên cùng nghe | Có khoảng trễ ngắn giữa thanh toán xong và bắt đầu tìm tài xế |
| Trả tài xế về rảnh sau chuyến | `driver-service` nghe topic `trip.status-changed` (Kafka), không dùng gRPC | Chuyến kết thúc ngoài đời thật thì phải được ghi nhận dù `driver-service` đang lỗi; sự kiện này đã có Payment và Notification cùng nghe. Khác với tài xế nhận chuyến (gRPC): ở đó bên gọi nên lỗi theo bên nhận | Tài xế được trả về rảnh chậm khoảng một giây |
| Tính cước | `booking-service` tính quãng đường ước tính từ tọa độ rồi gửi quãng đường (số nguyên, đơn vị mét) và loại xe cho `payment-service`; `payment-service` giữ bảng giá, tính cước và lưu từng thành phần của cước | Booking có tọa độ; quy tắc giá thuộc context Fare & Payment, đổi giá chỉ sửa một nơi. Lưu từng thành phần để giải thích được con số cuối | Hai service cùng tham gia một phép tính |
| Redis dừng | Gateway vẫn cho request đi qua và ghi log cảnh báo | Hệ thống không dừng chỉ vì thiếu bộ đếm rate limit | Trong lúc Redis dừng không có rate limit, và token đã đăng xuất tạm dùng lại được |
| Đăng xuất | Gateway xử lý: ghi mã của token vào danh sách thu hồi trong Redis, tự hết hạn cùng lúc với token (FR42) | Gateway là nơi kiểm tra token ở mọi request nên tra danh sách tại chỗ, không phải gọi sang Auth | Phụ thuộc Redis |
| Khóa chính | UUID (kiểu `uuid` của PostgreSQL, sinh bằng `gen_random_uuid()`) | Mỗi service tự sinh ID không cần nơi cấp số chung; ID không đoán được nên khó dò dữ liệu người khác; ID đi qua event và service khác vẫn duy nhất | Dài, khó đọc khi demo; index lớn hơn INT. Khác thiết kế tham chiếu (dùng INT) |
| Phân quyền | Ba role cố định trong cột `role`; **không có bảng PERMISSION** | Phiếu chấm chỉ kiểm tra theo role (mục 28); quyền không đổi lúc chạy | Thêm quyền mới phải sửa code Gateway |
| Lỗi sai trạng thái | gRPC `FAILED_PRECONDITION` → HTTP 409 | Thao tác hợp lệ nhưng sai thời điểm (ví dụ hoàn thành chuyến chưa bắt đầu, mục chấm 17) là lỗi của request, không phải lỗi hạ tầng | — |
| Hệ thống ngoài | Bản đồ, cổng thanh toán, kênh gửi thông báo đều **giả lập**, đặt sau một lớp adapter | Demo không phụ thuộc mạng, tài khoản và khóa API bên ngoài; adapter giữ được NFR13 (đổi sang nhà cung cấp thật không sửa nghiệp vụ) | Không chứng minh được tích hợp thật |

## Ràng buộc khi chấm

Mỗi mục chấm chỉ có khoảng **30 giây** để thực hiện trên Postman. Vì vậy:

- Luồng thành công không có bước nào phải chờ: mọi thao tác phản hồi ngay, event Kafka được xử lý trong khoảng một giây.
- Mọi giới hạn thời gian (hạn chờ thanh toán, hạn tài xế trả lời lời mời, cửa sổ rate limit) là **giới hạn trên** và đọc từ biến môi trường, để chỉnh ngắn lại khi cần demo trường hợp hết hạn.
- Cổng thanh toán giả lập gửi callback ngay sau khi nhận yêu cầu thanh toán.
- Dữ liệu cần có sẵn (tài khoản, tài xế đã duyệt và đang Online, booking mẫu) được tạo bằng seed, không tạo tay lúc chấm.
- Postman collection chia thư mục theo số mục chấm; script của request tự lưu token và các ID vào biến để request sau dùng luôn.

## Cấu trúc thư mục mục tiêu

```
proto/                    hợp đồng gRPC, mỗi service một file
services/<tên>/           mỗi service: package.json, Dockerfile, src/, migrations/ riêng
tests/                    test tích hợp và end-to-end
postman/                  collection theo số mục chấm
compose.yaml              toàn hệ thống (8 service, database, Redis, Kafka, Kafka UI); chỉ gateway và Kafka UI có `ports`
.env.example              mẫu biến môi trường (không commit .env)
```

## Quy ước code

- Node.js ≥ 20, ES Modules, phiên bản dependency ghi chính xác. Chú thích trong code bằng tiếng Việt, giải thích **vì sao**.
- Tách logic nghiệp vụ khỏi tầng giao tiếp; truyền dependency từ ngoài vào để test không cần database thật.
- SQL luôn dùng tham số (`$1`). Thay đổi schema bằng file migration mới, không sửa migration đã chạy.
- Mọi lời gọi gRPC có deadline. Gateway đổi gRPC status sang HTTP: `INVALID_ARGUMENT` 400, `UNAUTHENTICATED` 401, `PERMISSION_DENIED` 403, `NOT_FOUND` 404, `ALREADY_EXISTS` 409, `FAILED_PRECONDITION` 409, còn lại 503.
- Lỗi trả `{ "error": "MA_LOI" }`. Không trả stack trace; không log mật khẩu, token, dữ liệu cá nhân.
- Service lắng nghe `0.0.0.0` trong container và gọi nhau bằng tên service của Compose.
- Test dùng `node:test`. Commit: `feat(identity): ...`, `test(gateway): ...`, `docs: ...`.

## Quy trình ba agent

1. **ba-agent** thiết kế và viết đặc tả (`docs/design/`, `docs/specs/`). Không viết code.
2. **dev-agent** code đúng theo đặc tả. Đặc tả thiếu thì dừng và báo.
3. **test-agent** viết, chạy test và Postman, ghi báo cáo. Không sửa code; lỗi thì báo để dev-agent sửa.

Lộ trình và prompt mẫu: `docs/HUONG-DAN-AGENT.md`.
