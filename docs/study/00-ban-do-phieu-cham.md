# Buổi 1 — Bản đồ phiếu chấm & tài liệu

> **Lưu ý (2026-10-03):** đường dẫn API trong file này là bản cũ. API chính thức theo chuẩn `/api/v1/{resource}/{id}?{query}` nằm ở `docs/design/04-api.md`; cách gõ khi thi nằm ở `docs/design/06-kich-ban-thi.md`.

> Tuần 1 · Giai đoạn 0. Cập nhật: 2026-09-30.
> Cột **Trạng thái** phản ánh code tại thời điểm viết: ✅ xong · 🟡 một phần · ❌ chưa có.
>
> **Lưu ý (2026-10-01):** project được xây lại từ đầu trên nhánh `rebuild/agent-workflow`. Cột Trạng thái và Demo dưới đây mô tả **bản cũ** (nhánh `codex/customer-registration`); trên nhánh mới, mọi mục đều bắt đầu từ ❌.

## 1. Cấu trúc phiếu chấm

Phiếu có 30 mục, mỗi mục 1 điểm. Ba dòng "BẢNG CHẤM THỰC HÀNH 1/2/3" nằm **sau** từng nhóm
(dòng cuối cùng của phiếu là "THỰC HÀNH 3" và không có mục nào theo sau), nên đó là dòng
tổng điểm của nhóm phía trên:

| Nhóm | Mục | Chủ đề | Service chính |
|---|---|---|---|
| Thực hành 1 | 1 – 10 | Kiến trúc, hạ tầng, đăng ký, đăng nhập | Gateway, Identity, Compose, Kafka |
| Thực hành 2 | 11 – 20 | Nghiệp vụ đặt xe trọn vòng | Identity, Fleet, Booking, Dispatch, Trip, Payment, Rating, Notification |
| Thực hành 3 | 21 – 30 | Luồng tài xế + bảo mật | Fleet, Identity, Gateway, Payment |

Hai loại mục:

- **Mô tả** (thi bằng lời + sơ đồ): 1, 3, 4. Chuẩn bị bằng ADR + `docs/architecture/cab-architecture.png`.
- **Kiểm tra / POSTMAN** (thi bằng chạy thật): tất cả mục còn lại. Mỗi mục cần một request mẫu trong Postman collection.

## 2. Bảng 30 mục

| # | Nội dung | Loại | Service | Trạng thái | Demo / bằng chứng |
|---|---|---|---|---|---|
| 1 | Mô tả kiến trúc tổ chức source code | Mô tả | Toàn repo | 🟡 | Chưa có README; `package.json` còn dùng chung |
| 2 | `.gitignore` và `.env` trên GitHub | Kiểm tra | Toàn repo | ❌ | `.gitignore` đang rỗng (0 byte) |
| 3 | Nhiệm vụ Gateway | Mô tả | Gateway | 🟡 | Có routing + log + REST→gRPC; thiếu JWT, role, rate limit |
| 4 | IPC giữa các microservice | Mô tả | Toàn hệ thống | 🟡 | gRPC Gateway→Identity đã chạy; chưa có Kafka, chưa có gRPC service↔service |
| 5 | Compose hệ thống, liệt kê container | Kiểm tra | Compose | ❌ | Compose mới có `identity-db` |
| 6 | `/health`, `/ready`, `/health/services` | POSTMAN | Gateway | 🟡 | Có `/health`, `/health/services`; thiếu `/ready` |
| 7 | Kafka / RabbitMQ | Kiểm tra | Kafka | ❌ | — |
| 8 | Mọi request đi qua Gateway | Kiểm tra | Compose | 🟡 | Identity chỉ nghe gRPC nội bộ; cần kiểm chứng lại trong Docker |
| 9 | Đăng ký khách hàng → đăng nhập được | POSTMAN | Identity | 🟡 | `POST /api/v1/auth/register` xong; vế "đăng nhập được" cần mục 10 |
| 10 | Đăng nhập → cấp token | POSTMAN | Identity | ❌ | — |
| 11 | Xem khách hàng theo mã (có token) | POSTMAN | Identity | ❌ | — |
| 12 | Xem tài xế theo mã (có token) | POSTMAN | Fleet | ❌ | — |
| 13 | Tài xế quanh tọa độ 1km, limit + paging, seed ≥ 5 tài xế | POSTMAN | Fleet | ❌ | — |
| 14 | Booking của khách, limit + paging, seed ≥ 5 booking | POSTMAN | Booking | ❌ | — |
| 15 | Đặt xe → tìm tài xế → gửi offer | POSTMAN | Booking, Dispatch, Fleet | ❌ | — |
| 16 | Tài xế nhận chuyến | POSTMAN | Dispatch, Trip, Notification | ❌ | — |
| 17 | Cập nhật trạng thái chuyến đúng trình tự | POSTMAN | Trip | ❌ | — |
| 18 | Hủy chuyến → CANCELED, các bên được báo | POSTMAN | Trip, Notification | ❌ | — |
| 19 | Thanh toán online + callback → COMPLETED | POSTMAN | Payment | ❌ | — |
| 20 | Đánh giá chuyến đi | POSTMAN | Rating | ❌ | — |
| 21 | Đăng ký tài xế (OTP) → hồ sơ chờ duyệt | POSTMAN | Identity, Fleet | ❌ | — |
| 22 | Admin duyệt / từ chối hồ sơ | POSTMAN | Fleet | ❌ | DB chưa có role `admin` |
| 23 | Tài xế bật / tắt nhận chuyến | POSTMAN | Fleet | ❌ | — |
| 24 | Dữ liệu nhạy cảm mã hóa at rest + key management | POSTMAN | Identity (+ khác) | 🟡 | Mật khẩu đã băm scrypt; chưa mã hóa field, chưa quản lý khóa |
| 25 | SQL injection | POSTMAN | Identity | 🟡 | SQL có tham số; cần login để demo đúng kịch bản |
| 26 | XSS | POSTMAN | Mọi service nhận text | ❌ | — |
| 27 | JWT bị sửa → 401 | POSTMAN | Gateway | ❌ | — |
| 28 | Sai quyền → 403 | POSTMAN | Gateway | ❌ | — |
| 29 | Spam → 429 | POSTMAN | Gateway + Redis | ❌ | — |
| 30 | Replay thanh toán → trả response cũ | POSTMAN | Payment | ❌ | — |

**Tổng hiện tại:** 0 ✅ · 8 🟡 · 22 ❌.

Mục 9 (đăng ký) và 25 (SQL injection) phụ thuộc vào mục 10 (đăng nhập), nên **Login là
việc có đòn bẩy cao nhất** sau khi sửa hạ tầng (mục 2, 5).

## 3. Service nào gánh bao nhiêu điểm

| Service | Mục liên quan | Số mục |
|---|---|---|
| Gateway | 3, 6, 8, 27, 28, 29 (+ đi qua trong mọi mục POSTMAN) | 6 |
| Identity | 9, 10, 11, 21, 24, 25 | 6 |
| Fleet | 12, 13, 21, 22, 23 | 5 |
| Booking / Dispatch | 14, 15, 16 | 3 |
| Trip | 16, 17, 18 | 3 |
| Payment | 19, 30 | 2 |
| Rating | 20 | 1 |
| Notification | 16, 18 (vế "các bên nhận thông báo") | 2 |
| Hạ tầng (Compose, Kafka, Git) | 2, 5, 7 | 3 |

## 4. Bản đồ tài liệu: câu hỏi nào tìm ở đâu

| Muốn trả lời… | Mở tài liệu |
|---|---|
| Hệ thống giải quyết vấn đề gì, cho ai | `srs.md` — Business Problem, Stakeholder, BG |
| Hệ thống phải làm gì | `srs.md` — BR, FR01–FR34, UC |
| Quy tắc nghiệp vụ bắt buộc | `srs.md` — BRULE01–12 |
| Chất lượng (bảo mật, hiệu năng, tin cậy) | `srs.md` — NFR01–16 |
| Chia service thế nào, vì sao | `DDD Bounded Contexts — Cab Booking System.md` |
| Service giao tiếp thế nào | `docs/architecture/cab-architecture.png`, `proto/*.proto` |
| API cụ thể (URL, body, status) | `API document/*.yml` |
| Kiểm thử gì | `Test Case/CAB_Test_Cases.xlsx`, phiếu chấm |
| Lý thuyết nền | Slide 12 (DDD, MSA), slide 13 (Gateway, IPC, gRPC, Kafka) |
| Bài mẫu tham khảo | `Bai_Tap_Thay_The_PROJECT/p3` (sơ đồ, ERD, traceability, API spec) |

## 5. Tự kiểm tra cuối buổi

Trả lời không nhìn tài liệu:

1. Ba nhóm của phiếu chấm là gì, mỗi nhóm kiểm tra năng lực gì?
2. Mục nào thi bằng lời? Bạn sẽ mang gì vào để trình bày?
3. Vì sao Login là việc nên làm sớm nhất trong các chức năng?
4. Mục 15 cần những service nào phối hợp, theo thứ tự nào?
5. Mục 8 được kiểm tra bằng cách nào, và hệ thống phải cấu hình gì để đạt?
