// Unit test cho config.js: thiếu biến hoặc sai định dạng thì báo đúng TÊN biến (spec 00 mục 3.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

const VALID = {
  SERVICE_NAME: 'trip-service',
  DATABASE_URL: 'postgres://cab:x@trip-db:5432/trip',
  KAFKA_BROKERS: 'kafka:9092',
  SIMULATION_MODE: 'true',
};

function expectConfigError(env, variable, reason) {
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.variable, variable);
    assert.equal(err.reason, reason);
    return true;
  });
}

test('đủ biến hợp lệ thì trả cấu hình', () => {
  const config = loadConfig(VALID);
  assert.equal(config.simulationMode, true);
});

for (const name of Object.keys(VALID)) {
  test(`thiếu ${name} thì báo đúng tên biến`, () => {
    const env = { ...VALID };
    delete env[name];
    expectConfigError(env, name, 'MISSING');
  });
}

test('biến rỗng cũng coi là thiếu', () => {
  expectConfigError({ ...VALID, DATABASE_URL: '  ' }, 'DATABASE_URL', 'MISSING');
});
