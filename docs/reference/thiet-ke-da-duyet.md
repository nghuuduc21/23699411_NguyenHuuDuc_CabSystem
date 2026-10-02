# Thiết kế tham chiếu đã được giảng viên duyệt

> Ghi lại 2026-10-02 từ hai ảnh trong thư mục này:
> `design-da-duyet.jpg` (kiến trúc) và `DB-da-duyet.jpg` (bounded context / database).
> Đây là thiết kế của một sinh viên khác đã được giảng viên duyệt, dùng làm **mốc tham chiếu**.
> Không sao chép nguyên trạng; thiết kế của project này phải truy vết về `srs.md` và tự giải thích được.

## 1. Điều chỉnh của giảng viên

Thiết kế trong ảnh có **10 service**. Giảng viên nhận xét là hơi nhiều và chỉ cần **8 bounded context = 8 service**:

| # | Bounded context | Service | Ghi chú |
|---|---|---|---|
| 1 | Identity & Access | `auth-service` | |
| 2 | Customer Management | `customer-service` | |
| 3 | Driver & Vehicle Management | `driver-service` | Giảng viên cho **gộp** Driver và Vehicle. Chỉ tách khi khách hàng được tự chọn xe cụ thể |
| 4 | Booking Management | `booking-service` | Gồm cả ghép tài xế (không có dispatch-service riêng) |
| 5 | Trip Management (Ride/Trip) | `trip-service` | |
| 6 | Fare & Payment | `payment-service` | |
| 7 | Notification | `notification-service` | |
| 8 | Rating & Review | `review-service` | Mục chấm 20: "Review được lưu và liên kết với chuyến đi". Sinh viên đã xác nhận |

Bỏ khỏi phạm vi: `report-service` (Reporting) và `audit-service` (Audit).

## 2. Kiến trúc trong ảnh `design-da-duyet.jpg`

**Tầng ngoài**

- Client (Web / Mobile App: Rider, Driver, Admin/Operations) → API Gateway bằng **REST (HTTPS/JSON)**.
- API Gateway: Authentication & Authorization, Request Routing, Rate Limiting, Logging & Monitoring.
- Redis (API Gateway Cache): cache token, session store, rate limiting, cache dữ liệu chung.
- Gateway → từng service bằng **gRPC (synchronous)**.

**Service và database**

| Service | Nhiệm vụ ghi trong ảnh | Database | Bảng |
|---|---|---|---|
| auth-service | Quản lý tài khoản; JWT / OTP / Refresh Token; xác thực, phân quyền | PostgreSQL (auth_db) | User, Role, RefreshToken, OTPVerification |
| customer-service | Hồ sơ khách hàng; xem / cập nhật profile; cung cấp dữ liệu customer | PostgreSQL (customer_db) | Customer, CustomerProfile |
| driver-service | Tài xế & phương tiện; duyệt hồ sơ / trạng thái; vị trí tài xế, ETA; tìm tài xế gần nhất | PostgreSQL + PostGIS (driver_db) | Driver, Vehicle, VehicleType, DriverLocation |
| booking-service | Tạo & quản lý booking; ghép tài xế / đề xuất tài xế; trạng thái booking; phát sự kiện booking | PostgreSQL (booking_db) | Booking, DriverOffer, DriverAssignment |
| trip-service | Tạo trip từ booking; theo dõi hành trình; tính quãng đường / thời gian; cập nhật trạng thái trip | PostgreSQL (trip_db) | Trip, TripStatusHistory |
| payment-service | Tính cước (fare); thanh toán online; callback / đối soát; quản lý giao dịch | PostgreSQL (payment_db) | Payment, Transaction |
| notification-service | Tạo & gửi thông báo; Email / SMS / Push; theo dõi trạng thái gửi; tiêu thụ sự kiện business | MongoDB (notification_db) | Notification, DeliveryStatus |
| review-service | Đánh giá tài xế; kiểm tra quyền đánh giá; quản lý review; phát sự kiện review | PostgreSQL (review_db) | Review |
| ~~report-service~~ | Báo cáo doanh thu, thống kê | PostgreSQL (report_db) | Bỏ |
| ~~audit-service~~ | Ghi log / truy vết | PostgreSQL (audit_db) | Bỏ |

**gRPC giữa các service (đồng bộ)** — ảnh vẽ bốn đường, mỗi đường có nhãn mục đích:

| Giữa | Nhãn |
|---|---|
| customer-service ↔ driver-service | validate customer |
| driver-service ↔ booking-service | matching / availability |
| booking-service ↔ trip-service | location / ETA lookup |
| trip-service ↔ payment-service | validate completed trip |

Ảnh vẽ các đường này giữa hai ô đứng cạnh nhau, nên bên gọi và bên được gọi cần xác định lại theo nghiệp vụ (ví dụ "validate customer" hợp lý hơn là booking gọi customer).

**Message broker: RabbitMQ (bất đồng bộ)**

| Service | Publish | Consume |
|---|---|---|
| booking-service | `booking.created`, `driver.offer.created`, `booking.no_driver_found`, `driver.accepted` | — |
| trip-service | `trip.status.changed`, `trip.canceled` | `driver.accepted` |
| payment-service | `payment.completed`, `payment.failed` | `trip.status.changed` (COMPLETED) |
| notification-service | — | các business event |
| review-service | `review.created` | trip / payment events |
| auth, customer | — | — |

auth-service và customer-service **không nối** với message broker. Đây là điểm khớp với yêu cầu "không phải service nào cũng giao tiếp cả đồng bộ lẫn bất đồng bộ".

**Hệ thống ngoài:** Map / Geolocation Service (location, ETA, route), Payment Provider (payment API, webhook), Notification Provider (email, SMS, push).

## 3. Bảng trong ảnh `DB-da-duyet.jpg`

Kiểu dữ liệu ghi theo ảnh; chỗ ảnh mờ thì chỉ ghi tên cột.

**1. Identity & Access**

- `ROLE` (role_id INT PK, role_name VARCHAR(100), description VARCHAR(255))
- `PERMISSION` (permission_id INT PK, permission_code VARCHAR(50), description VARCHAR(255))
- `ROLE_PERMISSION` (role_id PK/FK, permission_id PK/FK, created_at DATETIME)
- `USER_ACCOUNT` (user_id INT PK, phone VARCHAR(20), email VARCHAR(100), password_hash VARCHAR(255), role_id FK, status VARCHAR(20), created_at DATETIME)
- `REFRESH_TOKEN` (token_id PK, user_id FK, token_hash VARCHAR(255), expires_at, revoked_at, device_info VARCHAR(255))
- `OTP_VERIFICATION` (otp_id PK, user_id FK, phone VARCHAR(20), otp_hash VARCHAR(255), purpose VARCHAR(50), expires_at, verified_at, attempt_count INT)

**2. Customer Management**

- `CUSTOMER_PROFILE` (customer_id INT PK, user_id INT, fullname VARCHAR(100), address VARCHAR(255), date_of_birth DATE, created_at DATETIME)

**3. Driver & Vehicle Management**

- `DRIVER` (driver_id INT PK, user_id INT, approval_status VARCHAR(20), vehicle_type VARCHAR(50), created_at)
- `DRIVER_PROFILE` (driver_id PK/FK, full_name, address, date_of_birth, driver_license_number VARCHAR(50), driver_license_expiry)
- `DRIVER_LOCATION` (driver_id PK/FK, latitude DECIMAL(10,7), longitude DECIMAL(10,7), recorded_at)
- `VEHICLE_TYPE` (vehicle_type_id INT PK, name, description, status)
- `VEHICLE` (vehicle_id PK, driver_id FK, vehicle_type_id FK, license_plate VARCHAR(50), brand, model, status)
- `DRIVER_APPLICATION` (application_id PK, driver_id FK, vehicle_id FK, status VARCHAR(20), reviewed_by, submitted_at, released_at)

**4. Booking Management**

- `BOOKING` (booking_id INT PK, customer_id INT, pickup_latitude DECIMAL(10,7), pickup_longitude DECIMAL(10,7), pickup_address VARCHAR(255), destination_latitude, destination_longitude, destination_address, requested_vehicle_type INT, status VARCHAR(20), created_at)
- `DRIVER_OFFER` (offer_id PK, booking_id FK, driver_id, vehicle_id, status VARCHAR(20), price_offer DECIMAL(10,2), expires_at, created_at)
- `DRIVER_ASSIGNMENT` (assignment_id PK, booking_id FK, driver_id, vehicle_id, assigned_at)

**5. Trip Management**

- `TRIP` (trip_id INT PK, booking_id, driver_id, vehicle_id, pickup_latitude / longitude, dropoff_latitude / longitude DECIMAL(10,7), status VARCHAR(20), started_at, arrived_at, completed_at, cancelled_at, cancellation_reason VARCHAR(255), created_at)
- `TRIP_STATUS_HISTORY` (history_id PK, trip_id FK, status, to_status, changed_by, reason VARCHAR(255), changed_at)

**6. Fare & Payment**

- `FARE` (fare_id PK, trip_id, vehicle_type_id, base_fare DECIMAL(10,2), currency VARCHAR(10), pricing_rules JSON, surge_multiplier, calculated_at)
- `PAYMENT` (payment_id PK, fare_id FK, trip_id, customer_id, amount DECIMAL(10,2), currency, payment_method VARCHAR(20), payment_status VARCHAR(20), transaction_ref VARCHAR(100), transaction_time)
- `PAYMENT_TRANSACTION` (transaction_id PK, payment_id FK, provider_transaction_id VARCHAR(100), transaction_date, amount DECIMAL(10,2), currency, status, processed_at)

**7. Notification**

- `NOTIFICATION` (notification_id PK, recipient_id, notification_type, title VARCHAR(255), message VARCHAR(500), status, created_at)
- `NOTIFICATION_DELIVERY` (delivery_id PK, notification_id FK, recipient_id, channel VARCHAR(20), provider_name, provider_response, status, delivered_at)

**8. Rating & Review**

- `DRIVER_RATING` (rating_id PK, customer_id, driver_id, rating_score DECIMAL(3,2), comment, created_at)
- `REVIEW` (review_id PK, trip_id, customer_id, driver_id, rating INT, comment VARCHAR(255), created_at)

**9. Reporting, 10. Audit:** bỏ theo yêu cầu của giảng viên.

## 4. Điểm cần cân nhắc khi áp dụng vào project này

| Điểm | Trong ảnh | Project này |
|---|---|---|
| Message broker | RabbitMQ | **Kafka** (sinh viên đã chốt). Phiếu chấm mục 7 chấp nhận cả hai; event trong ảnh chuyển thành topic Kafka, xem qua Kafka UI |
| Ghép tài xế | Nằm trong booking-service (DriverOffer, DriverAssignment) | Phải theo ảnh: không có dispatch-service riêng |
| Booking và Trip | Hai service | Phải tách (thiết kế trước đó của ba-agent gộp thành ride-service) |
| Rating | Service riêng | Phải tách (thiết kế trước đó gộp vào ride-service) |
| Vai trò | Bảng ROLE + PERMISSION + ROLE_PERMISSION | Đã chốt ba vai trò `customer`, `driver`, `admin`; có cần bảng PERMISSION không là câu hỏi mở |
| Khóa chính | INT | Cần chốt INT hay UUID và ghi lý do |
| Lưu vết, báo cáo (FR30–FR34) | report-service, audit-service | Service bị bỏ; phần nào phiếu chấm cần thì đặt vào service liên quan |
