// Hàm xử lý A30–A32 — thanh toán (spec 14-15-16-19-30 mục 4.7–4.9; mục chấm 19, 30).
// Không có logic nghiệp vụ: Gateway chỉ chuyển header vào metadata (`idempotency-key`, `x-callback-secret`) và
// đổi field `replayed` của response gRPC thành header `Idempotency-Replayed: true` (DX14). Việc nhớ và trả lại
// response lần đầu, so khóa bí mật, đổi trạng thái thanh toán là việc của payment-service (04 mục 1.4).
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { pick } from './pick.js';

const PAYMENT_KEYS = ['payment_id', 'booking_id', 'method', 'status', 'amount', 'fare', 'status_reason', 'expires_at', 'paid_at', 'refunded_at', 'transactions'];
const FARE_KEYS = ['distance_m', 'base_fare', 'per_km_rate', 'min_fare'];
const TXN_KEYS = ['txn_id', 'type', 'attempt_no', 'status', 'amount'];
const PAY_KEYS = ['payment_id', 'status', 'txn_id', 'txn_status', 'attempt_no', 'attempts_left', 'expires_at'];
const CALLBACK_KEYS = ['txn_id', 'txn_status', 'payment_id', 'status'];

const toPayment = (r) => {
  const out = pick(r, PAYMENT_KEYS);
  out.fare = pick(r.fare ?? {}, FARE_KEYS);
  out.transactions = (r.transactions ?? []).map((t) => pick(t, TXN_KEYS));
  return out;
};

export function createPaymentHandlers({ paymentClient }) {
  // `extra(req)`: metadata riêng của route. Response có `replayed: true` → thêm header, body giữ y hệt lần đầu
  // (không có field `replayed`).
  const forward = (method, build, keys, extra = () => ({})) => async (req, res) => {
    try {
      const response = await callUnary(paymentClient, method, build(req), buildMetadata(req, extra(req)));
      if (response.replayed === true) res.set('Idempotency-Replayed', 'true');
      res.status(200).json(typeof keys === 'function' ? keys(response) : pick(response, keys));
    } catch (err) {
      const { status, body } = grpcErrorToHttp(err);
      res.status(status).json(body);
    }
  };

  return {
    // A30: chủ hoặc admin; mã trong đường dẫn gửi dạng chuỗi để số lớn không bị làm tròn.
    byId: forward('GetPayment', (req) => ({ payment_id: req.params.id }), toPayment),
    // A31: 200 — response mô tả TRẠNG THÁI thanh toán (DX-Q2 đã chốt). Khóa chống lặp đã kiểm hình thức ở validate.js.
    pay: forward('PayPayment', (req) => ({ payment_id: req.params.id, ...req.rpcRequest }), PAY_KEYS,
      (req) => ({ 'idempotency-key': req.idempotencyKey })),
    // A32: không token; khóa bí mật chuyển nguyên cho payment-service so (Gateway không giữ khóa).
    callback: forward('HandleProviderCallback', (req) => req.rpcRequest, CALLBACK_KEYS,
      (req) => ({ 'x-callback-secret': req.get('x-callback-secret') ?? '' })),
  };
}
