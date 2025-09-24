MyDrop v1.2.0

本次版本重点：系统设置（运行时生效）、设备 IP 记录、聊天体验与夜间模式优化、缓存与清理策略改进、安全加固，以及移动端交互细节修复。

变更明细
- 系统设置（管理页 → 系统设置）
  - 将以下配置从环境变量迁移至数据库统一管理，并可在运行时生效：
    - 自动清理：清理间隔（支持“自动”与手动；手动时≥30 分钟）、消息保留天数、未活跃设备清理天数
    - 上传限制：单个文件大小上限（MB）、全局文件数量上限
    - 登录会话：JWT 过期天数（记住我）、临时登录有效期（分钟）
    - 前端行为：移动端顶部栏自动隐藏（HEADER_AUTO_HIDE）
    - 日志级别（LOG_LEVEL）：运行中可调整，立即生效
  - 管理页样式与说明优化：分组标题带主题色下划线、标签与说明分色、输入/下拉统一深浅主题适配、下拉菜单美化

- 设备管理
  - 新增设备 IP 记录（created_ip/last_ip），适配多级代理/CDN/内网穿透：优先解析 cf-connecting-ip/true-client-ip/x-real-ip/x-forwarded-for/forwarded 等头，过滤私网段，尽量获取真实公网 IP

- 聊天体验改进
  - 附件选择后支持单个移除，选中附件“标签化”展示更醒目
  - 图片消息支持灯箱预览
  - 输入区粘底（sticky bottom）并动态为消息区添加底部间距，避免长消息遮挡输入框
  - 移动端发送按钮焦点行为优化：
    - 若输入框未聚焦，点“发送”不再自动唤起键盘（仅发送附件更优雅）
    - 若输入框已聚焦且为文本消息，发送后保持焦点；纯附件发送后不强制聚焦

- 骨架屏与夜间模式
  - 骨架屏全面适配暗色主题（使用主题变量），避免刺眼的亮色块
  - 页面切换采用容器淡入与最小展示时间（100–160ms），显著降低闪屏感

- PWA 与缓存
  - 清除静态资源缓存时不再向地址栏追加随机查询参数，使用 Service Worker 内部“BUST_FETCH”机制强制拉取最新资源

- 清理与统计
  - 清理间隔默认≥30 分钟（自动模式为 720 分钟）
  - 手动删除消息会清理其关联文件，并计入“累计清理”统计

- 安全加固
  - 若检测到 JWT_SECRET 仍为示例默认值，启动时自动生成高强度随机密钥并写入 .env（权限 0600），同时在当前进程生效（多实例部署请显式统一配置）

兼容性说明（可能的改动影响）
- 若之前通过环境变量配置 AUTO_CLEANUP_ENABLED/CLEANUP_INTERVAL_MINUTES/MESSAGE_TTL_DAYS/JWT_EXPIRES_DAYS/TEMP_LOGIN_TTL_MINUTES/HEADER_AUTO_HIDE/LOG_LEVEL/FILE_SIZE_LIMIT_MB/MAX_FILES 等，请改为在“系统设置”中调整。已更新 .env.example 以反映迁移。
- 多实例部署应统一配置 JWT_SECRET（不要依赖自动生成）以避免跨实例令牌失效。

升级建议
- 升级后首次进入“系统设置”，确认各项默认值是否符合预期（尤其是清理间隔、消息/设备保留策略与上传限制）。
- 生产环境务必显式设置 JWT_SECRET，并检查日志输出与权限配置。

建议从 .env 文件移除的环境变量（交由系统设置统一管理）
- AUTO_CLEANUP_ENABLED
- CLEANUP_INTERVAL_MINUTES
- MESSAGE_TTL_DAYS
- DEVICE_INACTIVE_DAYS
- JWT_EXPIRES_DAYS
- TEMP_LOGIN_TTL_MINUTES
- HEADER_AUTO_HIDE
- LOG_LEVEL
- FILE_SIZE_LIMIT_MB
- MAX_FILES

保留（按需）
- PORT, HOST
- LOG_FILE, LOG_MAX_SIZE_MB, LOG_ROTATE_KEEP
- SQLITE_JOURNAL_MODE
- ASSET_VERSION（可选）

