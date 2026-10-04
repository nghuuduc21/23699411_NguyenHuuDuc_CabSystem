// Bảng route của Gateway: MỘT chỗ khai báo mọi đường dẫn (spec 00 mục 4, 04 mục 1.10).
// Mỗi dòng: mã API, method, đường dẫn, role được phép, rpc ở service, hàm kiểm tra hình thức, hàm xử lý.
//   roles:    null = công khai (không cần token); mảng = phải có token với một trong các role này.
//   rpc:      null = Gateway tự trả lời, không gọi service.
//   validate: kiểm tra hình thức body, trả mã lỗi hoặc null (không có = không có body).
//   validateParams: kiểm tra tham số đường dẫn (ví dụ `:id` phải là số nguyên dương).
// A01–A03 nằm ngoài tiền tố /api/v1 vì không phải tài nguyên nghiệp vụ.
import { ROLES } from './token.js';
import {
  validateCreateCustomer, validateIdParam, validateLogin, validateRegister, validateUpdateCustomer,
} from './validate.js';

// customers: handler hồ sơ khách (spec 11). Test chỉ thử health / auth thì không truyền → không có route này.
export function buildRoutes({ health, auth, customers }) {
  return [
    { code: 'A01', method: 'GET', path: '/health', roles: null, rpc: null, handler: health.live },
    { code: 'A02', method: 'GET', path: '/ready', roles: null, rpc: null, handler: health.ready },
    { code: 'A03', method: 'GET', path: '/health/services', roles: null, rpc: 'grpc.health.v1.Health/Check', handler: health.services },

    // Spec 09-10. Đăng ký = tạo một tài khoản → POST vào tập `accounts` (không có động từ trong đường dẫn).
    { code: 'A04', method: 'POST', path: '/api/v1/accounts', roles: null, rpc: 'cab.auth.v1.AuthService/RegisterCustomer', validate: validateRegister, handler: auth.register },
    // Hai ngoại lệ có chủ đích (04 mục 1.9): đăng nhập, đăng xuất không tạo tài nguyên nào.
    { code: 'A05', method: 'POST', path: '/api/v1/auth/login', roles: null, rpc: 'cab.auth.v1.AuthService/Login', validate: validateLogin, handler: auth.login },
    { code: 'A06', method: 'POST', path: '/api/v1/auth/logout', roles: ROLES, rpc: null, handler: auth.logout },

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
  ];
}
