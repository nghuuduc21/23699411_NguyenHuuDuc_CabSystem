// Unit test cho config.js của Gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKEND_SERVICES, ConfigError, loadConfig } from '../src/config.js';

const VALID = {
  SERVICE_NAME: 'gateway',
  REDIS_URL: 'redis://redis:6379',
  JWT_SECRET: 'demo-jwt-secret-chi-dung-cho-may-demo-32b',
  RATE_LIMIT_WINDOW_SECONDS: '10',
  RATE_LIMIT_PUBLIC_MAX: '5',
  RATE_LIMIT_ACCOUNT_MAX: '30',
  ...Object.fromEntries(BACKEND_SERVICES.map(([name, variable]) => [variable, `${name}:50058`])),
};

test('đủ biến thì có địa chỉ của 8 service', () => {
  const config = loadConfig(VALID);
  assert.equal(Object.keys(config.grpcAddrs).length, 8);
  assert.equal(config.grpcAddrs['rating-service'], 'rating-service:50058');
});

for (const name of Object.keys(VALID)) {
  test(`thiếu ${name} thì báo đúng tên biến`, () => {
    const env = { ...VALID };
    delete env[name];
    assert.throws(() => loadConfig(env), (err) => err instanceof ConfigError && err.variable === name);
  });
}

test('JWT_SECRET < 32 ký tự bị từ chối, thông báo không chứa giá trị', () => {
  assert.throws(
    () => loadConfig({ ...VALID, JWT_SECRET: 'khoa-ngan' }),
    (err) => err.reason === 'TOO_SHORT' && !err.message.includes('khoa-ngan'),
  );
});
