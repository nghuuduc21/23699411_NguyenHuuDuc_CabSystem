// Adapter cổng thanh toán GIẢ LẬP (ADR-014; spec 14-15-16-19-30 mục 5.7). NFR13: logic thanh toán chỉ nói
// chuyện với adapter này; thay bằng cổng thật thì chỉ thay file này, không sửa logic.
//
// Giả lập đơn giản nhất (giảng viên 2026-10-03): nhận yêu cầu thu tiền rồi GỌI NGAY phần xử lý callback
// (giống cổng thật gọi lại sau vài giây, nhưng không phải chờ), mặc định thành công.
//   simulate_result chỉ có hiệu lực khi SIMULATION_MODE=true:
//     SUCCESS (mặc định) → callback thành công ngay
//     FAILED             → callback thất bại ngay (demo thanh toán lỗi, hết lượt)
//     MANUAL             → KHÔNG gọi callback: giao dịch đứng PENDING, người demo tự gửi callback A32 từ Postman
//                          để người chấm thấy rõ bước "hệ thống nhận callback" → COMPLETED (mục chấm 19, Q57)
//   SIMULATION_MODE=false → bỏ qua simulate_result, coi như SUCCESS (chưa có cổng thật).

export function createSimulatedProvider({ simulationMode }) {
  return {
    // Mã giao dịch theo quy luật dễ nhớ (03 mục 8.4): SIM-<payment_id>-<lần thử>, ví dụ SIM-7-1.
    chargeId: (paymentId, attemptNo) => `SIM-${paymentId}-${attemptNo}`,
    // Mã giao dịch hoàn: SIM-R-<payment_id> — mỗi thanh toán hoàn nhiều nhất một lần (M8).
    refundId: (paymentId) => `SIM-R-${paymentId}`,

    // Gửi yêu cầu thu tiền. `onCallback(result)` = hàm xử lý callback của payment-service — CÙNG hàm mà
    // A32 dùng khi callback đến từ ngoài (applyProviderResult), nên hai đường cho kết quả giống hệt nhau.
    // Trả kết quả của onCallback, hoặc null khi MANUAL (chưa có kết quả, chờ A32).
    async charge({ simulateResult, onCallback }) {
      const mode = simulationMode ? (simulateResult ?? 'SUCCESS') : 'SUCCESS';
      if (mode === 'MANUAL') return null;
      return onCallback(mode);
    },

    // Hoàn tiền giả lập: thành công ngay (cổng thật sẽ là một lời gọi ra ngoài).
    refundResult: () => 'SUCCEEDED',
  };
}
