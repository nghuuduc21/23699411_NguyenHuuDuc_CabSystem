# ADR-013 — Tách đăng ký tài khoản khỏi hồ sơ khách hàng; Auth và Customer không gọi nhau

- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — góp ý của giảng viên ngày 2026-10-03, ghi trong `CLAUDE.md` dòng "Đăng ký và hồ sơ khách hàng". **Thay thế ADR-004.**
- Liên quan: `srs.md` FR26, FR27, BRULE18, UC01, UC03, AC27–AC29, RTM27, RTM28; `docs/design/01` quy tắc A8, C1–C6, quan hệ R1; `docs/design/02` (bỏ S1, mục 1, 4.3, 4.6, 5, 8.1, 9, 10.1); `docs/design/03` mục 4.1, 14; `docs/design/04` A04, A09, A10, A37, A38, mục 5; `docs/design/05` QT01, QT04; ADR-001; mục chấm 9, 11, 24, 26.
- So với thiết kế tham chiếu: **giống** — bản đã duyệt cũng không có đường Auth → Customer.

## Bối cảnh

ADR-004 cho `auth-service` gọi gRPC `CreateProfile` sang `customer-service` trong lúc đăng ký (đường S1), để mục chấm 11 chạy ngay sau mục 9. Giảng viên nhận xét: để như vậy **khó xử lý hơn**; thực tế khách đăng ký tài khoản → đăng nhập → mở màn hình khác để tạo và cập nhật hồ sơ.

"Khó xử lý" cụ thể trong thiết kế cũ:

| Vấn đề của S1 | Hệ quả |
|---|---|
| Một thao tác ghi vào hai database không chung giao dịch | Phải xử lý khe hở: hồ sơ đã tạo mà tài khoản chưa lưu (hồ sơ mồ côi), hoặc ngược lại |
| Đăng ký phụ thuộc Customer | `customer-service` dừng thì không ai đăng ký được, dù đăng ký không cần hồ sơ |
| Dữ liệu hồ sơ (họ tên) đi ngang qua Auth | Auth phải nhận và chuyển dữ liệu cá nhân không thuộc context của nó |

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | Giữ S1 (ADR-004) | Đăng ký xong là có hồ sơ; mục 11 chạy ngay | Ba vấn đề ở trên; trái góp ý giảng viên |
| B | Auth phát event "tài khoản đã tạo"; Customer nghe và tạo hồ sơ rỗng | Không phụ thuộc đồng bộ | Thêm một topic không có lý do nghiệp vụ bắt buộc; hồ sơ rỗng vẫn phải được khách điền sau; vẫn có lúc tài khoản có mà hồ sơ chưa |
| C | Gateway gọi lần lượt Auth rồi Customer | Hai service không biết nhau | Gateway chứa logic điều phối — trái `CLAUDE.md` |
| D | **Đăng ký chỉ tạo tài khoản. Sau khi đăng nhập, khách tạo hồ sơ bằng một request riêng tới Customer; `customer_id` lấy từ `account_id` trong token. Auth và Customer không gọi nhau** | Giống thực tế; không có thao tác nào ghi hai database; mỗi service dừng chỉ mất chức năng của chính nó; không thêm đường giao tiếp | Ngay sau đăng ký chưa có hồ sơ (404); mục 11 cần thêm một request |

## Quyết định

Chọn **D**.

| Điểm | Thiết kế |
|---|---|
| Đăng ký (A04) | Số điện thoại, email (tùy chọn), mật khẩu → tạo Account role `customer`. Không có họ tên. Không gọi service nào (A8) |
| Tạo hồ sơ (A37 `POST /customers/me`) | Sau khi đăng nhập. Họ tên bắt buộc, ngày sinh tùy chọn. `customer_id` = `x-account-id` do Gateway chuyển từ token; client không gửi mã. Đã có → 409 (C1, BRULE18) |
| Xem / sửa (A38, A09, A10) | Chưa có hồ sơ → 404 (C5). Sửa chỉ qua `/customers/me` |
| Vì sao Customer tin `account_id` mà không hỏi Auth | Gateway đã kiểm tra chữ ký JWT do Auth cấp; chỉ Gateway vào được mạng nội bộ (mục chấm 8). Token là bằng chứng tài khoản tồn tại và có role `customer` |
| Số điện thoại trong hồ sơ | **Bỏ**: số điện thoại là định danh đăng nhập, chỉ nằm ở Auth (file 03 mục 4.1, Q58) |
| Mục chấm 11 | Chuỗi 4 request: xem (404) → tạo (201) → xem (200) → xem hồ sơ người khác (403). Dự phòng: tài khoản seed KH3 (chưa có hồ sơ), KH1 (đã có) |
| Mã đường giao tiếp | Bỏ S1, **giữ nguyên S2–S7**, không đánh số lại |

## Vì sao

1. **Theo nghiệp vụ**: đăng ký (FR26) và quản lý hồ sơ (FR27) là hai use case khác nhau (UC01, UC03), do người dùng thực hiện ở hai lúc khác nhau. Không yêu cầu nào nói "đăng ký xong phải có hồ sơ".
2. **Quy tắc "mỗi đường giao tiếp phải có lý do nghiệp vụ"** (`CLAUDE.md`): khi hồ sơ do khách tạo, Customer không cần gì từ Auth ngoài `account_id`, mà `account_id` đã có trong token. Không có lý do thì không nối.
3. **Bỏ được cả bài toán nhất quán hai database** của S1, thay vì phải xử lý nó.
4. **NFR05 tốt hơn**: Customer dừng không còn chặn đăng ký; Auth dừng không chặn tạo hồ sơ của người đã có token.

## Đánh đổi

- Có thể tồn tại tài khoản `customer` **chưa có hồ sơ**. Xem hồ sơ trả 404 cho đến khi khách tạo. Booking không kiểm tra hồ sơ: **đã chốt** khách chưa có hồ sơ vẫn đặt được xe, Booking không gọi Customer (Q56, 2026-10-03).
- Mục chấm 11 dài thêm một request (A37); vẫn 4 request, vừa 30 giây.
- Hồ sơ không có số điện thoại (Q58 **đã chốt** 2026-10-03: không lưu); màn hình hồ sơ không hiện số.
- Customer tin metadata từ Gateway: nếu có đường vào mạng nội bộ không qua Gateway thì giả được `x-account-id`. Đây là giả định chung của mọi service (file 02 mục 2.2), không riêng Customer.

## Câu trả lời mẫu khi vấn đáp

**"Vì sao auth và customer không gọi nhau?"** — "Vì đăng ký tài khoản và tạo hồ sơ là hai việc khác nhau của người dùng: khách đăng ký, đăng nhập, rồi mới vào màn hình hồ sơ. Lúc tạo hồ sơ, khách đã có token, trong token có mã tài khoản do Auth ký, Gateway đã kiểm tra, nên Customer lấy mã đó làm mã khách hàng mà không cần hỏi Auth. Auth thì không cần biết khách đã có hồ sơ chưa. Không có yêu cầu nghiệp vụ nào cần hai bên nói chuyện, nên em không nối. Trước đây em cho Auth gọi Customer lúc đăng ký, nhưng như vậy một thao tác phải ghi hai database và Customer lỗi thì không ai đăng ký được; thầy góp ý nên em tách ra."

**"Khách vừa đăng ký xem hồ sơ thì sao?"** — "Trả 404 vì chưa có hồ sơ; khách tạo hồ sơ rồi xem lại là có. Đó là đánh đổi em chấp nhận."

## Điều kiện xem lại

Giảng viên yêu cầu đăng ký xong phải có hồ sơ ngay, hoặc có quy tắc nghiệp vụ mới cần Booking / service khác biết thông tin hồ sơ (khi đó thêm đúng một đường gRPC tới Customer, kèm BRULE mới).
