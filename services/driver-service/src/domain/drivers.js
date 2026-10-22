// Logic nghiệp vụ của Driver & Vehicle (spec 12-13-21-23): nộp hồ sơ (UC29), duyệt / từ chối (UC30),
// xem tài xế (UC20, UC21), tìm quanh tọa độ (UC06), bật / tắt và vị trí (UC28, UC12).
// Mọi phụ thuộc (kho dữ liệu, bộ mã hóa, bộ phát event, log) truyền từ ngoài vào
// nên test chạy được không cần PostgreSQL, Kafka hay gRPC.
// `identity` = { accountId, role } dạng chuỗi lấy từ metadata do Gateway dựng (tầng gRPC đọc giúp).
import {
  APPROVAL_STATUSES, boundingBox, checkCoordinates, checkId, checkPagination, cleanReason, cleanText,
  DriverError, invalid, isPresent, NAME_MAX, normalizeLicense, normalizePlate, normalizeVehicle,
  pagination, requireRole, requireSystem, SEARCH_RADIUS_M, SYSTEM_ROLE, VEHICLE_TEXT_MAX,
} from './rules.js';

export const TOPIC_APPLICATION_REVIEWED = 'driver.application-reviewed'; // K7

const notFound = () => new DriverError('NOT_FOUND', 'DRIVER_NOT_FOUND');

// Tên ràng buộc trong migration 001 → mã lỗi (lỗi 23505 trùng, 23503 khóa ngoại).
const CONSTRAINT_TO_ERROR = {
  vehicles_license_plate_key: () => new DriverError('ALREADY_EXISTS', 'LICENSE_PLATE_ALREADY_EXISTS'),
  vehicles_vehicle_type_fkey: () => invalid(), // loại xe không có trong vehicle_types
};

export function createDriverLogic({ drivers, cipher, events, log }) {
  // Giải mã số giấy phép. Hỏng (sửa tay trong database, sai khóa) thì KHÔNG trả dữ liệu sai:
  // ghi log kèm mã tài xế (không kèm dữ liệu) rồi báo INTERNAL → Gateway 503.
  function decryptLicense(row) {
    try {
      return cipher.decrypt(row.license_number_enc);
    } catch {
      log.error('decrypt_failed', { driver_id: row.driver_id });
      throw new DriverError('INTERNAL', 'INTERNAL');
    }
  }

  // Phần CÔNG KHAI (FR14): ai đã đăng nhập cũng thấy — họ tên, loại xe, biển số, trạng thái.
  const publicView = (row) => ({
    driver_id: row.driver_id,
    name: row.full_name,
    vehicle: row.vehicle_type,
    plate: row.license_plate,
    status: row.availability,
  });

  // Dạng ĐẦY ĐỦ cho chính chủ và admin. Field NULL thì không đưa vào (proto `optional` → JSON không có key).
  function fullView(row) {
    const out = { ...publicView(row), approval_status: row.approval_status, license: decryptLicense(row) };
    if (row.current_lat !== null) {
      out.lat = row.current_lat;
      out.lng = row.current_lng;
    }
    for (const [key, column] of [['brand', 'brand'], ['model', 'model'], ['color', 'color'], ['reason', 'reject_reason']]) {
      if (row[column] !== null && row[column] !== undefined) out[key] = row[column];
    }
    return out;
  }

  // Phát K7 SAU KHI database đã ghi xong (ADR-017). Gửi lỗi thì KHÔNG hoàn tác việc duyệt và vẫn trả
  // thành công: duyệt hồ sơ không được thất bại vì Kafka / Notification lỗi (NFR05). Chỉ ghi log để xử lý tay.
  // Event chỉ mang mã và kết quả — không họ tên, không số giấy phép, không lý do (02 mục 6.1).
  async function publishReviewed(driverId, result) {
    try {
      await events.publish(TOPIC_APPLICATION_REVIEWED, String(driverId), { driver_id: driverId, result });
    } catch (err) {
      log.error('EVENT_PUBLISH_FAILED', { topic: TOPIC_APPLICATION_REVIEWED, key: String(driverId), reason: err?.name ?? 'Error' });
    }
  }

  // A15 / A16 dùng chung: một lệnh UPDATE có điều kiện PENDING → nếu không khớp thì phân biệt 404 / 409.
  async function review(driverId, identity, approvalStatus, reason) {
    const updated = await drivers.review({ driverId, approvalStatus, reviewedBy: identity.accountId, reason });
    if (!updated) {
      if (!(await drivers.exists(driverId))) throw notFound();
      // Đã APPROVED / REJECTED: không xét lại (D5). Hồ sơ REJECTED muốn được xét lại thì tài xế nộp lại
      // bằng A11 (FR43) → về PENDING → admin xét như lần đầu.
      throw new DriverError('FAILED_PRECONDITION', 'APPLICATION_ALREADY_REVIEWED');
    }
    // Chỉ ghi mã và kết quả, KHÔNG ghi lý do hay họ tên (NFR08, NFR10).
    log.info('driver_reviewed', { driver_id: driverId, result: approvalStatus, reviewed_by: identity.accountId });
    await publishReviewed(driverId, approvalStatus);
    return updated;
  }

  return {
    // A11: driver_id = mã tài khoản trong token (cùng mẫu ADR-013): tài xế không nộp hộ người khác,
    // và auth-service không phải gọi sang đây.
    // FR43 (2026-10-05): hồ sơ đang REJECTED thì CÙNG request này là "nộp lại" — cùng dữ liệu, cùng kiểm tra,
    // nên không thêm API mới. Nộp lại không phát event (như lần đầu: admin xem danh sách chờ ở A13).
    async submitApplication(req, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      // Kiểm tra hết TRƯỚC khi ghi: dữ liệu sai thì không có gì được tạo.
      const fullName = cleanText(req.name, NAME_MAX);
      const license = normalizeLicense(req.license);
      const plate = normalizePlate(req.plate);
      const vehicleType = normalizeVehicle(req.vehicle);
      const extra = {};
      for (const key of ['brand', 'model', 'color']) extra[key] = isPresent(req[key]) ? cleanText(req[key], VEHICLE_TEXT_MAX) : null;

      let outcome;
      try {
        outcome = await drivers.saveApplication({
          driverId: accountId, fullName, licenseEnc: cipher.encrypt(license), vehicleType, plate, ...extra,
        });
      } catch (err) {
        const toError = (err.code === '23505' || err.code === '23503') && CONSTRAINT_TO_ERROR[err.constraint];
        if (toError) throw toError();
        throw err;
      }
      // Đang PENDING / APPROVED: không nộp chồng (D4) — đang chờ thì chờ, đã duyệt thì không cần nộp.
      if (outcome === 'EXISTS') throw new DriverError('ALREADY_EXISTS', 'DRIVER_ALREADY_EXISTS');
      const resubmitted = outcome === 'RESUBMITTED';
      // Chỉ ghi mã và cờ nộp lại: không ghi họ tên, số giấy phép (NFR08, NFR10).
      log.info('driver_applied', { driver_id: accountId, resubmitted });
      // Chủ hồ sơ → dạng đầy đủ (thấy lại số giấy phép mình vừa nhập, đã chuẩn hóa).
      const out = {
        driver_id: accountId, name: fullName, vehicle: vehicleType, plate, status: 'OFFLINE',
        approval_status: 'PENDING', license,
      };
      for (const key of ['brand', 'model', 'color']) if (extra[key] !== null) out[key] = extra[key];
      // Cờ chỉ có khi nộp lại; Gateway dùng nó để trả 200 thay vì 201 (TX12). Không có `reason`: đã xóa.
      if (resubmitted) out.resubmitted = true;
      return out;
    },

    // A14: mọi role xem được; mức chi tiết tùy người xem (04 mục 4).
    // A14 (sửa 2026-10-14 theo yêu cầu giảng viên, D11): chỉ ADMIN (mọi mã) và CHÍNH tài xế (mã của mình).
    // Khách không còn xem hồ sơ tài xế theo mã: khách thấy tài xế của chuyến mình qua A27 (FR14) và tài xế
    // quanh mình qua A12. Vì vậy chỉ còn MỘT bản trả về — bản đầy đủ — bỏ "phần công khai" (TX3 bỏ).
    async getDriver({ driver_id: driverId }, identity) {
      const { accountId, role } = requireRole(identity, ['driver', 'admin']);
      // TX15: tài xế xem mã KHÁC → 403 NGAY, chưa đọc database (như A09 của hồ sơ khách). Mã tài xế là số nhỏ
      // dễ đoán (11–18); nếu tra trước rồi mới so chủ thì 404 / 403 sẽ lộ "mã này có tài xế không".
      // So được ngay vì driver_id = account_id. Đánh đổi: mã không tồn tại cũng nhận 403 thay vì 404.
      if (role === 'driver' && driverId !== accountId) throw new DriverError('PERMISSION_DENIED', 'NOT_OWNER');
      checkId(driverId);
      const row = await drivers.findById(driverId);
      if (!row) throw notFound();
      // Admin và chủ thấy mọi trạng thái duyệt (gồm PENDING, REJECTED kèm lý do — FR43).
      return fullView(row);
    },

    // A13: danh sách hồ sơ cho admin, cũ nhất trước. Không giải mã số giấy phép (xem từng hồ sơ ở A14).
    async listDrivers({ approval_status: approvalStatus, page, limit }, identity) {
      requireRole(identity, ['admin']);
      let filter = null;
      if (isPresent(approvalStatus)) {
        filter = String(approvalStatus).toUpperCase();
        if (!APPROVAL_STATUSES.includes(filter)) throw invalid();
      }
      const paging = checkPagination(page, limit);
      const { rows, total } = await drivers.list({ approvalStatus: filter, limit: paging.limit, offset: paging.offset });
      return {
        data: rows.map((row) => ({
          ...publicView(row),
          approval_status: row.approval_status,
          created_at: new Date(row.created_at).toISOString(),
        })),
        pagination: pagination(paging.page, paging.limit, total),
      };
    },

    // A12 (và S2 của booking): ONLINE + APPROVED + đúng loại xe + trong 1 km, gần nhất trước.
    // Role: customer, admin (qua Gateway) và `system` (bộ ghép của booking-service — DX-M1, TX-Q3 đã chốt).
    async findNearbyDrivers({ lat, lng, vehicle, page, limit }, identity) {
      requireRole(identity, ['customer', 'admin', SYSTEM_ROLE]);
      checkCoordinates(lat, lng);
      let vehicleType = null;
      if (isPresent(vehicle)) {
        vehicleType = normalizeVehicle(vehicle);
        // Loại xe lạ (`BUS`) là lỗi của request, không phải "không có ai" — báo 400 thay vì trả rỗng.
        if (!(await drivers.vehicleTypeExists(vehicleType))) throw invalid();
      }
      const paging = checkPagination(page, limit);
      const { dLat, dLng } = boundingBox(lat);
      const { rows, total } = await drivers.findNearby({
        lat, lng, vehicle: vehicleType, dLat, dLng, radiusM: SEARCH_RADIUS_M, limit: paging.limit, offset: paging.offset,
      });
      return {
        // Không trả tọa độ của tài xế (NFR08): khách chỉ cần biết cách bao xa.
        data: rows.map((row) => ({
          driver_id: row.driver_id,
          name: row.full_name,
          vehicle: row.vehicle_type,
          plate: row.license_plate,
          distance_m: Math.round(row.distance),
        })),
        pagination: pagination(paging.page, paging.limit, total),
      };
    },

    // A15
    async approveDriver({ driver_id: driverId }, identity) {
      const caller = requireRole(identity, ['admin']);
      checkId(driverId);
      await review(driverId, caller, 'APPROVED', null);
      return { driver_id: driverId, approval_status: 'APPROVED' };
    },

    // A16: lý do bắt buộc (FR36), lưu trong database để tài xế xem ở A14; KHÔNG đưa vào event.
    async rejectDriver({ driver_id: driverId, reason }, identity) {
      const caller = requireRole(identity, ['admin']);
      checkId(driverId);
      const cleanedReason = cleanReason(reason === '' ? undefined : reason);
      await review(driverId, caller, 'REJECTED', cleanedReason);
      return { driver_id: driverId, approval_status: 'REJECTED', reason: cleanedReason };
    },

    // A17 / A39: tài xế tự bật / tắt nhận chuyến. BUSY chỉ hệ thống đặt và nhả (D8).
    async setAvailability({ status, lat, lng }, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      const target = typeof status === 'string' ? status.toUpperCase() : '';
      if (target !== 'ONLINE' && target !== 'OFFLINE') throw invalid();
      const hasLat = isPresent(lat);
      if (hasLat !== isPresent(lng)) throw invalid(); // tọa độ phải đủ cặp
      if (hasLat && target === 'OFFLINE') throw invalid(); // A39 chỉ nhận `status`
      if (hasLat) checkCoordinates(lat, lng);

      const updated = await drivers.updateAvailabilityLocked(accountId, (row) => {
        if (row.availability === 'BUSY') {
          // Đang chở khách: không tự bật / tắt được, chỉ hệ thống nhả khi chuyến kết thúc (D8).
          throw new DriverError('FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
        }
        if (target === 'OFFLINE') return { availability: 'OFFLINE' }; // giữ vị trí; đã OFFLINE → vẫn 200
        // D6: chưa được admin duyệt thì không nhận chuyến.
        if (row.approval_status !== 'APPROVED') throw new DriverError('FAILED_PRECONDITION', 'DRIVER_NOT_APPROVED');
        // Bật lần đầu phải có vị trí, nếu không thì không ai tìm thấy tài xế này.
        if (!hasLat && row.current_lat === null) throw invalid();
        return hasLat ? { availability: 'ONLINE', lat, lng } : { availability: 'ONLINE' };
      });
      if (!updated) throw notFound(); // tài khoản driver chưa nộp hồ sơ
      // Không ghi tọa độ vào log (NFR08).
      log.info('availability_changed', { driver_id: accountId, status: updated.availability });
      if (updated.availability === 'OFFLINE') return { driver_id: accountId, status: 'OFFLINE' };
      return { driver_id: accountId, status: updated.availability, lat: updated.current_lat, lng: updated.current_lng };
    },

    // S3 ReserveDriver (spec 14-15-16-19-30 mục 5.4; D8): giữ tài xế cho một booking khi tài xế nhận chuyến.
    // Một lệnh UPDATE có điều kiện `availability = 'ONLINE'` nên hai booking không giữ được cùng một tài xế,
    // và không giữ được tài xế vừa tắt Online. Không khớp thì đọc lại để trả đúng lý do.
    async reserveDriver({ driver_id: driverId, booking_id: bookingId }, identity) {
      requireSystem(identity);
      checkId(driverId, 'INVALID_INPUT');
      checkId(bookingId, 'INVALID_INPUT');
      if (!(await drivers.reserve(driverId, bookingId))) {
        const state = await drivers.findAvailability(driverId);
        if (!state) throw notFound();
        // Đã giữ cho CHÍNH booking này (lần gọi trước bị quá hạn ở phía booking) → trả như lần đầu (gọi lặp an toàn).
        const sameBooking = state.availability === 'BUSY' && state.current_booking_id === bookingId;
        // Còn lại: OFFLINE, hoặc đang bận booking khác.
        if (!sameBooking) throw new DriverError('FAILED_PRECONDITION', 'DRIVER_NOT_AVAILABLE');
      }
      // DX25: trả họ tên, biển số (cả khi gọi lặp) để Trip chụp lại; khách xem ở A27 mà không cần A14 hay S6.
      // Tài xế đã giữ được thì chắc chắn có hồ sơ và xe (nộp cùng lúc ở A11); không đọc được là lỗi bất thường.
      const summary = await drivers.findNameAndPlate(driverId);
      if (!summary) throw new DriverError('INTERNAL', 'INTERNAL');
      // Không ghi họ tên, biển số vào log (dữ liệu cá nhân).
      log.info('driver_reserved', { driver_id: driverId, booking_id: bookingId });
      return {
        driver_id: driverId, booking_id: bookingId, status: 'BUSY',
        driver_name: summary.full_name, plate: summary.license_plate,
      };
    },

    // S3 ReleaseDriver (D9, DX6): chỉ nhả khi đang giữ ĐÚNG booking này, về ONLINE (trước khi giữ tài xế
    // đang ONLINE). Không khớp → released = false, KHÔNG lỗi: booking gọi lặp hay gọi "phòng khi" đều an toàn.
    // Không phát event: không context nào khác cần biết việc giữ / nhả.
    async releaseDriver({ driver_id: driverId, booking_id: bookingId }, identity) {
      requireSystem(identity);
      checkId(driverId, 'INVALID_INPUT');
      checkId(bookingId, 'INVALID_INPUT');
      const released = await drivers.release(driverId, bookingId);
      if (released) log.info('driver_released', { driver_id: driverId, booking_id: bookingId });
      return { driver_id: driverId, released };
    },

    // D9 (spec 17-18 mục 2.6): nghe K5 trip.status-changed. Chuyến COMPLETED / CANCELED → tài xế rảnh lại (ONLINE).
    // Vì sao Kafka chứ không để Trip gọi gRPC: chuyến kết thúc ngoài đời thì phải được ghi nhận dù driver-service đang
    // dừng; chạy lại thì đọc bù event (NFR05). Đánh đổi: tài xế rảnh lại trễ khoảng một giây.
    // DÙNG CHUNG câu lệnh với ReleaseDriver: chỉ nhả khi tài xế đang giữ ĐÚNG booking của chuyến. Nhờ vậy event lặp
    // (đã nhả rồi), event cũ của booking khác (tài xế đang chở người khác — AC-HT-05) không làm gì: chống lặp bằng
    // chính trạng thái, không cần bảng event đã xử lý (03 mục 11.3). Lỗi database → ném để Kafka giao lại.
    async onTripStatusChanged(envelope) {
      const data = envelope?.data;
      if (!data || typeof data.status !== 'string') {
        log.warn('bỏ qua event sai dạng', { topic: 'trip.status-changed', event_id: envelope?.event_id });
        return false;
      }
      if (data.status !== 'COMPLETED' && data.status !== 'CANCELED') return false;
      if (!Number.isSafeInteger(data.driver_id) || !Number.isSafeInteger(data.booking_id)) {
        log.warn('bỏ qua event sai dạng', { topic: 'trip.status-changed', event_id: envelope?.event_id });
        return false;
      }
      const released = await drivers.release(data.driver_id, data.booking_id);
      if (released) log.info('driver_released', { driver_id: data.driver_id, booking_id: data.booking_id, trip_status: data.status });
      return released;
    },

    // A18: ghi vị trí mới nhất ở mọi trạng thái (tài xế cập nhật trước khi bật Online — TX9).
    async updateLocation({ lat, lng }, identity) {
      const { accountId } = requireRole(identity, ['driver']);
      checkCoordinates(lat, lng);
      const updated = await drivers.updateLocation({ driverId: accountId, lat, lng });
      if (!updated) throw notFound();
      return { driver_id: accountId, lat: updated.current_lat, lng: updated.current_lng };
    },
  };
}
