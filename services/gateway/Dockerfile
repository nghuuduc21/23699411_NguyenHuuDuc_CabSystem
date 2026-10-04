# Build context là THƯ MỤC GỐC của repo (compose.yaml: context: .) vì Gateway cần proto của cả 8 service.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
# Code tìm file .proto theo biến này; ngoài Docker thì mặc định là proto/ ở gốc repo.
ENV PROTO_DIR=/app/proto

# Copy package.json và lockfile trước rồi mới cài: đổi code không làm mất cache của bước npm ci.
COPY services/gateway/package.json services/gateway/package-lock.json ./
RUN npm ci --omit=dev

COPY services/gateway/src ./src
COPY proto ./proto

# Không chạy bằng root.
USER node

CMD ["node", "src/index.js"]
