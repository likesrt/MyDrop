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
  // 按照demo.html的方式：使用requestAnimationFrame确保DOM完全渲染后快速定位到底部
  requestAnimationFrame(() => {
    window.MyDropChat.jumpToBottom();
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
    await window.MyDropAPI.loadInitialMessages();
    await render();
    window.MyDropWebSocket.openWS();
  } catch (_) {
    await render();
  }
})();

window.MyDropApp = {
  render,
  attachMediaLoadScroll
};
