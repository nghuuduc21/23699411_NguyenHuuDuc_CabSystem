// Bảng route của Gateway: MỘT chỗ khai báo mọi đường dẫn (spec 00 mục 4, 04 mục 1.10).
// Mỗi dòng: mã API, method, đường dẫn, role được phép, rpc ở service, hàm xử lý.
//   roles: null = công khai (không cần token).
//   rpc:   null = Gateway tự trả lời, không gọi service.
// Spec 00 chỉ đăng ký A01–A03 (ngoài tiền tố /api/v1 vì không phải tài nguyên nghiệp vụ).
// Các spec sau thêm route nghiệp vụ dưới /api/v1/… vào bảng này.

export function buildRoutes({ health }) {
  return [
    { code: 'A01', method: 'GET', path: '/health', roles: null, rpc: null, handler: health.live },
    { code: 'A02', method: 'GET', path: '/ready', roles: null, rpc: null, handler: health.ready },
    { code: 'A03', method: 'GET', path: '/health/services', roles: null, rpc: 'grpc.health.v1.Health/Check', handler: health.services },
  ];
}
