// Unit test seed (spec 20-29 mục 7.2; AC-DG-13): driver_ratings chỉ chèn khi dòng ratings vừa được tạo,
// nên khởi động lại không cộng lại lần nữa và không ghi đè số đã cộng khi demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeed } from '../src/seed.js';

const log = { info() {}, warn() {}, error() {} };

function fakePool({ ratingExists }) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO ratings')) return { rowCount: ratingExists ? 0 : 1, rows: ratingExists ? [] : [{ rating_id: 3 }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return { queries, connect: async () => client };
}

test('lần đầu: chèn đánh giá 3 (trip 3, khách 1, tài xế 11, 5 sao) và driver_ratings 11 = 1 | 5', async () => {
  const pool = fakePool({ ratingExists: false });
  assert.equal(await runSeed({ pool, log }), 2);
  const r = pool.queries.find((q) => q.sql.includes('INSERT INTO ratings'));
  assert.deepEqual(r.params, [3, 3, 1, 11, 5]);
  assert.ok(pool.queries.some((q) => q.sql.includes('INSERT INTO driver_ratings')));
});

test('khởi động lại (đánh giá 3 đã có): KHÔNG đụng driver_ratings', async () => {
  const pool = fakePool({ ratingExists: true });
  assert.equal(await runSeed({ pool, log }), 0);
  assert.ok(!pool.queries.some((q) => q.sql.includes('driver_ratings')));
  assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));
});
