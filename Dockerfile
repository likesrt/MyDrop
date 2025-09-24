# 最小化多阶段构建的 Dockerfile（MyDrop）
# - builder 阶段：安装构建依赖与完整依赖，构建前端静态资源
# - runner 阶段：仅包含生产依赖与运行所需文件，镜像更小更安全

FROM node:20-alpine AS builder
WORKDIR /app

# 为原生模块准备编译工具（例如 sqlite3 在 Alpine 上需要）
RUN apk add --no-cache python3 make g++

# 安装依赖（包含 dev 依赖以便构建）
COPY package.json ./
# 如存在锁文件则一并复制（npm 会忽略 yarn.lock，但其变更仍可触发缓存失效）
COPY yarn.lock* ./
RUN npm install --no-audit --no-fund

# 复制源码并构建前端静态资源
COPY . .
RUN npx tailwindcss -i frontend/styles/tailwind.css -o frontend/templates/static/tailwind.css --minify \
  && node scripts/copy-vendor.js \
  && npm prune --omit=dev \
  && npm cache clean --force


FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# 仅复制运行所需内容，减小镜像体积
COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/app.js ./app.js
COPY --from=builder --chown=node:node /app/backend ./backend
COPY --from=builder --chown=node:node /app/frontend ./frontend
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/.env.example ./.env.example

# 创建运行期可写目录（上传、日志、数据库）
# 运行期准备：安装 su-exec，用于入口脚本降权到 node 用户
RUN apk add --no-cache su-exec \
  && mkdir -p uploads logs database \
  && chown -R node:node uploads logs database

# 入口脚本：挂载卷会覆盖镜像内的权限，这里在容器启动时修正属主再降权
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 以 root 进入入口脚本，随后切换为 node 用户运行应用
USER root
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "app.js"]
