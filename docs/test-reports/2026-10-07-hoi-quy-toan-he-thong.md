# Báo cáo kiểm thử hồi quy toàn hệ thống (2026-10-07)

> Người kiểm thử: test-agent. Đối tượng: commit `bcd6ede`, nhánh `rebuild/agent-workflow` (code service không đổi trong đợt này; chỉ sửa `tests/`, `postman/`).
> Phạm vi: spec `00`, `09-10`, `11`, `12-13-21-23`, `14-15-16-19-30`, `17-18-chuyen-di-thong-bao`, `20-29-danh-gia-gioi-han` và các thay đổi 2026-10-05: ADR-019 (email thuộc hồ sơ khách, tài khoản chỉ số điện thoại), FR43 (nộp lại hồ sơ tài xế → 200 `resubmitted: true`), ADR-020 (cổng gRPC 50051–50058), nội dung mới của `APPLICATION_REJECTED`, DX22 (rpc nội bộ thiếu `x-role` → `IDENTITY_MISSING`).
> Máy: Windows 11, Git Bash, Node v24.16.0, Docker Desktop; 21 container của project. Không đụng container khác (`product-api`, `nammongodb` vẫn `Exited` như lúc bắt đầu).

## 1. Tổng kết

| Nhóm | Lệnh | Số test | Đạt | Không đạt |
|---|---|---|---|---|
| Unit + tích hợp gRPC (9 thư mục `services/*`) | `npm test` từng service | 406 (auth 39, booking 41, customer 41, driver 49, gateway 114, notification 22, payment 37, rating 33, trip 30) | 406 | 0 |
| E2E hạ tầng (file 01–06) | `npm run test:ha-tang` | 53 | 53 | 0 |
| E2E nghiệp vụ (file 07–15) | `npm run test:nghiep-vu` | 190 | 190 | 0 |
| E2E dừng / restart service (file 90, 91, 92) | `npm run test:dung-service` | 19 | 19 (*) | 0 |
| E2E rate limit, ngưỡng mẫu 5 / 30 (file 95) | `npm run test:rate-limit` | 7 | 7 | 0 |
| Postman (newman) — mọi thư mục trừ 29, ngưỡng 1000 | `npx -y newman@6.2.1 run … --folder …` | 81 request / 175 assertion | 175 | 0 |
| Postman (newman) — thư mục 29, ngưỡng 5 / 30 | `… --folder "29 Spam → 429"` | 6 request / 13 assertion | 13 | 0 |

(*) Lượt đầu nhóm dừng service có **1 đỏ**: AC-DX-04 đếm `trip_status_history` của chuyến seed = 12 thay vì 11. Nguyên nhân là **test cũ**: mục 18 (spec 17-18, đã chốt) hủy chuyến seed 5 nên thêm đúng một dòng `ACCEPTED → CANCELED`. Đã sửa test (bỏ dòng hủy khỏi phép đếm seed, thêm kiểm "không có cặp chuyến/trạng thái lặp") và chạy lại AC-DX-04: đạt. Phần "tổng số dòng trước / sau restart bằng nhau" của AC-DX-04 đạt ngay ở lượt đầu.

Lượt đầu nhóm nghiệp vụ có **1 đỏ** do **lỗi của bộ test** (không phải của hệ thống): hàm `kafkaMessages` (tests/e2e/api.js) chỉ nhận được 100 message mỗi topic — Kafka UI trả tối đa 100 message mỗi lần gọi dù `limit=5000`; khi topic `trip.status-changed` có 132 message thì message mới nhất (bản gửi lặp của AC-HT-04) không đọc được. Đã sửa hàm (đọc từng partition, từng trang 100, từ `offsetMin` đến `offsetMax`), đặt lại dữ liệu và **chạy lại toàn bộ nhóm nghiệp vụ**: 190 / 190. Kết quả bảng trên là lượt chạy lại. Lưu ý: các báo cáo trước dùng hàm cũ; các AC đó chạy lại bằng hàm mới đều đạt.

| Kết quả | |
|---|---|
| **Mục chấm** | 30 / 30 có test tự động đạt (mục 1–4 là mô tả: kiểm bằng test cấu trúc repo, README, `.gitignore`, bảng route, ma trận giao tiếp) |
| **AC** | Mọi AC của 7 spec có test tự động đều đạt; AC chỉ kiểm bằng mắt / bằng lệnh tay ghi ở mục 3.8 |
| **Lỗi cần dev-agent sửa code** | **Không có** |
| **Mâu thuẫn spec cần BA chốt** | **1** (M1: Kafka UI chỉ đọc nhưng AC-HT-04, AC-HT-05, AC-TB-09 yêu cầu "Kafka UI → Produce") |
| Lỗi cũ L1, L2 (báo cáo 2026-10-05) | **L1 đã hết**: A19 ngay sau khi Payment chạy lại → 201 (1,7 s sau healthy), A24 ngay sau khi Trip chạy lại → 200 (92 ms); AC-HT-15 (đổi IP) đạt. **L2 đóng** theo DX22 (test AC-DX-24 sửa theo quyết định đã chốt, đạt) |

## 2. Lệnh đã chạy

```bash
# 0. Gateway ngưỡng cao cho các nhóm thường (GH-Q3)
RATE_LIMIT_PUBLIC_MAX=1000 RATE_LIMIT_ACCOUNT_MAX=1000 docker compose up -d gateway

# 1. Đặt lại dữ liệu về seed (trước mỗi nhóm có đổi dữ liệu và sau cùng)
for x in booking payment trip rating; do
  docker exec $x-db psql -U cab -d $x -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
done
docker compose restart booking-service payment-service trip-service rating-service
docker exec notification-db mongosh -u cab -p cab123 --authenticationDatabase admin notification --eval "db.notifications.deleteMany({})"
docker exec driver-db psql -U cab -d driver -c "update drivers set availability='ONLINE', current_booking_id=null where driver_id in (11,12,13,14,18); update drivers set availability='BUSY', current_booking_id=5 where driver_id=16"

# 2. Unit test 9 service
for s in services/*; do (cd $s && npm test); done

# 3. E2E (thư mục tests/)
npm run test:ha-tang          # file 01–06 (04 tự dừng / bật rating-service, redis)
npm run test:nghiep-vu        # file 07–15, trên dữ liệu vừa đặt lại
npm run test:dung-service     # file 90, 91, 92 (dừng / restart container)

# 4. Postman trên dữ liệu vừa đặt lại, mọi thư mục trừ 29 (ngưỡng 1000)
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "06 Health check" … --folder "30 Replay thanh toán → trả response cũ"
# dọn tài khoản 0399… / 0599… (kèm hồ sơ, xe, OTP), trả TX7 về seed bằng SQL

# 5. Gateway về .env (5 / 30) rồi nhóm rate limit và thư mục 29
docker compose up -d gateway
npm run test:rate-limit
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "29 Spam → 429"

# 6. Cuối cùng: đặt lại dữ liệu như bước 1, dọn tài khoản test, chạy lại test:ha-tang (53/53) để xác nhận hệ thống lành
```

Nhóm thường chạy với 1000 / 1000 (đọc lại bằng `docker exec gateway printenv RATE_LIMIT_PUBLIC_MAX` trước khi chạy). File 95 tự kiểm tiền điều kiện 10 / 5 / 30 và tự đổi `RATE_LIMIT_ACCOUNT_MAX=3` cho AC-GH-05, 06 rồi trả về `.env`.

## 3. Bảng AC → test → kết quả

Ký hiệu file: `07` = `tests/e2e/07-dang-ky-dang-nhap.test.js`, … `15` = `15-tai-xe-nop-lai.test.js`, `92` = `92-dung-service-chuyen-di.test.js`, `95` = `95-rate-limit.test.js`. Postman ghi số request.

### 3.1 Test cũ sửa theo quyết định đã chốt

| AC | Trước | Nay (theo spec) | File | Kết quả |
|---|---|---|---|---|
| AC-DN-03 | Test "email trùng → 409 `EMAIL_ALREADY_EXISTS`", đăng nhập bằng email | Bỏ (ADR-019); thay bằng AC-DN-21 | 07 | Đạt |
| AC-DN-05 | Có trường hợp `email: "abc"` → `INVALID_EMAIL` | Chỉ `INVALID_PHONE`, `INVALID_PASSWORD` | 07 | Đạt |
| AC-DN-09 | "phone + email → 400" | Thiếu `password`, thiếu `phone` → 400 (phone + email chuyển sang AC-DN-22) | 07 | Đạt |
| AC-DN-13 | `email` injection → `INVALID_EMAIL` | `email` là field lạ → `INVALID_INPUT`; `phone` injection → `INVALID_PHONE` | 07 | Đạt |
| AC-HS-01, 06, 13, 16 | Hồ sơ KH1 3 field | Thêm `email: "kh1@cab.vn"` | 08; 11.1 | Đạt |
| AC-HS-04, 11 | Response không có `email` | Có `email: null` | 08; 11.3 | Đạt |
| AC-HS-13 + 14 | Cột bảng 5 cột | Thêm cột `email` (vẫn không có cột số điện thoại) | 08 | Đạt |
| AC-TX-15 | Nộp lại khi `REJECTED` → 409 | Chủ xem `reason` ở A14; nộp lại → **200** `resubmitted: true`, `PENDING` | 09 (hồ sơ mới), 15 (TX7) | Đạt |
| AC-DX-24 | Thiếu `x-role` → `PERMISSION_DENIED/FORBIDDEN` | DX22: thiếu → `UNAUTHENTICATED/IDENTITY_MISSING`; `x-role: customer` → `FORBIDDEN` | 11 | Đạt — chạy thật: thiếu `x-role` trả `IDENTITY_MISSING`, đúng DX22 |
| AC-HT-11 | Chỉ thử 50051 | Thử đủ 50051–50058 (+ 5432, 6379, 9092, 9093), GET Postman-style 50051, 50058 | 02 | Đạt |
| AC-DX-04 | Lịch sử chuyến seed đúng 11 dòng | 11 dòng seed (không tính dòng hủy chuyến 5 của mục 18), không cặp lặp | 91 | Đạt (sau khi sửa) |

### 3.2 Spec 09-10, 11 — mới (ADR-019)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-DN-21 | 9 | A04 kèm `email` → 400 `INVALID_INPUT`, không tạo; bỏ `email` → 201 | 07; 09.1 (không có `email` trong response) | Đạt |
| AC-DN-22 | 10 | A05 chỉ `email`; `phone` + `email` → 400 `INVALID_INPUT`, không có token | 07 | Đạt |
| AC-DN-23 | Migration | `schema_migrations` có `003_bo-email-accounts.sql` (một dòng); `accounts` không còn cột `email`; AC-DN-01, 07 vẫn đạt | 07 | Đạt. Phần "khởi động lại lần hai không lỗi" kiểm gián tiếp: `auth-service` đã khởi động lại nhiều lần trong đợt (AC-DN-06), `version` là khóa chính nên chạy lại sẽ lỗi — không lỗi |
| AC-HS-19 | 11 | Tài khoản mới A37 `email: "  Duc@Cab.VN "` → 201 `duc@cab.vn`; A09 theo mã → 200 cùng nội dung | 08 | Đạt |
| AC-HS-20 | 11 | KH3: `abc`, `""`, `<a>@x.vn`, 255 ký tự → `INVALID_EMAIL`; `123`, `null` → `INVALID_INPUT`; KH3 vẫn 404 | 08 | Đạt |
| AC-HS-21 | 11 | KH2 đặt email trùng KH1 → 200 (không UNIQUE), họ tên / ngày sinh giữ; trả lại `kh2@cab.vn` | 08 | Đạt |
| AC-HS-22 | 11 | `email: null` → 200 null; A38 có key `email: null`; đặt lại → 200; `"sai"` → `INVALID_EMAIL`, email cũ giữ | 08 | Đạt |
| AC-HS-23 | 24 | `table customer_profiles`: `kh1@cab.vn`, `kh2@cab.vn` rõ; họ tên, ngày sinh `\x…` | 08 | Đạt |
| AC-HS-24 | Migration | `002_them-email.sql` một dòng; KH9 (không email) → `"email": null` | 08 | Đạt |

### 3.3 Spec 12-13-21-23 — nộp lại hồ sơ (FR43)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-TX-15 (TX7) | 22 | A16 `drivers/17` `thieu giay to` → 200; K7 `REJECTED`, không có lý do | 15; 22.2 | Đạt |
| AC-TX-34 | 21, 22 | TX7 A14 thấy `REJECTED` + `reason` → A11 → **200** đúng body spec (`resubmitted: true`, không `reason`) → A14 `PENDING`; DB `reject_reason`, `reviewed_by`, `reviewed_at` NULL; không K7 mới, không thông báo mới | 15; 2122.1–2122.4 | Đạt |
| AC-TX-35 | 21 (409) | TX7 `PENDING` nộp lại; TX1 `APPROVED` nộp → 409 `DRIVER_ALREADY_EXISTS`; hồ sơ không đổi | 15; 2122.5 | Đạt |
| AC-TX-36 | 22 | A13 `PENDING` có 17 → A15 → 200 `APPROVED`; K7 `APPROVED`; TX7 có `APPLICATION_APPROVED` + 2 `APPLICATION_REJECTED` | 15 | Đạt |
| AC-TX-37 | 21 (409/400) | Hồ sơ `REJECTED` nộp lại biển `59A-00001` → 409 `LICENSE_PLATE_ALREADY_EXISTS`; thiếu `license` → 400; `<b>` → `TEXT_CONTAINS_HTML`; sau đó vẫn `REJECTED`, lý do, biển, tên cũ (rollback) | 15 | Đạt |
| AC-TX-38 | 21 | Nộp lại giữ biển của mình, đổi `MOTORBIKE`, không `brand` → 200; DB `brand`, `model` NULL | 15 | Đạt |
| AC-TX-39 | 22 | Từ chối lần hai `anh mo` → A14 thấy lý do mới → nộp lại → 200 `resubmitted`; 2 thông báo, 2 `event_id` | 15 | Đạt |

### 3.4 Spec 17-18 — chuyến đi, hủy, hoàn tiền, thông báo (34 AC)

"Chuyến 1000" của spec (tạo ở AC-DX-19) = chuyến C1 do file 13 tự tạo (KH1 CASH, TX1 nhận), mã đọc từ response. Trong Postman là chuyến `{{T}}` của mục 16.

| AC | Mục | Kiểm tra chính | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-TB-01 | 16 | KH1 `data[0]` `TRIP_ACCEPTED` `{booking, trip, driver 11, ACCEPTED}`, `data[1]` `BOOKING_CREATED`; không trả `_id`, `event_id`, `recipient_id`; TX1 `OFFER_CREATED` | 13; 16.2 | Đạt |
| AC-CD-01 | 17 | `COMPLETED` khi `ACCEPTED` → 409; A27 vẫn `ACCEPTED`; không K5 mới | 13; 17.1 | Đạt |
| AC-CD-02 | 17 | `arrived` (chữ thường) → 200, history 2; K5 `ARRIVED` / `ACCEPTED` đúng 6 field; KH1 `TRIP_ARRIVED` ≤ 2 s | 13; 17.2 | Đạt |
| AC-CD-03 | 17 | `PICKED_UP`, `IN_PROGRESS` → 200; `started_at`, history 4; KH1 không có thông báo mới | 13; 17.3, 17.4 | Đạt |
| AC-CD-04 | 17 (AC11) | `COMPLETED` → history 5 đúng thứ tự thời gian; TX1 `ONLINE` ≤ 2 s; payment CASH `COMPLETED`, `paid_at`, `transactions: []`; K6 `COMPLETED` `CASH`; A33 `PAYMENT_COMPLETED` rồi `TRIP_COMPLETED` | 13; 17.5–17.7 | Đạt |
| AC-CD-05 | 17 (409) | `COMPLETED` lại, `ARRIVED` → `INVALID_STATUS_TRANSITION`; A29 → `TRIP_NOT_CANCELABLE` | 13 | Đạt |
| AC-CD-06 | 17 (lỗi) | TX3 → `NOT_OWNER`; 999 → 404; `abc` → `INVALID_ID`; `ACCEPTED`, `BUSY`, không body, có `reason` → `INVALID_INPUT`; KH1, AD1 (không body) → `FORBIDDEN`; không token → 401; body hỏng → `INVALID_JSON` | 13 | Đạt |
| AC-CD-07 | 17 (A27) | KH1, TX1, AD1 → 200 (`CASH`, 45000, history 5, `ended_at`); KH2, TX3 → `NOT_OWNER`; 999 → 404; `GET /trips` (A26) → 404 `ROUTE_NOT_FOUND` | 13 | Đạt |
| AC-CD-08 | 17 (503) | Dừng trip → A28, A27 → 503 | 92 | Đạt |
| AC-CD-09 | 18 | `trips/5` hủy → 200 đúng body; lịch sử `ACCEPTED|CANCELED|1|customer|ban viec`; `trips` có `canceled_by`, `cancel_reason`, `ended_at`; K5 đúng 7 field, **không** có lý do | 13; 18.1 | Đạt |
| AC-HT-01 | 18 (AC22) | ≤ 2 s payment 5 `REFUNDED` / `TRIP_CANCELED` / `refunded_at`; giao dịch `SIM-5-1` CHARGE + `SIM-R-5` REFUND 45000; K6 `REFUNDED` (`previous_status` `COMPLETED`); TX6 `ONLINE` | 13; 18.5 | Đạt |
| AC-TB-02 | 18 (N5) | KH1 `data[0]` `PAYMENT_REFUNDED` (5, 45000, body "Đã hoàn 45000 đ…"), `data[1]` `TRIP_CANCELED` ("…bị khách hàng hủy"); TX6 có `TRIP_CANCELED` | 13; 18.2–18.4 | Đạt |
| AC-CD-10 | 18 (lỗi) | Hủy lại → 409 (vẫn một REFUND); thiếu / khoảng trắng / `null` reason → `REASON_REQUIRED`; `<b>` → `TEXT_CONTAINS_HTML`; 256 ký tự, số → `INVALID_INPUT` (255 ký tự hợp lệ hình thức); `trips/4` → 409; KH2 → `NOT_OWNER`; AD1 → `FORBIDDEN` | 13 | Đạt |
| AC-CD-11 | 18 (BRULE16) | Chuyến `PICKED_UP`: KH1, TX1 hủy → 409; vẫn `PICKED_UP` | 13 | Đạt |
| AC-CD-12 | 18 (FR41) | TX1 hủy chuyến ONLINE "xe hong" → 200 `driver`; `REFUNDED` / `TRIP_CANCELED`; TX1 `ONLINE`; KH1 `TRIP_CANCELED` ("…bị tài xế hủy") + `PAYMENT_REFUNDED`; booking `DRIVER_ASSIGNED`; không Offer mới (T6) | 13 | Đạt |
| AC-CD-13 | 18 (tiền mặt) | Chuyến CASH `ARRIVED` hủy → payment `CANCELED` / `TRIP_CANCELED`, không giao dịch, không K6 | 13 | Đạt |
| AC-CD-14 | 18 phụ | A22 `PENDING_PAYMENT` → 200; K4 đúng 5 field, không `reason`; A21 `cancel_reason`; payment `CANCELED` / `BOOKING_CANCELED`, không K6; A31 → 409 `PAYMENT_CANCELED`; `BOOKING_CANCELED` | 13; 18.6, 18.7 | Đạt |
| AC-CD-15 | 18 phụ (VOIDED) | A22 khi có Offer → 200; A23 `[]`; `?status=VOIDED` có Offer; A24 → 409; TX1 `ONLINE`; payment `CANCELED`; K4 `pending_offer_driver_id` 11, `previous_status` `SEARCHING`; TX1 `OFFER_VOIDED` | 13 | Đạt |
| AC-CD-16 | 18 phụ (đã trả) | `REFUNDED` / `BOOKING_CANCELED`, `SIM-R-<id>`; K6 `REFUNDED`; `PAYMENT_REFUNDED` | 13 | Đạt |
| AC-CD-17 | 18 phụ (M11) | `MANUAL` → A22 → `CANCELED`; callback muộn → 200 `SUCCEEDED` / `REFUNDED`; booking vẫn `CANCELED` | 13 | Đạt |
| AC-CD-18 | 18 phụ (lỗi) | `bookings/3` → `BOOKING_ALREADY_ASSIGNED`; `/1`, `/2` → `BOOKING_NOT_CANCELABLE`; thiếu reason; `SEARCHING`; field lạ; KH2; 999; `abc`; TX1 (không body), AD1; không token | 13 | Đạt |
| AC-CD-19 | 18 (NFR05) | Dừng payment: A22, A29 → 200; bật lại → cả hai `REFUNDED` | 92 | Đạt — thời gian xem N2 |
| AC-HT-02 | 15 (AC09) | ONLINE xa, đã trả → `NO_DRIVER_FOUND`, `REFUNDED` / `NO_DRIVER_FOUND`, hai thông báo; CASH → `CANCELED` / `NO_DRIVER_FOUND` | 13 | Đạt |
| AC-HT-03 | BRULE15 | Chuyến ONLINE xong: giữ `COMPLETED`, không REFUND, không K6 `REFUNDED`; Offer bị từ chối: payment giữ `PENDING` | 13 | Đạt |
| AC-HT-04 | NFR14 | Gửi lại y hệt K5 `CANCELED` trip 5 (cùng `event_id`) → vẫn một REFUND, TX6 không đổi, không thông báo thêm, không K6 thêm | 13 | Đạt — gửi bằng console producer, **không** qua Kafka UI (M1) |
| AC-HT-05 | D9 | TX1 `BUSY` cho X; gửi K5 `COMPLETED` `driver_id` 11, booking khác → TX1 vẫn `BUSY` với X | 13 | Đạt — như trên (M1) |
| AC-HT-06 | NFR05 | Dừng driver: A28 tới `COMPLETED` đều 200; bật lại → TX1 `ONLINE` | 92 | Đạt — thời gian xem N2 |
| AC-TB-03 | 19, 21, 22 | `PAYMENT_FAILED` (body đúng spec); tài xế mới được duyệt có `APPLICATION_APPROVED`; TX7 bị từ chối có `APPLICATION_REJECTED` body **đúng từng chữ** "Hồ sơ của bạn bị từ chối. Xem lý do tại hồ sơ tài xế và nộp lại.", không chứa lý do | 13, 15; 2122.2 | Đạt |
| AC-TB-04 | 16, 18 | `?limit=1` (pagination đúng); `page=2` = mục thứ hai; `limit=abc`, `page=0`, `limit=51` → `INVALID_PAGINATION`; `foo=1` → `INVALID_INPUT`; AD1 `[]`; KH2 chỉ thấy booking của mình; 401 | 13 | Đạt |
| AC-TB-05 | NFR05 | Dừng notification: đặt xe 201, nhận 200, A33 503; bật lại → có `BOOKING_CREATED`, `TRIP_ACCEPTED` (33–36 ms sau healthy) | 92 | Đạt |
| AC-TB-06 | N4 | Restart notification → `total` không đổi | 92 | Đạt |
| AC-TB-07 | 7 | Group `booking-`, `driver-`, `payment-` (3 topic), `notification-service` (7 topic) lag 0; K5 có đủ `ACCEPTED` … `CANCELED`; message mới ở K3–K6 không chứa lý do, tọa độ, họ tên | 13 | Đạt |
| AC-TB-08 | NFR08, 10 | Log có `notification_created`, `trip_status_changed`, `trip_canceled`; không dòng log nào có key `title`, `body`, `reason`, `cancel_reason` hay chuỗi lý do | 13 | Đạt |
| AC-TB-09 | 22 (FR43, N4) | Hai `APPLICATION_REJECTED` (hai `event_id`, cùng body mới); gửi lại y hệt K7 lần hai → vẫn hai; nộp lại không tạo thông báo | 15 | Đạt — gửi lặp bằng console producer (M1) |

### 3.5 Spec 20-29 — đánh giá, rate limit (22 AC)

| AC | Mục | Kiểm tra chính | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-DG-01 | 20 | 201 `{1000, 4, 13, 5, avg 5, count 1}`, không key `comment`, JSON in `5`; DB `4|1|13|5`; `driver_ratings` 13 = `1|5` | 14; 20.1 | Đạt |
| AC-DG-02 | 20 | Gửi lại; trip 3 → 409 `RATING_ALREADY_EXISTS`; số liệu 13, 11 không đổi | 14; 20.2 | Đạt |
| AC-DG-03 | 20 | trip 5 → 409 `TRIP_NOT_COMPLETED` (lượt chạy: trip 5 đã `CANCELED` sau mục 18 — đúng nhánh "sau khi hủy" của AC) | 14; 20.3 (khi T5 còn `ACCEPTED`) | Đạt cả hai trạng thái |
| AC-DG-04 | 20 | KH2 trip 3 → 403 `NOT_OWNER` (không lộ đã có đánh giá); 999 → 404 | 14 | Đạt |
| AC-DG-05 | 20, 26 | 9 × `INVALID_INPUT` + `trip_id` 4.5, `customer_id`; `<b>` → `TEXT_CONTAINS_HTML`; 501 ký tự, khoảng trắng → `INVALID_INPUT`; `{abc` → `INVALID_JSON`; không thêm dòng | 14 | Đạt |
| AC-DG-06 | 20, 28 | Không token 401; TX1 không body 403; AD1 403 | 14 | Đạt |
| AC-DG-07 | 20 (503) | Chuyến xong mới; dừng trip → 503, không lưu, `driver_ratings` không đổi; bật lại → gửi lại → 201 | 92 | Đạt |
| AC-DG-08 | 20 (V5) | Chuyến KH1–TX1 xong, score 4 + comment có khoảng trắng → 201 `comment` đã cắt, `avg` 4.5, `count` 2; DB 11 = `2|9`; A36, A35 khớp | 14 | Đạt |
| AC-DG-09 | 20 (A35) | KH1, TX3, AD1 → 200; TX1, KH2 → `NOT_OWNER`; trip 5 → `RATING_NOT_FOUND` | 14 | Đạt |
| AC-DG-10 | 20 (A36) | `{11, 5, 1}` ×3; `{999, count 0}` không `avg` | 14 | Đạt |
| AC-DG-11 | 20, 25 | Thiếu / cả hai / `page` → `INVALID_INPUT`; `abc`, `4 OR 1=1` → `INVALID_ID`; 401 | 14 | Đạt |
| AC-DG-12 | 20 (S7) | Gọi thẳng `trip-service:50055`: system → `{4, COMPLETED, 1, 13}`; 999 → `NOT_FOUND`; 0 → `INVALID_ARGUMENT`; không `x-role` → `IDENTITY_MISSING`; `customer` → `FORBIDDEN` | 14 | Đạt |
| AC-DG-13 | 20 (seed) | Restart rating → số dòng, số liệu y hệt | 92 | Đạt |
| AC-DG-14 | 7, 4 | Không topic `rating`; 7 topic không có message mới khi tạo đánh giá | 14 | Đạt |
| AC-GH-01 | 29 | 1–5: 200, `Limit 5`, `Remaining 4…0`, `Reset 1–10`, không `Retry-After`; lần 6: 429 `RATE_LIMITED`, `Retry-After` = `Reset` ∈ 1–10, `Remaining 0`, `X-Request-Id`, `nosniff`, `no-store`; log `rate_limited` `scope: ip`, không ghi IP | 95; 29.1–29.6 | Đạt. Unit gateway "vượt ngưỡng thì không gọi gRPC" đạt (`rate-limit.test.js`) |
| AC-GH-02 | 29 | 5 lần nữa → 429, `Retry-After` không tăng; hết hạn → 200 `Remaining 4` | 95 | Đạt |
| AC-GH-03 | 29 | A04, A07 → 429 (chung bộ đếm IP); A38 → 200 `Limit 30`; `/health` không header; `X-Forwarded-For` → vẫn 429 | 95 | Đạt |
| AC-GH-04 | 29 | A32 ×10 → 401 / 404, không 429, không header | 95 | Đạt |
| AC-GH-05 | 29 | `ACCOUNT_MAX=3`: 200 ×3, 429 (`scope: account`, `account_id` 1); KH2 200; A06 429 | 95 | Đạt |
| AC-GH-06 | 29 | Không token 401; token sửa 401 `TOKEN_INVALID`; A19 không body → 429 | 95 | Đạt |
| AC-GH-07 | 29 | Redis dừng: 7 × 200, không header; log `warn` `rate_limit_skipped` có `request_id`; bật lại → lần 6 = 429 | 95 | Đạt |
| AC-GH-08 | 29 | `rl:ip:<ip>` duy nhất, TTL 1–10; hết hạn → khóa biến mất | 95 | Đạt |

### 3.6 Spec 00 — cổng gRPC riêng (ADR-020)

| AC | Mục | Kiểm tra | File | Kết quả |
|---|---|---|---|---|
| AC-HT-11 (đổi) | 8 | TCP tới 50051–50058, 5432, 6379, 9092, 9093 từ máy bị từ chối; GET `http://localhost:50051`, `:50058` không response | 02 | Đạt |
| AC-HT-14 | 5, 6 | Dòng log cuối "gRPC đang nghe" của 8 service đúng cổng 50051…50058; 8 biến `*_GRPC_ADDR` của gateway; booking (`DRIVER_`, `PAYMENT_`, `TRIP_`), trip (`DRIVER_`), rating (`TRIP_`) đúng `<tên>:<cổng>` | 02 | Đạt |
| AC-HT-15 | 6 | Restart customer + rating → 8 SERVING, A09, A36 đúng ngay lần đầu; dừng cả hai, bật **ngược** thứ tự (đổi IP) → như trên | 92 | Đạt |

### 3.7 AC các spec trước (hồi quy)

Toàn bộ AC đã đạt ở các báo cáo 2026-10-04, 2026-10-05 (spec 00, 09-10, 11, 12-13-21-23, 14-15-16-19-30) **chạy lại đều đạt**: file 01–12, 90, 91 (203 test kể cả hạ tầng). Riêng AC-DX-12, AC-DX-21 (trước đỏ vì L1) nay **đạt**.

### 3.8 Kiểm bằng mắt / lệnh tay (không tự động hóa)

| Việc | Ghi chú |
|---|---|
| Kafka UI → Consumers, Topics (AC-TB-07, AC-HT-09) | Đã kiểm bằng API của chính Kafka UI (cùng dữ liệu giao diện hiển thị) |
| Thời gian gõ tay | Ước tính ở mục 6, không đo bằng người thật |

## 4. Bảng 30 mục chấm

| # | Mục | Test tự động (file / Postman) | Kết quả |
|---|---|---|---|
| 1 | Kiến trúc source code | 01 (README, cây thư mục, 9 `package.json` + `Dockerfile`) | Đạt |
| 2 | `.gitignore`, `.env` | 01, 06; AC-HS-15 | Đạt |
| 3 | Nhiệm vụ Gateway | 03, 07 (JWT), 95 (rate limit), unit gateway 114 | Đạt |
| 4 | IPC | 05, 11 (gRPC nội bộ), 13 (Kafka K3–K6), 14 (AC-DG-14: rating không Kafka) | Đạt |
| 5 | Compose, liệt kê container | 02 (21 container, 8 database, AC-HT-14) | Đạt |
| 6 | `/health`, `/ready`, `/health/services` | 03, 04, 92 (AC-HT-15); 06.1–06.3 | Đạt |
| 7 | Kafka | 05, 12 (AC-TT-14), 13 (AC-TB-07) | Đạt |
| 8 | Mọi request qua Gateway | 02 (AC-HT-10, 11: 50051–50058) | Đạt |
| 9 | Đăng ký → đăng nhập | 07 (AC-DN-01…06, 21); 09.1–09.3 | Đạt |
| 10 | Đăng nhập → token | 07 (AC-DN-07…11, 22); 10.1–10.5 | Đạt |
| 11 | Khách theo mã | 08 (AC-HS-01…12, 19…24); 11.1–11.4 | Đạt |
| 12 | Tài xế theo mã | 10; 12.1–12.3 | Đạt |
| 13 | Tài xế quanh 1 km, paging, seed ≥ 5 | 10; 13.1–13.3 | Đạt (seed 8 tài xế) |
| 14 | Booking của khách, paging, seed ≥ 5 | 11; 14.1–14.3 | Đạt (seed 7 booking) |
| 15 | Đặt xe → Offer | 11, 13 (AC-HT-02); 15.1, 15.2 | Đạt |
| 16 | Tài xế nhận chuyến (+ thông báo) | 11 (AC-DX-19…24), 13 (AC-TB-01); 16.1–16.4 | Đạt |
| 17 | Trạng thái chuyến đúng trình tự | 13 (AC-CD-01…07), 92 (AC-CD-08); 17.1–17.7 | Đạt |
| 18 | Hủy chuyến, các bên được báo | 13 (AC-CD-09…18, AC-HT-01…05, AC-TB-02), 92 (AC-CD-19); 18.1–18.7 | Đạt |
| 19 | Thanh toán online + callback | 12; 19.1–19.3 | Đạt |
| 20 | Đánh giá chuyến | 14, 92 (AC-DG-07, 13); 20.1–20.3 | Đạt |
| 21 | Đăng ký tài xế OTP | 09, 15 (nộp lại); 21.1–21.4, 2122.* | Đạt |
| 22 | Admin duyệt / từ chối | 09, 15; 22.1–22.3 | Đạt |
| 23 | Bật / tắt nhận chuyến | 10; 23.1, 23.2 | Đạt |
| 24 | Mã hóa at rest | 07 (AC-DN-19), 08 (AC-HS-13, 14, 23), 09 (AC-TX-12); 24.1 | Đạt |
| 25 | SQL injection | 07 (AC-DN-12…14), 08 (AC-HS-17), 14 (AC-DG-11); 25.1–25.3 | Đạt |
| 26 | XSS | 08 (AC-HS-16), 13 (reason), 14 (comment); 26.1, 26.2 | Đạt |
| 27 | JWT bị sửa → 401 | 07 (AC-DN-15…17), 95 (AC-GH-06); 27.1–27.5 | Đạt |
| 28 | Sai quyền → 403 | 08–15 (FORBIDDEN theo role, kể cả không body); 28.1, 28.2 | Đạt |
| 29 | Spam → 429 | 95 (AC-GH-01…08); 29.1–29.6 (ngưỡng 5 / 10 s) | Đạt |
| 30 | Replay thanh toán | 12 (AC-TT-03…06); 30.1–30.4 | Đạt |

Dữ liệu seed cho mục 13, 14 (rule 6): đủ — 8 tài xế (4 trong bán kính 1 km quanh P0), KH1 có 7 booking.

## 5. Lỗi và mâu thuẫn

### 5.1 Lỗi code cần dev-agent sửa

Không có.

### 5.2 Mâu thuẫn spec cần BA chốt

| # | AC | Bước tái hiện | Mong đợi (spec 17-18) | Thực tế |
|---|---|---|---|---|
| **M1** | AC-HT-04, AC-HT-05 (spec 17-18), AC-TB-09 (spec 17-18) | Mở `localhost:8080` → topic `trip.status-changed` → Produce Message; hoặc `POST /api/clusters/cab/topics/trip.status-changed/messages` | Gửi lại được message (cùng `event_id`) từ Kafka UI để demo chống lặp | 405 `"This cluster is in read-only mode."` — `compose.yaml` đặt `KAFKA_CLUSTERS_0_READONLY: "true"` đúng **spec 00 H4** ("Kafka UI chỉ đọc: không xóa topic, không gửi message"). Hai spec mâu thuẫn. Hành vi chống lặp của hệ thống **đạt** khi gửi cùng message bằng `docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic trip.status-changed --property parse.key=true` (test làm cách này). BA chọn: (a) giữ chỉ đọc, sửa 3 AC thành lệnh console producer (lệnh dài, khó gõ khi thi); hoặc (b) bỏ chỉ đọc ở spec 00 và compose |

### 5.3 Lỗi bộ test đã sửa trong đợt này

| # | Chỗ | Sửa |
|---|---|---|
| T1 | `tests/e2e/api.js` `kafkaMessages` | Kafka UI trả tối đa 100 message mỗi lần gọi → đọc từng partition, từng trang. Lượt đầu AC-HT-04 đỏ vì lý do này; chạy lại cả nhóm sau khi sửa |
| T2 | `tests/e2e/91-dung-service-dat-xe.test.js` AC-DX-04 | Đếm lịch sử seed không tính dòng hủy chuyến 5 (mục 18 tạo hợp lệ) |
| T3 | Chuỗi `\r?\n` trong test bị công cụ dòng lệnh đổi thành ký tự thật khi ghi file — đã ghi lại bằng trình sửa file, `node --check` mọi file | — |

## 6. Ghi chú (không phải lỗi)

| # | Chủ đề | Ghi chú |
|---|---|---|
| N1 | "≈ 1 s" | Mọi kiểm tra "≈ 1 s" đều đạt trong giới hạn 2 s: thông báo, K5/K6, tài xế rảnh lại, hoàn tiền |
| N2 | Thời gian sau khi service chạy lại (AC-CD-19, AC-HT-06; spec ghi "≈ 3 s") | Đo từ lúc container **healthy**: Payment hoàn tiền sau 4,2–4,8 s; Driver trả TX1 về rảnh sau 5,0 s (2 lượt chạy). Test chờ tối đa 5 s nên đạt, nhưng **sát giới hạn**, chậm hơn con số 3 s của spec. Nguyên nhân có lẽ là thời gian consumer tham gia lại group Kafka. Notification (AC-TB-05) chỉ 33–36 ms; Booking (AC-TT-13) 141 ms. Không ảnh hưởng mục chấm (chỉ là kịch bản dừng service); nếu cần demo thì nên nói "vài giây" thay vì "3 giây" |
| N3 | AC-DX-17 | `NO_DRIVER_FOUND` sau 5,4 s khi Driver dừng (spec ≈ 5 s) — như báo cáo trước |
| N4 | Thứ tự chạy cố định | File 13 cần chuyến seed 5 còn `ACCEPTED` (hủy được một lần); file 14 cần `rating-db` vừa đặt lại; file 15 cần TX7 `PENDING` (hook `after` trả TX7 về seed). Hook `before` báo rõ khi thiếu. Postman: thư mục 20 đặt **trước** 18, mục 29 chạy riêng ở ngưỡng mẫu |
| N5 | Dữ liệu không do test-agent tạo | `auth-db` còn tài khoản 1000 (`0901234567`) và 1002 (`0901234571`) từ 2026-10-04 (đã ghi ở báo cáo trước, N6) — không xóa |
| N6 | Kafka giữ message | Message của các lần chạy vẫn còn trong topic (không `down -v`); test so với ảnh chụp partition:offset |

## 7. Postman

`postman/cab.postman_collection.json`: 24 thư mục, 87 request. Thứ tự: 06, 09–13, 21, 22, **21-22 (luyện vấn đáp)**, 23–28, 14, 15, 16, **17**, **20**, **18**, 19, 30, **29**.

| Thư mục | Thay đổi |
|---|---|
| 09 | Body chỉ `phone`, `password` (đã đúng); thêm kiểm "response không có `email`" |
| 11 | 11.1 kiểm hồ sơ có `email: "kh1@cab.vn"`; 11.3 kiểm `dob`, `email` null |
| 16 | **16.2 mới (chính)**: tab GET `[KH1]` → `notifications`: `TRIP_ACCEPTED` của `{{T}}`, `BOOKING_CREATED`; đổi số 16.2 → 16.3, 16.3 → 16.4 |
| 17 (mới) | 17.1 `COMPLETED` → 409; 17.2–17.5 `ARRIVED` → … → `COMPLETED` (history 5); 17.6 (tùy chọn) thông báo `PAYMENT_COMPLETED`, `TRIP_COMPLETED`; 17.7 (test-agent) TX1 `ONLINE` |
| 20 (mới) | 20.1 `{"trip_id":4,"score":5}` → 201; 20.2 gửi lại → 409; 20.3 (tùy chọn) trip 5 → `TRIP_NOT_COMPLETED` |
| 18 (mới) | 18.1 tab GET `PATCH trips/5` hủy; 18.2 cùng tab `GET notifications` (body để nguyên) → `PAYMENT_REFUNDED`, `TRIP_CANCELED`; 18.3–18.4 (tùy chọn) TX6; 18.5 (test-agent) payment 5; 18.6–18.7 (tùy chọn) hủy booking |
| 21-22 (mới, luyện vấn đáp) | Đăng nhập TX7 → thông báo `APPLICATION_REJECTED` → `drivers/17` thấy lý do → `POST drivers` cùng body → 200 `resubmitted` → nộp lần nữa 409 |
| 29 (mới) | 6 request đăng nhập KH1; lần 6 → 429, `Retry-After`, `RateLimit-*` |

## 8. Thời gian gõ tay ước tính

Phía hệ thống: mọi response ≤ 140 ms (newman: trung bình 23 ms); thông báo, hoàn tiền, tài xế rảnh có trong < 2 s → không có bước nào phải chờ. Ước tính theo giả định `06` mục 5 (gõ GET ≈ 10 s, POST/PATCH có body 15–20 s, sửa tab 3–5 s, nói song song):

| Mục | Thao tác | Tổng gồm nói | Đánh giá |
|---|---|---|---|
| 9 | 1 gõ + 1 sửa (body chỉ 2 field) | ~28 s | Sát |
| 10 | 1 sửa + 2 nhân bản | ~25 s | Ổn |
| 11 | 1 gõ + 1 sửa (response có email, không thêm request) | ~23 s | Ổn |
| 12, 13, 14 | 2 sửa | 18–24 s | Ổn |
| 15 | 1 gõ + 1 nhân bản | ~32 s | Sát |
| 16 | 1 sửa tab chuyến + 1 sửa tab GET (`notifications`) | ~26 s | Sát |
| 17 | 5 sửa một từ | ~30 s | Sát |
| 18 | 2 sửa ở tab GET (PATCH + body; rồi GET) | ~28 s | Sát |
| 19 | 1 gõ + 1 nhân bản (header, No Auth) | ~42 s | **Vượt** — dự phòng 1 request (bỏ body) ~25 s |
| 20 | 1 gõ + Send lại | ~25 s | Ổn |
| 21 | 1 gõ + 2 sửa | ~42 s | **Vượt** (Q64) |
| 22 | 1 sửa | ~22 s | Ổn |
| 23–28 | 1–2 sửa | 20–28 s | Ổn / Sát (24) |
| 29 | 6 lần Send + mở Headers | ~18 s | Ổn |
| 30 | 2 Send lại + 1 sửa | ~22 s | Ổn |
| Nộp lại hồ sơ (vấn đáp, không chấm) | Đăng nhập TX7 + sửa URL + Send `POST drivers` | ~35 s | Chỉ nói, không cần demo |

## 9. Trạng thái hệ thống sau kiểm thử

- `booking-db`, `payment-db`, `trip-db`, `rating-db`: đặt lại bằng `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` rồi restart 4 service → seed: 7 booking, 7 payment (7 `PENDING`), 3 trip (5 `ACCEPTED`), 1 rating (trip 3).
- `notification-db`: `notifications` rỗng.
- `driver-db`: TX1–TX4, TX8 `ONLINE` không `current_booking_id`; TX5 `OFFLINE`; TX6 `BUSY` / booking 5; TX7 `PENDING`, "Tài Xế 7", không lý do, chưa xét, xe `59A-00007` `CAR_4`.
- `customer-db`: KH1 `kh1@cab.vn`, KH2 `kh2@cab.vn`, KH9 không email (như seed).
- Tài khoản test (`0399…`, `0599…`) đã xóa kèm hồ sơ, xe, OTP; còn 15 tài khoản (13 seed + 1000, 1002 có từ trước).
- Gateway chạy theo `.env`: `RATE_LIMIT_PUBLIC_MAX=5`, `RATE_LIMIT_ACCOUNT_MAX=30`, cửa sổ 10 s.
- 20 container `running (healthy)`, `kafka-init` `Exited (0)`; `GET /health/services` 200, 8 `SERVING`. `product-api`, `nammongodb` không bị đụng tới.

## 10. File đã tạo / sửa

| File | Thay đổi |
|---|---|
| `tests/e2e/02-compose.test.js` | AC-HT-11 thử 50051–50058; AC-HT-14 mới |
| `tests/e2e/07-dang-ky-dang-nhap.test.js` | Sửa AC-DN-03, 05, 09, 13; mới AC-DN-21, 22, 23 |
| `tests/e2e/08-ho-so-khach-hang.test.js` | Hồ sơ có `email`; mới AC-HS-19…24; `after` trả email KH1, KH2 |
| `tests/e2e/09-tai-xe-dang-ky-duyet.test.js` | AC-TX-15: chủ xem lý do, nộp lại → 200 |
| `tests/e2e/11-dat-xe.test.js` | AC-DX-24 theo DX22 (+ trường hợp `x-role: customer`) |
| `tests/e2e/91-dung-service-dat-xe.test.js` | AC-DX-04 đếm lịch sử seed đúng sau mục 18 |
| `tests/e2e/api.js` | `kafkaMessages` đọc đủ mọi message (phân trang theo partition) |
| `tests/e2e/chuyen-di.js` (mới) | Tạo chuyến, tiến trạng thái, đọc thông báo, gửi lại message Kafka (console producer), thử Produce Kafka UI, consumer group, `mongosh` |
| `tests/e2e/13-chuyen-di-thong-bao.test.js` (mới) | 29 test: spec 17-18 (AC-CD, AC-HT, AC-TB trừ phần dừng service) |
| `tests/e2e/14-danh-gia.test.js` (mới) | 12 test: AC-DG-01…06, 08…12, 14 |
| `tests/e2e/15-tai-xe-nop-lai.test.js` (mới) | 10 test: AC-TX-15 (TX7), 34…39, AC-TB-03 (duyệt / từ chối), AC-TB-09 |
| `tests/e2e/92-dung-service-chuyen-di.test.js` (mới) | 8 test: AC-CD-08, 19, AC-HT-06, AC-TB-05, 06, AC-DG-07, 13, AC-HT-15 |
| `tests/e2e/95-rate-limit.test.js` (mới) | 7 test: AC-GH-01…08 |
| `tests/package.json` | `test:nghiep-vu` thêm 13, 14, 15; `test:dung-service` thêm 92; mới `test:ha-tang`, `test:rate-limit` |
| `postman/cab.postman_collection.json` | Mục 7 ở trên |
