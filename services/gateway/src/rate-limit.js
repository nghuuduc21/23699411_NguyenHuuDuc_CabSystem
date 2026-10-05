// Giới hạn tần suất request ở Gateway bằng Redis (mục chấm 29; NFR17; spec 20-29 mục 4.3–4.5, 5.4, 7.3).
// Vì sao ở Gateway: mọi request đi qua đây, chặn ở đây thì request thừa KHÔNG tới service nào.
// Vì sao Redis: bộ đếm dùng chung cho mọi bản Gateway và còn nguyên khi Gateway khởi động lại (ADR-010).
//
// Hai loại bộ đếm (GH3):
//   - `ip`:      4 route công khai (đăng ký, đăng nhập, OTP, đăng ký tài xế) chung MỘT bộ đếm theo IP — chặn dò mật khẩu.
//   - `account`: mọi route có token chung MỘT bộ đếm theo mã tài khoản (đã xác thực chữ ký) — chặn một tài khoản spam.
//
// Cửa sổ CỐ ĐỊNH, BẮT ĐẦU TỪ REQUEST ĐẦU TIÊN (GH1): request đầu tạo key kèm hạn; các request sau chỉ tăng số, không
// kéo dài hạn. Vì sao không chia theo đồng hồ (floor(giờ / 10 s)): bấm Send 6 lần có thể rơi vào hai cửa sổ → lần 6
// vẫn 200, demo hỏng. Neo theo request đầu thì lần thứ max + 1 LUÔN bị 429.
//
// Phụ thuộc (redis, ngưỡng, log) truyền từ ngoài vào để test không cần Redis thật.
import { REDIS_COMMAND_TIMEOUT_MS, withTimeout } from './redis.js';

export function createRateLimiter({ redis, windowSeconds, publicMax, accountMax, log, timeoutMs = REDIS_COMMAND_TIMEOUT_MS }) {
  const limits = { ip: publicMax, account: accountMax };
  const prefix = { ip: 'rl:ip:', account: 'rl:acc:' };

  // Một lần đếm = MỘT vòng gọi Redis (MULTI … EXEC chạy liền một khối):
  //   SET key 0 EX <window> NX → chỉ request đầu tạo key và đặt hạn;
  //   INCR key                 → tăng số, GIỮ NGUYÊN hạn (spam lúc bị chặn không kéo dài cửa sổ);
  //   TTL key                  → số giây còn lại, dùng cho RateLimit-Reset / Retry-After.
  // Gộp trong MULTI nên không có lúc key có số mà không có hạn (Gateway dừng giữa chừng không để key kẹt mãi).
  async function count(key) {
    const results = await withTimeout(
      redis.multi().set(key, '0', 'EX', windowSeconds, 'NX').incr(key).ttl(key).exec(),
      timeoutMs,
    );
    if (!Array.isArray(results)) throw new Error('RATE_LIMIT_NO_RESULT');
    for (const [err] of results) if (err) throw err;
    const n = Number(results[1][1]);
    let ttl = Number(results[2][1]);
    // TTL = -1: key không có hạn (không xảy ra khi làm đúng như trên) — đặt lại hạn để key không chặn mãi.
    if (ttl < 0) {
      await withTimeout(redis.expire(key, windowSeconds), timeoutMs);
      ttl = windowSeconds;
    }
    return { n, ttl };
  }

  return {
    // scope: 'ip' | 'account'; id: địa chỉ IP hoặc mã tài khoản.
    // Trả { skipped: true } khi Redis lỗi; hoặc { limited, headers } — headers gắn vào MỌI response của route bị đếm.
    async hit(scope, id, req) {
      const max = limits[scope];
      let result;
      try {
        result = await count(prefix[scope] + id);
      } catch (err) {
        // Redis dừng / quá 500 ms → CHO QUA (quyết định đã chốt "Redis dừng"): hệ thống không dừng chỉ vì thiếu bộ đếm.
        // Đánh đổi: trong lúc đó không có rate limit. Không gắn header RateLimit-* vì không đếm được.
        log.warn('rate_limit_skipped', { code: err?.code ?? err?.message, request_id: req.requestId });
        return { skipped: true };
      }
      const reset = Math.max(1, result.ttl); // TTL làm tròn có thể ra 0 khi còn < 0,5 giây; header phải ≥ 1
      const headers = {
        'RateLimit-Limit': String(max),
        'RateLimit-Remaining': String(Math.max(0, max - result.n)),
        'RateLimit-Reset': String(reset),
      };
      // Lần thứ max + 1 bị chặn.
      if (result.n > max) return { limited: true, headers: { ...headers, 'Retry-After': String(reset) } };
      return { limited: false, headers };
    },
  };
}
