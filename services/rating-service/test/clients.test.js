// Unit test client S7 GetTripForRating (spec 00 H14, AC-HT-19): lời gọi bật waitForReady, deadline 1 000 ms,
// metadata x-role: system và x-request-id, không có x-account-id. Dùng client giả để đọc đúng đối tượng Metadata
// và tùy chọn deadline mà lời gọi truyền đi (`waitForReady` là tùy chọn phía client, không gửi qua mạng).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, SERVICE_DEADLINE_MS, systemMetadata } from '../src/clients.js';

test('S7: waitForReady === true, deadline = now + 1 000 ms, x-role system, x-request-id', async () => {
  let seen;
  const fakeTrip = {
    GetTripForRating(req, metadata, options, cb) {
      seen = { req, metadata, options };
      cb(null, { trip_id: req.trip_id, status: 'COMPLETED', customer_id: 1, driver_id: 11 });
    },
  };
  const t0 = Date.now();
  const res = await call(fakeTrip, 'GetTripForRating', { trip_id: 3 }, 'r1');
  assert.equal(res.status, 'COMPLETED');
  assert.equal(seen.metadata.getOptions().waitForReady, true);
  assert.deepEqual(seen.metadata.get('x-role'), ['system']);
  assert.deepEqual(seen.metadata.get('x-request-id'), ['r1']);
  assert.deepEqual(seen.metadata.get('x-account-id'), []);
  const left = seen.options.deadline - t0;
  assert.ok(left >= SERVICE_DEADLINE_MS && left <= SERVICE_DEADLINE_MS + 50, `deadline ${left} ms`);
});

test('lỗi gRPC → gắn statusName, không gọi lại', async () => {
  let n = 0;
  const fakeTrip = { GetTripForRating(req, md, opts, cb) { n += 1; cb(Object.assign(new Error('x'), { code: 14 })); } };
  await assert.rejects(call(fakeTrip, 'GetTripForRating', { trip_id: 3 }, 'r2'), (err) => err.statusName === 'UNAVAILABLE');
  assert.equal(n, 1);
  assert.equal(systemMetadata().getOptions().waitForReady, true);
});
