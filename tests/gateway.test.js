// Các hàm tổ chức và chạy test của Node.js.
import { before, after, test } from 'node:test';

// assert kiểm tra kết quả thực tế có đúng kỳ vọng không.
// Nếu không đúng, nó ném lỗi để đánh dấu test thất bại.
import assert from 'node:assert/strict';

// Import ứng dụng đã có middleware và route.
// app.js chưa mở cổng nên test có thể tự chọn cổng riêng.
import app from '../services/gateway/src/app.js';

let server;
let baseUrl;

// Chạy một lần trước các test trong file.
before(async () => {
  await new Promise((resolve, reject) => {
    // Cổng 0: nhờ hệ điều hành chọn một cổng còn trống.
    // Không chiếm cổng 8081 của server bạn đang dùng với Postman.
    server = app.listen(0, '127.0.0.1');

    server.once('listening', resolve);
    server.once('error', reject);
  });

  // Lấy cổng thực tế được hệ điều hành cấp.
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

// Chạy sau các test để đóng server, tránh giữ tiến trình chạy mãi.
after(async () => {
  if (!server?.listening) return;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test('GET /health trả 200 và thông tin Gateway', async () => {
  // Act: gửi request HTTP thật đến server của bài test.
  const response = await fetch(`${baseUrl}/health`);

  // Assert: kiểm tra status và kiểu nội dung.
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/,
  );

  // Đọc JSON response và kiểm tra toàn bộ nội dung mong đợi.
  const body = await response.json();

  assert.deepEqual(body, {
    service: 'gateway',
    status: 'healthy',
  });
});

test('GET /heath trả 404 vì sai đường dẫn', async () => {
  // Cố tình gọi sai để kiểm tra cơ chế xử lý route không tồn tại.
  const response = await fetch(`${baseUrl}/heath`);

  assert.equal(response.status, 404);

  const body = await response.json();
  assert.equal(body.error, 'ROUTE_NOT_FOUND');
});