// Bảng route của Gateway: MỘT chỗ khai báo mọi đường dẫn (spec 00 mục 4, 04 mục 1.10).
// Mỗi dòng: mã API, method, đường dẫn, role được phép, rpc ở service, hàm kiểm tra hình thức, hàm xử lý.
//   roles:    null = công khai (không cần token); mảng = phải có token với một trong các role này.
//   rpc:      null = Gateway tự trả lời, không gọi service.
//   validate: kiểm tra hình thức body, trả mã lỗi hoặc null (không có = không có body).
//   validateParams: kiểm tra tham số đường dẫn (ví dụ `:id` phải là số nguyên dương).
//   select:   (chỉ đường dẫn có nhiều mã API — 04 mục 1.10) tra bảng theo body / query, trả
//             { error } hoặc { roles, handler } của biến thể; message gRPC dựng sẵn ở req.rpcRequest.
//   rateLimit: bộ đếm của mục chấm 29 (spec 20-29 mục 4.4): 'ip' = 4 route công khai chung một bộ đếm theo IP;
//             'account' = mặc định của route có token (một bộ đếm theo mã tài khoản); 'booking' = riêng đặt xe
//             (bộ đếm riêng theo mã tài khoản, ngưỡng thấp — mục chấm 29 demo ở đây); 'none' = không đếm
//             (health để Docker / người chấm luôn xem được; callback vì cổng thanh toán không phải người dùng).
// A01–A03 nằm ngoài tiền tố /api/v1 vì không phải tài nguyên nghiệp vụ.
import { ROLES } from './token.js';
import {
  parseBookingsQuery, parseCallbackBody, parseCancelBookingBody, parseCreateBooking, parseDriverMeBody, parseDriversQuery,
  parseCreateRating, parseNotificationsQuery, parseOfferBody, parseOffersQuery, parsePayRequest, parseRatingsQuery,
  parseReviewBody, parseTripBody,
  validateCreateCustomer, validateIdParam, validateLogin,
  validateRegister, validateRegisterDriver, validateRequestOtp, validateSubmitDriver, validateUpdateCustomer,
} from './validate.js';

// Biến bảng biến thể { mã: { roles, handler } } thành hàm `select` cho app.js:
// `parse` trả { error } hoặc { variant, request }; request được gắn vào req để handler chuyển thẳng.
function selectBy(parse, variants) {
  return (req) => {
    const parsed = parse(req);
    if (parsed.error) return parsed;
    req.rpcRequest = parsed.request;
    return variants[parsed.variant];
  };
}

// customers: handler hồ sơ khách (spec 11); drivers: handler tài xế (spec 12-13-21-23);
// bookings, payments: đặt xe, lời mời, thanh toán (spec 14-15-16-19-30); trips, notifications: chuyến đi, hủy,
// thông báo (spec 17-18); ratings: đánh giá (spec 20-29). Test chỉ thử health / auth thì không truyền → không có các route này.
export function buildRoutes({ health, auth, customers, drivers, bookings, payments, trips, notifications, ratings }) {
  return [
    { code: 'A01', method: 'GET', path: '/health', roles: null, rateLimit: 'none', rpc: null, handler: health.live },
    { code: 'A02', method: 'GET', path: '/ready', roles: null, rateLimit: 'none', rpc: null, handler: health.ready },
    { code: 'A03', method: 'GET', path: '/health/services', roles: null, rateLimit: 'none', rpc: 'grpc.health.v1.Health/Check', handler: health.services },

    // Spec 09-10, 12-13-21-23 (sửa 2026-10-14 theo yêu cầu giảng viên, ADR-021): MỌI thao tác xác thực gom vào
    // nhóm `/api/v1/auth/…` — quy ước phổ biến, người chấm nhìn là biết. Đường cũ /accounts, /otps, /driver-accounts
    // không còn khai báo nên trả 404 ROUTE_NOT_FOUND (và không bị đếm rate limit).
    // Bốn route công khai (register, login, otp, driver-register) chung MỘT bộ đếm theo IP (mục chấm 29).
    // A04: khách đăng ký bằng email; chỉ tạo `customer`.
    { code: 'A04', method: 'POST', path: '/api/v1/auth/register', roles: null, rateLimit: 'ip', rpc: 'cab.auth.v1.AuthService/RegisterCustomer', validate: validateRegister, handler: auth.register },
    // A05: cả ba role; đúng một trong email (khách, admin) / phone (tài xế).
    { code: 'A05', method: 'POST', path: '/api/v1/auth/login', roles: null, rateLimit: 'ip', rpc: 'cab.auth.v1.AuthService/Login', validate: validateLogin, handler: auth.login },
    // A06: có token → đếm theo tài khoản như mọi route có token.
    { code: 'A06', method: 'POST', path: '/api/v1/auth/logout', roles: ROLES, rpc: null, handler: auth.logout },
    // A07, A08: tài xế xin OTP rồi đăng ký bằng số điện thoại. Đường riêng với A04 vì luật tạo khác (phải có OTP,
    // role `driver`, định danh là số). Công khai: người đăng ký chưa có token.
    { code: 'A07', method: 'POST', path: '/api/v1/auth/otp', roles: null, rateLimit: 'ip', rpc: 'cab.auth.v1.AuthService/RequestDriverOtp', validate: validateRequestOtp, handler: auth.requestOtp },
    { code: 'A08', method: 'POST', path: '/api/v1/auth/driver-register', roles: null, rateLimit: 'ip', rpc: 'cab.auth.v1.AuthService/RegisterDriver', validate: validateRegisterDriver, handler: auth.registerDriver },

    // Spec 11. Tạo hồ sơ = POST vào tập `customers`; không có mã trong đường dẫn vì mã = mã trong token.
    // Admin chỉ xem, tài xế không dùng hồ sơ khách (BRULE18) → hai role này bị 403 FORBIDDEN ngay ở Gateway.
    ...(customers ? [
      { code: 'A37', method: 'POST', path: '/api/v1/customers', roles: ['customer'], rpc: 'cab.customer.v1.CustomerService/CreateCustomer', validate: validateCreateCustomer, handler: customers.create },
      // `/customers/me` khai báo TRƯỚC `/customers/:id`: Express khớp theo thứ tự, nếu đảo thì "me" bị coi là mã → 400.
      { code: 'A38', method: 'GET', path: '/api/v1/customers/me', roles: ['customer'], rpc: 'cab.customer.v1.CustomerService/GetCustomer', handler: customers.me },
      // Khách chỉ xem được mã của mình (service trả 403 NOT_OWNER); admin xem mọi mã.
      { code: 'A09', method: 'GET', path: '/api/v1/customers/:id', roles: ['customer', 'admin'], rpc: 'cab.customer.v1.CustomerService/GetCustomer', validateParams: validateIdParam, handler: customers.byId },
      // PATCH = sửa một phần. Không có PATCH /customers/{id}: chỉ chủ được sửa hồ sơ của mình.
      { code: 'A10', method: 'PATCH', path: '/api/v1/customers/me', roles: ['customer'], rpc: 'cab.customer.v1.CustomerService/UpdateCustomer', validate: validateUpdateCustomer, handler: customers.update },
    ] : []),

    // Spec 12-13-21-23 — tài xế. Role của ĐƯỜNG DẪN kiểm trước khi đọc body / query (mục chấm 28);
    // role của BIẾN THỂ kiểm sau khi chọn (04 mục 1.10).
    ...(drivers ? [
      // A11: nộp hồ sơ = POST vào tập `drivers`; mã = mã trong token.
      { code: 'A11', method: 'POST', path: '/api/v1/drivers', roles: ['driver'], rpc: 'cab.driver.v1.DriverService/SubmitApplication', validate: validateSubmitDriver, handler: drivers.submit },
      // GET /drivers: có lat / lng → A12 (khách, admin); không → A13 (chỉ admin). Tài xế bị 403 ngay.
      {
        code: 'A12|A13', method: 'GET', path: '/api/v1/drivers', roles: ['customer', 'admin'],
        rpc: 'cab.driver.v1.DriverService/FindNearbyDrivers|ListDrivers',
        select: selectBy((req) => parseDriversQuery(req.query), {
          A12: { roles: ['customer', 'admin'], handler: drivers.nearby },
          A13: { roles: ['admin'], handler: drivers.list },
        }),
      },
      // `/drivers/me` khai báo TRƯỚC `/drivers/:id`: Express khớp theo thứ tự, nếu đảo thì "me" bị coi là mã → 400.
      {
        code: 'A17|A39|A18', method: 'PATCH', path: '/api/v1/drivers/me', roles: ['driver'],
        rpc: 'cab.driver.v1.DriverService/SetAvailability|UpdateLocation',
        select: selectBy((req) => parseDriverMeBody(req.body), {
          A17: { handler: drivers.availability },
          A39: { handler: drivers.availability },
          A18: { handler: drivers.location },
        }),
      },
      // A14 (sửa 2026-10-14 theo yêu cầu giảng viên): chỉ tài xế (mã của mình — service trả 403 NOT_OWNER nếu khác)
      // và admin (mọi mã). Khách bị 403 FORBIDDEN ngay ở đây, không gọi service.
      { code: 'A14', method: 'GET', path: '/api/v1/drivers/:id', roles: ['driver', 'admin'], rpc: 'cab.driver.v1.DriverService/GetDriver', validateParams: validateIdParam, handler: drivers.byId },
      // A15 / A16: chỉ admin — khách, tài xế bị 403 dù body rỗng (AC-TX-17).
      {
        code: 'A15|A16', method: 'PATCH', path: '/api/v1/drivers/:id', roles: ['admin'],
        rpc: 'cab.driver.v1.DriverService/ApproveDriver|RejectDriver', validateParams: validateIdParam,
        select: selectBy((req) => parseReviewBody(req.body), {
          A15: { handler: drivers.approve },
          A16: { handler: drivers.reject },
        }),
      },
    ] : []),

    // Spec 14-15-16-19-30 — đặt xe, lời mời. Role của đường dẫn kiểm TRƯỚC body (mục chấm 28: tài xế đặt xe → 403).
    ...(bookings ? [
      // A19: đặt xe = POST vào tập `bookings`; khách đặt được nhiều booking, nhưng tối đa RATE_LIMIT_BOOKING_MAX lần
      // trong mỗi cửa sổ (mục chấm 29: spam đặt xe → 429).
      {
        code: 'A19', method: 'POST', path: '/api/v1/bookings', roles: ['customer'], rateLimit: 'booking', rpc: 'cab.booking.v1.BookingService/CreateBooking',
        select: selectBy((req) => parseCreateBooking(req.body), { A19: { handler: bookings.create } }),
      },
      // A20 (sửa 2026-10-14 theo yêu cầu giảng viên): booking THEO MÃ KHÁCH — tài nguyên con của khách
      // (`/{resource}/{id}/{sub-resource}`). Đường dẫn bắt đầu bằng `customers` nhưng dữ liệu thuộc Booking nên
      // bảng route trỏ sang booking-service; customer-service không tham gia (không thêm đường giao tiếp nào).
      // Khách chỉ mã của mình (service trả 403 NOT_OWNER), admin mọi mã, tài xế 403 ngay ở đây.
      // Bỏ GET /api/v1/bookings để chỉ còn một cách (đường cũ → 404).
      {
        code: 'A20', method: 'GET', path: '/api/v1/customers/:id/bookings', roles: ['customer', 'admin'], rpc: 'cab.booking.v1.BookingService/ListBookings',
        validateParams: validateIdParam,
        select: selectBy(parseBookingsQuery, { A20: { handler: bookings.list } }),
      },
      // A21: chủ (service kiểm) hoặc admin.
      { code: 'A21', method: 'GET', path: '/api/v1/bookings/:id', roles: ['customer', 'admin'], rpc: 'cab.booking.v1.BookingService/GetBooking', validateParams: validateIdParam, handler: bookings.byId },
      // A22 (spec 17-18): hủy = PATCH + `status` CANCELED (không có động từ trong đường dẫn). Chỉ khách; tài xế, admin
      // bị 403 TRƯỚC khi đọc body (mục chấm 28).
      {
        code: 'A22', method: 'PATCH', path: '/api/v1/bookings/:id', roles: ['customer'], rpc: 'cab.booking.v1.BookingService/CancelBooking',
        validateParams: validateIdParam,
        select: selectBy((req) => parseCancelBookingBody(req.body), { A22: { handler: bookings.cancel } }),
      },
      // A23: lời mời của chính tài xế.
      {
        code: 'A23', method: 'GET', path: '/api/v1/offers', roles: ['driver'], rpc: 'cab.booking.v1.BookingService/ListOffers',
        select: selectBy((req) => parseOffersQuery(req.query), { A23: { handler: bookings.offers } }),
      },
      // A24 / A25: đổi trạng thái lời mời bằng PATCH + `status` (không có động từ trong đường dẫn — ADR-018).
      {
        code: 'A24|A25', method: 'PATCH', path: '/api/v1/offers/:id', roles: ['driver'],
        rpc: 'cab.booking.v1.BookingService/AcceptOffer|RejectOffer', validateParams: validateIdParam,
        select: selectBy((req) => parseOfferBody(req.body), {
          A24: { handler: bookings.accept },
          A25: { handler: bookings.reject },
        }),
      },
    ] : []),

    // Spec 14-15-16-19-30 — thanh toán (mục 19, 30).
    ...(payments ? [
      // A31 khai báo TRƯỚC A30 (spec mục 4): đường dẫn dài hơn khớp trước. Mỗi lần thanh toán là một
      // giao dịch mới → POST vào tập `transactions` của thanh toán đó.
      {
        code: 'A31', method: 'POST', path: '/api/v1/payments/:id/transactions', roles: ['customer'],
        rpc: 'cab.payment.v1.PaymentService/PayPayment', validateParams: validateIdParam,
        select: selectBy(parsePayRequest, { A31: { handler: payments.pay } }),
      },
      { code: 'A30', method: 'GET', path: '/api/v1/payments/:id', roles: ['customer', 'admin'], rpc: 'cab.payment.v1.PaymentService/GetPayment', validateParams: validateIdParam, handler: payments.byId },
      // A32: KHÔNG token, không role (cổng thanh toán không có tài khoản); xác thực bằng khóa bí mật ở payment-service.
      {
        code: 'A32', method: 'POST', path: '/api/v1/payment-callbacks', roles: null, rateLimit: 'none', rpc: 'cab.payment.v1.PaymentService/HandleProviderCallback',
        select: selectBy((req) => parseCallbackBody(req.body), { A32: { handler: payments.callback } }),
      },
    ] : []),

    // Spec 17-18 — chuyến đi (mục 17, 18).
    ...(trips ? [
      // A27: cả ba role; service kiểm khách / tài xế CỦA CHUYẾN (403 NOT_OWNER), admin xem mọi chuyến.
      { code: 'A27', method: 'GET', path: '/api/v1/trips/:id', roles: ROLES, rpc: 'cab.trip.v1.TripService/GetTrip', validateParams: validateIdParam, handler: trips.byId },
      // A28 / A29: một đường dẫn, chọn theo `status`. Admin bị 403 ở role đường dẫn (trước body — CD-Q7); khách gửi
      // A28 (tiến trạng thái) bị 403 ở role biến thể: chỉ tài xế đón / trả khách.
      {
        code: 'A28|A29', method: 'PATCH', path: '/api/v1/trips/:id', roles: ['customer', 'driver'],
        rpc: 'cab.trip.v1.TripService/UpdateTripStatus|CancelTrip', validateParams: validateIdParam,
        select: selectBy((req) => parseTripBody(req.body), {
          A28: { roles: ['driver'], handler: trips.update },
          A29: { roles: ['customer', 'driver'], handler: trips.cancel },
        }),
      },
    ] : []),

    // Spec 17-18 — thông báo của tôi (mục 16, 18). Cả ba role; danh sách lọc theo người trong token (N2).
    ...(notifications ? [
      {
        code: 'A33', method: 'GET', path: '/api/v1/notifications', roles: ROLES, rpc: 'cab.notification.v1.NotificationService/ListNotifications',
        select: selectBy((req) => parseNotificationsQuery(req.query), { A33: { handler: notifications.list } }),
      },
    ] : []),

    // Spec 20-29 — đánh giá chuyến (mục 20).
    ...(ratings ? [
      // A34: chỉ khách; tài xế, admin bị 403 TRƯỚC khi đọc body (mục chấm 28).
      {
        code: 'A34', method: 'POST', path: '/api/v1/ratings', roles: ['customer'], rpc: 'cab.rating.v1.RatingService/CreateRating',
        select: selectBy((req) => parseCreateRating(req.body), { A34: { handler: ratings.create } }),
      },
      // GET /ratings: `trip_id` → A35 (service kiểm khách / tài xế của chuyến, admin xem mọi chuyến);
      // `driver_id` → A36 (điểm tài xế là thông tin công khai cho mọi role đã đăng nhập).
      {
        code: 'A35|A36', method: 'GET', path: '/api/v1/ratings', roles: ROLES,
        rpc: 'cab.rating.v1.RatingService/GetRatingByTrip|GetDriverRating',
        select: selectBy((req) => parseRatingsQuery(req.query), {
          A35: { handler: ratings.byTrip },
          A36: { handler: ratings.driver },
        }),
      },
    ] : []),
  ];
}
