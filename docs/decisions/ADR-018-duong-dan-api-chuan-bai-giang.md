# ADR-018 — Đường dẫn API theo chuẩn bài giảng: `/api/v1/{resource}/{id}`, đổi trạng thái bằng `PATCH`

- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — cấu trúc đường dẫn, "không động từ", `PATCH` + `status` do giảng viên / sinh viên chốt (`CLAUDE.md`, dòng "Đường dẫn và tên trường API"). Cách gộp nhiều mã vào một đường dẫn, tên `accounts` / `otps` / `driver-accounts` / `payment-callbacks`, hai ngoại lệ `auth/login`, `auth/logout` là BA đề xuất (`docs/design/04` P19–P24).
- Thay cho: quyết định "bỏ tiền tố `/api/v1`" và các đường dẫn có động từ của `docs/design/04` lần 3 (P12, P16).
- Liên quan: `docs/design/04` mục 1.9, 1.10, 2, 5, 8; `docs/design/06`; spec 00, 09-10, 11; ADR-015.

## Bối cảnh

Lần 3, để bớt ký tự phải gõ tay, BA bỏ tiền tố `/api/v1` và đặt đường dẫn theo hành động (`/offers/{id}/accept`, `/trips/{id}/cancel`, `/drivers/me/online`…). Giảng viên trả lời (2026-10-03): đường dẫn phải theo cấu trúc chuẩn của bài giảng **`/api/{version}/{resource}/{id}?{query-params}`**, bỏ `/api/v1` gây ấn tượng xấu; được dùng lại tab Postman; 30 giây tính cả giải thích.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Giữ đường dẫn lần 3, chỉ thêm `/api/v1` | Ít sửa | Vẫn có động từ (`accept`, `cancel`, `online`) — trái chuẩn bài giảng |
| B | **Tài nguyên số nhiều + `PATCH` đổi `status`**; mỗi thao tác giữ rpc riêng, Gateway chọn rpc theo giá trị `status` | Đúng chuẩn; proto không đổi; client nhớ ít đường dẫn hơn (32 thay 39) | Gateway phải đọc một field của body để chọn rpc |
| C | Như B nhưng gộp rpc (`UpdateOffer`, `UpdateTrip`) | Gateway đơn giản | Một rpc ôm nhiều quy tắc khác nhau (hủy chuyến ≠ tiến trạng thái: khác người được làm, khác event); sửa proto và service |

## Quyết định

Chọn **B**.

| Điểm | Thiết kế |
|---|---|
| Tiền tố | Mọi API nghiệp vụ dưới `/api/v1/`; `/health`, `/ready`, `/health/services` ở ngoài (không phải tài nguyên nghiệp vụ) |
| Method | Chỉ `GET`, `POST`, `PATCH` |
| Đổi trạng thái | `PATCH /api/v1/{resource}/{id}` + `{"status": …}` (kèm `reason` khi hủy). Duyệt hồ sơ tài xế dùng `approval_status` vì tài xế có hai trạng thái độc lập |
| Tìm, lọc | Query: `GET /api/v1/drivers?lat=10.82&lng=106.68&limit=2` |
| Hành động khó biểu diễn | Thành tài nguyên được tạo: `POST /api/v1/accounts`, `/otps`, `/driver-accounts`, `/payments/{id}/transactions`, `/payment-callbacks` |
| Ngoại lệ có động từ | Chỉ `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` — quy ước phổ biến; không có bản ghi nào được tạo |
| Mã API | Giữ A01–A39; mã = một thao tác = một rpc; nhiều mã chung một đường dẫn |

## Vì sao

1. Đúng yêu cầu giảng viên; đường dẫn nói "cái gì", method nói "làm gì".
2. Không đổi proto, rpc, service: chỉ bảng route của Gateway đổi.
3. Ít đường dẫn hơn và theo một mẫu: học thuộc dễ hơn ("đổi trạng thái luôn là `PATCH` + `status`").
4. Dùng lại tab: mục 16 → 17 → 18 chỉ sửa URL và giá trị `status` trong cùng một tab.

## Đánh đổi

- Mỗi URL gõ mới dài thêm 7 ký tự; bù lại bằng việc sửa tab.
- Gateway đọc `status` / `approval_status` / query để chọn rpc — vẫn là tra bảng route, không phải logic nghiệp vụ, nhưng phải giải thích được.
- Lỗi role của biến thể (ví dụ khách gửi `{"status":"ARRIVED"}`) chỉ biết sau khi đọc body: thứ tự kiểm tra có thêm một bước.
- Hai ngoại lệ `auth/login`, `auth/logout` vẫn là động từ (Q65).

## Câu trả lời mẫu khi vấn đáp

"API theo chuẩn `/api/v1/tài-nguyên/mã`. Tài nguyên là danh từ số nhiều, method nói hành động: GET đọc, POST tạo, PATCH sửa một phần. Đổi trạng thái — nhận chuyến, hủy chuyến, bật Online — đều là PATCH với `status` mới. Tìm kiếm và phân trang dùng query. Riêng đăng nhập, đăng xuất em giữ `auth/login`, `auth/logout` vì đó là quy ước phổ biến và không tạo bản ghi nào. Health nằm ngoài `/api/v1` vì không phải tài nguyên nghiệp vụ."

## Điều kiện xem lại

Giảng viên không chấp nhận hai ngoại lệ đăng nhập / đăng xuất (đổi sang `POST /api/v1/tokens`, `DELETE /api/v1/tokens/current`), hoặc cần API phiên bản 2.
