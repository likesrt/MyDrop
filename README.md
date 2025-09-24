# MyDrop

简洁的本地/内网临时传输与消息留存工具。后端基于 Node.js + Express，提供 HTTP API 与 WebSocket（/ws），前端为简易的静态页面与模块化 JS。

- 运行时：Node.js 18+（CommonJS）
- 数据库：SQLite（单文件，默认位于项目根目录的 `database/sqlite.db`）
- 静态资源：Tailwind CSS（构建产物）和本地 vendor（Marked、DOMPurify、SweetAlert2）

## 快速开始（本地）

1) 安装依赖

```bash
yarn install
```

2) 准备环境变量并启动

```bash
cp .env.example .env
# 强烈建议修改 .env 中的 JWT_SECRET！
# 构建 CSS 与 vendor
yarn build

# 启动
yarn start
```

- 默认监听 `PORT=3000`，`HOST=0.0.0.0`
- 首次启动会自动创建 `database/`、`uploads/`、`logs/` 目录（如不存在）

## Docker/Compose 部署

推荐使用 Docker 部署，步骤简单、镜像体积小且默认带持久化挂载。

```bash
# 1) 克隆仓库并进入目录（请替换为你的仓库地址与目录名）
git clone <你的仓库地址>
cd <目录名>

# 2)（可选）准备环境变量配置
cp .env.example .env
# 强烈建议修改 .env 中的 JWT_SECRET

# 3) 首次构建并后台运行
docker compose up -d --build

# 4) 常用操作
docker compose logs -f    # 查看日志
docker compose down       # 停止容器
```

- 数据与日志持久化（绑定挂载）
  - `./database:/app/database`（SQLite 主库与 WAL/SHM）
  - `./uploads:/app/uploads`
  - `./logs:/app/logs`
- 外部端口：`${PORT:-3000}:3000`（可在 `.env` 中调整 `PORT`）
- Compose 会将应用在容器内绑定到 `0.0.0.0`，便于宿主访问。

## 目录结构

```
backend/            # 服务端 API 与服务层
  api/              # 路由：auth、messages、files、admin、config
  services/         # db.js、auth.js、logger.js
frontend/           # 前端模板与 JS 模块
  templates/        # 页面与静态构建产物（/static/*）
  js/               # UI、API、WS、Chat 等模块
scripts/            # 构建/维护脚本（copy-vendor.js、reset-admin.js）
database/           # SQLite 数据（持久化，已 gitignore）
uploads/            # 上传文件
logs/               # 日志文件
app.js              # 启动 Express + WebSocket 与静态资源
Dockerfile          
docker-compose.yml  
```

## 常用脚本

- 重置管理员账号（用户名/密码：`admin/admin`，并使现有 Token，totp，webauth失效）：
  ```bash
  yarn reset:admin
  ```

## 环境变量（节选）

- `PORT`：服务端口（默认 3000）
- `HOST`：监听地址（默认 0.0.0.0）
- `JWT_SECRET`：JWT 签名密钥（务必强设置）
- `JWT_EXPIRES_DAYS`：JWT 过期天数（默认 7）
- `MAX_FILES`：全局文件数量上限（默认 10）
- `FILE_SIZE_LIMIT_MB`：单文件大小上限 MB（默认 5）
- `LOG_LEVEL`：日志级别 `error|warn|info|debug`（默认 info）
- `HEADER_AUTO_HIDE`：移动端自动隐藏顶部设置栏（`0/1/true/false`）
- 自动清理相关：`AUTO_CLEANUP_ENABLED`、`CLEANUP_INTERVAL_MINUTES`、`MESSAGE_TTL_DAYS`、`DEVICE_INACTIVE_DAYS`
- 缓存版本：`ASSET_VERSION`

## 安全与部署建议

- 强设置 `JWT_SECRET`，并妥善保管；避免将 `.env` 提交到仓库。
- 若暴露公网，建议置于反向代理（Nginx/Caddy）之后，启用 TLS 与限流。
- 定期备份 `database/` 目录；如使用 Compose，直接备份宿主机的 `./database` 即可。

## 许可

本项目采用 MIT License 授权，详见根目录 `LICENSE` 文件。
