# ============================================
# 填埋场智慧监测系统 v4.0 — 多阶段构建 Docker 镜像
# ============================================
FROM node:22-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================
FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/app/data/chat.db

# 安装生产依赖（tsx 已在 dependencies 中，供 TypeScript 服务端直接运行）
COPY package*.json ./
RUN npm ci --omit=dev

# 复制前端构建产物（由 Express 同源托管）与后端源码
COPY --from=frontend-builder /app/dist ./dist
COPY server ./server
COPY knowledge-base ./knowledge-base
COPY OGS ./OGS
COPY .env.example .env

# 数据目录 + 非 root 用户
RUN mkdir -p /app/data \
 && addgroup -g 1001 -S app \
 && adduser -S app -u 1001 -G app \
 && chown -R app:app /app/data
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npx", "--no-install", "tsx", "server/index.ts"]
