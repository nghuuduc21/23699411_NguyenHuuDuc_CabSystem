// Unit test cho config.js: thiếu biến hoặc sai định dạng thì báo đúng TÊN biến (spec 00 mục 3.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

const VALID = {
  SERVICE_NAME: 'notification-service',
  MONGODB_URI: 'mongodb://cab:x@notification-db:27017/notification?authSource=admin',
  KAFKA_BROKERS: 'kafka:9092',
  SIMULATION_MODE: 'false',
};

test('đủ biến hợp lệ thì trả cấu hình', () => {
  assert.equal(loadConfig(VALID).simulationMode, false);
});

for (const name of Object.keys(VALID)) {
  test(`thiếu ${name} thì báo đúng tên biến, không lộ giá trị`, () => {
    const env = { ...VALID };
    delete env[name];
    assert.throws(() => loadConfig(env), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.variable, name);
      assert.ok(!err.message.includes('cab:x'));
      return true;
    });
  });
}
