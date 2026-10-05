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

test('spec 17-18: hai index — UNIQUE (event_id, recipient_id) và (recipient_id, created_at giảm dần)', async () => {
  const db = fakeDb();
  assert.equal(await runMigrations({ db, log: silentLog }), 2);
  assert.deepEqual(db.calls, [
    { name: 'notifications', keys: { event_id: 1, recipient_id: 1 }, options: { unique: true, name: 'notifications_event_recipient_uq' } },
    { name: 'notifications', keys: { recipient_id: 1, created_at: -1 }, options: { name: 'notifications_recipient_created_idx' } },
  ]);
  assert.equal(INDEXES.length, 2);
});

test('tạo đúng từng index trong danh sách', async () => {
  const db = fakeDb();
  const indexes = [{ collection: 'c', keys: { a: 1 }, options: { unique: true } }];
  await runMigrations({ db, log: silentLog, indexes });
  assert.deepEqual(db.calls, [{ name: 'c', keys: { a: 1 }, options: { unique: true } }]);
});
