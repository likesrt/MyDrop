# MyDrop
> EDGE浏览器得Drop功能使用十分方便，靠驻侧边栏，聊天对话框，可以多端同步文字、图片和文件，储存依托得是账户自带的OneDrive,所以国内访问速度可想而知，于是有了这个项目。

> 简洁的本地/内网临时传输与消息留存工具。后端基于 Node.js + Express，提供 HTTP API 与 WebSocket（/ws），前端为简易的静态页面与模块化 JS。

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
# 构建静态资源
yarn build

# 启动
yarn start
```

- 默认监听 `PORT=3000`，`HOST=0.0.0.0`
- 首次启动会自动创建 `database/`、`uploads/`、`logs/` 目录（如不存在）

## Docker/Compose 部署（推荐）

推荐直接使用预构建镜像（GHCR，多架构支持 amd64/arm64），无需克隆仓库：

```bash
# 1) 创建部署目录并进入
mkdir mydrop && cd mydrop

# 2) 下载环境变量与 Compose 模板
wget -O .env https://raw.githubusercontent.com/likesrt/MyDrop/refs/heads/main/.env.example
wget -O docker-compose.yml https://raw.githubusercontent.com/likesrt/MyDrop/refs/heads/main/docker-compose.example.yml


# 3) 强烈建议编辑 .env，设置一个强随机的 JWT_SECRET

# 4) 可选：创建持久化目录（也可交由 Docker 自动创建）
mkdir -p uploads logs database

# 5) 启动（默认拉取 main 稳定镜像：latest）
docker compose up -d

# 6) 常用操作
docker compose pull        # 拉取更新
docker compose up -d       # 应用更新并后台运行
docker compose logs -f     # 查看日志
docker compose down        # 停止容器
```

- 数据与日志持久化（绑定挂载）
  - `./database:/app/database`（SQLite与 WAL/SHM）
  - `./uploads:/app/uploads`
  - `./logs:/app/logs`
- 端口映射：仅一个变量 `PORT`。
  - 在 `.env` 修改 `PORT=8080` → 发布为 `8080:8080`。
  - 仅本机访问：在 `docker-compose.yml` 注释处启用 `127.0.0.1:${PORT:-3000}:${PORT:-3000}`。


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
docker-compose.example.yml  
```

## 常用脚本

- 重置管理员账号（用户名/密码：`admin/admin`，并使现有 Token，totp，webauth失效）：
  ```bash
  yarn reset:admin
  ```

## 环境变量

- `PORT`：同时用于应用内部监听与 docker-compose 端口映射（默认 3000）
- `JWT_SECRET`：JWT 签名密钥（务必强设置）
- `JWT_EXPIRES_DAYS`：JWT 过期天数（默认 7）
- `TEMP_LOGIN_TTL_MINUTES`：未勾选“记住我”时的临时登录有效期（分钟，默认 10；会话 Cookie，关闭浏览器即清除）
- `MAX_FILES`：全局文件数量上限（默认 10）
- `FILE_SIZE_LIMIT_MB`：单文件大小上限 MB（默认 5）
- `LOG_LEVEL`：日志级别 `error|warn|info|debug`（默认 info）
- `HEADER_AUTO_HIDE`：移动端自动隐藏顶部设置栏（`0/1/true/false`）
- 自动清理相关：`AUTO_CLEANUP_ENABLED`、`CLEANUP_INTERVAL_MINUTES`、`MESSAGE_TTL_DAYS`、`DEVICE_INACTIVE_DAYS`
- 缓存版本：`ASSET_VERSION`

## 更新与升级

- Docker 部署（推荐）：
  - 拉取更新：`git pull`
  - 同步配置：
    - 对比 `docker-compose.example.yml` 与本地 `docker-compose.yml`，必要时合并或执行 `cp docker-compose.example.yml docker-compose.yml` 并恢复你的自定义端口等改动；
    - 查看 `.env.example` 是否新增变量或说明，将需要的项补充到你的 `.env`（如 `PORT`、`SQLITE_JOURNAL_MODE`）。
  - 拉取并启动：`docker compose pull && docker compose up -d`
  - 验证：`docker compose logs -f` 观察启动日志；访问 `http://<主机>:<PORT>`。

- 兼容性提示：
  - 若运行环境不支持 SQLite WAL，可在 `.env` 中设置 `SQLITE_JOURNAL_MODE=DELETE`。

## 安全与部署建议

- 强设置 `JWT_SECRET`，并妥善保管；
- 若暴露公网，建议置于反向代理（Nginx/Caddy）之后，启用 TLS 与限流。
- 定期备份 `database/` `uploads/` 目录；如使用 Compose，直接备份宿主机的 `./database`  `uploads/` 即可。

## 许可

MIT
