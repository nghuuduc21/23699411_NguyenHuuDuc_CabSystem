// Hàm xử lý A33 — thông báo của tôi (spec 17-18 mục 4.4; mục chấm 16, 18).
// Không có logic nghiệp vụ: "của tôi" do notification-service lọc theo x-account-id trong metadata (N2).
import { buildMetadata, callUnary } from '../grpc/clients.js';
import { grpcErrorToHttp } from '../grpc/errors.js';
import { pick } from './pick.js';

const ITEM_KEYS = ['type', 'title', 'body', 'created_at'];
const DATA_KEYS = ['booking_id', 'trip_id', 'payment_id', 'offer_id', 'driver_id', 'amount', 'status'];
const PAGINATION_KEYS = ['page', 'limit', 'total', 'total_pages'];

// Giữ thứ tự key như spec (type, title, body, data, created_at); `data` chỉ các key có giá trị.
const toItem = (n) => {
  const { created_at: createdAt, ...rest } = pick(n, ITEM_KEYS);
  return { ...rest, data: pick(n.data ?? {}, DATA_KEYS), created_at: createdAt };
};

export function createNotificationHandlers({ notificationClient }) {
  return {
    async list(req, res) {
      try {
        const r = await callUnary(notificationClient, 'ListNotifications', req.rpcRequest, buildMetadata(req));
        res.status(200).json({ data: (r.data ?? []).map(toItem), pagination: pick(r.pagination ?? {}, PAGINATION_KEYS) });
      } catch (err) {
        const { status, body } = grpcErrorToHttp(err);
        res.status(status).json(body);
      }
    },
  };
}
