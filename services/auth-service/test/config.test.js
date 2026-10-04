// Unit test cho config.js: thiếu biến hoặc sai định dạng thì báo đúng TÊN biến (spec 00 mục 3.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

const VALID = {
  SERVICE_NAME: 'auth-service',
  DATABASE_URL: 'postgres://cab:x@auth-db:5432/auth',
  JWT_SECRET: 'demo-jwt-secret-chi-dung-cho-may-demo-32b',
  JWT_TTL_SECONDS: '3600',
  OTP_TTL_SECONDS: '300',
  SEED_PASSWORD: '12345678',
  SIMULATION_MODE: 'true',
};

function expectConfigError(env, variable, reason) {
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.variable, variable);
    assert.equal(err.reason, reason);
    // Thông báo lỗi không được chứa giá trị bí mật.
    assert.ok(!err.message.includes(VALID.JWT_SECRET));
    return true;
  });
}

test('đủ biến hợp lệ thì trả cấu hình đã đổi kiểu', () => {
  const config = loadConfig(VALID);
  assert.equal(config.jwtTtlSeconds, 3600);
  assert.equal(config.simulationMode, true);
});

for (const name of Object.keys(VALID)) {
  test(`thiếu ${name} thì báo đúng tên biến`, () => {
    const env = { ...VALID };
    delete env[name];
    expectConfigError(env, name, 'MISSING');
  });
}

test('JWT_SECRET ngắn hơn 32 ký tự bị từ chối', () => {
  expectConfigError({ ...VALID, JWT_SECRET: 'ngan' }, 'JWT_SECRET', 'TOO_SHORT');
});

test('SIMULATION_MODE chỉ nhận true hoặc false', () => {
  expectConfigError({ ...VALID, SIMULATION_MODE: 'yes' }, 'SIMULATION_MODE', 'NOT_TRUE_OR_FALSE');
});

test('số giây phải là số nguyên dương', () => {
  expectConfigError({ ...VALID, OTP_TTL_SECONDS: '-5' }, 'OTP_TTL_SECONDS', 'NOT_POSITIVE_INTEGER');
});
