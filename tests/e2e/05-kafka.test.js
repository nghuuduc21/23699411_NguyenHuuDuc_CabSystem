// Mục chấm 7 — Kafka UI thấy đủ 7 topic đã đăng ký (spec 00: AC-HT-09, mục 3.3).
// Gọi API REST của Kafka UI (chính API mà giao diện web dùng để vẽ trang Topics).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KAFKA_UI_URL, TOPICS, compose, getJson } from './helpers.js';

async function listTopics() {
  const r = await getJson(`${KAFKA_UI_URL}/api/clusters/cab/topics?showInternal=true&perPage=100`, { timeoutMs: 10_000 });
  assert.equal(r.status, 200, `Kafka UI trả ${r.status}`);
  return r.body.topics;
}

test('AC-HT-09 (mục 7): Kafka UI mở ở localhost:8080 và có cluster "cab" ONLINE', async () => {
  const r = await getJson(`${KAFKA_UI_URL}/api/clusters`, { timeoutMs: 10_000 });
  assert.equal(r.status, 200);
  const cab = r.body.find((c) => c.name === 'cab');
  assert.ok(cab, 'không có cluster cab');
  assert.equal(cab.status, 'online');
  assert.equal(cab.readOnly, true, 'Kafka UI phải ở chế độ chỉ đọc');
});

test('AC-HT-09 (mục 7): đủ 7 topic, không topic nghiệp vụ nào khác (topic nội bộ __… được phép)', async () => {
  const names = (await listTopics()).map((t) => t.name).filter((n) => !n.startsWith('__')).sort();
  assert.deepEqual(names, [...TOPICS].sort());
});

test('AC-HT-09 (mục 7): mỗi topic 3 partition, replication 1 (spec 00 H4)', async () => {
  const topics = await listTopics();
  for (const name of TOPICS) {
    const t = topics.find((x) => x.name === name);
    assert.ok(t, `thiếu ${name}`);
    assert.equal(t.partitionCount, 3, `${name}: ${t.partitionCount} partition`);
    assert.equal(t.replicationFactor, 1, `${name}: replication ${t.replicationFactor}`);
  }
});

test('AC-HT-09 (mục 7): broker tắt tự tạo topic (auto.create.topics.enable=false)', () => {
  const r = compose(
    'exec', '-T', 'kafka', '/opt/kafka/bin/kafka-configs.sh', '--bootstrap-server', 'localhost:9092',
    '--entity-type', 'brokers', '--entity-name', '1', '--describe', '--all',
  );
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split(/\r?\n/).find((l) => l.trim().startsWith('auto.create.topics.enable='));
  assert.ok(line, 'không đọc được auto.create.topics.enable');
  assert.match(line, /auto\.create\.topics\.enable=false/);
});

test('AC-HT-09 (mục 7): log kafka-init liệt kê 7 topic', () => {
  const r = compose('logs', '--no-log-prefix', 'kafka-init');
  assert.equal(r.status, 0, r.stderr);
  for (const name of TOPICS) assert.match(r.stdout, new RegExp(`^${name.replace('.', '\\.')}$`, 'm'), `log thiếu ${name}`);
});
