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
  // 在页面首次渲染后，给一个短暂时间窗口强制“跟随到底部”，避免图片等媒体异步加载导致跳不到底部
  _autoScrollUntil: 0,
};

async function replaceWithFade(html) {
  const app = window.MyDropUtils.qs('#app');
  if (!app) return;
  try { app.style.transition = 'opacity .16s ease'; } catch (_) {}
  try { app.style.opacity = '0'; } catch (_) {}
  // 下一帧替换内容，再下一帧淡入，避免布局叠加导致的跳动
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      app.innerHTML = html;
      requestAnimationFrame(() => {
        try { app.style.opacity = '1'; } catch (_) {}
        // 再下一帧确保 DOM 可查询
        requestAnimationFrame(resolve);
      });
    });
  });
}

async function render() {
  const app = window.MyDropUtils.qs('#app');
  if (!window.MyDropState.me) {
    const html = await window.MyDropAuth.renderLogin();
    await replaceWithFade(html);
    window.MyDropAuth.bindLogin();
    return;
  }
  const html = await window.MyDropChat.renderChat();
  await replaceWithFade(html);
  window.MyDropChat.bindChat();
  // 在没有锚点跳转时，短时间内强制跟随到底部
  try { window.MyDropState._autoScrollUntil = Date.now() + 1500; } catch (_) {}
  try { attachMediaLoadScroll(window.MyDropUtils.qs('#messageList') || document); } catch (_) {}
  // 渲染完成后，如有锚点则跳转并高亮；否则定位到底部
  requestAnimationFrame(() => {
    const did = highlightAnchorIfAny();
    if (!did) window.MyDropChat.jumpToBottom();
  });
}

function attachMediaLoadScroll() {
  try {
    const container = window.MyDropUtils.qs('#messages');
    if (!container) return;
    const media = Array.from(container.querySelectorAll('img,video,audio'));
    const onLoaded = () => {
      try {
        const c = window.MyDropUtils.qs('#messages');
        const hasAnchor = /^#message-(\d+)$/.test((location.hash || '').trim());
        const forceAuto = Date.now() < (window.MyDropState._autoScrollUntil || 0);
        if (c && (forceAuto && !hasAnchor || window.MyDropUtils.isNearBottom(c, 160))) {
          setTimeout(window.MyDropChat.jumpToBottom, 30);
        }
      } catch (_) {}
    };
    for (const m of media) {
      const tag = (m.tagName || '').toLowerCase();
      if (tag === 'img') {
        if (m.complete) continue; // 已加载无需监听
        m.addEventListener('load', onLoaded, { once: true });
      } else {
        m.addEventListener('loadedmetadata', onLoaded, { once: true });
        m.addEventListener('loadeddata', onLoaded, { once: true });
      }
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
