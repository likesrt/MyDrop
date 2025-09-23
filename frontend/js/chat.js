// 聊天功能相关





async function renderChat() {
  const deviceLabel = (d) => d?.alias || window.MyDropUtils.shortId(d?.device_id) || '未命名设备';
  const messagesList = window.MyDropState.messages.map((m, i) => window.MyDropRender.renderMessageWithGrouping(i)).join('');

  return await window.MyDropTemplates.getTemplate('chat-layout', {
    deviceName: deviceLabel(window.MyDropState.me.device),
    messagesList: messagesList,
    fileSizeLimit: window.MyDropState.config.fileSizeLimitMB,
    maxFiles: window.MyDropState.config.maxFiles
  });
}

// 快速定位到底部（无动画）- 按照demo.html的实现
function jumpToBottom() {
  const el = window.MyDropUtils.qs('#messages');
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

// 兼容性：保持原名称
function scrollToBottom() {
  jumpToBottom();
}

// 平滑滚动到底部（新消息时使用）- 按照demo.html的实现
function smoothScrollToBottom() {
  const el = window.MyDropUtils.qs('#messages');
  if (!el) return;
  el.scrollTo({
    top: el.scrollHeight,
    behavior: 'smooth'
  });
}


function addFilesToInput(newFiles = []) {
  const fileInput = window.MyDropUtils.qs('#fileInput');
  if (!fileInput) return;
  const dt = new DataTransfer();
  const existing = Array.from(fileInput.files || []);
  const incoming = Array.from(newFiles || []);
  const sizeLimit = (window.MyDropState.config?.fileSizeLimitMB || 5) * 1024 * 1024;
  let added = 0; const skipped = [];
  for (const f of existing) dt.items.add(f);
  for (const f of incoming) {
    if (f && typeof f.size === 'number' && f.size > sizeLimit) { skipped.push(f.name || ''); continue; }
    if (f) { dt.items.add(f); added++; }
  }
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change'));
  if (added) window.MyDropUI.toast(`已添加 ${added} 个文件`, 'success');
  if (skipped.length) window.MyDropUI.toast(`超出大小限制：${skipped.join(', ')}`, 'warn');
}

async function appendMessageToList(newMsg) {
  try {
    const list = window.MyDropUtils.qs('#messageList');
    if (!list) { await window.MyDropApp.render(); return; }
    const container = window.MyDropUtils.qs('#messages');
    const idx = window.MyDropState.messages.length - 1;

    if (idx - 1 >= 0) {
      const prevHtml = window.MyDropRender.renderMessageWithGrouping(idx - 1);
      const tempPrev = document.createElement('div');
      tempPrev.innerHTML = prevHtml;
      const prevNode = tempPrev.firstElementChild;
      const existingPrev = window.MyDropUtils.qs('#message-' + window.MyDropState.messages[idx - 1].id);
      if (existingPrev && prevNode) existingPrev.replaceWith(prevNode);
    }

    const html = window.MyDropRender.renderMessageWithGrouping(idx);
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const node = temp.firstElementChild;
    if (node) list.appendChild(node);

    // 按照demo.html的方式：延迟50ms后平滑滚动
    setTimeout(smoothScrollToBottom, 50);

    try {
      const media = node ? Array.from(node.querySelectorAll('img,video,audio')) : [];
      for (const m of media) {
        const onLoaded = () => { const c = window.MyDropUtils.qs('#messages'); if (c && window.MyDropUtils.isNearBottom(c, 120)) setTimeout(jumpToBottom, 30); };
        m.addEventListener('load', onLoaded, { once: true });
        m.addEventListener('loadedmetadata', onLoaded, { once: true });
        m.addEventListener('loadeddata', onLoaded, { once: true });
      }
    } catch (_) {}
  } catch (_) {
    try { await window.MyDropApp.render(); } catch (_) {}
  }
}

function bindChat() {
  window.MyDropUtils.qs('#logoutBtn').addEventListener('click', async () => {
    try { await window.MyDropAPI.api('/logout', { method: 'POST' }); location.reload(); } catch (e) { window.MyDropUI.toast(window.MyDropUI.formatError(e, '退出登录失败'), 'error'); }
  });

  const fileInput = window.MyDropUtils.qs('#fileInput');
  const selectedFiles = window.MyDropUtils.qs('#selectedFiles');
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    const over = files.filter(f => f.size > window.MyDropState.config.fileSizeLimitMB * 1024 * 1024);
    if (over.length) {
      window.MyDropUI.toast(`部分文件超过大小限制 ${window.MyDropState.config.fileSizeLimitMB}MB：` + over.map(f => f.name).join(', '), 'warn');
    }
    selectedFiles.innerHTML = files.map(f => `${window.MyDropUtils.escapeHTML(f.name)} (${window.MyDropUtils.formatBytes(f.size)})`).join(', ');
  });

  const composer = window.MyDropUtils.qs('#composer');
  const msgContainer = window.MyDropUtils.qs('#messages');
  if (msgContainer) {
    const updateStick = () => { try { window.MyDropState.stickToBottom = window.MyDropUtils.isNearBottom(msgContainer, 80); } catch (_) {} };
    updateStick();
    msgContainer.addEventListener('scroll', updateStick);
  }

  const textInput = window.MyDropUtils.qs('#textInput');
  textInput.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      composer.requestSubmit();
    }
  });

  const maxRows = 5;
  const syncHeight = () => {
    textInput.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(textInput).lineHeight) || 20;
    const styles = getComputedStyle(textInput);
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const max = lineHeight * maxRows + padding;
    textInput.style.height = Math.min(textInput.scrollHeight, max) + 'px';

    // 垂直居中占位符：在无内容时，根据当前高度与行高动态分配上下内边距
    if (!textInput.value) {
      const h = textInput.clientHeight;
      const lh = lineHeight;
      const pad = Math.max((h - lh) / 2, 6);
      textInput.style.paddingTop = pad + 'px';
      textInput.style.paddingBottom = pad + 'px';
    } else {
      // 还原为初始内边距（由样式表控制）
      textInput.style.paddingTop = '';
      textInput.style.paddingBottom = '';
    }
  };
  ['input','change'].forEach(evt => textInput.addEventListener(evt, syncHeight));
  setTimeout(syncHeight, 0);

  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    const files = Array.from(fileInput.files || []);
    if (!text && files.length === 0) return;

    for (const f of files) {
      if (f.size > window.MyDropState.config.fileSizeLimitMB * 1024 * 1024) {
        window.MyDropUI.toast(`文件 ${f.name} 超过大小限制 ${window.MyDropState.config.fileSizeLimitMB}MB`, 'warn');
        return;
      }
    }

    const fd = new FormData();
    fd.append('text', text);
    for (const f of files) fd.append('files', f);

    try {
      const j = await window.MyDropAPI.api('/message', { method: 'POST', body: fd });
      const saved = j && j.message ? j.message : null;
      if (saved && !window.MyDropState.messages.some(m => m.id === saved.id)) {
        window.MyDropState.messages.push(saved);
        appendMessageToList(saved);
      }

      textInput.value = '';
      fileInput.value = '';
      selectedFiles.textContent = '';
      syncHeight();

      setTimeout(() => {
        try {
          textInput.focus();
          textInput.setSelectionRange(textInput.value.length, textInput.value.length);
        } catch (_) {}
      }, 50);
    } catch (err) {
      window.MyDropUI.toast(window.MyDropUI.formatError(err, '发送失败'), 'error');
    }
  });

  if (window.visualViewport) {
    const onVV = () => setTimeout(() => {
      const c = window.MyDropUtils.qs('#messages');
      if (c && window.MyDropUtils.isNearBottom(c, 80)) jumpToBottom();
    }, 50);
    window.visualViewport.addEventListener('resize', onVV);
    window.addEventListener('orientationchange', () => setTimeout(() => {
      const c = window.MyDropUtils.qs('#messages');
      if (c && window.MyDropUtils.isNearBottom(c, 80)) jumpToBottom();
    }, 300));
  }

  window.MyDropUtils.qs('#aliasBtn').addEventListener('click', async () => {
    const current = window.MyDropState.me?.device?.alias || '';
    const alias = await window.MyDropUI.showPrompt('设置设备别名：', current);
    if (alias === null) return;
    try {
      const res = await window.MyDropAPI.api('/device/alias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias }) });
      window.MyDropState.me.device = res.device;
      const label = (res.device?.alias || (res.device?.device_id ? window.MyDropUtils.shortId(res.device.device_id) : '未命名设备'));
      const el = window.MyDropUtils.qs('#deviceNameLabel');
      if (el) el.textContent = label;
    } catch (e) {
      window.MyDropUI.toast(window.MyDropUI.formatError(e, '更新设备别名失败'), 'error');
    }
  });

  if (!window.MyDropState._dndBound) {
    window.MyDropState._dndBound = true;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => document.addEventListener(evt, prevent));
    document.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) addFilesToInput(files);
    });
  }

  if (!window.MyDropState._pasteBound) {
    window.MyDropState._pasteBound = true;
    window.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) addFilesToInput(files);
    });
  }

  if (!window.MyDropState._resizeBound) {
    window.MyDropState._resizeBound = true;
  }

  window.MyDropUtils.qs('#fsEditBtn').addEventListener('click', () => window.MyDropEditor.openFullscreenEditor(textInput.value));

  if (!window.MyDropState._copyBound) {
    window.MyDropState._copyBound = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy-mid]');
      if (!btn) return;
      e.preventDefault();
      const id = parseInt(btn.getAttribute('data-copy-mid'), 10);
      const msg = window.MyDropState.messages.find(x => x.id === id);
      const text = (msg?.text || '').toString();
      if (!text) { window.MyDropUI.toast('无可复制文本', 'warn'); return; }
      try {
        await window.MyDropUI.copyToClipboard(text);
        window.MyDropUI.toast('已复制', 'success');
      } catch (_) {
        window.MyDropUI.toast('复制失败', 'error');
      }
    });
  }
}

window.MyDropChat = {
  renderChat,
  bindChat,
  jumpToBottom,
  scrollToBottom,
  smoothScrollToBottom,
  addFilesToInput,
  appendMessageToList
};
