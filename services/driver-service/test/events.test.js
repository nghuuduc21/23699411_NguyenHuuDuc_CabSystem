// Unit test bộ phát event (ADR-017): phong bì, thử lại ≤ 3 lần, tổng ≤ 1 giây — với producer giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, createEventPublisher } from '../src/events.js';

const log = { info() {}, warn() {}, error() {} };

function fakeProducer({ failTimes = 0, hang = false } = {}) {
  const sent = [];
  let failures = 0;
  return {
    sent,
    connects: 0,
    async connect() { this.connects += 1; },
    async send(record) {
      if (hang) return new Promise(() => {});
      if (failures < failTimes) {
        failures += 1;
        throw Object.assign(new Error('down'), { name: 'KafkaJSConnectionError' });
      }
      sent.push(record);
      return [];
    },
    async disconnect() {},
  };
}

test('phong bì: event_id, event_type = tên topic, occurred_at ISO, data', () => {
  const env = buildEnvelope('driver.application-reviewed', { driver_id: 17, result: 'APPROVED' }, { newId: () => 'id-1', now: () => new Date('2026-10-04T01:02:03Z') });
  assert.deepEqual(env, { event_id: 'id-1', event_type: 'driver.application-reviewed', occurred_at: '2026-10-04T01:02:03.000Z', data: { driver_id: 17, result: 'APPROVED' } });
});

test('gửi thành công: đúng topic, key, value JSON; nối Kafka một lần', async () => {
  const producer = fakeProducer();
  const events = createEventPublisher({ producer, log, newId: () => 'id-1' });
  await events.publish('driver.application-reviewed', '17', { driver_id: 17, result: 'APPROVED' });
  await events.publish('driver.application-reviewed', '18', { driver_id: 18, result: 'REJECTED' });
  assert.equal(producer.connects, 1);
  assert.equal(producer.sent[0].topic, 'driver.application-reviewed');
  assert.equal(producer.sent[0].messages[0].key, '17');
  assert.equal(JSON.parse(producer.sent[0].messages[0].value).data.result, 'APPROVED');
});

test('lỗi hai lần rồi được: lần thứ ba gửi thành công, nối lại sau mỗi lần lỗi', async () => {
  const producer = fakeProducer({ failTimes: 2 });
  const events = createEventPublisher({ producer, log });
  await events.publish('t', 'k', {});
  assert.equal(producer.sent.length, 1);
  assert.equal(producer.connects, 3);
});

test('lỗi cả 3 lần → ném lỗi; Kafka treo → bỏ cuộc trong khoảng ngân sách 1 giây', async () => {
  await assert.rejects(createEventPublisher({ producer: fakeProducer({ failTimes: 9 }), log }).publish('t', 'k', {}));
  const started = Date.now();
  await assert.rejects(createEventPublisher({ producer: fakeProducer({ hang: true }), log, budgetMs: 300 }).publish('t', 'k', {}));
  assert.ok(Date.now() - started < 600);
});
