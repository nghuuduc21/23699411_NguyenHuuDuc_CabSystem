// Unit test cho migrate.js (tạo index MongoDB) bằng database giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDEXES, runMigrations } from '../src/migrate.js';

const silentLog = { info() {}, warn() {}, error() {} };

function fakeDb() {
  const calls = [];
  return {
    calls,
    collection: (name) => ({ createIndex: async (keys, options) => calls.push({ name, keys, options }) }),
  };
}

test('spec 00 chưa có index nào', async () => {
  const db = fakeDb();
  assert.equal(INDEXES.length, 0);
  assert.equal(await runMigrations({ db, log: silentLog }), 0);
  assert.equal(db.calls.length, 0);
});

test('tạo đúng từng index trong danh sách', async () => {
  const db = fakeDb();
  const indexes = [{ collection: 'c', keys: { a: 1 }, options: { unique: true } }];
  await runMigrations({ db, log: silentLog, indexes });
  assert.deepEqual(db.calls, [{ name: 'c', keys: { a: 1 }, options: { unique: true } }]);
});
