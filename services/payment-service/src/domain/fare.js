// Tính cước cố định (FR16, BRULE08; CLAUDE.md "Cước"; 03 mục 6.3; spec 14-15-16-19-30 mục 5.7).
//   cước = giá mở cửa + đơn giá mỗi km × quãng đường ước tính, làm tròn LÊN bội 1 000 đ, không dưới tối thiểu.
// Quãng đường ước tính (mét, số nguyên) do booking-service tính từ tọa độ và gửi sang (S4).
//
// Vì sao tính bằng số nguyên: đơn giá tính theo km còn quãng đường theo mét, nên nhân cả hai vế với 1 000
// để không có phần lẻ — số thực (0.1 + 0.2 ≠ 0.3) có thể làm 45 000 thành 45 000,000001 rồi làm tròn lên 46 000.
//   thô (đồng × 1 000) = base_fare × 1 000 + per_km_rate × distance_m
//   làm tròn lên bội 1 000 đ = ceil(thô / 1 000 000) × 1 000
// Ví dụ P0 → D0 (2 026 m), CAR_4: 20 000 000 + 12 000 × 2 026 = 44 312 000 → 45 000 đ.
export function calculateFare(rate, distanceM) {
  const raw = rate.base_fare * 1000 + rate.per_km_rate * distanceM;
  const rounded = Math.ceil(raw / 1_000_000) * 1000;
  return Math.max(rounded, rate.min_fare);
}
