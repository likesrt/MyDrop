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
      let msg = res.status === 401 ? '未登录' : '请求失败';
      let body = null;
      try { body = await res.json(); if (body && body.error) msg = body.error; } catch (_) {}
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
  const cfg = await api('/config');
  window.MyDropState.config = cfg;
  const me = await api('/me');
  window.MyDropState.me = me;
  const devices = await api('/devices');
  window.MyDropState.devices = devices.devices || [];
  if (me?.user?.needsPasswordChange && !window.MyDropState.shownPwdPrompt) {
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
