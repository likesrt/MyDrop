// 主应用逻辑


// 全局状态
window.MyDropState = {
  me: null,
  devices: [],
  messages: [],
  ws: null,
  config: { maxFiles: 10, fileSizeLimitMB: 5 },
  shownPwdPrompt: false,
  _dndBound: false,
  _pasteBound: false,
  _resizeBound: false,
  _copyBound: false,
  stickToBottom: true,
  _scrollTimer: null,
};

async function swapAppContent(html) {
  const app = window.MyDropUtils.qs('#app');
  if (!app) return;
  const next = document.createElement('div');
  next.style.opacity = '0';
  next.style.transition = 'opacity .16s ease';
  next.innerHTML = html;
  app.appendChild(next);
  // 渐入新内容
  requestAnimationFrame(() => { next.style.opacity = '1'; });
  // 渐入完成后，移除旧内容（除 next 自身）
  setTimeout(() => {
    try {
      const children = Array.from(app.children);
      for (const el of children) { if (el !== next) el.remove(); }
    } catch (_) {}
  }, 200);
}

async function render() {
  const app = window.MyDropUtils.qs('#app');
  if (!window.MyDropState.me) {
    const html = await window.MyDropAuth.renderLogin();
    await swapAppContent(html);
    window.MyDropAuth.bindLogin();
    return;
  }
  const html = await window.MyDropChat.renderChat();
  await swapAppContent(html);
  window.MyDropChat.bindChat();
  try { attachMediaLoadScroll(window.MyDropUtils.qs('#messageList') || document); } catch (_) {}
  // 渲染完成后，如有锚点则跳转并高亮；否则定位到底部
  requestAnimationFrame(() => {
    const did = highlightAnchorIfAny();
    if (!did) window.MyDropChat.jumpToBottom();
  });
}

function attachMediaLoadScroll() {
  try {
    const list = window.MyDropUtils.qs('#messageList');
    if (!list) return;
    let last = list.lastElementChild;
    const prev = last ? last.previousElementSibling : null;
    const targets = [last, prev].filter(Boolean);
    let media = [];
    for (const t of targets) media = media.concat(Array.from(t.querySelectorAll('img,video,audio')));
    for (const m of media) {
      const onLoaded = () => { const c = window.MyDropUtils.qs('#messages'); if (c && window.MyDropUtils.isNearBottom(c, 120)) setTimeout(window.MyDropChat.jumpToBottom, 30); };
      m.addEventListener('load', onLoaded, { once: true });
      m.addEventListener('loadedmetadata', onLoaded, { once: true });
      m.addEventListener('loadeddata', onLoaded, { once: true });
    }
  } catch (_) {}
}

(async function init() {
  // 先渲染骨架屏，避免白屏等待 API
  try { await window.MyDropTemplates.preloadTemplates(); } catch (_) {}
  try {
    const app = window.MyDropUtils.qs('#app');
    if (app) app.innerHTML = await window.MyDropTemplates.getTemplate('app-skeleton');
  } catch (_) {}
  const skeletonTs = Date.now();
  const ensureMinDelay = async (start, minMs) => {
    const now = Date.now();
    const rest = Math.max(0, minMs - (now - start));
    if (rest > 0) await new Promise(r => setTimeout(r, rest));
  };

  // 并发加载基础数据
  let basicsOk = false;
  try {
    await window.MyDropAPI.loadBasics();
    basicsOk = true;
  } catch (err) {
    basicsOk = false;
    // 首页静默处理：仅在超时时提示，其他错误（含未登录）不提示
    try {
      const isApiErr = err && err.name === 'ApiError';
      if (isApiErr && err.status === 408) {
        window.MyDropUI.toast('请求超时，请稍后重试', 'error');
      }
    } catch (_) {}
  }

  if (basicsOk) {
    try {
      const hash = (location.hash || '').trim();
      const needMore = /^#message-(\d+)$/.test(hash);
      await window.MyDropAPI.loadInitialMessages(needMore ? 1000 : 100);
    } catch (_) {}
    // 略微延迟，避免骨架与实内容“闪屏”
    await ensureMinDelay(skeletonTs, 100 + Math.floor(Math.random() * 60));
    await render();
    if (window.MyDropState.me) {
      window.MyDropWebSocket.openWS();
    }
  } else {
    // 未登录或 API 暂不可用，先渲染登录页
    await ensureMinDelay(skeletonTs, 100 + Math.floor(Math.random() * 60));
    await render();
  }

  // 监听 hash 变化，支持后续跳转与高亮
  window.addEventListener('hashchange', () => {
    highlightAnchorIfAny();
  });
})();

window.MyDropApp = {
  render,
  attachMediaLoadScroll
};

function highlightAnchorIfAny() {
  try {
    const hash = (location.hash || '').trim();
    const m = /^#message-(\d+)$/.exec(hash);
    if (!m) return false;
    const el = document.getElementById('message-' + m[1]);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('msg-highlight');
    setTimeout(() => { try { el.classList.remove('msg-highlight'); } catch (_) {} }, 2600);
    return true;
  } catch (_) { return false; }
}
