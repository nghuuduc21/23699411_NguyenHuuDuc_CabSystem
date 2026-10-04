// Bảng route của Gateway: MỘT chỗ khai báo mọi đường dẫn (spec 00 mục 4, 04 mục 1.10).
// Mỗi dòng: mã API, method, đường dẫn, role được phép, rpc ở service, hàm kiểm tra hình thức, hàm xử lý.
//   roles:    null = công khai (không cần token); mảng = phải có token với một trong các role này.
//   rpc:      null = Gateway tự trả lời, không gọi service.
//   validate: kiểm tra hình thức body, trả mã lỗi hoặc null (không có = không có body).
//   validateParams: kiểm tra tham số đường dẫn (ví dụ `:id` phải là số nguyên dương).
//   select:   (chỉ đường dẫn có nhiều mã API — 04 mục 1.10) tra bảng theo body / query, trả
//             { error } hoặc { roles, handler } của biến thể; message gRPC dựng sẵn ở req.rpcRequest.
// A01–A03 nằm ngoài tiền tố /api/v1 vì không phải tài nguyên nghiệp vụ.
import { ROLES } from './token.js';
import {
  parseBookingsQuery, parseCallbackBody, parseCreateBooking, parseDriverMeBody, parseDriversQuery, parseOfferBody,
  parseOffersQuery, parsePayRequest, parseReviewBody, validateCreateCustomer, validateIdParam, validateLogin,
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
// bookings, payments: đặt xe, lời mời, thanh toán (spec 14-15-16-19-30).
// Test chỉ thử health / auth thì không truyền → không có các route này.
export function buildRoutes({ health, auth, customers, drivers, bookings, payments }) {
  return [
    { code: 'A01', method: 'GET', path: '/health', roles: null, rpc: null, handler: health.live },
    { code: 'A02', method: 'GET', path: '/ready', roles: null, rpc: null, handler: health.ready },
    { code: 'A03', method: 'GET', path: '/health/services', roles: null, rpc: 'grpc.health.v1.Health/Check', handler: health.services },

    // Spec 09-10. Đăng ký = tạo một tài khoản → POST vào tập `accounts` (không có động từ trong đường dẫn).
    { code: 'A04', method: 'POST', path: '/api/v1/accounts', roles: null, rpc: 'cab.auth.v1.AuthService/RegisterCustomer', validate: validateRegister, handler: auth.register },
    // Hai ngoại lệ có chủ đích (04 mục 1.9): đăng nhập, đăng xuất không tạo tài nguyên nào.
    { code: 'A05', method: 'POST', path: '/api/v1/auth/login', roles: null, rpc: 'cab.auth.v1.AuthService/Login', validate: validateLogin, handler: auth.login },
    { code: 'A06', method: 'POST', path: '/api/v1/auth/logout', roles: ROLES, rpc: null, handler: auth.logout },
    // Spec 12-13-21-23. Mã OTP là một tài nguyên được tạo → POST /otps (04 R7). Đăng ký tài xế tạo một
    // tài khoản tài xế → POST /driver-accounts. Cả hai công khai: người đăng ký chưa có token.
    { code: 'A07', method: 'POST', path: '/api/v1/otps', roles: null, rpc: 'cab.auth.v1.AuthService/RequestDriverOtp', validate: validateRequestOtp, handler: auth.requestOtp },
    { code: 'A08', method: 'POST', path: '/api/v1/driver-accounts', roles: null, rpc: 'cab.auth.v1.AuthService/RegisterDriver', validate: validateRegisterDriver, handler: auth.registerDriver },

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
      // A14: cả ba role; service quyết định phần công khai hay đầy đủ.
      { code: 'A14', method: 'GET', path: '/api/v1/drivers/:id', roles: ROLES, rpc: 'cab.driver.v1.DriverService/GetDriver', validateParams: validateIdParam, handler: drivers.byId },
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
      // A19: đặt xe = POST vào tập `bookings`; khách đặt được nhiều booking.
      {
        code: 'A19', method: 'POST', path: '/api/v1/bookings', roles: ['customer'], rpc: 'cab.booking.v1.BookingService/CreateBooking',
        select: selectBy((req) => parseCreateBooking(req.body), { A19: { handler: bookings.create } }),
      },
      // A20: chỉ booking của khách trong token (B14) — admin, tài xế bị 403.
      {
        code: 'A20', method: 'GET', path: '/api/v1/bookings', roles: ['customer'], rpc: 'cab.booking.v1.BookingService/ListBookings',
        select: selectBy((req) => parseBookingsQuery(req.query), { A20: { handler: bookings.list } }),
      },
      // A21: chủ (service kiểm) hoặc admin.
      { code: 'A21', method: 'GET', path: '/api/v1/bookings/:id', roles: ['customer', 'admin'], rpc: 'cab.booking.v1.BookingService/GetBooking', validateParams: validateIdParam, handler: bookings.byId },
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
        code: 'A32', method: 'POST', path: '/api/v1/payment-callbacks', roles: null, rpc: 'cab.payment.v1.PaymentService/HandleProviderCallback',
        select: selectBy((req) => parseCallbackBody(req.body), { A32: { handler: payments.callback } }),
      },
    ] : []),
  ];
}
