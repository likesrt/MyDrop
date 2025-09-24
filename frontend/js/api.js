// API 调用相关
class ApiError extends Error {
  constructor(message, status, url, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.data = data || null;
  }
}

async function api(path, opts = {}) {
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 15000;
  const controller = new AbortController();
  const id = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
  const { timeoutMs: _omit, signal: _sig, ...rest } = opts || {};
  try {
    const res = await fetch(path, { ...rest, signal: controller.signal });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) {}
      // 默认消息映射，登录相关 401 透传后端文案，其余 401 统一为“未登录”
      let msg;
      if (res.status === 401) {
        const p = String(path || '');
        const isLoginFlow = p === '/login' || p === '/login/totp' || p.startsWith('/webauthn/login');
        msg = isLoginFlow ? (body && body.error ? String(body.error) : '登录失败') : '未登录';
      } else if (res.status === 403) {
        msg = '无权限';
      } else if (res.status === 404) {
        msg = '未找到';
      } else {
        msg = res.status >= 500 ? '服务器错误' : '请求失败';
      }
      // 非 401 场景优先采用后端 error（例如业务校验错误）
      if (res.status !== 401 && body && body.error) msg = String(body.error);
      if (res.status === 401 && location.pathname !== '/') {
        try { await fetch('/logout', { method: 'POST' }); } catch (_) {}
        location.replace('/');
      }
      throw new ApiError(msg, res.status, path, body);
    }
    return res.json();
  } catch (err) {
    if (err && (err.name === 'AbortError' || /aborted|timeout/i.test(String(err.message||'')))) {
      throw new ApiError('请求超时', 408, path);
    }
    throw new ApiError('请求失败', 0, path);
  } finally {
    clearTimeout(id);
  }
}

async function loadBasics() {
  try {
    const cfg = await api('/config');
    window.MyDropState.config = cfg;
  } catch (_) { /* 公共配置失败不影响登录渲染 */ }

  try {
    const me = await api('/me');
    window.MyDropState.me = me;
  } catch (err) {
    if (err && err.name === 'ApiError' && err.status === 401) {
      // 未登录：静默处理用于首页渲染登录页
      window.MyDropState.me = null;
      window.MyDropState.devices = [];
      return;
    }
    throw err;
  }

  try {
    const devices = await api('/devices');
    window.MyDropState.devices = devices.devices || [];
  } catch (_) { window.MyDropState.devices = []; }
  if (window.MyDropState.me?.user?.needsPasswordChange && !window.MyDropState.shownPwdPrompt) {
    window.MyDropState.shownPwdPrompt = true;
    window.MyDropUI.toast('您仍在使用默认密码，请前往"设置"修改。', 'warn');
  }
}

async function loadInitialMessages(limit = 100) {
  const result = await api(`/messages?limit=${encodeURIComponent(limit)}`);
  window.MyDropState.messages = result.messages || [];
}

window.MyDropAPI = {
  api,
  loadBasics,
  loadInitialMessages,
  ApiError
};
