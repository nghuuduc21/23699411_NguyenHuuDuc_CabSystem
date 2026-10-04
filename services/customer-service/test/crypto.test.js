// Unit test cho domain/crypto.js: tính chất của AES-256-GCM mà mục chấm 24 dựa vào.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFieldCipher } from '../src/domain/crypto.js';

const cipher = createFieldCipher(Buffer.alloc(32, 7));

test('mã hóa rồi giải mã ra đúng chuỗi, kể cả tiếng Việt có dấu', () => {
  const stored = cipher.encrypt('Nguyễn Văn An');
  assert.ok(Buffer.isBuffer(stored));
  assert.equal(cipher.decrypt(stored), 'Nguyễn Văn An');
  // Bản mã không chứa chữ rõ.
  assert.ok(!stored.toString('utf8').includes('Nguy'));
});

test('cùng một chuỗi mã hai lần ra hai bản mã khác nhau (IV ngẫu nhiên từng giá trị)', () => {
  assert.notDeepEqual(cipher.encrypt('An'), cipher.encrypt('An'));
});

test('định dạng IV 12 byte ‖ bản mã ‖ tag 16 byte', () => {
  assert.equal(cipher.encrypt('2000-01-01').length, 12 + 10 + 16);
});

test('sửa một byte hoặc dùng khóa khác thì giải mã báo lỗi', () => {
  const stored = cipher.encrypt('Nguyễn Văn An');
  const tampered = Buffer.from(stored);
  tampered[14] ^= 1;
  assert.throws(() => cipher.decrypt(tampered));
  assert.throws(() => createFieldCipher(Buffer.alloc(32, 8)).decrypt(stored));
  assert.throws(() => cipher.decrypt(Buffer.alloc(5)));
});

test('khóa không đủ 32 byte thì không tạo được bộ mã hóa', () => {
  assert.throws(() => createFieldCipher(Buffer.alloc(16)));
});
