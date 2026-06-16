# MyDrop 项目 Bug 分析报告

## 1. 严重 Bug（Critical）

### 1.1 后端 - WebAuthn 实现缺陷

**文件**：`backend/api/auth.js`

**问题**：
- 行 467-477：WebAuthn 注册流程只接收前端传来的 `publicKeyPem`，完全信任客户端提取的公钥，**没有验证 attestation**
- 攻击者可以伪造任意公钥注册，绕过 WebAuthn 的硬件绑定保护

```javascript
// 当前实现（错误）
router.post('/webauthn/register/finish', requireAuth, async (req, res) => {
  const { flowId, credentialId, publicKeyPem, signCount, transports } = req.body || {};
  // 直接使用客户端传来的 publicKeyPem，没有验证 attestation
  await db.addWebAuthnCredential({ userId: flow.userId, credId, publicKeyPem: String(publicKeyPem), ... });
});
```

**修复**：必须在后端解析 `attestationObject`，验证签名和证书链，提取公钥。

---

### 1.2 后端 - 设备删除竞态条件

**文件**：`backend/api/admin.js`

**问题**：
- 行 24-58：删除设备时先查询文件列表，再删除磁盘文件，最后删除数据库记录
- 在删除磁盘文件期间，并发请求可能新增文件，导致孤立文件

```javascript
// 当前实现（错误）
if (removeMessages) {
  const files = await db.listFilesByDevice(deviceId); // 步骤1：查询
  for (const f of files) {
    try { await fs.promises.unlink(...); } catch (_) {} // 步骤2：删除磁盘文件
  }
  const msgs = await db.listMessagesByDevice(deviceId); // 步骤3：查询消息
  for (const m of msgs) { await db.deleteMessage(m.id); } // 步骤4：删除数据库
}
```

**修复**：使用事务，先删除数据库记录（触发 CASCADE），再删除磁盘文件。

---

### 1.3 后端 - 日志轮转未处理写入失败

**文件**：`backend/services/logger.js`

**问题**：
- 行 98-155：日志轮转过程中 `this.stream = null`，新日志进入 `queue`
- 若轮转失败（磁盘满、权限错误），队列会无限增长导致 OOM
- 缺少队列长度限制

**修复**：限制队列长度（如 1000 条），超出后丢弃旧日志并记录错误到 stderr。

---

### 1.4 前端 - WebSocket 消息处理未验证消息 ID 类型

**文件**：`frontend/js/websocket.js`

**问题**：
- 行 78：`String(m.id) === String(incoming.id)` 类型转换可能导致误匹配
- 若后端返回 `id: null` 或 `id: undefined`，`String(null)` === `String(undefined)` 为 false，但都会匹配到临时消息 `tmp-xxx`

```javascript
// 当前实现（错误）
if (!window.MyDropState.messages.some(m => String(m.id) === String(incoming.id))) {
  window.MyDropState.messages.push(incoming);
}
```

**修复**：严格验证 `incoming.id` 是数字或字符串，拒绝 null/undefined。

---

### 1.5 前端 - Markdown 渲染 XSS 风险

**文件**：`frontend/js/render.js`

**问题**：
- 行 53：手动替换 `<a>` 标签添加属性，**在 DOMPurify 净化之前**操作 HTML 字符串
- 若 `md.render()` 输出包含恶意构造的 `<a>` 标签（如 `<a href="javascript:alert(1)">`），替换后可能绕过净化

```javascript
// 当前实现（错误）
raw = raw.replace(/<a\s+/g, '<a target="_blank" rel="noreferrer noopener" ');
const clean = window.DOMPurify.sanitize(raw, { ALLOWED_ATTR: [...] });
```

**修复**：在 DOMPurify 净化**之后**，通过 DOM API 安全地添加属性。

---

## 2. 重要 Bug（Major）

### 2.1 后端 - JWT 过期时间校验缺失时区处理

**文件**：`backend/services/auth.js`

**问题**：
- 行 44：`Math.floor(Date.now() / 1000) > payload.exp` 使用本地时间
- 若服务器时区设置错误或时钟漂移，会导致 token 提前或延迟过期

**修复**：使用 UTC 时间戳，或在签发时记录服务器时区。

---

### 2.2 后端 - TOTP 验证窗口过大

**文件**：`backend/services/auth.js`

**问题**：
- 行 129-138：`window = 1` 意味着允许前后各 30 秒的时间窗口
- 总共 90 秒的有效期，降低了 TOTP 的安全性

**修复**：默认 `window = 0`（仅验证当前时间步），允许用户在设置中启用 `window = 1`（时钟同步问题）。

---

### 2.3 后端 - 管理员设置缺少输入范围验证

**文件**：`backend/api/admin.js`

**问题**：
- 行 118-141：接收用户输入的 `cleanupIntervalMinutes`、`jwtExpiresDays` 等，只做 `parseInt` 转换
- 没有上限检查，用户可以设置 `jwtExpiresDays: 999999`（273 年），或 `fileSizeLimitMB: 999999`（约 1TB）

**修复**：添加合理范围限制（如 JWT 有效期 1-365 天，文件大小 1-1000 MB）。

---

### 2.4 前端 - API 超时后未中止请求

**文件**：`frontend/js/api.js`

**问题**：
- 行 15：`controller.abort()` 后，`fetch` 会抛出 `AbortError`
- 但 `clearTimeout(id)` 在 `finally` 中执行，timeout timer 已经清除
- 实际上这个实现是正确的，但注释说"超时"的用户体验提示不够清晰

**修复建议**：在 catch 块中区分 `AbortError` 和网络错误，给出更准确的提示。

---

### 2.5 前端 - 文件上传进度条未更新

**文件**：`frontend/js/chat.js`

**问题**：
- 行 117-121：渲染上传进度条，但 `m._progress` 的更新逻辑缺失
- 查找整个前端代码，没有地方设置 `_progress` 字段

**修复**：在发送消息时监听 `XMLHttpRequest.upload.onprogress`，更新 `_progress` 并重新渲染消息。

---

### 2.6 前端 - WebSocket 重连指数退避上限过低

**文件**：`frontend/js/websocket.js`

**问题**：
- 行 17：`st.retry = Math.min(st.retry + 1, 10)` 限制重试次数为 10
- 行 16：最大延迟 `20s`
- 若服务器长时间不可用（如维护 1 小时），客户端会每 20 秒重连一次，共 180 次请求

**修复**：增加最大延迟到 60s，或增加重试次数上限到 20。

---

### 2.7 前端 - QR 登录轮询未处理网络错误

**文件**：`frontend/js/auth.js`

**问题**：
- 行 159-186：QR 登录轮询函数 `poll()`
- 行 185：`catch (_) { /* ignore transient */ }` 静默吞掉所有错误
- 若网络断开，用户看到二维码一直不刷新，没有任何提示

**修复**：连续失败 3 次后，在二维码下方显示"网络连接失败，请检查网络"提示。

---

## 3. 次要 Bug（Minor）

### 3.1 后端 - Base32 解码未处理无效字符

**文件**：`backend/services/auth.js`

**问题**：
- 行 93-95：`if (idx === -1) continue;` 跳过无效字符
- 但没有检查字符串是否全部由无效字符组成，可能返回空 Buffer

**修复**：在解码前验证字符串格式，拒绝包含非法字符的输入。

---

### 3.2 后端 - 日志下载缺少文件大小限制

**文件**：`backend/api/admin.js`

**问题**：
- 行 144-157：直接 `fs.createReadStream(abs).pipe(res)`
- 若日志文件几个 GB，会占用大量内存和带宽

**修复**：检查文件大小，超过 100MB 时提示用户分片下载或使用 `tail -n` 查看最新日志。

---

### 3.3 前端 - 设备 ID 生成未检查冲突

**文件**：`frontend/js/utils.js`（未在审查中读取，但从 `auth.js` 中看到使用）

**问题**：
- `window.MyDropUtils.getDeviceId()` 使用 `localStorage` 存储设备 ID
- 若用户清除浏览器数据后重新生成，可能与旧设备 ID 冲突（虽然概率极低）

**修复**：在注册设备时，后端检查设备 ID 是否已存在，若冲突则返回错误让客户端重新生成。

---

### 3.4 前端 - 文件拖拽上传未限制文件数量

**文件**：`frontend/js/chat.js`

**问题**：
- 行 43-60：`addFilesToInput` 函数添加文件到 input
- 只检查文件大小，未检查总文件数量是否超过 `maxFiles`

**修复**：在添加前检查 `existing.length + incoming.length <= maxFiles`，超出时提示用户。

---

### 3.5 前端 - Toast 通知栈未限制数量

**文件**：`frontend/js/ui.js`

**问题**：
- 行 14-95：自定义 Toast 通知
- 若短时间内调用 100 次 `toast()`，会创建 100 个 DOM 元素堆叠在顶部
- 没有最大数量限制

**修复**：限制同时显示的 toast 数量为 5 个，超出时移除最旧的。

---

### 3.6 前端 - Markdown 渲染未处理循环嵌套

**文件**：`frontend/js/render.js`

**问题**：
- 行 47-60：`renderMarkdownWithCards` 渲染 Markdown
- 若 `marked` 或 `markdownit` 遇到恶意构造的深度嵌套（如 1000 层引用），可能导致栈溢出

**修复**：设置 Markdown 渲染的最大嵌套深度（marked 和 markdownit 都有配置选项）。

---

## 4. 设计缺陷（Design Issues）

### 4.1 前端 - API 错误处理不一致

**文件**：`frontend/js/api.js` + 各调用方

**问题**：
- `api()` 函数抛出 `ApiError`，但不同场景的错误处理不一致
- 有的地方使用 `window.MyDropUI.formatError(err, '提示')`
- 有的地方直接 `alert(err.message)`
- 有的地方静默吞掉错误

**修复**：统一错误处理策略，在 `api()` 函数中添加全局错误处理钩子。

---

### 4.2 前端 - WebSocket 断线后消息丢失

**文件**：`frontend/js/websocket.js`

**问题**：
- WebSocket 断线期间，用户发送的消息会通过 HTTP API 成功
- 但其他在线用户不会收到消息（因为 WebSocket 断开）
- 重连后，没有拉取断线期间的消息

**修复**：在 WebSocket 重连成功后，调用 `/messages?sinceId=xxx` 拉取增量消息。

---

### 4.3 后端 - 清理任务未处理并发执行

**文件**：`app.js`（启动时设置的清理定时器，未在审查中读取完整）

**问题**：
- 若清理任务执行时间超过定时器间隔（如清理 10GB 文件需要 20 分钟）
- 下一个定时器触发时，会启动第二个清理任务，导致并发删除同一批文件

**修复**：在清理任务开始时设置锁标志，执行中时跳过后续触发。

---

### 4.4 前端 - 消息列表未实现虚拟滚动

**文件**：`frontend/js/chat.js`

**问题**：
- 行 7-10：渲染所有消息 `Promise.all(window.MyDropState.messages.map(...))`
- 若消息列表有 10000 条，会创建 10000 个 DOM 节点，导致页面卡顿

**修复**：实现虚拟滚动，只渲染可见区域的消息（如 react-window 或 IntersectionObserver）。

---

## 5. 性能问题（Performance）

### 5.1 前端 - 消息渲染重复调用 Markdown 解析

**文件**：`frontend/js/render.js`

**问题**：
- 行 47-60：每次渲染消息时都调用 `md.render()` 或 `marked.parse()`
- 同一消息在 WebSocket 推送、滚动、重新渲染时会多次解析

**修复**：缓存 Markdown 渲染结果（如 `m._renderedHTML`）。

---

### 5.2 后端 - 文件列表查询未分页

**文件**：`backend/services/db.js`（listAllFiles 函数，未完全审查）

**问题**：
- 管理员清空消息时，`listAllFiles()` 一次性查询所有文件
- 若有 100 万个文件，会占用大量内存

**修复**：使用 LIMIT/OFFSET 分页查询，分批删除文件。

---

## 总结

- **严重 Bug**: 5 个（WebAuthn 安全漏洞、竞态条件、内存泄漏、XSS 风险）
- **重要 Bug**: 7 个（时区问题、输入验证、错误处理缺失）
- **次要 Bug**: 6 个（边界条件、用户体验）
- **设计缺陷**: 4 个（架构层面的改进）
- **性能问题**: 2 个（优化机会）

**总计**: 24 个问题

建议优先修复严重 Bug，尤其是 **1.1 WebAuthn 实现缺陷**（安全漏洞）和 **1.5 Markdown XSS 风险**。
