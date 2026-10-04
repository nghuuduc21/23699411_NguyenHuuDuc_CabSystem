// Bảng đổi gRPC status → HTTP, dùng chung cho mọi route của các spec sau (spec 00 mục 4.1, CLAUDE.md).
// Quy ước: service trả lỗi nghiệp vụ bằng gRPC status kèm `details` ĐÚNG BẰNG mã lỗi,
// ví dụ NOT_FOUND + "CUSTOMER_NOT_FOUND"; Gateway trả { "error": "CUSTOMER_NOT_FOUND" }.
import grpc from '@grpc/grpc-js';

const STATUS_TO_HTTP = new Map([
  [grpc.status.INVALID_ARGUMENT, 400],
  [grpc.status.UNAUTHENTICATED, 401],
  [grpc.status.PERMISSION_DENIED, 403],
  [grpc.status.NOT_FOUND, 404],
  [grpc.status.ALREADY_EXISTS, 409],
  // Đúng dữ liệu nhưng sai thời điểm (ví dụ hoàn thành chuyến chưa bắt đầu) là lỗi của request → 409.
  [grpc.status.FAILED_PRECONDITION, 409],
]);

// Mã lỗi hợp lệ: chữ hoa, số, gạch dưới. `details` khác dạng này (câu chữ, stack trace)
// bị coi là lỗi nội bộ để không lộ thông tin bên trong service ra ngoài.
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export const SERVICE_UNAVAILABLE = Object.freeze({ status: 503, body: Object.freeze({ error: 'SERVICE_UNAVAILABLE' }) });

export function grpcErrorToHttp(err) {
  const httpStatus = STATUS_TO_HTTP.get(err?.code);
  if (httpStatus && typeof err.details === 'string' && ERROR_CODE.test(err.details)) {
    return { status: httpStatus, body: { error: err.details } };
  }
  // Còn lại (UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL, …): service không chạy, quá hạn
  // hoặc lỗi không lường trước → 503, bỏ `details`.
  return SERVICE_UNAVAILABLE;
}
