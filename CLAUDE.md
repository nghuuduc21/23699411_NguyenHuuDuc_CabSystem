# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Chấm theo phiếu 30 mục (`docs/study/00-ban-do-phieu-cham.md`) kèm vấn đáp. Trả lời và viết tài liệu bằng tiếng Việt.

Sinh viên phải tự giải thích được mọi quyết định. Vì vậy mỗi quyết định thiết kế (chia service, chọn database, kiểu dữ liệu, cách giao tiếp) phải ghi kèm **lý do** và **đánh đổi**.

## Trạng thái

Nhánh `rebuild/agent-workflow`: xây lại từ đầu bằng quy trình ba agent. Hiện **chỉ có nghiệp vụ** (`srs.md`); chưa có thiết kế kỹ thuật và chưa có code. Bản cũ nằm ở nhánh `codex/customer-registration`, chỉ để tham khảo, không sao chép lại nguyên trạng.

## Tài liệu

| Cần biết | Xem | Trạng thái |
|---|---|---|
| Nghiệp vụ: BG01–06, BR, FR01–FR39, BRULE01–12, NFR01–16, UC01–UC30, AC, RTM | `srs.md` | Có, đã rà |
| 30 mục phiếu chấm | `docs/study/00-ban-do-phieu-cham.md` | Có |
| Truy vết yêu cầu → mục chấm; quyết định nghiệp vụ đã chốt | `docs/study/01-nghiep-vu-va-truy-vet.md` | Có |
| Bounded context, aggregate, quy tắc | `docs/design/01-bounded-contexts.md` | ba-agent viết |
| Service, đường giao tiếp, topic Kafka, nhiệm vụ Gateway | `docs/design/02-kien-truc-giao-tiep.md` | ba-agent viết |
| Database từng service, bảng, kiểu dữ liệu, ERD | `docs/design/03-du-lieu.md` | ba-agent viết |
| API REST của Gateway | `docs/design/04-api.md` | ba-agent viết |
| Đặc tả từng phần việc | `docs/specs/` | ba-agent viết |
| Quyết định thiết kế kèm lý do | `docs/decisions/` | ba-agent viết |
| Báo cáo kiểm thử | `docs/test-reports/` | test-agent viết |

## Quy tắc kiến trúc (theo yêu cầu của giảng viên)

- **Client → Gateway: REST/JSON.** Gateway là cổng duy nhất mở ra ngoài (mục chấm 8).
- **Gateway → service: gRPC**, hợp đồng trong `proto/`.
- **Gateway:** authentication (JWT), authorization (role), rate limiting, routing REST → gRPC, log. Không chứa logic nghiệp vụ, không truy cập database nghiệp vụ.
- **Database-per-service.** Loại database chọn theo nhu cầu của từng service và phải ghi lý do. Service không đọc database của service khác; tham chiếu chéo bằng ID, không có khóa ngoại.
- **Mỗi đường giao tiếp phải theo nghiệp vụ.** Không phải service nào cũng giao tiếp cả đồng bộ lẫn bất đồng bộ. Trước khi thêm một lời gọi gRPC giữa hai service hoặc một event Kafka, phải chỉ ra FR/BRULE/NFR cần nó:
  - gRPC service ↔ service: chỉ khi bên gọi cần kết quả ngay mới làm tiếp được.
  - Kafka: chỉ cho sự kiện nghiệp vụ mà context khác cần biết và bên phát không cần chờ. Mỗi topic ghi rõ service publish, service subscribe và lý do.
  - Không có lý do nghiệp vụ thì không thêm.
- **Kafka phải kiểm tra được** (mục chấm 7): topic được đăng ký rõ ràng, và xem được event qua giao diện Kafka UI ở một cổng trong Compose.
- Số lượng service vừa đủ để đạt 30 mục chấm. Không tách service chỉ để có nhiều service.

## Quyết định nghiệp vụ đã chốt

| Điểm | Quyết định |
|---|---|
| Vai trò | `customer`, `driver`, `admin` (SRS gọi là Operator) |
| Đăng ký | Đăng ký tài khoản công khai chỉ tạo `customer`. Tài xế đăng ký theo luồng riêng: OTP → hồ sơ chờ duyệt → Admin duyệt (FR39) |
| Ghép tài xế | Tài xế đang sẵn sàng, đúng loại xe, trong bán kính 1 km, gần điểm đón nhất được hỏi trước (BRULE01–03) |
| Thanh toán | Khách chọn phương thức khi đặt xe; tính cước và thanh toán sau khi chuyến hoàn thành (BRULE08) |

## Cấu trúc thư mục mục tiêu

```
proto/                    hợp đồng gRPC, mỗi service một file
services/<tên>/           mỗi service: package.json, Dockerfile, src/, migrations/ riêng
tests/                    test tích hợp và end-to-end
postman/                  collection theo số mục chấm
compose.yaml              toàn hệ thống; chỉ gateway và Kafka UI có `ports`
.env.example              mẫu biến môi trường (không commit .env)
```

## Quy ước code

- Node.js ≥ 20, ES Modules, phiên bản dependency ghi chính xác. Chú thích trong code bằng tiếng Việt, giải thích **vì sao**.
- Tách logic nghiệp vụ khỏi tầng giao tiếp; truyền dependency từ ngoài vào để test không cần database thật.
- SQL luôn dùng tham số (`$1`). Thay đổi schema bằng file migration mới, không sửa migration đã chạy.
- Mọi lời gọi gRPC có deadline. Gateway đổi gRPC status sang HTTP: `INVALID_ARGUMENT` 400, `UNAUTHENTICATED` 401, `PERMISSION_DENIED` 403, `NOT_FOUND` 404, `ALREADY_EXISTS` 409, còn lại 503.
- Lỗi trả `{ "error": "MA_LOI" }`. Không trả stack trace; không log mật khẩu, token, dữ liệu cá nhân.
- Service lắng nghe `0.0.0.0` trong container và gọi nhau bằng tên service của Compose.
- Test dùng `node:test`. Commit: `feat(identity): ...`, `test(gateway): ...`, `docs: ...`.

## Quy trình ba agent

1. **ba-agent** thiết kế và viết đặc tả (`docs/design/`, `docs/specs/`). Không viết code.
2. **dev-agent** code đúng theo đặc tả. Đặc tả thiếu thì dừng và báo.
3. **test-agent** viết, chạy test và Postman, ghi báo cáo. Không sửa code; lỗi thì báo để dev-agent sửa.

Lộ trình và prompt mẫu: `docs/HUONG-DAN-AGENT.md`.
