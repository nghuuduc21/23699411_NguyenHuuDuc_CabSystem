// Logic nghiệp vụ của Fare & Payment (spec 14-15-16-19-30 mục 2.5, 4.7–4.9, 5.2, 5.7):
// tính cước và tạo thanh toán (S4), xem thanh toán (A30), thanh toán trả trước có chống lặp (A31),
// nhận callback của cổng thanh toán (A32), hết hạn thanh toán (tiến trình nền);
// nghe K3 / K4 / K5 để hủy bỏ, hoàn tiền, ghi nhận tiền mặt (spec 17-18 mục 2.5; FR17, FR40, BRULE14, BRULE15).
// Mọi phụ thuộc (kho dữ liệu, adapter cổng thanh toán, bộ phát event, log, cấu hình) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL, Kafka hay gRPC.
//
// `payments.transaction(fn)` mở MỘT giao dịch database và đưa `tx` cho fn; fn ném lỗi → ROLLBACK cả giao dịch.
// Event Kafka chỉ phát SAU KHI commit (ADR-017): logic gom event vào mảng rồi phát khi giao dịch đã xong.
import { calculateFare } from './fare.js';
import {
  CALLBACK_RESULTS, checkId, checkIdempotencyKey, conflict, invalid, iso, isPresent, MAX_ATTEMPTS, METHODS,
  normalizeEnum, PaymentError, requestHash, requireRole, requireSystem, secretMatches, SIMULATE_RESULTS,
} from './rules.js';

export const TOPIC_PAYMENT_STATUS_CHANGED = 'payment.status-changed'; // K6
// Topic payment NGHE (spec 17-18 mục 5.4). Vì sao Kafka: hủy chuyến / hủy booking phải thành công dù Payment đang dừng
// (NFR05); Payment chạy lại thì đọc bù và hoàn tiền. Không bên nào gọi gRPC sang Payment để hoàn tiền.
export const TOPIC_NO_DRIVER_FOUND = 'booking.no-driver-found'; // K3
export const TOPIC_BOOKING_CANCELED = 'booking.canceled'; // K4
export const TOPIC_TRIP_STATUS_CHANGED = 'trip.status-changed'; // K5

const notFound = () => new PaymentError('NOT_FOUND', 'PAYMENT_NOT_FOUND');
const notOwner = () => new PaymentError('PERMISSION_DENIED', 'NOT_OWNER');

// Dữ liệu K6 (spec mục 6): chỉ mã, số tiền, trạng thái — không thông tin cá nhân. `reason` chỉ khi CANCELED.
function statusEvent(payment, status, previousStatus, reason) {
  const data = {
    payment_id: payment.payment_id,
    booking_id: payment.booking_id,
    customer_id: payment.customer_id,
    method: payment.method,
    amount: payment.amount,
    status,
    previous_status: previousStatus,
  };
  if (status === 'CANCELED') data.reason = reason;
  return data;
}

export function createPaymentLogic({ payments, provider, events, log, config }) {
  const { paymentTimeoutSeconds, callbackSecret } = config;

  // Phát K6 sau commit. Lỗi gửi KHÔNG hoàn tác: tiền đã thu thì Payment phải ghi nhận xong dù Kafka lỗi
  // (NFR14, ADR-017); chỉ ghi log để xử lý tay. Key = booking_id để mọi event của một booking vào cùng
  // partition, Booking nhận đúng thứ tự (FAILED rồi CANCELED).
  async function publishAll(list) {
    for (const data of list) {
      try {
        await events.publish(TOPIC_PAYMENT_STATUS_CHANGED, String(data.booking_id), data);
      } catch (err) {
        log.error('EVENT_PUBLISH_FAILED', { topic: TOPIC_PAYMENT_STATUS_CHANGED, key: String(data.booking_id), reason: err?.name ?? 'Error' });
      }
    }
  }

  // MỘT chỗ hoàn tiền (CD5) cho mọi đường: callback muộn sau khi đã hủy (M11), không tìm được tài xế (K3), khách hủy
  // booking đã trả (K4), chuyến bị hủy (K5). Gọi bên trong giao dịch đã khóa thanh toán. Cổng giả lập hoàn thành công
  // ngay (ADR-014). UNIQUE (payment_id) WHERE type = 'REFUND' ở database chặn hoàn lần hai (M8) kể cả khi code có lỗi.
  //   reason: lý do mới (NO_DRIVER_FOUND, BOOKING_CANCELED, TRIP_CANCELED); null = giữ lý do cũ (M11).
  //   markPaid: true khi tiền vừa vào lúc này (M11) — các đường khác đã có paid_at từ lúc COMPLETED.
  // Trả dữ liệu K6 REFUNDED để bên gọi phát SAU KHI commit.
  async function refundNow(tx, payment, { reason = null, markPaid = false } = {}) {
    const refundTxnId = provider.refundId(payment.payment_id);
    const refundStatus = provider.refundResult();
    await tx.insertRefund({
      paymentId: payment.payment_id, txnId: refundTxnId, amount: payment.amount, status: refundStatus,
      callbackResponse: { txn_id: refundTxnId, txn_status: refundStatus, payment_id: payment.payment_id, status: 'REFUNDED' },
    });
    await tx.updatePayment(payment.payment_id, { status: 'REFUNDED', reason, paid: markPaid, refunded: true });
    log.info('payment_refunded', { payment_id: payment.payment_id, reason: reason ?? payment.status_reason });
    return statusEvent(payment, 'REFUNDED', payment.status);
  }

  // Đọc một event K3 / K4 / K5 thành việc cần làm với tiền của booking (bảng spec 17-18 mục 2.5):
  //   { action: 'settle', reason } — chuyến KHÔNG được thực hiện: chưa thu → hủy bỏ; đã thu → hoàn đủ (BRULE14)
  //   { action: 'cash' }           — chuyến hoàn thành: tiền mặt thì ghi nhận đã thu (FR17)
  //   null                         — không liên quan tiền (bỏ qua)
  // Tài xế TỪ CHỐI lời mời không có event nào → Payment không biết → không thể hoàn nhầm (BRULE15).
  function eventAction(topic, data) {
    if (topic === TOPIC_NO_DRIVER_FOUND) return { action: 'settle', reason: 'NO_DRIVER_FOUND' };
    // Hệ thống hủy (quá hạn / hết lượt) thì chính Payment đã CANCELED trước đó → bỏ qua (02 K4).
    if (topic === TOPIC_BOOKING_CANCELED) return data.canceled_by === 'customer' ? { action: 'settle', reason: 'BOOKING_CANCELED' } : null;
    if (topic === TOPIC_TRIP_STATUS_CHANGED) {
      if (data.status === 'CANCELED') return { action: 'settle', reason: 'TRIP_CANCELED' };
      if (data.status === 'COMPLETED') return { action: 'cash' };
    }
    return null;
  }

  // MỘT hàm xử lý kết quả từ cổng thanh toán, dùng cho cả adapter giả lập (A31) và callback từ ngoài (A32).
  // Gọi bên trong giao dịch, khi đã khóa giao dịch (txn) và thanh toán (payment). Trả kết quả và event cần
  // phát — bên gọi phát SAU KHI commit.
  async function applyProviderResult(tx, txn, payment, result) {
    const previous = payment.status;
    let paymentStatus = previous;
    let txnStatus;
    const out = [];

    if (result === 'SUCCESS') {
      txnStatus = 'SUCCEEDED';
      if (previous === 'PENDING') {
        // Trả trước thành công → COMPLETED → K6 → Booking bắt đầu tìm tài xế (BRULE13).
        paymentStatus = 'COMPLETED';
        await tx.updatePayment(payment.payment_id, { status: 'COMPLETED', paid: true });
        out.push(statusEvent(payment, 'COMPLETED', previous));
      } else if (previous === 'CANCELED') {
        // M11: tiền bị trừ SAU KHI thanh toán đã hủy (quá hạn / khách hủy booking) → ghi nhận rồi HOÀN NGAY: tiền đã
        // trừ phải trả lại. Giữ status_reason (vì sao đã hủy); thêm paid_at (lúc tiền vào) và refunded_at (FR20).
        paymentStatus = 'REFUNDED';
        out.push(await refundNow(tx, payment, { markPaid: true }));
      }
    } else {
      txnStatus = 'FAILED'; // lần thất bại vẫn được lưu (BRULE10)
      if (previous === 'PENDING') {
        if (txn.attempt_no >= MAX_ATTEMPTS) {
          // Lần thử cuối thất bại → hủy thanh toán; chỉ MỘT K6 CANCELED, không kèm FAILED (DX10).
          paymentStatus = 'CANCELED';
          await tx.updatePayment(payment.payment_id, { status: 'CANCELED', reason: 'ATTEMPTS_EXHAUSTED' });
          out.push(statusEvent(payment, 'CANCELED', previous, 'ATTEMPTS_EXHAUSTED'));
        } else {
          // Còn lượt: Booking vẫn chờ (B16), khách thử lại bằng khóa mới (FR19).
          paymentStatus = 'FAILED';
          await tx.updatePayment(payment.payment_id, { status: 'FAILED' });
          out.push(statusEvent(payment, 'FAILED', previous));
        }
      }
      // Thanh toán đã CANCELED (quá hạn) mà cổng báo thất bại: chỉ ghi giao dịch, không event.
    }

    // Lưu response của callback cùng lúc với kết quả: callback gửi lại sẽ nhận đúng nội dung này (mục chấm 30).
    const callbackResponse = { txn_id: txn.provider_transaction_id, txn_status: txnStatus, payment_id: payment.payment_id, status: paymentStatus };
    await tx.finishTransaction(txn.transaction_id, txnStatus, callbackResponse);
    return { txnStatus, paymentStatus, callbackResponse, events: out };
  }

  return {
    applyProviderResult,

    // Nghe K3, K4, K5 (spec 17-18 mục 2.5, 5.4). Một giao dịch: khóa thanh toán của booking → làm theo bảng → commit →
    // phát K6 nếu có. Chống lặp bằng CHÍNH trạng thái (03 mục 11.3): event lặp gặp thanh toán đã CANCELED / REFUNDED /
    // COMPLETED thì không còn nhánh nào khớp → không làm gì. Lỗi database → ném để Kafka giao lại (không mất hoàn tiền).
    async onBookingEvent(topic, envelope) {
      const data = envelope?.data;
      if (!data || !Number.isSafeInteger(data.booking_id)) {
        log.warn('bỏ qua event sai dạng', { topic, event_id: envelope?.event_id });
        return null;
      }
      const todo = eventAction(topic, data);
      if (!todo) return null;

      const outcome = await payments.transaction(async (tx) => {
        const payment = await tx.lockPaymentByBooking(data.booking_id);
        if (!payment) return { result: 'NO_PAYMENT', events: [] };
        if (todo.action === 'cash') {
          // FR17: tài xế đã thu tiền mặt khi chuyến xong → ghi nhận COMPLETED. ONLINE đã COMPLETED từ trước → giữ
          // nguyên, KHÔNG hoàn (chuyến đã thực hiện — BRULE15).
          if (payment.method !== 'CASH' || payment.status !== 'PENDING') return { result: null, events: [] };
          await tx.updatePayment(payment.payment_id, { status: 'COMPLETED', paid: true });
          log.info('cash_recorded', { payment_id: payment.payment_id });
          return { result: 'COMPLETED', events: [statusEvent(payment, 'COMPLETED', payment.status)] };
        }
        if (payment.status === 'PENDING' || payment.status === 'FAILED') {
          // Chưa thu được đồng nào → chỉ hủy bỏ, không K6: Booking / Trip đã là bên báo tin (CD4, 02 mục 6.2).
          await tx.updatePayment(payment.payment_id, { status: 'CANCELED', reason: todo.reason });
          log.info('payment_canceled', { payment_id: payment.payment_id, reason: todo.reason });
          return { result: 'CANCELED', events: [] };
        }
        if (payment.status === 'COMPLETED') {
          // Đã thu mà chuyến không được thực hiện → hoàn đủ (BRULE14).
          return { result: 'REFUNDED', events: [await refundNow(tx, payment, { reason: todo.reason })] };
        }
        return { result: null, events: [] }; // đã CANCELED / REFUNDED: event lặp
      });

      if (outcome.result === 'NO_PAYMENT') {
        log.warn('không có thanh toán cho booking', { topic, booking_id: data.booking_id });
        return null;
      }
      await publishAll(outcome.events);
      return outcome.result;
    },

    // S4 CreatePayment: booking gọi khi khách đặt xe (B15). Tính cước cố định MỘT lần, tạo Payment PENDING.
    // Không phát event: chưa có gì xảy ra với tiền.
    async createPayment(req, identity) {
      requireSystem(identity);
      const bookingId = checkId(req.booking_id, 'INVALID_INPUT');
      const customerId = checkId(req.customer_id, 'INVALID_INPUT');
      const vehicleType = typeof req.vehicle_type === 'string' ? req.vehicle_type.trim().toUpperCase() : '';
      if (vehicleType === '') throw invalid();
      if (!Number.isInteger(req.distance_m) || req.distance_m <= 0) throw invalid();
      if (!METHODS.includes(req.method)) throw invalid();

      const view = (p) => {
        const out = { payment_id: p.payment_id, amount: p.amount, status: p.status };
        if (p.expires_at) out.expires_at = iso(p.expires_at);
        return out;
      };

      let created;
      try {
        created = await payments.transaction(async (tx) => {
          // M1: đã có Payment cho booking này (booking gọi lặp sau khi quá hạn) → trả Payment cũ.
          const existing = await tx.findPaymentByBooking(bookingId);
          if (existing) return { payment: existing, isNew: false };
          const rate = await tx.findRate(vehicleType);
          if (!rate) throw invalid(); // loại xe không có giá → 400 INVALID_INPUT (qua Booking)
          const total = calculateFare(rate, req.distance_m);
          const fareId = await tx.insertFare({ bookingId, vehicleType, distanceM: req.distance_m, rate, total });
          const payment = await tx.insertPayment({
            bookingId, fareId, customerId, method: req.method, amount: total,
            // Hạn thanh toán chỉ cho ONLINE (BRULE17); tiền mặt trả khi chuyến xong.
            timeoutSeconds: req.method === 'ONLINE' ? paymentTimeoutSeconds : null,
          });
          return { payment, isNew: true };
        });
      } catch (err) {
        // Hai lời gọi cùng booking đến cùng lúc: lời gọi sau vấp UNIQUE (booking_id) → đọc lại Payment đã có.
        if (err?.code !== '23505') throw err;
        const existing = await payments.findPaymentByBooking(bookingId);
        if (!existing) throw err;
        created = { payment: existing, isNew: false };
      }
      if (created.isNew) {
        log.info('payment_created', { payment_id: created.payment.payment_id, booking_id: bookingId, method: req.method, amount: created.payment.amount });
      }
      return view(created.payment);
    },

    // A30: chủ (khách) hoặc admin. Có từng thành phần cước để giải thích con số cuối (AC26) và mọi giao dịch.
    async getPayment({ payment_id: paymentId }, identity) {
      const { accountId, role } = requireRole(identity, ['customer', 'admin']);
      checkId(paymentId);
      const p = await payments.findPaymentView(paymentId);
      if (!p) throw notFound();
      if (role === 'customer' && p.customer_id !== accountId) throw notOwner();
      const out = {
        payment_id: p.payment_id,
        booking_id: p.booking_id,
        method: p.method,
        status: p.status,
        amount: p.amount,
        fare: { distance_m: p.distance_m, base_fare: p.base_fare, per_km_rate: p.per_km_rate, min_fare: p.min_fare },
        transactions: p.transactions.map((t) => {
          const txn = { txn_id: t.provider_transaction_id, type: t.type, status: t.status, amount: t.amount };
          if (t.attempt_no !== null) txn.attempt_no = t.attempt_no;
          return txn;
        }),
      };
      // Field không có giá trị thì không có key (proto `optional`).
      if (p.status_reason) out.status_reason = p.status_reason;
      if (p.expires_at) out.expires_at = iso(p.expires_at);
      if (p.paid_at) out.paid_at = iso(p.paid_at);
      if (p.refunded_at) out.refunded_at = iso(p.refunded_at);
      return out;
    },

    // A31: khách thanh toán trả trước (UC14). Một giao dịch database theo đúng thứ tự spec mục 4.8.
    // `context.idempotencyKey` = header Idempotency-Key do Gateway chép vào metadata.
    async payPayment({ payment_id: paymentId, simulate_result: simulateRaw }, context) {
      // Bước 1: danh tính, khóa chống lặp, hình thức.
      const { accountId } = requireRole(context, ['customer']);
      const key = checkIdempotencyKey(context.idempotencyKey);
      checkId(paymentId);
      const simulateResult = normalizeEnum(simulateRaw, SIMULATE_RESULTS);
      const hash = requestHash(simulateResult);

      const outcome = await payments.transaction(async (tx) => {
        // Bước 2: khóa dòng thanh toán (FOR UPDATE) — hai request cùng thanh toán xếp hàng, không chen nhau.
        // Kiểm chủ TRƯỚC khi tra khóa (DX8): người khác không đọc được response đã lưu bằng cách đoán khóa.
        const payment = await tx.lockPayment(paymentId);
        if (!payment) throw notFound();
        if (payment.customer_id !== accountId) throw notOwner();

        // Bước 3: tra khóa chống lặp TRƯỚC mọi kiểm tra trạng thái (04 mục 1.4): gặp lại khóa thì trả response
        // lần đầu dù thanh toán đã đổi (mục chấm 30).
        const saved = await tx.findIdempotencyKey(paymentId, key);
        if (saved) {
          if (saved.request_hash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED');
          if (saved.response === null) throw conflict('PAYMENT_IN_PROGRESS');
          return { response: saved.response, replayed: true, events: [] };
        }

        // Bước 4: trạng thái, theo đúng thứ tự.
        if (payment.method !== 'ONLINE') throw conflict('PAYMENT_NOT_ONLINE');
        if (payment.status === 'COMPLETED' || payment.status === 'REFUNDED') throw conflict('PAYMENT_ALREADY_COMPLETED');
        if (payment.status === 'CANCELED') {
          if (payment.status_reason === 'PAYMENT_EXPIRED') throw conflict('PAYMENT_EXPIRED');
          if (payment.status_reason === 'ATTEMPTS_EXHAUSTED') throw conflict('PAYMENT_ATTEMPTS_EXHAUSTED');
          throw conflict('PAYMENT_CANCELED'); // hủy vì booking / không có tài xế / chuyến (DX11)
        }
        // Quá hạn mà tiến trình nền chưa kịp chạy: vẫn từ chối (so bằng giờ của database).
        if (payment.expired) throw conflict('PAYMENT_EXPIRED');
        const charges = await tx.chargeSummary(paymentId);
        if (charges.pending) throw conflict('PAYMENT_IN_PROGRESS'); // lần MANUAL trước chưa có callback

        // Bước 5: ghi khóa (response NULL = đang xử lý), tạo lần thử mới.
        const attemptNo = charges.count + 1;
        const txnId = provider.chargeId(paymentId, attemptNo);
        try {
          await tx.insertIdempotencyKey(paymentId, key, hash);
        } catch (err) {
          if (err?.code === '23505') throw conflict('PAYMENT_IN_PROGRESS'); // request song song cùng khóa
          throw err;
        }
        const txn = await tx.insertCharge({ paymentId, attemptNo, txnId, amount: payment.amount });
        if (payment.status === 'FAILED') {
          // Thử lại sau lần thất bại: thanh toán quay về chờ kết quả.
          await tx.updatePayment(paymentId, { status: 'PENDING' });
          payment.status = 'PENDING';
        }
        // Không ghi Idempotency-Key vào log (spec mục 5.7).
        log.info('payment_attempt', { payment_id: paymentId, attempt_no: attemptNo, simulate_result: simulateResult ?? 'SUCCESS' });

        // Bước 6: gửi yêu cầu thu tới cổng (giả lập). Mặc định cổng "gọi lại" ngay → applyProviderResult.
        const result = await provider.charge({
          simulateResult,
          onCallback: (providerResult) => applyProviderResult(tx, txn, payment, providerResult),
        });

        // Bước 7: dựng response, lưu vào khóa (cùng giao dịch) rồi commit.
        const response = {
          payment_id: paymentId,
          status: result ? result.paymentStatus : 'PENDING',
          txn_id: txnId,
          txn_status: result ? result.txnStatus : 'PENDING',
          attempt_no: attemptNo,
          attempts_left: MAX_ATTEMPTS - attemptNo, // số lần còn lại nếu lần này thất bại
          expires_at: iso(payment.expires_at),
        };
        await tx.saveIdempotencyResponse(paymentId, key, response);
        return { response, replayed: false, events: result ? result.events : [] };
      });
      // Lỗi ở bất kỳ bước nào → ROLLBACK cả khóa: chỉ response THÀNH CÔNG được lưu (DX9).

      await publishAll(outcome.events);
      return { ...outcome.response, replayed: outcome.replayed };
    },

    // A32: cổng thanh toán báo kết quả. Không có token; xác thực bằng khóa bí mật cố định (ADR-014).
    async handleProviderCallback({ txn_id: txnId, result: resultRaw, amount }, context) {
      // Bước 1: khóa bí mật.
      if (!secretMatches(context.callbackSecret, callbackSecret)) throw new PaymentError('UNAUTHENTICATED', 'INVALID_CALLBACK_SECRET');
      if (typeof txnId !== 'string' || txnId.trim() === '' || txnId.length > 100) throw invalid();
      const result = normalizeEnum(resultRaw, CALLBACK_RESULTS) ?? 'SUCCESS';
      if (isPresent(amount) && (!Number.isInteger(amount) || amount <= 0)) throw invalid();

      const outcome = await payments.transaction(async (tx) => {
        // Bước 2: khóa giao dịch theo mã của cổng — hai callback trùng nhau xếp hàng, cái sau thấy kết quả của cái trước.
        const txn = await tx.lockTransaction(txnId.trim());
        if (!txn) throw new PaymentError('NOT_FOUND', 'TRANSACTION_NOT_FOUND');
        // Bước 3: số tiền lệch → từ chối (DX15).
        if (isPresent(amount) && amount !== txn.amount) throw invalid();
        // Bước 4: đã có kết quả → trả response đã lưu, KHÔNG đổi gì, KHÔNG phát lại K6 (mục chấm 30).
        if (txn.status !== 'PENDING') return { response: txn.callback_response, replayed: true, events: [] };
        // Bước 5: khóa thanh toán rồi áp kết quả bằng CÙNG hàm với adapter.
        const payment = await tx.lockPayment(txn.payment_id);
        const applied = await applyProviderResult(tx, txn, payment, result);
        return { response: applied.callbackResponse, replayed: false, events: applied.events };
      });

      log.info('payment_callback', { txn_id: outcome.response.txn_id, txn_status: outcome.response.txn_status, replayed: outcome.replayed });
      await publishAll(outcome.events);
      return { ...outcome.response, replayed: outcome.replayed };
    },

    // Tiến trình nền mỗi giây (BRULE17, M13): thanh toán ONLINE còn PENDING / FAILED đã quá hạn → CANCELED
    // (PAYMENT_EXPIRED) → K6 CANCELED → Booking hủy. Giao dịch MANUAL đang chờ giữ nguyên (callback muộn → M11).
    async expireOverdue() {
      const expired = await payments.expireOverdue();
      for (const p of expired) log.info('payment_expired', { payment_id: p.payment_id, booking_id: p.booking_id });
      await publishAll(expired.map((p) => statusEvent(p, 'CANCELED', p.previous_status, 'PAYMENT_EXPIRED')));
      return expired.length;
    },
  };
}
