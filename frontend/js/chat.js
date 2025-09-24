// 聊天功能相关





async function renderChat() {
  const deviceLabel = (d) => d?.alias || window.MyDropUtils.shortId(d?.device_id) || '未命名设备';
  const htmlList = await Promise.all(window.MyDropState.messages.map((_, i) => window.MyDropRender.renderMessageWithGrouping(i)));
  const messagesList = htmlList.join('');

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
      const prevHtml = await window.MyDropRender.renderMessageWithGrouping(idx - 1);
      const tempPrev = document.createElement('div');
      tempPrev.innerHTML = prevHtml;
      const prevNode = tempPrev.firstElementChild;
      const existingPrev = window.MyDropUtils.qs('#message-' + window.MyDropState.messages[idx - 1].id);
      if (existingPrev && prevNode) existingPrev.replaceWith(prevNode);
    }

    const html = await window.MyDropRender.renderMessageWithGrouping(idx);
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
  // 移动端自动隐藏 Header
  try { if (window.MyDropState?.config?.headerAutoHide) window.MyDropUI.setupAutoHideHeader(true); } catch (_) {}
  try { window.MyDropPWA?.bindInstall(); } catch (_) {}
  window.MyDropUtils.qs('#logoutBtn').addEventListener('click', async () => {
    try { await window.MyDropAPI.api('/logout', { method: 'POST' }); location.reload(); } catch (e) { window.MyDropUI.toast(window.MyDropUI.formatError(e, '退出登录失败'), 'error'); }
  });

  // 主题切换
  const themeBtn = window.MyDropUtils.qs('#themeToggleBtn');
  if (themeBtn && window.MyDropTheme) {
    // 确保按钮图标与当前模式一致
    try { window.MyDropTheme.apply(window.MyDropTheme.get()); } catch (_) {}
    themeBtn.addEventListener('click', () => {
      try {
        const curr = window.MyDropTheme.get();
        const next = window.MyDropTheme.next(curr);
        window.MyDropTheme.set(next);
      } catch (_) {}
    });
  }

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
  const sendBtn = window.MyDropUtils.qs('#sendBtn');
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
    // 占位状态下交由 CSS 控制高度与垂直居中
    if (!textInput.value) { textInput.style.height = ''; return; }

    textInput.style.height = 'auto';
    const styles = getComputedStyle(textInput);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const max = lineHeight * maxRows + padding;
    textInput.style.height = Math.min(textInput.scrollHeight, max) + 'px';
  };
  ['input','change'].forEach(evt => textInput.addEventListener(evt, syncHeight));
  setTimeout(syncHeight, 0);

  // 防止点击发送按钮导致输入框失焦（移动端会收起键盘）
  if (sendBtn) {
    // 阻止鼠标按下将焦点切到按钮（不影响后续 click 与 submit）
    sendBtn.addEventListener('mousedown', (ev) => { try { ev.preventDefault(); } catch(_) {} });
    // 触屏场景尽量保持焦点在文本框
    sendBtn.addEventListener('touchstart', () => { try { textInput.focus({ preventScroll: true }); } catch(_) {} }, { passive: true });
  }

  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    // 提交瞬间立即把焦点锁回输入框，避免移动端键盘先收起再弹出
    try { textInput.focus({ preventScroll: true }); } catch (_) {}
    const text = textInput.value.trim();
    const files = Array.from(fileInput.files || []);
    if (!text && files.length === 0) return;

    for (const f of files) {
      if (f.size > window.MyDropState.config.fileSizeLimitMB * 1024 * 1024) {
        window.MyDropUI.toast(`文件 ${f.name} 超过大小限制 ${window.MyDropState.config.fileSizeLimitMB}MB`, 'warn');
        return;
      }
    }

    // Build optimistic message
    const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const optimistic = {
      id: tempId,
      sender_device_id: window.MyDropState.me?.device?.device_id || null,
      text,
      created_at: Date.now(),
      sender: window.MyDropState.me?.device || null,
      uploading: files.length > 0,
      _progress: files.length > 0 ? 0 : undefined,
      files: files.map(f => ({ original_name: f.name, size: f.size, mime_type: f.type, uploading: true }))
    };
    window.MyDropState.messages.push(optimistic);
    appendMessageToList(optimistic);

    // Prepare payload
    const fd = new FormData();
    fd.append('text', text);
    for (const f of files) fd.append('files', f);

    const updateProgress = (pct) => {
      optimistic._progress = pct;
      try {
        const root = document.querySelector('#message-' + CSS.escape(tempId));
        if (!root) return;
        const bar = root.querySelector('[data-role="msg-progress"]');
        const label = root.querySelector('[data-role="msg-progress-text"]');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (label) label.textContent = Math.max(0, Math.min(100, Math.round(pct))) + '%';
      } catch (_) {}
    };

    try {
      const j = await uploadMessageWithProgress(fd, updateProgress);
      const saved = j && j.message ? j.message : null;
      // Replace optimistic with saved
      const idx = window.MyDropState.messages.findIndex(m => m.id === tempId);
      if (idx >= 0 && saved) {
        // Deduplicate if WS already delivered the saved message
        const dupIdx = window.MyDropState.messages.findIndex((m, i) => i !== idx && String(m.id) === String(saved.id));
        if (dupIdx >= 0) {
          // Remove optimistic entry and keep the server-delivered one (from WS)
          window.MyDropState.messages.splice(idx, 1);
          try { const el = document.querySelector('#message-' + CSS.escape(tempId)); if (el) el.remove(); } catch (_) {}
          // Re-render neighbor before the removed slot to fix grouping
          try {
            if (idx - 1 >= 0) {
              const prevHtml = await window.MyDropRender.renderMessageWithGrouping(idx - 1);
              const prevOld = document.querySelector('#message-' + window.MyDropState.messages[idx - 1].id);
              const t = document.createElement('div'); t.innerHTML = prevHtml; const prevNode = t.firstElementChild; if (prevNode && prevOld) prevOld.replaceWith(prevNode);
            }
          } catch (_) {}
        } else {
          // Replace optimistic in place
          window.MyDropState.messages[idx] = saved;
          try {
            const prevHtml = (idx - 1 >= 0) ? await window.MyDropRender.renderMessageWithGrouping(idx - 1) : null;
            const currHtml = await window.MyDropRender.renderMessageWithGrouping(idx);
            if (prevHtml) {
              const t = document.createElement('div'); t.innerHTML = prevHtml; const prevNode = t.firstElementChild;
              const prevOld = document.querySelector('#message-' + window.MyDropState.messages[idx - 1]?.id);
              if (prevNode && prevOld) prevOld.replaceWith(prevNode);
            }
            const oldNode = document.querySelector('#message-' + CSS.escape(tempId));
            if (currHtml && oldNode) {
              const t2 = document.createElement('div'); t2.innerHTML = currHtml; const newNode = t2.firstElementChild;
              if (newNode) oldNode.replaceWith(newNode);
            }
          } catch (_) { try { await window.MyDropApp.render(); } catch (_) {} }
        }
      }

      // Reset inputs
      textInput.value = '';
      fileInput.value = '';
      selectedFiles.textContent = '';
      syncHeight();

      // 维持焦点与光标位置
      try {
        textInput.focus({ preventScroll: true });
        textInput.setSelectionRange(textInput.value.length, textInput.value.length);
      } catch (_) {}
    } catch (err) {
      // remove optimistic
      const idx = window.MyDropState.messages.findIndex(m => m.id === tempId);
      if (idx >= 0) {
        window.MyDropState.messages.splice(idx, 1);
        try { const el = document.querySelector('#message-' + CSS.escape(tempId)); if (el) el.remove(); } catch (_) {}
        // Update neighbors grouping
        try {
          if (idx - 1 >= 0) {
            const htmlPrev = await window.MyDropRender.renderMessageWithGrouping(idx - 1);
            const prevOld = document.querySelector('#message-' + window.MyDropState.messages[idx - 1].id);
            const t = document.createElement('div'); t.innerHTML = htmlPrev; const prevNode = t.firstElementChild; if (prevNode && prevOld) prevOld.replaceWith(prevNode);
          }
        } catch (_) {}
      }
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
      if (btn) {
        e.preventDefault();
        const idAttr = btn.getAttribute('data-copy-mid');
        const msg = window.MyDropState.messages.find(x => String(x.id) === String(idAttr));
        const text = (msg?.text || '').toString();
        if (!text) { window.MyDropUI.toast('无可复制文本', 'warn'); return; }
        try { await window.MyDropUI.copyToClipboard(text); window.MyDropUI.toast('已复制', 'success'); }
        catch (_) { window.MyDropUI.toast('复制失败', 'error'); }
        return;
      }
      const del = e.target.closest('[data-delete-mid]');
      if (del) {
        e.preventDefault();
        const idAttr = del.getAttribute('data-delete-mid');
        const msg = window.MyDropState.messages.find(x => String(x.id) === String(idAttr));
        if (!msg || !msg.id || String(msg.id).startsWith('tmp-')) return; // ignore optimistic
        const ok1 = await window.MyDropUI.showConfirm('确认删除该消息？');
        if (!ok1) return;
        try {
          await window.MyDropAPI.api('/admin/message/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: msg.id }) });
          // remove locally
          const idx = window.MyDropState.messages.findIndex(m => String(m.id) === String(idAttr));
          if (idx >= 0) {
            const oldEl = document.querySelector('#message-' + CSS.escape(String(idAttr)));
            window.MyDropState.messages.splice(idx, 1);
            try { if (oldEl) oldEl.remove(); } catch (_) {}
            // re-render neighbors
            try {
              if (idx - 1 >= 0) {
                const prevHtml = await window.MyDropRender.renderMessageWithGrouping(idx - 1);
                const prevOld = document.querySelector('#message-' + window.MyDropState.messages[idx - 1].id);
                const t = document.createElement('div'); t.innerHTML = prevHtml; const prevNode = t.firstElementChild; if (prevNode && prevOld) prevOld.replaceWith(prevNode);
              }
              if (idx < window.MyDropState.messages.length) {
                const currHtml = await window.MyDropRender.renderMessageWithGrouping(idx);
                const currOld = document.querySelector('#message-' + window.MyDropState.messages[idx].id);
                const t2 = document.createElement('div'); t2.innerHTML = currHtml; const currNode = t2.firstElementChild; if (currNode && currOld) currOld.replaceWith(currNode);
              }
            } catch (_) {}
          }
          window.MyDropUI.toast('已删除消息', 'success');
        } catch (err) {
          window.MyDropUI.toast(window.MyDropUI.formatError(err, '删除失败'), 'error');
        }
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

// 使用 XMLHttpRequest 以支持上传进度
function uploadMessageWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/message');
      xhr.responseType = 'json';
      if (xhr.upload && typeof onProgress === 'function') {
        xhr.upload.onprogress = (e) => {
          if (e && e.lengthComputable) {
            const pct = (e.total > 0) ? (e.loaded / e.total) * 100 : 0;
            onProgress(Math.round(pct));
          }
        };
      }
      xhr.onload = () => {
        const s = xhr.status || 0;
        const body = xhr.response || null;
        if (s >= 200 && s < 300) return resolve(body);
        const msg = (body && body.error) ? body.error : '上传失败';
        const err = new Error(msg); err.status = s; reject(err);
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.send(formData);
    } catch (err) { reject(err); }
  });
}
