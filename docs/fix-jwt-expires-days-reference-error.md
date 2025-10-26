# 修复 jwtExpiresDays ReferenceError 错误 - 变更方案文档

## 背景说明

本文档主要关注 JWT 配置的语义统一与边界优化，确保登录体验的一致性和安全性。

## 语义约定（方案 A）
- **jwtExpiresDays = 0** → 会话登录（session cookie），不设置 maxAge
- **jwtExpiresDays > 0** → 持久登录，maxAge = days × 24 × 60 × 60 × 1000
- **上限**：365 天（安全考虑，避免过长的持久 cookie）

## 逐文件变更点

### 1. 后端配置服务
**文件**：`backend/services/settings.js`

#### 变更点
- 对 `jwtExpiresDays` 增加上限 365 的硬性钳制（clamp），保持下限 0
- `load()` 解析阶段：将现有 `Math.max(0, parseInt(...))` 改为 clamp 至 [0, 365]
  ```javascript
  vals.jwtExpiresDays = Math.min(365, Math.max(0, parseInt(map.get('jwtExpiresDays'), 10) || DEFAULTS.jwtExpiresDays));
  ```
- `normalize()` 阶段：同样对 `jwtExpiresDays` 做 [0, 365] 钳制
  ```javascript
  jwtExpiresDays: 'jwtExpiresDays' in partial ? num(partial.jwtExpiresDays, curr.jwtExpiresDays, { min: 0, max: 365 }) : curr.jwtExpiresDays,
  ```
- `tempLoginTtlMinutes` 保持 min>=1，可选上限（如 <=1440 分钟）

#### 语义确认
- `DEFAULTS` 保持不变（7 天/10 分钟）以与当前行为一致
- 确保所有配置读取路径都经过边界校验

### 2. 后端认证路由（可选增强）
**文件**：`backend/api/auth.js`

#### 变更点（可选，保持最小变更原则）
- 在四处签发令牌成功日志中增加字段：`remember`、`expiresSec`、`cookieMaxAge`
  - 密码登录 success：行 119
  - TOTP 登录 success：行 151
  - QR 消费 success：行 416
  - WebAuthn 登录 success：行 578

#### 代码收敛（可选）
抽取本文件内小函数 `computeTokenExpiry(cfg, remember)` 返回 `{ expiresSec, cookieMaxAge }`：
```javascript
function computeTokenExpiry(cfg, remember) {
  const days = Number.isFinite(cfg.jwtExpiresDays) ? cfg.jwtExpiresDays : 7;
  const tmpSec = Math.max(60, (parseInt(cfg.tempLoginTtlMinutes, 10) || 10) * 60);
  const expiresSec = remember ? (days > 0 ? days * 24 * 60 * 60 : null) : tmpSec;
  const cookieMaxAge = (remember && days > 0) ? (expiresSec * 1000) : null;
  return { expiresSec, cookieMaxAge };
}
```

### 3. 管理端后端接口
**文件**：`backend/api/admin.js`

#### 变更点
- `/admin/status` 输出中当前已返回 `jwtExpiresDays` 字段（行 78）
- 可选增强：
  - 当 `jwtExpiresDays=0` 时，添加 `jwtMode: 'session'` 字段
  - 理论超界时返回 `warnings` 提示（有 clamp 后不太可能发生）

### 4. 管理端前端校验与提示
**文件**：`frontend/js/admin.js`

#### 变更点
- 在系统设置提交校验处（行 418 附近）加入范围校验：
  ```javascript
  if (payload.jwtExpiresDays < 0 || payload.jwtExpiresDays > 365) {
    return toast('记住我有效期需在 0~365 天之间', 'warn');
  }
  ```
- 在设置面板渲染时，增加 UI 提示文案：
  - `jwtExpiresDays=0` → 显示"会话登录（关闭持久登录）"
  - `>0` → 显示"长效登录（持久 Cookie），上限 365 天"

#### 模板文件（如需）
- 如需在模板上增加提示，涉及 `frontend/templates/admin.html` 相应 input 附近

## PR 拆分建议

### PR-1 配置与语义加固（后端）
**改动文件**：仅 `backend/services/settings.js`

**内容**：
- 对 `jwtExpiresDays` 加 clamp 至 [0, 365]
- 可选：对 `tempLoginTtlMinutes` 加上限
- 维持 `DEFAULTS` 与现有 `getAllSync` 行为

**风险与收益**：
- 低风险；统一语义，消除异常值
- 避免持久 cookie 过长带来的安全风险

**验收项**：
- 设置 `jwtExpiresDays=0` 后登录 → Set-Cookie 为会话 cookie（不含 maxAge）
- 设置 `jwtExpiresDays=365` 后登录 → Set-Cookie 的 maxAge≈365 天
- 传入负数或超 365 值 → 被钳制至边界

### PR-2 前端管理页校验与提示（前端）
**改动文件**：仅 `frontend/js/admin.js`（如需模板提示，附带 `frontend/templates/admin.html`）

**内容**：
- 在提交前对 `jwtExpiresDays` 进行 [0, 365] 校验
- 在设置界面显示语义提示（0=会话登录，>0=持久登录）

**风险与收益**：
- 低风险；防止用户误设，增强可理解性

**验收项**：
- 输入 -1、366 → 前端阻止保存并提示
- 输入 0、365 → 正常保存，界面提示正确

### PR-3（可选）认证路由日志增强与重复代码收敛（后端）
**改动文件**：`backend/api/auth.js`

**内容**：
- 成功日志新增 `remember`/`expiresSec`/`cookieMaxAge` 字段
- 抽取 `computeTokenExpiry()` 以减少重复

**风险与收益**：
- 极低风险；提升可观测性与可维护性

**验收项**：
- 四处登录成功日志均包含期望字段
- 功能无行为变化（回归：密码、TOTP、QR、WebAuthn）


## 附录：相关文件位置

- 配置服务：`backend/services/settings.js:58-59`（load）、`backend/services/settings.js:93`（normalize）
- 认证路由：`backend/api/auth.js:110`（密码登录）、`backend/api/auth.js:144`（TOTP）、`backend/api/auth.js:406`（QR）、`backend/api/auth.js:571`（WebAuthn）
- 管理接口：`backend/api/admin.js:78`（status）
- 前端校验：`frontend/js/admin.js:418`（提交校验）