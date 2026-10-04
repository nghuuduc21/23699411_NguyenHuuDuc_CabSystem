// Healthcheck của Docker: `node src/healthcheck.js` (spec 00 H2).
// Vì sao không dùng grpc_health_probe: phải tải thêm một file chạy vào image;
// script này dùng lại đúng thư viện gRPC và proto mà service đã có.
// Thoát 0 = healthy, 1 = unhealthy.
import grpc from '@grpc/grpc-js';
import { GRPC_PORT, loadProto } from './grpc/server.js';

const DEADLINE_MS = 1000;

const healthProto = loadProto('health.proto');
const client = new healthProto.grpc.health.v1.Health(`127.0.0.1:${GRPC_PORT}`, grpc.credentials.createInsecure());

client.Check({ service: '' }, { deadline: Date.now() + DEADLINE_MS }, (err, response) => {
  process.exit(!err && response.status === 'SERVING' ? 0 : 1);
});
