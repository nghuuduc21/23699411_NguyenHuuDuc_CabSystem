import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../services/gateway/src/app.js';

// Mở một HTTP server trên cổng trống do hệ điều hành chọn.
async function start(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return `http://127.0.0.1:${server.address().port}`;
}

// Đóng server sau test để không giữ cổng và tiến trình.
async function stop(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test('Gateway trả 200 khi Identity healthy', async (t) => {
  // Arrange: tạo Identity giả lập có HTTP response đúng hợp đồng.
  // Đây vẫn là server HTTP thật, nhưng không chạy code Identity thật.
  let receivedPath;

  const identity = createServer((req, res) => {
    receivedPath = req.url;

    res.writeHead(200, {
      'Content-Type': 'application/json',
    });

    res.end(JSON.stringify({
      service: 'identity',
      status: 'healthy',
    }));
  });

  const identityUrl = await start(identity);
  t.after(() => stop(identity));

  // Gateway gọi địa chỉ server giả lập thay cho cổng 3002.
  const gateway = createServer(createApp({ identityUrl }));
  const gatewayUrl = await start(gateway);
  t.after(() => stop(gateway));

  // Act: gửi request vào Gateway.
  const response = await fetch(`${gatewayUrl}/health/services`);
  const body = await response.json();

  // Assert: Gateway gọi đúng endpoint của Identity và trả đúng kết quả.
  assert.equal(receivedPath, '/health');
  assert.equal(response.status, 200);

  assert.deepEqual(body, {
    status: 'ready',
    services: {
      identity: 'healthy',
    },
  });
});

test('Gateway trả 503 khi Identity báo không sẵn sàng', async (t) => {
  // Giả lập Identity đang chạy nhưng không sẵn sàng phục vụ.
  const identity = createServer((req, res) => {
    res.writeHead(503, {
      'Content-Type': 'application/json',
    });

    res.end(JSON.stringify({
      service: 'identity',
      status: 'unavailable',
    }));
  });

  const identityUrl = await start(identity);
  t.after(() => stop(identity));

  const gateway = createServer(createApp({ identityUrl }));
  const gatewayUrl = await start(gateway);
  t.after(() => stop(gateway));

  const response = await fetch(`${gatewayUrl}/health/services`);
  const body = await response.json();

  assert.equal(response.status, 503);

  assert.deepEqual(body, {
    status: 'not_ready',
    services: {
      identity: 'unavailable',
    },
  });

  // Dependency lỗi nhưng bản thân Gateway vẫn còn phản hồi.
  const health = await fetch(`${gatewayUrl}/health`);
  assert.equal(health.status, 200);
});