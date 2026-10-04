// Unit test tính cước (03 mục 6.3; AC26): 6 ví dụ của thiết kế, toàn số nguyên.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare } from '../src/domain/fare.js';

const CAR_4 = { base_fare: 20000, per_km_rate: 12000, min_fare: 30000 };
const MOTORBIKE = { base_fare: 10000, per_km_rate: 5000, min_fare: 15000 };
const CAR_7 = { base_fare: 25000, per_km_rate: 15000, min_fare: 40000 };

test('ví dụ 03 mục 6.3: làm tròn LÊN bội 1 000 đ, không dưới tối thiểu', () => {
  assert.equal(calculateFare(CAR_4, 3250), 59000);
  assert.equal(calculateFare(MOTORBIKE, 650), 15000); // 13 250 → 14 000 → dưới tối thiểu
  assert.equal(calculateFare(CAR_7, 4333), 90000); // 89 995 → 90 000
});

test('tuyến mẫu P0 → D0 (2 026 m): CAR_4 45 000, MOTORBIKE 21 000, CAR_7 56 000', () => {
  assert.equal(calculateFare(CAR_4, 2026), 45000);
  assert.equal(calculateFare(MOTORBIKE, 2026), 21000);
  assert.equal(calculateFare(CAR_7, 2026), 56000);
});

test('đúng bội 1 000 thì không làm tròn thêm', () => {
  assert.equal(calculateFare(CAR_4, 2000), 44000);
});
