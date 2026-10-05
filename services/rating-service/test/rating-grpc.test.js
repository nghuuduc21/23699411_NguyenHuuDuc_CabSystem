// Gọi thật cab.rating.v1.RatingService qua mạng nội bộ của máy (cổng ngẫu nhiên) với logic giả:
// kiểm tầng gRPC — đọc danh tính trong metadata, đổi lỗi nghiệp vụ → gRPC status + details, lỗi lạ → INTERNAL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';
import { RatingError } from '../src/domain/rules.js';

const log = { info() {}, warn() {}, error() {} };

async function withServer(ratings, fn) {
  const server = createGrpcServer({ health: { check: async () => 'SERVING' }, ratings, log });
  const port = await startGrpcServer(server, 0);
  const { RatingService } = loadProto('rating.proto').cab.rating.v1;
  const client = new RatingService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const call = (method, request, md = {}) => new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    for (const [k, v] of Object.entries(md)) metadata.set(k, v);
    client[method](request, metadata, { deadline: Date.now() + 2000 }, (err, res) => resolve({ err, res }));
  });
  try {
    await fn(call);
  } finally {
    client.close();
    server.forceShutdown();
  }
}

test('CreateRating: chuyển danh tính + request id cho logic; response optional comment vắng khi không có', async () => {
  const seen = [];
  const ratings = {
    async createRating(req, identity, requestId) {
      seen.push({ req, identity, requestId });
      return { rating_id: 1000, trip_id: 4, driver_id: 13, score: 5, driver_avg: 5, driver_count: 1 };
    },
  };
  await withServer(ratings, async (call) => {
    const { err, res } = await call('CreateRating', { trip_id: 4, score: 5 }, { 'x-account-id': '1', 'x-role': 'customer', 'x-request-id': 'r1' });
    assert.equal(err, null);
    assert.equal(res.rating_id, 1000);
    assert.equal(res.driver_avg, 5);
    assert.equal(res.comment, undefined);
    assert.deepEqual(seen[0].identity, { accountId: '1', role: 'customer' });
    assert.equal(seen[0].requestId, 'r1');
    assert.equal(seen[0].req.trip_id, 4);
  });
});

test('lỗi nghiệp vụ → đúng gRPC status + details; lỗi lạ → INTERNAL không lộ thông điệp', async () => {
  const errors = {
    NOT_OWNER: new RatingError('PERMISSION_DENIED', 'NOT_OWNER'),
    RATING_ALREADY_EXISTS: new RatingError('ALREADY_EXISTS', 'RATING_ALREADY_EXISTS'),
    TRIP_NOT_COMPLETED: new RatingError('FAILED_PRECONDITION', 'TRIP_NOT_COMPLETED'),
  };
  let next;
  const ratings = { async createRating() { throw next; }, async getRatingByTrip() { throw next; }, async getDriverRating() { throw new Error('bi mat db'); } };
  await withServer(ratings, async (call) => {
    for (const [code, e] of Object.entries(errors)) {
      next = e;
      const { err } = await call('CreateRating', { trip_id: 4, score: 5 });
      assert.equal(err.code, grpc.status[e.kind]);
      assert.equal(err.details, code);
    }
    next = new RatingError('NOT_FOUND', 'RATING_NOT_FOUND');
    assert.equal((await call('GetRatingByTrip', { trip_id: 4 })).err.details, 'RATING_NOT_FOUND');
    const { err } = await call('GetDriverRating', { driver_id: 11 });
    assert.equal(err.code, grpc.status.INTERNAL);
    assert.equal(err.details, 'INTERNAL');
  });
});

test('GetDriverRating: count 0 không có avg', async () => {
  const ratings = { async getDriverRating() { return { driver_id: 999, count: 0 }; } };
  await withServer(ratings, async (call) => {
    const { res } = await call('GetDriverRating', { driver_id: 999 });
    assert.equal(res.count, 0);
    assert.equal(res.avg, undefined);
  });
});
