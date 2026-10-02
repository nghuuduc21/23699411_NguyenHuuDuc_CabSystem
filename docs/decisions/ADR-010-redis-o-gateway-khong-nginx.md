# ADR-010 — Redis ở Gateway cho rate limit và token đã thu hồi; không đặt Nginx

- Ngày: 2026-10-02. Trạng thái: **Đã chấp nhận** — ghi trong `CLAUDE.md`, mục "Quy tắc kiến trúc". Đóng Q17, Q18 và giả định GĐ-7. Cách xử lý khi Redis dừng và việc đăng xuất còn mở (Q39, Q40).
- Liên quan: `docs/design/02-kien-truc-giao-tiep.md` mục 2.1, 2.2, G10; NFR04, NFR06; mục chấm 3, 6, 27, 29.

## Bối cảnh

Bản trước giả định (GĐ-7) không có Redis: bộ đếm rate limit giữ trong bộ nhớ Gateway. Thiết kế tham chiếu có Redis ở Gateway cho bốn việc: cache token, session, rate limit, cache dữ liệu chung. Giảng viên cũng nói bản chất Gateway đã bao gồm vai trò của Nginx.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Không Redis; đếm trong bộ nhớ Gateway | Ít container nhất | Mất bộ đếm khi Gateway khởi động lại; chạy hai bản Gateway thì mỗi bản đếm riêng; không có chỗ giữ token đã thu hồi |
| B | **Redis, chỉ cho rate limit và token đã thu hồi** | Bộ đếm và danh sách thu hồi dùng chung, tự hết hạn; đăng xuất có hiệu lực ngay | Thêm một container; Gateway phụ thuộc Redis |
| C | Redis cho cả cache dữ liệu nghiệp vụ, session (như tham chiếu) | Giảm tải cho service | Gateway bắt đầu giữ dữ liệu nghiệp vụ — trái quy tắc "Gateway không chứa logic và dữ liệu nghiệp vụ"; dữ liệu cache có thể cũ |

Về Nginx: (1) đặt Nginx trước Gateway; (2) **không đặt**.

## Quyết định

Chọn **B** và **không đặt Nginx**.

| Việc | Cách dùng Redis | Truy vết |
|---|---|---|
| Rate limit | Mỗi khóa (IP hoặc `account_id`, theo khung thời gian) là một bộ đếm có hạn tự xóa. Vượt ngưỡng → 429 | Mục chấm 29 |
| Token đã thu hồi | Khi đăng xuất, ghi mã định danh của token với hạn bằng thời gian sống còn lại của token. Mỗi request, sau khi kiểm tra chữ ký, Gateway tra danh sách này; có → 401 | NFR06; `CLAUDE.md` |

Chỉ Gateway kết nối Redis. Redis không có `ports` trong Compose.

## Vì sao

1. Mục chấm 29 (spam → 429) cần bộ đếm theo thời gian; `docs/study/00-ban-do-phieu-cham.md` ghi mục này thuộc "Gateway + Redis".
2. JWT kiểm tra tại chỗ nên **không cần session**; nhược điểm của JWT là không thu hồi được trước hạn — danh sách thu hồi trong Redis vá đúng chỗ đó.
3. Không cache dữ liệu nghiệp vụ: mỗi service là nơi duy nhất giữ sự thật về dữ liệu của mình (database-per-service).
4. Không Nginx: Gateway đã làm reverse proxy; thêm Nginx là thêm một tầng không có mục chấm nào cần.

## Đánh đổi

- Thêm một container phải vận hành và một phụ thuộc cho mọi request có token.
- **Redis dừng** thì phải chọn: cho qua (mất rate limit, token đã đăng xuất dùng lại được) hay từ chối (mọi request có token trả 503). Đề xuất cho môi trường học tập: cho qua, ghi log cảnh báo, `/ready` báo chưa sẵn sàng (Q39).
- `srs.md` chưa có FR / UC "Đăng xuất" và chưa có NFR về giới hạn tần suất (Q10, Q40).
- Khác thiết kế tham chiếu: không dùng Redis cho session và cache dữ liệu.

## Câu trả lời mẫu khi vấn đáp

"Redis ở Gateway em chỉ dùng cho hai việc: đếm request để trả 429 và giữ danh sách token đã đăng xuất. Em không cache dữ liệu nghiệp vụ ở đó vì Gateway không được giữ dữ liệu nghiệp vụ. Em không đặt Nginx vì Gateway đã làm vai trò reverse proxy."
