# Luyện tập 30 mục chấm bằng Postman

> Viết 2026-10-21. Đi kèm hai file trong `postman/luyen-tap/`:
> - `cab-luyen-tap.postman_environment.json`: environment "CAB - Luyện tập", tự lưu token và mã;
> - `cab-luyen-tap.postman_collection.json`: collection "CAB - Luyện tập 30 mục chấm", 78 request xếp **đúng thứ tự thi**.
>
> Mỗi request có phần mô tả (bảng bên phải Postman, nút 📄 *Documentation*) ghi bốn ý: **cách gõ khi thi, kết quả, câu nói, code chạy**.
> Kịch bản gốc: `docs/design/06-kich-ban-thi.md`. Hiểu sâu code: `docs/study/02-cam-nang-he-thong.md`.
> **Khi thi:** xóa environment và collection, gõ tay mọi thứ (luật thi: Postman không lưu sẵn gì).

---

## 1. Cài đặt (một lần)

1. Postman → **Import** → kéo cả hai file trong `postman/luyen-tap/` vào.
2. Góc trên bên phải chọn environment **CAB - Luyện tập**.
3. Mở **Settings → General**, tắt *"Send anonymous usage data"* nếu muốn; không cần chỉnh gì khác.

**Environment làm gì:** các request lưu kết quả vào biến bằng script ở tab *Tests*. Ví dụ đăng nhập xong thì `pm.environment.set('tok_kh1', token)`. Request sau dùng lại bằng `{{tok_kh1}}`. Nhờ vậy bạn **tập trung hiểu từng bước**, không mất công copy-paste. Bấm con mắt 👁 cạnh tên environment để xem giá trị đang có.

| Biến | Lưu ở | Dùng ở |
| `cb_secret` | **Tự điền một lần**: chép giá trị `PAYMENT_CALLBACK_SECRET` trong `.env` vào cột *Current value* (file environment trên Git để trống) | Mục 19 |
|---|---|---|
| `tok_kh1`, `tok_ad1`, `tok_tx1`, `tok_tx6` | 00 Chuẩn bị, Mục 10 | Hầu hết các mục |
| `new_email`, `tok_new`, `new_id` | Mục 9 | Mục 11.3 |
| `booking_id`, `offer_id`, `trip_id` | Mục 15, 16 | Mục 16, 17 |
| `new_phone`, `otp`, `tok_txnew`, `driver_new_id`, `new_plate` | Mục 21 | Mục 22 |
| `tok_sua` | Mục 27 (script sửa token) | Mục 27 |

## 2. Trước mỗi buổi luyện: dữ liệu sạch

Nhiều mục **đổi dữ liệu seed**: TX1 thành bận, chuyến 5 bị hủy, B7 đã thanh toán, chuyến 4 đã được đánh giá. Muốn luyện lại từ đầu thì gõ:

```
docker compose down -v
docker compose up -d --build
```

Chờ khoảng 1 phút, rồi chạy thư mục **00 · Chuẩn bị**. Đây cũng là luyện luôn lệnh của mục 5.

Nếu cổng 3000 bị chiếm (`port is already allocated`) thì gõ `docker stop product-api` rồi `docker compose up -d --force-recreate gateway`.

## 3. Ba cấp độ luyện tập

### Cấp 1: Hiểu (tuần 1)

Chạy **từng request một** theo thứ tự thư mục. Với mỗi request:
1. Đọc phần *Documentation*: kết quả mong đợi, câu nói, code chạy.
2. Bấm **Send**, so response với kết quả mong đợi. Tab *Test Results* báo PASS hay FAIL.
3. **Mở file code** được nhắc tới trong VS Code, tìm đúng hàm, đọc vài dòng. Thầy sẽ hỏi "code nào chạy".
4. Nói to câu giải thích, không nhìn tài liệu.

Muốn chạy cả bộ để kiểm tra hệ thống thì dùng **Run collection**, đặt *Delay* = **2500 ms**. Giới hạn 5 request công khai / 10 giây sẽ chặn nếu chạy nhanh hơn. Mục 29 phải bấm tay.

### Cấp 2: Gõ tay, vẫn có environment (tuần 2)

- Mở **tab mới trống**, tự gõ method, URL, body theo phần "Gõ khi thi". Chỉ được dùng `{{tok_kh1}}` thay cho việc copy token.
- So kết quả với request mẫu trong collection.
- **Bấm giờ từng mục**, ghi vào bảng ở mục 5. Mục nào vượt 30 giây thì luyện riêng.

### Cấp 3: Như thi thật (tuần 3 trở đi)

- **Xóa environment** (hoặc chọn *No environment*), **đóng collection**.
- Gõ **tất cả từ đầu**: đăng nhập, copy token từ response, dán vào Authorization. Dùng đúng các tab như kịch bản thi (tab KH1, tab GET, tab admin, tab chuyến…).
- Vừa làm vừa nói. Nhờ bạn bè hoặc tự quay màn hình để xem lại.
- Chạy đủ 30 mục theo thứ tự ở mục 4, rồi `down -v` và làm lại.

## 4. Thứ tự và tóm tắt từng mục

Thứ tự thư mục trong collection chính là thứ tự thi (06 mục 3). Bảng này để ôn nhanh; chi tiết nằm trong *Documentation* của từng request.

| Thứ tự | Mục | Request chính (gõ tay) | Kết quả cần thấy | Code chính |
|---|---|---|---|---|
| 0 | Chuẩn bị | `docker compose up -d --build`; `GET /health/services` | `healthy` ×8 | `compose.yaml` |
| 1 | 1–5 | Mô tả; `cat .gitignore`; `git ls-files .env .env.example`; `docker compose ps -a` | 21 container; chỉ `.env.example` trên git | `compose.yaml`, `.gitignore` |
| 2 | 6 | `GET /health` → `/ready` → `/health/services` | `healthy`, `ready`, `healthy` + 8 service | `gateway/src/health.js` |
| 3 | 8 | `GET localhost:50051` | `ECONNREFUSED` | `compose.yaml` (chỉ gateway, kafka-ui có `ports`) |
| 4 | 9 | `POST /api/v1/auth/register` `{"email","password"}` → sửa thành `login` | 201 → 200 token | `auth-service/src/domain/auth.js` |
| 5 | 10 | `POST /api/v1/auth/login`: KH1 email, admin email, TX1 phone | 3 token, 3 role | `auth.js` `login`, `domain/token.js` |
| 6 | 11 | `GET /api/v1/customers/1` → `/customers/2` | 200 có `phone` → 403 | `customer-service/src/domain/customers.js` |
| 7 | 12 | `GET /api/v1/drivers/11` [KH1] → [AD1] → `/drivers/999`; (tùy chọn) [KH1] `GET /trips/5` | 403 → 200 → 404; khối `driver` của chuyến | `routes.js` A14, `driver-service/src/domain/drivers.js` |
| 8 | 13 | `GET /api/v1/drivers?lat=10.82&lng=106.68&limit=2` → `&page=2` | TX1, TX2 → TX3, TX4 | `drivers.js` `findNearbyDrivers` |
| 9 | 14 | `GET /api/v1/customers/1/bookings?limit=2` → `&page=2` → `customers/2/…` | 7, 6 → 5, 4 → 403 | `booking-service/src/domain/bookings.js` `listBookings` |
| 10 | 15 | `POST /api/v1/bookings` `{"from":[10.82,106.68],"to":[10.83,106.69]}` → [TX1] `GET /offers` | 201 `fare` 45000 → Offer PENDING | `bookings.js` `createBooking`, `dispatcher.js` |
| 11 | 16 | `PATCH /api/v1/offers/1000` `{"status":"ACCEPTED"}` → [KH1] `GET /notifications` | `trip_id` 1000 → `TRIP_ACCEPTED` | `bookings.js` `acceptOffer` |
| 12 | 17 | `PATCH /api/v1/trips/1000` `COMPLETED` → `ARRIVED` → … → `COMPLETED` | 409 → 200 ×4 | `trip-service/src/domain/trips.js`, `rules.js` `NEXT` |
| 13 | 7 | Trình duyệt `localhost:8080` → Topics → Messages | 7 topic, có message | `kafka-init` trong `compose.yaml` |
| 14 | 20 | `POST /api/v1/ratings` `{"trip_id":4,"score":5}` → gửi lại | 201 → 409 | `rating-service/src/domain/ratings.js` |
| 15 | 18 | [KH1] `PATCH /api/v1/trips/5` `{"status":"CANCELED","reason":"ban viec"}` → `GET /notifications` | 200 → `PAYMENT_REFUNDED`, `TRIP_CANCELED` | `trips.js` `cancelTrip`, các `consumer.js` |
| 16 | 19 | `POST /api/v1/payments/7/transactions` (`Idempotency-Key:k1`, MANUAL) → `POST /api/v1/payment-callbacks` (`X-Callback-Secret:<khóa trong .env>`) | PENDING → COMPLETED | `payment-service/src/domain/payments.js` |
| 17 | 30 | Send lại hai tab mục 19 → `GET /payments/7` | Body y hệt, `Idempotency-Replayed: true` | `payments.js` `payPayment` |
| 18 | 21 | `POST /api/v1/auth/otp` → `auth/driver-register` → `POST /api/v1/drivers` | 201 otp → 201 token → 201 PENDING | `auth.js`, `drivers.js` `submitApplication` |
| 19 | 22 | [AD1] `PATCH /api/v1/drivers/D` `{"approval_status":"APPROVED"}` | 200 APPROVED | `drivers.js` `approveDriver` |
| 20 | 23 | [TX1] `PATCH /api/v1/drivers/me` `{"status":"OFFLINE"}` → `ONLINE` | 200 → 200 | `drivers.js` `setAvailability` |
| 21 | 24 | `GET /customers/1` + `docker exec customer-db psql -U cab -d customer -c "table customer_profiles"` | `\x…` mã hóa | `customer-service/src/domain/crypto.js` |
| 22 | 25 | Login `{"email":"' OR 1=1 --",…}` → mật khẩu injection | 400 → 401 | `validate.js`, `accounts-repo.js` (`$1`) |
| 23 | 26 | `PATCH /customers/me` `{"name":"<script>…"}` → `GET` xem Headers | 400 → `nosniff`, CSP | `validate.js`, `app.js` `securityHeaders` |
| 24 | 28 | [KH1] `PATCH /drivers/17`; [TX1] `POST /bookings` | 403, 403 | `app.js` `wrap()` bước 6 |
| 25 | 27 | Token sửa trên jwt.io → No Auth | 401 `TOKEN_INVALID` → 401 `TOKEN_MISSING` | `gateway/src/token.js` |
| 26 | 29 | Tab đăng nhập KH1, Send 6 lần | Lần 6: 429 + `Retry-After` | `gateway/src/rate-limit.js` |

## 5. Bảng bấm giờ (tự điền khi luyện cấp 2, 3)

Mục tiêu: mỗi mục ≤ 30 giây **kể cả lúc nói**. Mục 19 và 21 dài nhất (khoảng 42 giây), tập nói **trong lúc gõ**.

| Mục | Lần 1 | Lần 2 | Lần 3 | Lần 4 | Ghi chú (vướng ở đâu) |
|---|---|---|---|---|---|
| 6 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |
| 13 | | | | | |
| 14 | | | | | |
| 15 | | | | | |
| 16 | | | | | |
| 17 | | | | | |
| 18 | | | | | |
| 19 | | | | | |
| 20 | | | | | |
| 21 | | | | | |
| 22 | | | | | |
| 23 | | | | | |
| 24 | | | | | |
| 25 | | | | | |
| 26 | | | | | |
| 27 | | | | | |
| 28 | | | | | |
| 29 | | | | | |
| 30 | | | | | |

## 6. Câu thầy hay hỏi thêm, theo nhóm mục

| Nhóm | Câu hỏi | Gợi ý trả lời (mở rộng ở `docs/study/02`) |
|---|---|---|
| 6, 8 | Gateway chết thì sao? Service chết thì sao? | Gateway là cổng duy nhất nên Gateway chết thì không gọi được gì. Service chết thì chỉ API của nó trả 503, `/health/services` báo `unhealthy` (cẩm nang mục 13.1) |
| 9, 10 | Sao khách dùng email, tài xế dùng số điện thoại? | Theo yêu cầu thầy (ADR-021). Tài xế đã xác thực số bằng OTP. Database có CHECK theo role |
| 11, 12, 14 | Gateway có biết booking 7 của ai không? | Không. Gateway chỉ kiểm role; service kiểm chủ (`NOT_OWNER`) vì chỉ service có dữ liệu |
| 15 | Vì sao Booking gọi Payment bằng gRPC, không dùng Kafka? | Khách phải thấy giá và mã thanh toán **ngay** trong response; đánh đổi là Payment chết thì không đặt được xe |
| 16, 17, 18 | Vì sao hủy chuyến dùng Kafka? | Hủy phải thành công dù Payment đang dừng (NFR05); ba bên cùng nghe (driver, payment, notification) |
| 19, 30 | Bấm thanh toán hai lần thì sao? | `Idempotency-Key` → trả response cũ, không tạo giao dịch mới; khóa dòng `FOR UPDATE` |
| 24 | Khóa mã hóa để ở đâu? Ngoài thực tế? | `.env` riêng từng service; thực tế dùng Vault hoặc KMS (cẩm nang) |
| 27 | Ai có `JWT_SECRET` thì sao? | Ký được token thật. Vì vậy khóa chỉ ở auth và Gateway, không lên Git, không dán lên jwt.io |
| 29 | Redis chết thì sao? | Cho qua, ghi log cảnh báo; trong lúc đó không có giới hạn |
