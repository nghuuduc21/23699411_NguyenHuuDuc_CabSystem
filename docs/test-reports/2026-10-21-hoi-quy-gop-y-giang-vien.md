# Báo cáo kiểm thử hồi quy sau góp ý giảng viên 2026-10-14 (2026-10-21)

> Người kiểm thử: test-agent. Đối tượng: nhánh `rebuild/agent-workflow`, đặc tả `4bce62a`, code `1241b96` (code service không đổi trong đợt này; chỉ sửa `tests/`, `postman/`).
> Phạm vi: ADR-021 (khách / admin đăng nhập bằng email, tài xế bằng số; nhóm `/api/v1/auth/…`; số điện thoại khách vào hồ sơ), spec 00 H13 (chữ `healthy` / `ready` / `not_ready` / `unhealthy`), A14 chỉ admin và chính tài xế, A20 thành `GET /api/v1/customers/{id}/bookings`. AC mới: AC-HT-16/17; AC-DN-24…33; AC-HS-25…31; AC-TX-40…43; AC-DX-26…28; AC-GH-09/10. Hồi quy toàn bộ 30 mục chấm.
> Máy: Windows 11, Git Bash, Node v24.16.0, Docker Desktop. Hệ thống dựng trên database sạch (`down -v` → `up -d --build`, do người giao việc làm trước). Không đụng container khác (`product-api`, `nammongodb` vẫn `Exited` như lúc đầu).

## 1. Tổng kết

| Nhóm | Lệnh | Số test | Đạt | Không đạt |
|---|---|---|---|---|
| Unit + tích hợp gRPC (9 thư mục `services/*`) | `npm test` từng service | 411 (auth 41, booking 41, customer 41, driver 50, gateway 116, notification 22, payment 37, rating 33, trip 30) | 411 | 0 |
| E2E hạ tầng (file 01–06) | `npm run test:ha-tang` | 56 | 56 | 0 |
| E2E nghiệp vụ (file 07–15), ngưỡng 1000 | `npm run test:nghiep-vu` | 206 | 205 | **1** (AC-TX-42) |
| E2E dừng / restart service (file 90–92), ngưỡng 1000 | `npm run test:dung-service` | 19 | 18 (lượt 3) | **1** (AC-HT-15, chập chờn — xem L2) |
| E2E rate limit, ngưỡng mẫu 10 s / 5 / 30 (file 95) | `npm run test:rate-limit` | 11 | 11 | 0 |
| Postman (newman) — mọi thư mục trừ 29, ngưỡng 1000 | `npx -y newman@6.2.1 run … --folder …` | 91 request / 195 assertion | 195 (lượt 2) | 0 (lượt 2); lượt 1: 2 (L2) |
| Postman (newman) — thư mục 29, ngưỡng 5 / 10 s | `… --folder "29 Spam → 429"` | 6 request / 13 assertion | 13 | 0 |

| Kết quả | |
|---|---|
| **Mục chấm** | **29 / 30 đạt**. Mục 12 **chưa đạt trọn**: phần chấm (A14 theo role / chủ) đạt, nhưng AC-TX-42 (khách thấy tài xế của chuyến mình qua `GET /trips/{id}`, câu trả lời vấn đáp của mục 12 trong `06`) **không đạt** — L1. Mục 6 đạt mọi AC chấm (AC-HT-05/06/07/16/17); AC-HT-15 (phụ) chập chờn — L2 |
| **AC mới** | 34 AC mới: **31 đạt**, **1 không đạt** (AC-TX-42), **2 không kiểm** (AC-DN-30, AC-HS-31 — cần volume dữ liệu bản ADR-019, trái ràng buộc "không `down -v`, không xóa volume") |
| **Lỗi cần dev-agent sửa** | **2**: L1 (A27 thiếu khối `driver`, AC-TX-42), L2 (lời gọi đầu tiên sau khi service chạy lại có thể trả 503) |
| **Mâu thuẫn spec cần BA chốt** | **1**: M1 (spec 17-18 CD10 / CD-M2 nói A27 **không** có `driver`; spec 12-13-21-23 AC-TX-42 và `06` mục 12 nói **có**) |

## 2. Lệnh đã chạy

```bash
# 0. Gateway ngưỡng cao cho nhóm thường (GH-Q3)
RATE_LIMIT_PUBLIC_MAX=1000 RATE_LIMIT_ACCOUNT_MAX=1000 docker compose up -d gateway

# 1. Đặt lại dữ liệu về seed (trước mỗi nhóm có đổi dữ liệu và sau cùng) — không xóa volume
for x in booking payment trip rating; do
  docker exec $x-db psql -U cab -d $x -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
done
docker compose restart booking-service payment-service trip-service rating-service
docker exec notification-db mongosh -u cab -p cab123 --authenticationDatabase admin notification --eval "db.notifications.deleteMany({})"
docker exec driver-db psql -U cab -d driver -c "delete from vehicles where driver_id >= 1000; delete from drivers where driver_id >= 1000"
docker exec customer-db psql -U cab -d customer -c "delete from customer_profiles where customer_id >= 1000"
docker exec auth-db psql -U cab -d auth -c "delete from accounts where account_id >= 1000; delete from otp_verifications"
docker exec driver-db psql -U cab -d driver -c "update drivers set availability='ONLINE', current_booking_id=null where driver_id in (11,12,13,14,18); update drivers set availability='BUSY', current_booking_id=5 where driver_id=16; …TX5 OFFLINE (10.825,106.68); TX7 về seed PENDING 'Tài Xế 7', xe 59A-00007 CAR_4"

# 2. Unit test 9 service
for s in services/*; do (cd $s && npm test); done

# 3. E2E (thư mục tests/), mỗi nhóm trên dữ liệu vừa đặt lại
npm run test:ha-tang
npm run test:nghiep-vu
npm run test:dung-service

# 4. Postman, mọi thư mục trừ 29 (ngưỡng 1000), trên dữ liệu vừa đặt lại
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "06 Health check" … --folder "30 Replay thanh toán → trả response cũ" --reporters cli --color off

# 5. Gateway về .env (10 s / 5 / 30) rồi nhóm rate limit và thư mục 29
docker compose up -d gateway
npm run test:rate-limit
npx -y newman@6.2.1 run postman/cab.postman_collection.json --folder "29 Spam → 429"

# 6. Cuối cùng: đặt lại dữ liệu như bước 1; chạy lại test:ha-tang (56/56)
```

Lệnh `DROP SCHEMA public CASCADE` chạy được bằng user `cab` (không bị chặn quyền).

Diễn biến (báo đúng, không bỏ lượt đỏ):

| Lượt | Kết quả | Nguyên nhân | Xử lý |
|---|---|---|---|
| `test:ha-tang` lượt 1 | 47 / 48, file 04 không nạp được | **Lỗi bộ test** do test-agent vừa thêm: biểu thức `/\r?\n/` bị ghi hỏng khi sửa file | Sửa; file 04 chạy riêng 9 / 9; lượt cuối 56 / 56 |
| `test:nghiep-vu` lượt 1 (trên dữ liệu đã bị file 15 chạy thử trước đó) | 203 / 206 | AC-TX-42 (L1); AC-TB-09, AC-TX-36: TX7 có 4 `APPLICATION_REJECTED` vì test-agent đã chạy thử file 15 một lần mà chưa xóa thông báo — **lỗi dữ liệu test**, không phải lỗi hệ thống | Đặt lại dữ liệu, chạy lại cả nhóm: 205 / 206 (chỉ còn AC-TX-42) |
| `test:dung-service` lượt 1 | 18 / 19 | AC-HT-15 còn so chữ cũ `UP` / `SERVING` — **test cũ** chưa sửa theo H13 | Sửa test (file 92) |
| AC-HT-15 chạy riêng × 8 | 5 đạt, 3 không đạt | L2: `A09` hoặc `A36` trả 503 ở lời gọi đầu sau restart | Ghi lỗi L2 |
| `test:dung-service` lượt 2 | 17 / 19 | AC-TX-18 (bước chuẩn bị `POST /drivers` → 503 ngay sau khi AC-TX-33 bật lại driver-service), AC-CD-19 (A29 → 503 ngay sau khi AC-CD-08 bật lại trip-service) — cùng L2 | — |
| `test:dung-service` lượt 3 | 18 / 19 | AC-HT-15 (L2) | Kết quả ghi ở bảng 1 |
| newman lượt 1 | 193 / 195 | 17.1 → 503 (`PATCH /trips/1000`, 4 ms) — lần đầu Gateway gọi trip-service sau khi bước đặt lại restart 4 service — L2 | Đặt lại dữ liệu, chạy lại: 195 / 195 |

## 3. Bảng AC → test → kết quả

Ký hiệu file: `03` = `tests/e2e/03-health.test.js`, `04` = `04-health-degraded.test.js`, `07` = `07-dang-ky-dang-nhap.test.js`, `08` = `08-ho-so-khach-hang.test.js`, `09` = `09-tai-xe-dang-ky-duyet.test.js`, `10` = `10-tai-xe-xem-tim-bat-tat.test.js`, `11` = `11-dat-xe.test.js`, `15` = `15-tai-xe-nop-lai.test.js`, `90`, `92` = file dừng service, `95` = `95-rate-limit.test.js`. Postman ghi số request.

### 3.1 Spec 00 — health (H13)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-HT-05 (đổi) | 6 | `/health` đúng `{"status":"healthy"}`; `/ready` đúng `{"status":"ready","checks":{"redis":"healthy","grpc_clients":"healthy"}}`; `/health/services` `healthy`, 8 key `healthy` | 03; 06.1–06.3 | Đạt |
| AC-HT-06 (đổi) | 6 (503) | Dừng rating-service → 503 `unhealthy`, `rating-service: unhealthy`, 7 service `healthy`; **log Gateway có dòng `warn` `service_unhealthy` nêu `rating-service`** (kiểm mới thêm); bật lại → 200 | 04 | Đạt (trả lời 1 058 ms) |
| AC-HT-07 (đổi) | 6 (503) | Dừng redis → `/ready` 503 `not_ready`, `redis: unhealthy`, `grpc_clients: healthy`; `/health` 200 `healthy`; bật lại tự về `ready` | 04 | Đạt |
| AC-HT-16 (mới) | 6 (503) | `stop customer-db` → 503 `unhealthy`, `customer-service: unhealthy`; body không có `NOT_SERVING`, `UNREACHABLE`, `SERVING`, `UP`, `DOWN`, `DEGRADED`; `start customer-db` → 200 `healthy` | 04 | Đạt |
| AC-HT-17 (mới) | 6 | Mọi giá trị trạng thái của 3 endpoint ∈ {`healthy`, `unhealthy`, `ready`, `not_ready`}, không còn chữ cũ | 03; 06.3 | Đạt |
| AC-HT-15 | 6 (phụ) | Restart / dừng-bật ngược customer + rating → `/health/services` healthy; A09, A36 đúng **ngay lần gọi đầu** | 92 | **Không đạt (chập chờn, 3 / 8 lần chạy riêng + lượt 3)** — L2 |

### 3.2 Spec 09-10 — đăng ký, đăng nhập (ADR-021)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-DN-01 (đổi) | 9 | `POST /api/v1/auth/register` email mới → 201 đúng 2 key `{account_id ≥ 1000, role}`; dòng `accounts` có `email`, `phone` NULL; không có hồ sơ | 07; 09.1 | Đạt |
| AC-DN-02 (đổi) | 9 | Cùng body → login 200, cùng `account_id` | 07; 09.2 | Đạt |
| AC-DN-03 (đổi) | 9 (409) | Cùng email; email viết hoa; `kh1@cab.vn` → 409 `EMAIL_ALREADY_EXISTS`, không thêm dòng | 07; 09.3 | Đạt |
| AC-DN-04 | 9 (400) | Thiếu `password`; thiếu `email`; `role: admin`; sai kiểu; body hỏng `INVALID_JSON`; mảng | 07 | Đạt |
| AC-DN-05 (đổi) | 9 (400) | `abc`, `a b@cab.vn` → `INVALID_EMAIL`; `123` → `INVALID_PASSWORD` | 07 | Đạt |
| AC-DN-06 | 9 (503) | Dừng auth-service → `auth/register` 503; login 503 | 90 | Đạt |
| AC-DN-07 (đổi) | 10 | `kh1@cab.vn` → 200, mã 1, 3600; payload `sub`/`role`/`jti`/`exp`, **không** có email, số; email viết hoa có khoảng trắng vẫn ra mã 1 | 07; 10.1 | Đạt |
| AC-DN-08 (đổi) | 10 (401) | Sai mật khẩu và `khong@cab.vn` → cùng body 401; số tài xế chưa có → 401 | 07; 10.5 | Đạt |
| AC-DN-09 | 10 (400) | Thiếu `password` (email / phone) → 400 | 07 | Đạt |
| AC-DN-10 (đổi) | 10 (403) | `kh9@cab.vn` → 403 `ACCOUNT_LOCKED`; sai mật khẩu → 401 | 07; 10.6 | Đạt |
| AC-DN-11 (đổi) | 10 | `admin@cab.vn` → admin 99; `{"phone":"0910000001"}` → driver 11 | 07; 10.2, 10.3 | Đạt |
| AC-DN-12, 13 (đổi) | 25 | Password injection → 401; email `' OR 1=1 --` → 400 **`INVALID_EMAIL`**; phone injection → `INVALID_PHONE`; KH1 vẫn 200; log `auth-service` không chứa chuỗi injection | 07; 25.1, 25.2, 25.4 | Đạt |
| AC-DN-14 | 25 | SQL chỉ dùng `$n` (auth, customer, driver) | 07 | Đạt |
| AC-DN-15, 16, 17 | 27 | Sửa ký tự giữa → `TOKEN_INVALID`; không header → `TOKEN_MISSING`; đăng xuất → `TOKEN_REVOKED`, TTL đúng | 07; 27.1b, 27.2–27.5 | Đạt |
| AC-DN-18 | 27 (503) | Dừng redis → logout 503, request khác qua | 90 | Đạt |
| AC-DN-19 (đổi) | 24 | `table accounts`: `scrypt$`, không thấy `12345678`; `kh1@cab.vn`, `admin@cab.vn`, `0910000001` rõ; không còn `0999999999` | 07 | Đạt |
| AC-DN-20 | 404 | `/auth/login`, `/auth/register` thiếu `/api/v1` → 404 | 07 | Đạt |
| AC-DN-24 (mới) | 27 | Payload đổi `role: admin` giữ chữ ký → 401; ký lại bằng khóa `abc` → 401; `PATCH /drivers/17` bằng token đó → 401 `TOKEN_INVALID` | 07; 27.1 | Đạt |
| AC-DN-25 (mới) | 9 (400) | `auth/register` kèm `phone` → 400 `INVALID_INPUT`, không tạo; bỏ `phone` → 201 | 07; 09.4 | Đạt |
| AC-DN-26 (mới) | 10 (400) | Có cả `email` + `phone`; thiếu cả hai → 400 `INVALID_INPUT` | 07; 10.4 | Đạt |
| AC-DN-27 (mới) | 10 (401) | `{"phone":"0900000001"}` (số hồ sơ KH1); `{"email":"tx1@cab.vn"}` → 401 cả hai | 07; 10.7 | Đạt |
| AC-DN-28 (mới) | 10 (401) | `{"phone":"0999999999"}` → 401 | 07 | Đạt |
| AC-DN-29 (mới) | Migration | `004_email-dang-nhap.sql` một dòng; `email`, `phone` nullable; có `accounts_email_key`, `accounts_phone_key`, `accounts_email_format`, `accounts_identity_by_role`. "Khởi động lại lần hai không lỗi": auth-service đã khởi động lại trong AC-DN-06, không lỗi | 07 | Đạt |
| AC-DN-30 (mới) | Migration (lỗi) | Cần database còn dữ liệu bản ADR-019 | — | **Không kiểm** (ràng buộc: không `down -v`, không xóa / dựng volume cũ) |
| AC-DN-31 (mới) | Ràng buộc | 3 câu `INSERT` (driver có email; customer thiếu cả hai; email chữ hoa) đều bị từ chối đúng tên ràng buộc; không dòng nào được thêm | 07 | Đạt |
| AC-DN-32 (mới) | 29 | `auth/register` ×6 → 201 ×5, lần 6 429 | 95 | Đạt |
| AC-DN-33 (mới) | Đường dẫn | `POST /accounts`, `/otps`, `/driver-accounts` → 404 `ROUTE_NOT_FOUND` | 07 | Đạt |

### 3.3 Spec 11 — hồ sơ khách (phone thay email)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-HS-01 (đổi) | 11 | KH1 → `{customer_id 1, name, phone 0900000001, dob}`, không có key `email`; AD1 xem KH9 → phone `0900000009` | 08; 11.1 | Đạt |
| AC-HS-02, 03, 05–09, 11, 13, 16, 17, 18 | 11, 24–26 | Như trước (403 `NOT_OWNER`, 404, 409, 403 role, 401, 400 `INVALID_ID`, XSS, injection trong mã, đường cũ) | 08; 11.2, 11.4, 25.3, 26.* | Đạt |
| AC-HS-04 (đổi) | 11 | `{"name":"Pham Duc","phone":"0901234567"}` → 201 `{mã, name, phone, dob null}`; A09 / A38 cùng nội dung | 08; 11.3 | Đạt |
| AC-HS-10 (đổi) | 11 (400) | Thiếu `name`; **thiếu `phone`**; dob sai dạng / tương lai / 30-02; thêm `customer_id`… → `INVALID_INPUT` | 08 | Đạt |
| AC-HS-12 | 11 (503) | Dừng customer-service → A38 503; login 200 | 90 | Đạt |
| AC-HS-14 (đổi) | 24 | Cột `…_enc` dạng `\x…`; không thấy họ tên, ngày sinh; cột `phone` rõ; cột bảng đúng `customer_id, full_name_enc, date_of_birth_enc, created_at, updated_at, phone` (không có `email`) | 08 | Đạt |
| AC-HS-25 (mới) | 11 | Tài khoản mới (`auth/register` → login) tạo hồ sơ `phone: " +84 901-234-567 "` → 201 `0901234567`; A09 cùng nội dung | 08 | Đạt |
| AC-HS-26 (mới) | 11 (400) | KH3: `123`, `""`, `09abc` → `INVALID_PHONE`; số JSON, `null`, thêm `email` → `INVALID_INPUT`; KH3 vẫn 404 | 08 | Đạt |
| AC-HS-27 (mới) | 11 | KH2 PATCH `phone: 0900000001` (trùng KH1) → 200, các field khác giữ; trả lại `0900000002` | 08 | Đạt |
| AC-HS-28 (mới) | 11 (400) | KH1 PATCH `phone: null` → `INVALID_INPUT`; `"sai"` → `INVALID_PHONE`; A38 không đổi | 08 | Đạt |
| AC-HS-29 (mới) | 24 | `table customer_profiles`: `0900000001/2/9` rõ, `\x…` cho họ tên, ngày sinh | 08 | Đạt |
| AC-HS-30 (mới) | Migration | `003_sdt-trong-ho-so.sql` một dòng; `phone` NOT NULL, có `customer_profiles_phone_format`, không UNIQUE; không cột `email`. Khởi động lại (AC-HS-12, AC-HT-15) không lỗi | 08 | Đạt |
| AC-HS-31 (mới) | Migration (lỗi) | Cần database còn hồ sơ seed cũ | — | **Không kiểm** (cùng lý do AC-DN-30) |

### 3.4 Spec 12-13-21-23 — tài xế

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-TX-01, 02 (đổi) | 21 | `POST /api/v1/auth/otp` → 201 `otp`, lưu băm; `auth/driver-register` → 201 token driver; login bằng số → 200; dòng `accounts` có `email` NULL | 09; 21.1, 21.2 | Đạt |
| AC-TX-07 (đổi) | 21 (409) | `auth/otp` lại số đã đăng ký; `driver-register` lại; số TX1 → 409; **`auth/otp` `0900000001` → 201** (số hồ sơ khách không ở `accounts`) | 09 | Đạt |
| AC-TX-26 (đổi) | 12 (403) | KH1 `drivers/11`, `drivers/999`, hồ sơ PENDING / APPROVED / REJECTED của tài xế mới → 403 `FORBIDDEN` | 10, 09; 12.1 | Đạt |
| AC-TX-27 (đổi) | 12 | AD1 và TX1 `drivers/11` → 200 bản đầy đủ (`license GPLX-00001`, `approval_status`, `lat`, `lng`) | 10; 12.2, 12.4 | Đạt |
| AC-TX-28 (đổi) | 12 | AD1 `drivers/999` → 404; `drivers/17` → 200 PENDING; `abc` / `0` / `11 OR 1=1` → 400; không token → 401 | 10; 12.3, 12.6 | Đạt |
| AC-TX-40 (mới) | 12 (403) | TX1 `drivers/12`, `/999`, `/17` → 403 `NOT_OWNER` cả ba | 10, 09; 12.5 | Đạt |
| AC-TX-41 (mới) | 12 | Tài khoản driver mới chưa nộp: A14 mã mình → 404; A11 → 201; A14 → 200 PENDING | 09 | Đạt |
| AC-TX-42 (mới) | 12 (FR14) | KH1 `GET /api/v1/trips/5` → 200 **có `driver.name`, `driver.plate`** của TX6 | 10 | **Không đạt** — L1 |
| AC-TX-43 (mới) | 21, 29 | `auth/otp` ×6 → lần 6 429; sau `Retry-After`: `/otps`, `/driver-accounts` → 404 | 95 | Đạt |
| AC-TX-03…25, 29–39 | 13, 21–23 | Hồi quy (nộp hồ sơ, duyệt / từ chối, Kafka K7, nộp lại FR43, tìm 1 km, bật / tắt) | 09, 10, 15, 90; 13.*, 21.3, 21.4, 22.*, 2122.*, 23.* | Đạt |

### 3.5 Spec 14-15-16-19-30 — A20 theo mã khách

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-DX-01 (đổi) | 14 | `customers/1/bookings?limit=2` [KH1] → 7, 6, `{1, 2, 7, 4}`; `&page=2` → 5, 4 | 11; 14.1, 14.2 | Đạt |
| AC-DX-02 (đổi) | 14 | `?status=canceled` → 6, 1 (total 2); KH2 `customers/2/bookings` → `[]`, total 0 | 11 | Đạt |
| AC-DX-03 (đổi) | 14 (400/401/403) | `limit=abc/51/0`, `page=0` → `INVALID_PAGINATION`; `status=XYZ`, `sort=asc`, `customer_id=2` → `INVALID_INPUT`; không token 401; TX1 403 | 11; 14.5 | Đạt |
| AC-DX-26 (mới) | 14 (403) | KH1 `customers/2/bookings?limit=2`, `customers/999/bookings` → 403 `NOT_OWNER` | 11; 14.3 | Đạt |
| AC-DX-27 (mới) | 14 | AD1 `customers/1/bookings?limit=2` → như AC-DX-01; `customers/999/bookings` → 200 `[]`, total 0 | 11; 14.4 | Đạt |
| AC-DX-28 (mới) | 14 (400/404) | `customers/abc/bookings`, `customers/me/bookings` → 400 `INVALID_ID`; `GET /bookings?limit=2` → 404 `ROUTE_NOT_FOUND` | 11 | Đạt |
| AC-DX-04…25, AC-TT-01…14 | 15, 16, 19, 30 | Hồi quy | 11, 12, 91; 15.*, 16.*, 19.*, 30.* | Đạt |

### 3.6 Spec 20-29 — rate limit (đường dẫn mới)

| AC | Mục | Kiểm tra | File / Postman | Kết quả |
|---|---|---|---|---|
| AC-GH-01 (đổi) | 29 | Tab đăng nhập KH1 body email ×6 → 200 ×5 (Remaining 4…0), lần 6 429, `Retry-After`; log `rate_limited` `scope: ip` không ghi IP; khóa Redis `rl:ip:*` TTL 1–10 | 95; 29.1–29.6 | Đạt |
| AC-GH-02, 04–08 | 29 | Như trước | 95 | Đạt |
| AC-GH-03 (đổi) | 29 | IP bị chặn: `auth/register`, `auth/otp`, `auth/driver-register` → 429; A38 → 200 `RateLimit-Limit: 30`; `/health` không `RateLimit-*`; `X-Forwarded-For` không lách được | 95 | Đạt |
| AC-GH-09 (mới) | 29 | Xen kẽ register (201), login email (200), otp (201), driver-register OTP sai (400 `OTP_INVALID`), login tài xế (200), login email → 429 | 95 | Đạt |
| AC-GH-10 (mới) | 29 | IP bị chặn: `POST /accounts` → 404, không 429; đối chứng login vẫn 429 | 95 | Đạt |
| AC-DG-01…14 | 20 | Hồi quy đánh giá | 14, 92; 20.* | Đạt |

### 3.7 Spec 17-18 — hồi quy

Bước A14 trong file 13 và 92 đã dùng token `[AD1]` từ trước (kiểm lại: mọi `GET /drivers/{id}` trong 11, 13, 91, 92 dùng `ad1`), nên không phải sửa. 34 AC (AC-CD-*, AC-TB-*, AC-HT-01…05 của spec 17-18) **đạt** ở lượt nghiệp vụ 2 và dừng-service lượt 3; AC-CD-19 không đạt ở lượt dừng-service 2 do L2 (đạt ở lượt 1 và 3).

## 4. Bảng 30 mục chấm

| # | Mục | Test tự động (file / Postman) | Kết quả |
|---|---|---|---|
| 1 | Kiến trúc source code | 01 | Đạt |
| 2 | `.gitignore`, `.env` | 01, 06; AC-HS-15 | Đạt |
| 3 | Nhiệm vụ Gateway | 03, 07, 95, unit gateway 116 | Đạt |
| 4 | IPC | 05, 11, 13, 14 | Đạt |
| 5 | Compose, liệt kê container | 02 | Đạt |
| 6 | `/health`, `/ready`, `/health/services` | 03, 04 (AC-HT-05/06/07/16/17); 06.1–06.3 | Đạt (AC-HT-15 phụ chập chờn — L2) |
| 7 | Kafka | 05, 12, 13 | Đạt |
| 8 | Mọi request qua Gateway | 02 (AC-HT-10, 11) | Đạt |
| 9 | Đăng ký → đăng nhập | 07 (AC-DN-01…06, 25, 33), 90; 09.1–09.4 | Đạt |
| 10 | Đăng nhập → token | 07 (AC-DN-07…11, 26…28); 10.1–10.7 | Đạt |
| 11 | Khách theo mã | 08 (AC-HS-01…18, 25…30), 90; 11.1–11.4 | Đạt |
| 12 | Tài xế theo mã | 09, 10 (AC-TX-26…28, 40, 41, 42); 12.1–12.6 | **Chưa đạt trọn** — chuỗi chấm (403 `FORBIDDEN` khách, 200 admin, 404, 403 `NOT_OWNER`) đạt; AC-TX-42 không đạt (L1) |
| 13 | Tài xế quanh 1 km, paging, seed ≥ 5 | 10; 13.1–13.3 | Đạt (seed 8 tài xế, 4 trong 1 km) |
| 14 | Booking theo mã khách, paging, seed ≥ 5 | 11 (AC-DX-01…03, 26…28); 14.1–14.5 | Đạt (seed 7 booking của KH1) |
| 15 | Đặt xe → Offer | 11, 13; 15.1, 15.2 | Đạt |
| 16 | Tài xế nhận chuyến | 11, 13; 16.1–16.4 | Đạt |
| 17 | Trạng thái chuyến đúng trình tự | 13, 92; 17.1–17.7 | Đạt (newman lượt 1: 17.1 → 503 do L2; lượt 2 đạt) |
| 18 | Hủy chuyến, các bên được báo | 13, 92; 18.1–18.7 | Đạt |
| 19 | Thanh toán online + callback | 12; 19.1–19.3 | Đạt |
| 20 | Đánh giá chuyến | 14, 92; 20.1–20.3 | Đạt |
| 21 | Đăng ký tài xế OTP | 09, 15, 95 (AC-TX-43); 21.1–21.4, 2122.* | Đạt |
| 22 | Admin duyệt / từ chối | 09, 15, 90; 22.1–22.3 | Đạt |
| 23 | Bật / tắt nhận chuyến | 09, 10; 23.1, 23.2 | Đạt |
| 24 | Mã hóa at rest | 07 (AC-DN-19), 08 (AC-HS-13, 14, 29), 09 (AC-TX-12); 24.1 | Đạt |
| 25 | SQL injection | 07 (AC-DN-12…14), 08 (AC-HS-17); 25.1–25.4 | Đạt |
| 26 | XSS | 08 (AC-HS-16); 26.1, 26.2 | Đạt |
| 27 | JWT bị sửa → 401 | 07 (AC-DN-15…17, 24), 95; 27.1–27.5 | Đạt |
| 28 | Sai quyền → 403 | 08–15; 28.1, 28.2 | Đạt |
| 29 | Spam → 429 | 95 (AC-GH-01…10, AC-DN-32, AC-TX-43); 29.1–29.6 | Đạt |
| 30 | Replay thanh toán | 12; 30.1–30.4 | Đạt |

Dữ liệu seed cho mục 13, 14 (quy tắc 6): đủ — 8 tài xế (TX1–TX4 trong 1 km quanh (10.82, 106.68)), KH1 có 7 booking; hồ sơ KH1, KH2, KH9 có số điện thoại; KH3 chưa có hồ sơ (dùng cho AC-HS-03, 26).

## 5. Lỗi và mâu thuẫn

### 5.1 Lỗi code cần dev-agent sửa

**L1 — A27 `GET /api/v1/trips/{id}` không có khối `driver` (AC-TX-42, mục 12, FR14).**

| | |
|---|---|
| AC | AC-TX-42 (spec 12-13-21-23, mới 2026-10-14); `docs/design/04` A27 (response mẫu có `"driver": { "driver_id", "name", "plate", "lat", "lng" }`) |
| Tái hiện | 1. `POST /api/v1/auth/login` `{"email":"kh1@cab.vn","password":"12345678"}` → copy token. 2. `GET /api/v1/trips/5` với token đó |
| Mong đợi | 200 có `driver.name = "Tài Xế 6"`, `driver.plate` = biển của TX6 (khách thấy tài xế của chuyến mình dù A14 bị chặn) |
| Thực tế | 200 `{"trip_id":5,"booking_id":5,"status":"ACCEPTED","vehicle":"CAR_4","pay":"ONLINE","fare":45000,"customer_id":1,"driver_id":16,"from":[…],"to":[…],"created_at":"…","history":[…]}` — **không có `driver`** (chỉ có `driver_id`). `services/gateway/src/handlers/trips.js` `TRIP_KEYS` không có `driver`; proto trip không có trường này |
| Ảnh hưởng | Câu trả lời vấn đáp mục 12 trong `06` ("Khách vẫn thấy họ tên, biển số tài xế của chuyến mình qua `GET /trips/{mã}`") hiện **không đúng với hệ thống**. Từ 2026-10-14 khách không còn đường nào xem tên / biển số tài xế |
| Ghi chú | Đụng M1 (spec 17-18 ghi để sau). Cần BA chốt trước khi dev-agent làm |

**L2 — Lời gọi đầu tiên từ Gateway tới một service vừa chạy lại có thể trả 503 `SERVICE_UNAVAILABLE` dù `/health/services` báo `healthy` (AC-HT-15; ảnh hưởng AC-TX-18, AC-CD-19, Postman 17.1).**

| | |
|---|---|
| AC | AC-HT-15 (spec 00, ADR-020): "A09, A36 trả đúng dữ liệu **ngay lần gọi đầu**" |
| Tái hiện (lặp đến khi Docker đổi IP) | 1. Token KH1 như L1. 2. `docker compose restart booking-service payment-service trip-service rating-service`, chờ cả bốn `healthy`. 3. Ghi IP: `docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" payment-service` (và 3 service kia). 4. Gọi lần lượt `GET /api/v1/trips/5`, `/bookings/5`, `/payments/5`, `/ratings?driver_id=11`. Lặp bước 2–4 đến khi IP hai service đổi chỗ cho nhau (lần thử thứ 3 trong đợt này: booking ↔ payment, trip ↔ rating) |
| Mong đợi | 200 cả bốn ngay lần đầu |
| Thực tế | Lần đổi IP: `payments/5` → **503**, `ratings?driver_id=11` → **503** (lỗi trong 3–8 ms, tức kênh từ chối ngay, không chờ kết nối). Gọi lại ngay → 200. Trong đợt: AC-HT-15 chạy riêng 8 lần thì 3 lần đỏ (A09 hoặc A36 → 503); `test:dung-service` lượt 2: `POST /drivers` → 503 ngay sau khi bật lại driver-service, `PATCH /trips/{id}` (A29) → 503 ngay sau khi bật lại trip-service; newman lượt 1: `PATCH /trips/1000` → 503 (4 ms) — lần đầu Gateway gọi trip-service, 52 giây sau khi trip-service healthy. `/health/services` gọi ngay trước đó vẫn báo 8 `healthy` |
| Ảnh hưởng khi thi | Mục 6 (tùy chọn `stop`/`start rating-service`) rồi gọi API của service đó; hoặc sau khi đặt lại dữ liệu bằng restart: request đầu tiên có thể 503, người chấm thấy lỗi. Cách tạm khi demo: sau khi restart service, gửi mỗi API một lần trước khi trình bày |
| Ghi chú | Báo cáo 2026-10-07 AC-HT-15 đạt (có thể do may); code kênh gRPC (`services/gateway/src/grpc/clients.js`) không đổi ở commit `1241b96`, nên đây không phải hồi quy của đợt góp ý mà là lỗi có sẵn, nay lộ ra |

### 5.2 Mâu thuẫn spec cần BA chốt

**M1 — A27 có hay không có khối `driver`.** `docs/specs/17-18-chuyen-di-thong-bao.md` mục 2.8, 4.2, CD10, CD-M2 (và bảng "để sau": "S6 `GetDriverSummary` → khối `driver` trong A27 (FR14, UC10) — ngoài phiếu; A27 đã có `driver_id`"): A27 **không** có `driver`. `docs/specs/12-13-21-23-tai-xe.md` AC-TX-42 (2026-10-14) và `docs/design/04` A27, `docs/design/06` mục 12 "Nói gì": A27 **có** `driver.name`, `driver.plate`. Nay A14 chặn khách nên FR14 (khách xem tài xế của chuyến) chỉ còn đường A27. Cần chốt: (a) làm S6 / khối `driver` (dev-agent sửa — L1), hoặc (b) bỏ AC-TX-42 và sửa câu vấn đáp mục 12 trong `06`.

### 5.3 Lỗi bộ test đã sửa trong đợt này

| Lỗi | Sửa |
|---|---|
| Helper `login` / `tokenOf` gửi `{phone}` cho mọi tài khoản seed; `SEED.KH*`, `SEED.AD1` là số điện thoại | `SEED` theo ADR-021 (`kh1@cab.vn`…, `admin@cab.vn`; tài xế giữ số); `loginBody` chọn `email` / `phone` theo định danh; thêm `SEED_PROFILE_PHONE` |
| `newCustomer` đăng ký ở `/accounts` bằng số; `newDriverAccount` dùng `/otps`, `/driver-accounts` | `auth/register` bằng email ngẫu nhiên `qa########@test.vn`; `auth/otp`, `auth/driver-register`; tracker dọn thêm theo email |
| Assert health chữ cũ (`UP`, `READY`, `SERVING`, `DEGRADED`, `UNREACHABLE`, `NOT_READY`, `DOWN`) trong 03, 04, 92 | Đổi sang `healthy` / `ready` / `not_ready` / `unhealthy` |
| A14 bằng token khách (09, 10) kỳ vọng phần công khai / 404 | Khách → 403 `FORBIDDEN`; tài xế khác → 403 `NOT_OWNER`; chủ / admin → 200 |
| A20 `GET /bookings` (11) | `GET /customers/{id}/bookings` |
| Test hồ sơ email (AC-HS-19…24), AC-DN-21…23 | Thay bằng AC-HS-25…30, AC-DN-24…33 theo spec |
| 95 dùng `/accounts`, `/otps`, body `phone` cho KH1 | Đường mới, body email; thêm AC-GH-09, 10, AC-DN-32, AC-TX-43 |
| Biểu thức `/\r?\n/` bị ghi hỏng khi thêm kiểm log ở 04 (test-agent) | Sửa; file 04 chạy 9 / 9 |

## 6. Ghi chú (không phải lỗi)

- Chuỗi gõ tay mục 21 ghi `0911111111`; collection tự sinh `0599xxxxxx` để chạy lại. Mục 9 ghi `new1@cab.vn`; collection tự sinh `qa########@test.vn`.
- `RATE_LIMIT_WINDOW_SECONDS` mẫu là **10 s** (`.env.example`), ngưỡng công khai 5, tài khoản 30.
- Thời gian phản hồi: newman trung bình 22 ms, tối đa 122 ms; `/health/services` khi một service dừng 1 058 ms (deadline 1 s).

## 7. Postman

`postman/cab.postman_collection.json` sửa theo `docs/design/06` (chuỗi gõ tay đã đổi ngày 2026-10-14):

| Thư mục | Thay đổi |
|---|---|
| 06 | Kiểm `healthy`, `ready`, 8 service `healthy`; không còn chữ cũ (AC-HT-17) |
| 09 | `POST /api/v1/auth/register` `{"email","password"}` (biến `email9`) → sửa URL `login` → `register` lại 409 `EMAIL_ALREADY_EXISTS`; 09.4 kèm `phone` → 400 (AC-DN-25) |
| 10 | 10.1 `{"email":"kh1@cab.vn",…}` (tab KH1) → 10.2 `admin@cab.vn` (tab AD1) → 10.3 `{"phone":"0910000001",…}` (tab TX1), đúng thứ tự `06`; 10.4 gửi cả hai → 400; 10.5 sai mật khẩu; 10.6 KH9 → 403; 10.7 số hồ sơ → 401 |
| 11 | Hồ sơ có `phone`, không `email`; 11.3 body `{"name":"Pham Duc","phone":"0901234567"}` |
| 12 | `drivers/11` [KH1] → 403 `FORBIDDEN` → [AD1] 200 đầy đủ → `drivers/999` 404 → (tùy chọn [TX1] `drivers/11` 200, `drivers/12` 403 `NOT_OWNER`) → `drivers/abc` 400 |
| 14 | `customers/1/bookings?limit=2` → `&page=2` → `customers/2/…` 403 `NOT_OWNER` → (tab admin 200) → `limit=abc` 400 |
| 21 | `auth/otp` → `auth/driver-register` |
| 24 | Kiểm thêm `phone` rõ; mô tả lệnh `psql` có cột `phone` |
| 25 | Thứ tự `06`: email injection → 400 `INVALID_EMAIL` → password injection → 401 → (tab GET `customers/1 OR 1=1` → 400); 25.4 phone injection → `INVALID_PHONE` |
| 27 | 27.1 làm như jwt.io (đổi `role` thành `admin`, giữ chữ ký) → 401 (AC-DN-24); 27.1b dự phòng sửa một ký tự; 27.3 đăng nhập bằng email |
| 29 | Body `{"email":"kh1@cab.vn","password":"12345678"}` |

Kết quả: thư mục trừ 29 — 91 request / 195 assertion, 195 đạt (lượt 2; lượt 1 hai assertion 17.1 đỏ do L2). Thư mục 29 — 6 request / 13 assertion, 13 đạt.

## 8. Trạng thái hệ thống sau kiểm thử

- 21 container: 20 `running (healthy)`, `kafka-init` `exited (0)`; `/health/services` 200, 8 `healthy`.
- Gateway về `.env`: `RATE_LIMIT_WINDOW_SECONDS=10`, `RATE_LIMIT_PUBLIC_MAX=5`, `RATE_LIMIT_ACCOUNT_MAX=30`.
- Dữ liệu về seed: booking, payment, trip, rating dựng lại schema (7 booking, chuyến 5 `ACCEPTED`); notifications rỗng; `accounts` 13 dòng (mã lớn nhất 99), không còn hồ sơ / tài xế / OTP test; hồ sơ KH1, KH2, KH9 phone `0900000001`, `0900000002`, `0900000009`; tài xế TX1–TX4, TX8 `ONLINE`, TX5 `OFFLINE`, TX6 `BUSY` (booking 5), TX7 `PENDING` "Tài Xế 7".
- Lưu ý (L2): bốn service booking, payment, trip, rating vừa được restart ở bước dọn cuối; request đầu tiên tới chúng có thể 503 một lần.

## 9. File đã tạo / sửa

| File | Nội dung |
|---|---|
| `tests/e2e/api.js` | `SEED` theo email / số, `SEED_PROFILE_PHONE`, `loginBody`, `newEmail`; `newCustomer`, `newDriverAccount` dùng đường `auth/…`; tracker dọn theo email |
| `tests/e2e/03-health.test.js` | Chữ mới; thêm AC-HT-17 |
| `tests/e2e/04-health-degraded.test.js` | Chữ mới; AC-HT-06 kiểm log `warn`; thêm AC-HT-16 |
| `tests/e2e/07-dang-ky-dang-nhap.test.js` | Đăng ký / đăng nhập email; AC-DN-24…29, 31, 33; bỏ AC-DN-21…23 cũ |
| `tests/e2e/08-ho-so-khach-hang.test.js` | Hồ sơ `phone`; AC-HS-25…30; bỏ AC-HS-19…24 cũ |
| `tests/e2e/09-tai-xe-dang-ky-duyet.test.js` | Đường `auth/otp`, `auth/driver-register`; A14 theo chủ; AC-TX-07 (số hồ sơ), 26, 40, 41 |
| `tests/e2e/10-tai-xe-xem-tim-bat-tat.test.js` | AC-TX-26 (403), 27, 28 (admin), 40, 42 |
| `tests/e2e/11-dat-xe.test.js` | A20 `customers/{id}/bookings`; AC-DX-26…28 |
| `tests/e2e/90-dung-service.test.js` | AC-DN-06 `auth/register`; login email |
| `tests/e2e/92-dung-service-chuyen-di.test.js` | AC-HT-15 chữ `healthy` |
| `tests/e2e/95-rate-limit.test.js` | Body email, đường mới; AC-GH-09, 10, AC-DN-32, AC-TX-43 |
| `postman/cab.postman_collection.json` | Mục 7 |
| `docs/test-reports/2026-10-21-hoi-quy-gop-y-giang-vien.md` | Báo cáo này |

`tests/e2e/15-tai-xe-nop-lai.test.js` không phải sửa (dùng helper chung, không gọi đường cũ). Không đụng `postman/luyen-tap/` và `docs/study/03-luyen-tap-postman.md` (chưa commit, có sẵn từ trước đợt này, không phải của test-agent; collection luyện tập đó đã dùng đường `auth/…` và `customers/1/bookings`).
