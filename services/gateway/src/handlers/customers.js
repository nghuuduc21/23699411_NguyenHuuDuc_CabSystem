// Hàm xử lý A37, A38, A09, A10 — hồ sơ khách (spec 11 mục 4).
// Không có logic nghiệp vụ: chỉ đổi REST ↔ gRPC. Ai được xem mã nào (NOT_OWNER), hồ sơ có chưa,
// mã hóa họ tên… là việc của customer-service. Token, role, hình thức body, dạng mã `{id}`
// đã kiểm tra ở app.js trước khi vào đây.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';

// Message `Customer` → JSON. `dob` là field `optional` trong proto: không có thì gRPC bỏ hẳn field,
// còn API hứa trả `"dob": null` (spec 11 mục 4.2), nên điền null ở đây.
// Liệt kê đúng ba field để không lọt field phụ của thư viện (ví dụ `_dob` của oneof ẩn).
const toJson = (customer) => ({ customer_id: customer.customer_id, name: customer.name, dob: customer.dob ?? null });

export function createCustomerHandlers({ customerClient }) {
  // Gọi rpc với request do hàm `build` dựng từ req; lỗi gRPC đổi sang HTTP theo bảng chung (errors.js).
  const forward = (method, build, okStatus) => async (req, res) => {
    try {
      const response = await callUnary(customerClient, method, build(req), buildMetadata(req));
      res.status(okStatus).json(toJson(response));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };

  return {
    // A37: 201 vì tạo mới. Không gửi mã: service lấy customer_id từ metadata x-account-id.
    create: forward('CreateCustomer', ({ body }) => (body.dob === undefined ? { name: body.name } : { name: body.name, dob: body.dob }), 201),

    // A38: `me` = mã trong token. Gateway chỉ điền tham số, không quyết định gì (04 mục 2.2).
    me: forward('GetCustomer', (req) => ({ customer_id: req.identity.accountId }), 200),

    // A09: mã trong đường dẫn (đã kiểm tra là số nguyên dương). Gửi dạng chuỗi để số lớn không bị
    // làm tròn trước khi tới service; service tự so với mã trong token.
    byId: forward('GetCustomer', (req) => ({ customer_id: req.params.id }), 200),

    // A10: chỉ chép field có mặt. proto3 không phân biệt "dob vắng" với "dob = null",
    // nên `"dob": null` đổi thành cờ clear_dob (spec 11 mục 5).
    update: forward('UpdateCustomer', ({ body }) => {
      const request = {};
      if (body.name !== undefined) request.name = body.name;
      if (body.dob === null) request.clear_dob = true;
      else if (body.dob !== undefined) request.dob = body.dob;
      return request;
    }, 200),
  };
}
