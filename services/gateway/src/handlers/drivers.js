// Hàm xử lý A11–A18, A39 — tài xế (spec 12-13-21-23 mục 4).
// Không có logic nghiệp vụ: chỉ đổi REST ↔ gRPC. Ai xem được field nào, khi nào được bật Online,
// hồ sơ đã xét chưa… là việc của driver-service. Token, role, hình thức, chọn biến thể đã làm ở
// app.js / validate.js; message gRPC đã dựng sẵn ở `req.rpcRequest`.
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { buildSubmitRequest } from '../validate.js';

// Chép đúng các key được liệt kê, theo đúng thứ tự, bỏ key không có giá trị.
// Vì sao: field `optional` của proto không có giá trị thì vắng hẳn → JSON không có key (spec mục 4.1),
// ví dụ phần công khai của A14 không có `license`. Liệt kê rõ để không lọt field phụ của thư viện
// (ví dụ `_license` của oneof ẩn).
function pick(object, keys) {
  const out = {};
  for (const key of keys) if (object[key] !== undefined && object[key] !== null) out[key] = object[key];
  return out;
}

const DRIVER_KEYS = ['driver_id', 'name', 'vehicle', 'plate', 'status', 'approval_status', 'license', 'lat', 'lng', 'brand', 'model', 'color', 'reason', 'created_at'];
const NEARBY_KEYS = ['driver_id', 'name', 'vehicle', 'plate', 'distance_m'];
const PAGINATION_KEYS = ['page', 'limit', 'total', 'total_pages'];

const toDriver = (driver) => pick(driver, DRIVER_KEYS);
const toList = (itemKeys) => (response) => ({
  data: (response.data ?? []).map((item) => pick(item, itemKeys)),
  pagination: pick(response.pagination ?? {}, PAGINATION_KEYS),
});

export function createDriverHandlers({ driverClient }) {
  // Gọi rpc với request do `build` dựng; đổi response bằng `toJson`; lỗi gRPC → HTTP theo bảng chung.
  const forward = (method, build, toJson, okStatus = 200) => async (req, res) => {
    try {
      const response = await callUnary(driverClient, method, build(req), buildMetadata(req));
      res.status(okStatus).json(toJson(response));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };
  const prepared = (req) => req.rpcRequest; // request đã dựng ở bước chọn biến thể

  return {
    // A11: lần đầu 201 (tạo mới); nộp lại hồ sơ bị từ chối (FR43) 200 kèm `"resubmitted": true` (TX12).
    // Gateway CHỈ ĐỌC cờ `resubmitted` do driver-service đặt để chọn mã HTTP, không tự quyết nhánh nghiệp vụ.
    // Không gửi mã: service lấy driver_id từ metadata x-account-id.
    async submit(req, res) {
      try {
        const response = await callUnary(driverClient, 'SubmitApplication', buildSubmitRequest(req.body), buildMetadata(req));
        const resubmitted = response.resubmitted === true;
        res.status(resubmitted ? 200 : 201).json(resubmitted ? { ...toDriver(response), resubmitted: true } : toDriver(response));
      } catch (err) {
        const { status, body } = grpcErrorToHttp(err);
        res.status(status).json(body);
      }
    },

    // A14: mã trong đường dẫn gửi dạng chuỗi để số lớn không bị làm tròn trước khi tới service.
    byId: forward('GetDriver', (req) => ({ driver_id: req.params.id }), toDriver),

    // A12 / A13: hai biến thể của GET /api/v1/drivers.
    nearby: forward('FindNearbyDrivers', prepared, toList(NEARBY_KEYS)),
    list: forward('ListDrivers', prepared, toList(DRIVER_KEYS)),

    // A15 / A16: mã từ đường dẫn + phần body đã kiểm tra.
    approve: forward('ApproveDriver', (req) => ({ driver_id: req.params.id }), (r) => pick(r, ['driver_id', 'approval_status'])),
    reject: forward('RejectDriver', (req) => ({ driver_id: req.params.id, ...req.rpcRequest }), (r) => pick(r, ['driver_id', 'approval_status', 'reason'])),

    // A17 / A39 / A18: `me` — mã lấy từ token ở service, không gửi trong message.
    availability: forward('SetAvailability', prepared, (r) => pick(r, ['driver_id', 'status', 'lat', 'lng'])),
    location: forward('UpdateLocation', prepared, (r) => pick(r, ['driver_id', 'lat', 'lng'])),
  };
}
