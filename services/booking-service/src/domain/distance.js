// Quãng đường ước tính của một booking (FR16; CLAUDE.md "Cước"; 03 mục 6.3; spec 14-15-16-19-30 mục 5.6).
//   quãng đường ước tính = khoảng cách đường thẳng (Haversine) × 1,3, làm tròn đến mét.
// Không gọi dịch vụ bản đồ (ADR-014: giả lập đơn giản nhất) — công thức trên tọa độ là đủ để tính cước cố định.
// Hệ số 1,3 bù cho việc đường thật không thẳng; là hằng số trong code (không còn biến môi trường).
// Kết quả là SỐ NGUYÊN mét để Payment tính cước hoàn toàn bằng số nguyên.

const EARTH_RADIUS_M = 6_371_000; // cùng bán kính với driver-service (03 mục 5.4)
export const ROUTE_FACTOR = 1.3;

// Haversine: khoảng cách trên mặt cầu giữa hai tọa độ (mét).
// Math.min(1, …): sai số làm tròn có thể đẩy giá trị lên hơi quá 1, asin(>1) ra NaN.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// P0 (10.82, 106.68) → D0 (10.83, 106.69): ≈ 1 559 m → 2 026 m.
export function estimateDistanceM(from, to) {
  return Math.round(haversineMeters(from[0], from[1], to[0], to[1]) * ROUTE_FACTOR);
}
