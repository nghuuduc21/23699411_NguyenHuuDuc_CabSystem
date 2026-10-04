// Unit test cho migrate.js bằng pool giả: không cần PostgreSQL thật (spec 00 mục 7.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../src/migrate.js';

const silentLog = { info() {}, warn() {}, error() {} };

// Pool giả ghi lại mọi câu SQL; `failOn` làm một file migration lỗi.
function fakePool({ doneVersions = [], failOn } = {}) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (failOn && sql.includes(failOn)) throw Object.assign(new Error('lỗi giả'), { code: '42601' });
      return { rows: [] };
    },
    release() {},
  };
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT version')) return { rows: doneVersions.map((version) => ({ version })) };
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };
}

async function dirWith(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(dir, name), sql);
  return dir;
}

test('thư mục chỉ có .gitkeep: tạo schema_migrations, không chạy file nào', async () => {
  const pool = fakePool();
  const applied = await runMigrations({ pool, dir: await dirWith({ '.gitkeep': '' }), log: silentLog });
  assert.deepEqual(applied, []);
  assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
});

test('chạy file theo thứ tự tên, bỏ qua file đã chạy, ghi version bằng tham số', async () => {
  const dir = await dirWith({ '002_b.sql': 'SELECT 2', '001_a.sql': 'SELECT 1', '003_c.sql': 'SELECT 3' });
  const pool = fakePool({ doneVersions: ['001_a.sql'] });
  const applied = await runMigrations({ pool, dir, log: silentLog });
  assert.deepEqual(applied, ['002_b.sql', '003_c.sql']);
  const inserts = pool.queries.filter((q) => q.sql.startsWith('INSERT INTO schema_migrations'));
  assert.deepEqual(inserts.map((q) => q.params), [['002_b.sql'], ['003_c.sql']]);
});

test('file lỗi thì rollback và ném lỗi', async () => {
  const dir = await dirWith({ '001_a.sql': 'SAI CU PHAP' });
  const pool = fakePool({ failOn: 'SAI CU PHAP' });
  await assert.rejects(runMigrations({ pool, dir, log: silentLog }));
  assert.ok(pool.queries.some((q) => q.sql === 'ROLLBACK'));
  assert.ok(!pool.queries.some((q) => q.sql === 'COMMIT'));
});
