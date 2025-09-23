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

async function render() {
  const app = window.MyDropUtils.qs('#app');
  if (!window.MyDropState.me) {
    app.innerHTML = await window.MyDropAuth.renderLogin();
    window.MyDropAuth.bindLogin();
    return;
  }
  app.innerHTML = await window.MyDropChat.renderChat();
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
  try {
    await window.MyDropTemplates.preloadTemplates();
    await window.MyDropAPI.loadBasics();
    // 若带有消息锚点，则加载更多消息，提升命中率
    const hash = (location.hash || '').trim();
    const needMore = /^#message-(\d+)$/.test(hash);
    await window.MyDropAPI.loadInitialMessages(needMore ? 1000 : 100);
    await render();
    window.MyDropWebSocket.openWS();
    // 监听 hash 变化，支持后续跳转与高亮
    window.addEventListener('hashchange', () => {
      highlightAnchorIfAny();
    });
  } catch (_) {
    await render();
  }
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
