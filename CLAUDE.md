# Cab Booking System

Project cuối kỳ môn MSA (IUH): hệ thống đặt xe theo kiến trúc microservice, DDD, database-per-service.
Chấm theo phiếu 30 mục (`docs/study/00-ban-do-phieu-cham.md`) kèm vấn đáp. Trả lời và viết tài liệu bằng tiếng Việt.

Sinh viên phải tự giải thích được mọi quyết định. Vì vậy mỗi quyết định thiết kế (chọn database, kiểu dữ liệu, cách giao tiếp) phải ghi kèm **lý do** và **đánh đổi**.

## Tài liệu nguồn

| Cần biết | Xem |
|---|---|
| Nghiệp vụ: BG, BR, FR01–FR39, BRULE01–12, NFR01–16, UC01–UC30, AC, RTM | `srs.md` |
| Bounded context, aggregate, event, database từng service | `DDD Bounded Contexts — Cab Booking System.md` |
| API REST của Gateway | `API document/*.yml` |
| Bảng truy vết yêu cầu → API → service → mục chấm; các quyết định đã chốt | `docs/study/01-nghiep-vu-va-truy-vet.md` |
| Sơ đồ kiến trúc | `docs/architecture/` |
| Đặc tả từng phần việc (đầu ra của ba-agent) | `docs/specs/` |
| Quyết định thiết kế kèm lý do | `docs/decisions/` |
| Báo cáo kiểm thử (đầu ra của test-agent) | `docs/test-reports/` |

## Quy tắc kiến trúc (theo yêu cầu của giảng viên)

- **Client → Gateway: REST/JSON.** Gateway là cổng duy nhất mở ra ngoài (mục chấm 8).
- **Gateway → service: gRPC**, hợp đồng trong `proto/`.
- **Gateway:** authentication (JWT), authorization (role), rate limiting, routing REST → gRPC, log. Không chứa logic nghiệp vụ, không truy cập database.
- **Database-per-service.** Service không đọc database của service khác; tham chiếu chéo bằng ID, không có khóa ngoại.
- **Mỗi đường giao tiếp phải theo nghiệp vụ.** Trước khi thêm một lời gọi gRPC giữa hai service hoặc một event Kafka, phải chỉ ra FR/BRULE/NFR cần nó:
  - gRPC service ↔ service: chỉ khi bên gọi cần kết quả ngay mới làm tiếp được.
  - Kafka: chỉ cho sự kiện nghiệp vụ mà context khác cần biết và bên phát không cần chờ. Mỗi topic ghi rõ service publish, service subscribe và lý do.
  - Không có lý do nghiệp vụ thì không thêm.
- Kafka phải xem được event qua giao diện (Kafka UI) trong Compose (mục chấm 7).

## Quyết định nghiệp vụ đã chốt

| Điểm | Quyết định |
|---|---|
| Vai trò | `customer`, `driver`, `admin` (SRS gọi là Operator). Database hiện còn `operator`, cần migration đổi sang `admin` |
| Đăng ký | `POST /auth/register` chỉ tạo `customer`. Tài xế đăng ký theo luồng riêng: OTP → hồ sơ chờ duyệt → Admin duyệt (FR39) |
| Ghép tài xế | Tài xế đang sẵn sàng, đúng loại xe, trong bán kính 1 km, gần điểm đón nhất được hỏi trước (BRULE01–03) |
| Thanh toán | Khách chọn phương thức khi đặt xe; tính cước và thanh toán sau khi chuyến hoàn thành (BRULE08) |

## Trạng thái code

```
proto/identity.proto            hợp đồng Gateway ↔ Identity (Check, Register)
services/gateway/src/           Express, cổng 8081; REST → gRPC
services/identity/src/          gRPC server, cổng 50051; PostgreSQL
services/identity/migrations/   SQL, chạy bằng migrate.js
tests/                          node:test
compose.yaml                    hiện mới có identity-db
```

Đã có: health check, đăng ký khách hàng qua gRPC. Các service khác chưa có code.
Hiện dùng một `package.json` ở gốc cho mọi service; mục tiêu là mỗi service có `package.json` và `Dockerfile` riêng.

## Lệnh

```bash
npm test                    # toàn bộ test
docker compose up -d        # hạ tầng
npm run migrate:identity    # tạo bảng
npm run dev:identity        # Identity gRPC
npm run dev:gateway         # Gateway REST
```

## Quy ước code

- Node.js ≥ 20, ES Modules, phiên bản dependency ghi chính xác. Chú thích trong code bằng tiếng Việt, giải thích **vì sao**.
- Tách logic nghiệp vụ khỏi tầng giao tiếp; truyền dependency từ ngoài vào (`createApp({ ... })`, `createIdentityServer({ ... })`) để test không cần database thật.
- SQL luôn dùng tham số (`$1`). Thay đổi schema bằng file migration mới, không sửa migration đã có.
- Mọi lời gọi gRPC có deadline. Gateway đổi gRPC status sang HTTP: `INVALID_ARGUMENT` 400, `UNAUTHENTICATED` 401, `PERMISSION_DENIED` 403, `NOT_FOUND` 404, `ALREADY_EXISTS` 409, còn lại 503.
- Lỗi trả `{ "error": "MA_LOI" }`. Không trả stack trace; không log mật khẩu, token, dữ liệu cá nhân.
- Cấu hình qua biến môi trường; commit `.env.example`, không commit `.env`.
- Commit: `feat(identity): ...`, `test(gateway): ...`, `docs: ...`.

## Quy trình ba agent

Làm theo từng mục của phiếu chấm, mỗi mục một vòng `ba-agent` → `dev-agent` → `test-agent`:

1. **ba-agent** viết đặc tả vào `docs/specs/`, cập nhật `srs.md`, file DDD, `API document/` nếu cần. Không viết code.
2. **dev-agent** code đúng theo đặc tả. Đặc tả thiếu thì dừng và báo.
3. **test-agent** viết, chạy test và Postman, ghi báo cáo. Không sửa code trong `services/`; lỗi thì báo để dev-agent sửa.

Hướng dẫn chi tiết và prompt mẫu: `docs/HUONG-DAN-AGENT.md`.
