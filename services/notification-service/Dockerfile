# Build context là THƯ MỤC GỐC của repo (compose.yaml: context: .) để copy được proto/ dùng chung.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
# Code tìm file .proto theo biến này; ngoài Docker thì mặc định là proto/ ở gốc repo.
ENV PROTO_DIR=/app/proto

# Copy package.json và lockfile trước rồi mới cài: đổi code không làm mất cache của bước npm ci.
COPY services/notification-service/package.json services/notification-service/package-lock.json ./
RUN npm ci --omit=dev

COPY services/notification-service/src ./src
COPY proto ./proto

# Không chạy bằng root: lỗ hổng trong service không chiếm được quyền root của container.
USER node

CMD ["node", "src/index.js"]
