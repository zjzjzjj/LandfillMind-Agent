# ============================================
# LandfillMind — 多阶段构建 Docker 镜像
#   阶段 1：前端构建（纯 npm，alpine 足够快）
#   阶段 2：运行时 = Node + 内置三维内核的 Python 环境
#           （Debian slim 而非 alpine：numpy/scipy/matplotlib 在 musl 上
#             没有可靠 wheel，装不上时表现是内核报 ModuleNotFound，很难查）
# ============================================
FROM node:22-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================
FROM node:22-bookworm-slim AS production

WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/app/data/chat.db

# 内核图件要画中文：Noto CJK 字体必须装（landfill3d/style.py 的字体候选里有
# "Noto Sans CJK SC"，装了就命中，没装就退成方框 —— 图不报错但不可读）。
# python3-venv：用 /opt/venv 装科学栈，绕开 Debian 的 externally-managed 限制。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 生产依赖（tsx 已在 dependencies 中，供 TypeScript 服务端直接运行）
COPY package*.json ./
RUN npm ci --omit=dev

# 内置三维内核 + Python 依赖
COPY kernel3d ./kernel3d
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r kernel3d/requirements.txt

# 前端构建产物（由 Express 同源托管）与后端源码
COPY --from=frontend-builder /app/dist ./dist
COPY server ./server
COPY knowledge-base ./knowledge-base
COPY OGS ./OGS
COPY .env.example .env

# matplotlib 的字体缓存/配置目录要可写，且不能落在用户 HOME 之外读不到的地方
ENV KERNEL3D_PY=/opt/venv/bin/python \
    MPLCONFIGDIR=/tmp/matplotlib

# 数据目录 + 非 root 用户
RUN mkdir -p /app/data /tmp/matplotlib \
 && groupadd -r -g 1001 app \
 && useradd -r -u 1001 -g app -d /app -s /usr/sbin/nologin app \
 && chown -R app:app /app/data /tmp/matplotlib
USER app

EXPOSE 3000

# slim 镜像没有 wget/curl，用 Node 自带的 fetch 做健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "--no-install", "tsx", "server/index.ts"]
