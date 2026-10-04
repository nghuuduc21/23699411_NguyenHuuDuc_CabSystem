// Gọi thật grpc.health.v1.Health/Check qua mạng nội bộ của máy (cổng ngẫu nhiên),
// với health giả: kiểm tra tầng gRPC mà không cần database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createGrpcServer, loadProto, startGrpcServer } from '../src/grpc/server.js';

async function withServer(status, fn) {
  const server = createGrpcServer({ health: { check: async () => status } });
  const port = await startGrpcServer(server, 0);
  const { Health } = loadProto('health.proto').grpc.health.v1;
  const client = new Health(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const check = (service) => new Promise((resolve) => {
    client.Check({ service }, { deadline: Date.now() + 1000 }, (err, res) => resolve({ err, res }));
  });
  try {
    await fn(check);
  } finally {
    client.close();
    server.forceShutdown();
  }
}

test('Check với service "" trả trạng thái của health', async () => {
  await withServer('SERVING', async (check) => {
    const { err, res } = await check('');
    assert.equal(err, null);
    assert.equal(res.status, 'SERVING');
  });
  await withServer('NOT_SERVING', async (check) => {
    assert.equal((await check('')).res.status, 'NOT_SERVING');
  });
});

test('Check với tên service lạ trả NOT_FOUND', async () => {
  await withServer('SERVING', async (check) => {
    const { err } = await check('khong-co');
    assert.equal(err.code, grpc.status.NOT_FOUND);
  });
});
