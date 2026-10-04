// Chép đúng các key được liệt kê, theo đúng thứ tự, bỏ key không có giá trị.
// Vì sao: field `optional` của proto không có giá trị thì vắng hẳn → JSON không có key (spec mục 4.1);
// liệt kê rõ để không lọt field phụ của thư viện (ví dụ `_driver_id` của oneof ẩn) hay field nội bộ (`replayed`).
export function pick(object, keys) {
  const out = {};
  for (const key of keys) if (object[key] !== undefined && object[key] !== null) out[key] = object[key];
  return out;
}

const PAGINATION_KEYS = ['page', 'limit', 'total', 'total_pages'];

// Response danh sách: `data` (mỗi phần tử chỉ các key cho phép) + `pagination`.
export const toList = (itemKeys) => (response) => ({
  data: (response.data ?? []).map((item) => pick(item, itemKeys)),
  pagination: pick(response.pagination ?? {}, PAGINATION_KEYS),
});
