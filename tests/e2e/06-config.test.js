// Mục chấm 2 (đường lỗi) — thiếu hoặc sai khóa trong môi trường → service thoát 1, log nêu TÊN biến,
// không nêu giá trị (spec 00: AC-HT-03, mục 3.5).
// Không sửa .env thật: dùng `docker compose run --rm --no-deps -e CUSTOMER_DATA_KEY=` để chạy một
// container tạm của customer-service với biến bị xóa trắng. Container chính không bị đụng tới.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, compose, containerHealth } from './helpers.js';

function envValue(name) {
  const file = fs.existsSync(path.join(REPO_ROOT, '.env')) ? '.env' : '.env.example';
  const line = fs
    .readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line.slice(name.length + 1);
}

function runCustomerWith(envOverride) {
  return compose('run', '--rm', '--no-deps', '-T', '-e', envOverride, 'customer-service');
}

test('AC-HT-03 (mục 2): thiếu CUSTOMER_DATA_KEY → customer-service thoát mã 1, log có tên biến, không có giá trị khóa', () => {
  const r = runCustomerWith('CUSTOMER_DATA_KEY=');
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1, `mã thoát ${r.status}; log: ${out}`);
  assert.match(out, /CUSTOMER_DATA_KEY/);
  assert.match(out, /MISSING/);
  assert.ok(!out.includes(envValue('CUSTOMER_DATA_KEY')), 'log lộ giá trị khóa');
  assert.ok(!out.includes(envValue('DB_PASSWORD') + '@'), 'log lộ chuỗi kết nối có mật khẩu');
});

test('AC-HT-03 (mục 2): CUSTOMER_DATA_KEY sai độ dài (16 byte) → thoát mã 1, log có tên biến, không có giá trị', () => {
  const shortKey = Buffer.alloc(16, 7).toString('base64');
  const r = runCustomerWith(`CUSTOMER_DATA_KEY=${shortKey}`);
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1, `mã thoát ${r.status}; log: ${out}`);
  assert.match(out, /CUSTOMER_DATA_KEY/);
  assert.ok(!out.includes(shortKey), 'log lộ giá trị khóa sai');
});

test('AC-HT-03: container customer-service chính vẫn running healthy sau hai lần chạy thử', () => {
  assert.equal(containerHealth('customer-service'), 'running healthy');
});
