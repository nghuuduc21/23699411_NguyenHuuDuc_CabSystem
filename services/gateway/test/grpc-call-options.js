// Ghi lại tùy chọn của MỌI lời gọi gRPC mà Gateway gửi tới service giả (spec 00 H14, AC-HT-19).
// Mỗi file test route gọi `recordCallOptions` trong rpc giả, rồi test cuối file gọi `assertAllCallsWaitForReady`:
// mọi lời gọi phải có `waitForReady === true` và deadline 3 000 ms. Không reset giữa các test nên kiểm được hết.
import assert from 'node:assert/strict';
import { GATEWAY_DEADLINE_MS } from '../src/grpc/clients.js';

export function createCallOptionsRecorder() {
  const seen = [];
  return {
    recordCallOptions(name, metadata, options) {
      seen.push({ name, waitForReady: metadata.getOptions().waitForReady, left: options.deadline - Date.now() });
    },
    assertAllCallsWaitForReady() {
      assert.ok(seen.length > 0, 'phải có ít nhất một lời gọi gRPC');
      for (const c of seen) {
        assert.equal(c.waitForReady, true, `${c.name}: thiếu waitForReady`);
        // Lời gọi giả trả lời ngay nên còn gần đủ 3 000 ms; dưới 2 900 ms là deadline sai hằng số.
        assert.ok(c.left > GATEWAY_DEADLINE_MS - 100 && c.left <= GATEWAY_DEADLINE_MS, `${c.name}: deadline ${c.left} ms`);
      }
    },
  };
}
