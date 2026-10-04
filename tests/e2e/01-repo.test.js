// Mục chấm 1, 2 — cấu trúc mã nguồn, .gitignore và .env (spec 00: AC-HT-01, AC-HT-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, BACKEND_SERVICES, run } from './helpers.js';

const exists = (...p) => fs.existsSync(path.join(REPO_ROOT, ...p));

test('AC-HT-01 (mục 1): 9 thư mục services/*, mỗi thư mục có package.json và Dockerfile riêng', () => {
  const dirs = fs
    .readdirSync(path.join(REPO_ROOT, 'services'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(dirs, ['gateway', ...BACKEND_SERVICES].sort());
  for (const dir of dirs) {
    assert.ok(exists('services', dir, 'package.json'), `${dir} thiếu package.json`);
    assert.ok(exists('services', dir, 'Dockerfile'), `${dir} thiếu Dockerfile`);
    assert.ok(exists('services', dir, 'package-lock.json'), `${dir} thiếu package-lock.json`);
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'services', dir, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module', `${dir}: package.json phải "type": "module"`);
    // Phiên bản dependency ghi chính xác (không ^, ~, *, x).
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${dir}: ${name}@${version} không phải phiên bản chính xác`);
    }
  }
});

test('AC-HT-01 (mục 1): 7 service PostgreSQL có migrations/; gateway và notification không có', () => {
  for (const s of BACKEND_SERVICES) {
    const want = s !== 'notification-service';
    assert.equal(exists('services', s, 'migrations'), want, `${s}: migrations/ ${want ? 'phải có' : 'không được có'}`);
  }
  assert.equal(exists('services', 'gateway', 'migrations'), false);
});

test('AC-HT-01 (mục 1): có proto/health.proto, không có thư mục scripts/', () => {
  assert.ok(exists('proto', 'health.proto'));
  assert.equal(exists('scripts'), false, 'không được có scripts/ (luật thi)');
});

test('AC-HT-01 (mục 1): README có cây thư mục, bảng container, lệnh chạy', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /docker compose up -d --build/);
  assert.match(readme, /cp \.env\.example \.env/);
  assert.match(readme, /├─ services\//, 'thiếu cây thư mục');
  assert.match(readme, /\| *Container *\|/, 'thiếu bảng container');
});

test('AC-HT-02 (mục 2): git ls-files .env .env.example chỉ in .env.example', () => {
  const r = run('git', ['ls-files', '.env', '.env.example']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split(/\r?\n/).filter(Boolean), ['.env.example']);
});

test('AC-HT-02 (mục 2): .gitignore có dòng .env và git check-ignore .env in .env', () => {
  const lines = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.env'), '.gitignore thiếu dòng .env');
  const r = run('git', ['check-ignore', '.env']);
  assert.equal(r.stdout.trim(), '.env');
});

test('AC-HT-02 (mục 2): .env.example có đủ 14 biến và đều có giá trị (sao chép là chạy)', () => {
  const vars = Object.fromEntries(
    fs
      .readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const expected = [
    'DB_PASSWORD', 'JWT_SECRET', 'JWT_TTL_SECONDS', 'CUSTOMER_DATA_KEY', 'DRIVER_DATA_KEY',
    'PAYMENT_CALLBACK_SECRET', 'SIMULATION_MODE', 'SEED_PASSWORD', 'PAYMENT_TIMEOUT_SECONDS',
    'OFFER_TIMEOUT_SECONDS', 'OTP_TTL_SECONDS', 'RATE_LIMIT_WINDOW_SECONDS', 'RATE_LIMIT_PUBLIC_MAX',
    'RATE_LIMIT_ACCOUNT_MAX',
  ];
  assert.deepEqual(Object.keys(vars).sort(), [...expected].sort());
  for (const k of expected) assert.ok(vars[k].trim() !== '', `${k} rỗng`);
  assert.ok(vars.JWT_SECRET.length >= 32, 'JWT_SECRET < 32 ký tự');
  for (const k of ['CUSTOMER_DATA_KEY', 'DRIVER_DATA_KEY']) {
    assert.equal(Buffer.from(vars[k], 'base64').length, 32, `${k} không phải 32 byte base64`);
  }
  assert.notEqual(vars.CUSTOMER_DATA_KEY, vars.DRIVER_DATA_KEY, 'hai khóa dữ liệu phải khác nhau');
});
