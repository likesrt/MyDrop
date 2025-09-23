// moved to templates/index.js
(() => {
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const state = {
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
  };

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = uuid();
      localStorage.setItem('deviceId', id);
    }
    return id;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    if (res.status === 401) {
      // 避免在登录页循环重定向
      if (location.pathname !== '/') {
        try { await fetch('/logout', { method: 'POST' }); } catch (_) {}
        location.replace('/');
      }
      throw new Error('未登录');
    }
    if (!res.ok) {
      let msg = '请求失败';
      try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function render() {
    const app = qs('#app');
    if (!state.me) {
      app.innerHTML = renderLogin();
      bindLogin();
      return;
    }
    app.innerHTML = renderChat();
    bindChat();
    ensureLayoutSpacing();
    scrollToBottom();
  }

  function renderLogin() {
    return `
      <div class="flex-1 flex items-center justify-center p-4">
        <div id="loginCard" class="bg-white shadow rounded p-6 w-full max-w-sm">
          <h1 class="text-xl font-semibold mb-4">登录</h1>
          <form id="loginForm" class="space-y-4">
            <div>
              <label class="block text-sm text-slate-600 mb-1">用户名</label>
              <input id="loginUsername" name="username" class="w-full border rounded px-3 py-2" value="admin" />
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1">密码</label>
              <input id="loginPassword" name="password" type="password" class="w-full border rounded px-3 py-2" value="admin" />
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1">设备别名（可选）</label>
              <input id="loginAlias" name="alias" class="w-full border rounded px-3 py-2" placeholder="例如：办公室电脑" />
            </div>
            <button id="loginSubmitBtn" class="w-full bg-slate-900 text-white rounded py-2 hover:bg-slate-800">登录</button>
            <p class="text-xs text-slate-500 mt-2">单用户（admin/admin），多个设备互相聊天</p>
          </form>
        </div>
      </div>
    `;
  }

  function bindLogin() {
    qs('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = {
        username: fd.get('username'),
        password: fd.get('password'),
        alias: fd.get('alias') || '',
        deviceId: getDeviceId(),
      };
      try {
        await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await loadBasics();
        render();
        openWS();
        await loadInitialMessages();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function renderChat() {
    const deviceLabel = (d) => d?.alias || shortId(d?.device_id) || '未命名设备';
    const deviceCount = (state.devices || []).length;
    const lastDevice = (state.devices || [])[0];
    const msgCount = (state.messages || []).length;
    const lastMsg = (state.messages || [])[msgCount - 1];
    const lastMsgTime = lastMsg ? new Date(lastMsg.created_at).toLocaleString() : '—';
    return `
      <header id="mainHeader" class="border-b bg-white/90 backdrop-blur px-4 py-3 flex items-center justify-between sticky top-0 z-10 anim-fadeInDown" style="animation-delay:.05s">
        <div id="brandTitle" class="font-semibold flex items-center gap-2">
          <span>MyDrop</span>
        </div>
        <div id="headerActions" class="flex items-center gap-3">
          <div class="text-sm text-slate-600">本设备：<span class="font-medium">${deviceLabel(state.me.device)}</span></div>
          <button id="aliasBtn" class="btn pressable text-xs">设备名称</button>

          <a id="settingsBtn" href="/admin.html" class="inline-flex items-center justify-center w-9 h-9 border rounded hover:bg-slate-50 btn pressable" title="设置" aria-label="设置" style="line-height: 1;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" class="w-6 h-6 flex-shrink-0" fill="currentColor" style="display: block;">
            <path d="M904.533333 422.4l-85.333333-14.933333-17.066667-38.4 49.066667-70.4c14.933333-21.333333 12.8-49.066667-6.4-68.266667l-53.333333-53.333333c-19.2-19.2-46.933333-21.333333-68.266667-6.4l-70.4 49.066666-38.4-17.066666-14.933333-85.333334c-2.133333-23.466667-23.466667-42.666667-49.066667-42.666666h-74.666667c-25.6 0-46.933333 19.2-53.333333 44.8l-14.933333 85.333333-38.4 17.066667L296.533333 170.666667c-21.333333-14.933333-49.066667-12.8-68.266666 6.4l-53.333334 53.333333c-19.2 19.2-21.333333 46.933333-6.4 68.266667l49.066667 70.4-17.066667 38.4-85.333333 14.933333c-21.333333 4.266667-40.533333 25.6-40.533333 51.2v74.666667c0 25.6 19.2 46.933333 44.8 53.333333l85.333333 14.933333 17.066667 38.4L170.666667 727.466667c-14.933333 21.333333-12.8 49.066667 6.4 68.266666l53.333333 53.333334c19.2 19.2 46.933333 21.333333 68.266667 6.4l70.4-49.066667 38.4 17.066667 14.933333 85.333333c4.266667 25.6 25.6 44.8 53.333333 44.8h74.666667c25.6 0 46.933333-19.2 53.333333-44.8l14.933334-85.333333 38.4-17.066667 70.4 49.066667c21.333333 14.933333 49.066667 12.8 68.266666-6.4l53.333334-53.333334c19.2-19.2 21.333333-46.933333 6.4-68.266666l-49.066667-70.4 17.066667-38.4 85.333333-14.933334c25.6-4.266667 44.8-25.6 44.8-53.333333v-74.666667c-4.266667-27.733333-23.466667-49.066667-49.066667-53.333333z m-19.2 117.333333l-93.866666 17.066667c-10.666667 2.133333-19.2 8.533333-23.466667 19.2l-29.866667 70.4c-4.266667 10.666667-2.133333 21.333333 4.266667 29.866667l53.333333 76.8-40.533333 40.533333-76.8-53.333333c-8.533333-6.4-21.333333-8.533333-29.866667-4.266667L576 768c-10.666667 4.266667-17.066667 12.8-19.2 23.466667l-17.066667 93.866666h-57.6l-17.066666-93.866666c-2.133333-10.666667-8.533333-19.2-19.2-23.466667l-70.4-29.866667c-10.666667-4.266667-21.333333-2.133333-29.866667 4.266667l-76.8 53.333333-40.533333-40.533333 53.333333-76.8c6.4-8.533333 8.533333-21.333333 4.266667-29.866667L256 576c-4.266667-10.666667-12.8-17.066667-23.466667-19.2l-93.866666-17.066667v-57.6l93.866666-17.066666c10.666667-2.133333 19.2-8.533333 23.466667-19.2l29.866667-70.4c4.266667-10.666667 2.133333-21.333333-4.266667-29.866667l-53.333333-76.8 40.533333-40.533333 76.8 53.333333c8.533333 6.4 21.333333 8.533333 29.866667 4.266667L448 256c10.666667-4.266667 17.066667-12.8 19.2-23.466667l17.066667-93.866666h57.6l17.066666 93.866666c2.133333 10.666667 8.533333 19.2 19.2 23.466667l70.4 29.866667c10.666667 4.266667 21.333333 2.133333 29.866667-4.266667l76.8-53.333333 40.533333 40.533333-53.333333 76.8c-6.4 8.533333-8.533333 21.333333-4.266667 29.866667L768 448c4.266667 10.666667 12.8 17.066667 23.466667 19.2l93.866666 17.066667v55.466666z"/>
            <path d="M512 394.666667c-64 0-117.333333 53.333333-117.333333 117.333333s53.333333 117.333333 117.333333 117.333333 117.333333-53.333333 117.333333-117.333333-53.333333-117.333333-117.333333-117.333333z m0 170.666666c-29.866667 0-53.333333-23.466667-53.333333-53.333333s23.466667-53.333333 53.333333-53.333333 53.333333 23.466667 53.333333 53.333333-23.466667 53.333333-53.333333 53.333333z"/>
          </svg>
        </a>
        
          <button id="logoutBtn" class="text-sm link">退出</button>
        </div>
      </header>
      <main class="flex-1 flex flex-col min-h-0">
        <div id="messages" class="flex-1 overflow-auto p-4 scroll-smooth">
          <div class="flex flex-col gap-2 min-h-full justify-end" id="messageList">
            ${state.messages.map((m, i) => renderMessageWithGrouping(i)).join('')}
          </div>
        </div>
        <form id="composer" class="fixed bottom-0 left-0 right-0 z-10 border-t bg-white/95 backdrop-blur p-3 pb-safe flex flex-col gap-2">
          <div id="composerRow" class="flex gap-2 items-end">
            <textarea id="textInput" rows="1" class="flex-1 border rounded px-3 py-2 resize-none max-h-40 overflow-auto" placeholder="输入消息... (Enter 换行, Ctrl+Enter 发送)"></textarea>
            <label id="fileBtn" class="shrink-0 inline-flex items-center justify-center w-10 h-10 border rounded cursor-pointer bg-slate-50 hover:bg-slate-100 select-none" title="添加文件" aria-label="添加文件">
              <input id="fileInput" type="file" class="hidden" multiple />
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20.5 12.5l-7.778 7.778a5.5 5.5 0 11-7.778-7.778L12.5 5.222a3.5 3.5 0 114.95 4.95L9.672 17.95a1.5 1.5 0 11-2.122-2.122L14.56 8.818"/></svg>
            </label>
            <button type="button" id="fsEditBtn" class="shrink-0 inline-flex items-center justify-center w-10 h-10 border rounded hover:bg-slate-50" title="全屏编辑" aria-label="全屏编辑">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            </button>
            <button id="sendBtn" class="btn btn-primary pressable shrink-0 px-4">发送</button>
          </div>
          <div id="selectedFiles" class="text-xs text-slate-600"></div>
          <div class="text-xs text-slate-500">单个文件上限：${state.config.fileSizeLimitMB}MB；全局最多 ${state.config.maxFiles} 个文件</div>
        </form>
      </main>
    `;
  }

  function renderMessageWithGrouping(i) {
    const m = state.messages[i];
    const prev = state.messages[i - 1];
    const next = state.messages[i + 1];
    const samePrev = prev && prev.sender_device_id === m.sender_device_id && (m.created_at - prev.created_at) < 3 * 60 * 1000;
    const sameNext = next && next.sender_device_id === m.sender_device_id && (next.created_at - m.created_at) < 3 * 60 * 1000;
    const showMeta = !samePrev;
    return renderMessage(m, { tail: !sameNext, showMeta, tight: samePrev });
  }

  function renderMessage(m, opts = {}) {
    const isMine = state.me?.device?.device_id === m.sender_device_id;
    const row = isMine ? 'justify-end' : 'justify-start';
    const align = isMine ? 'items-end text-left' : 'items-start text-left';
    let bubbleCls = isMine ? 'bubble bubble-mine bubble-shadow' : 'bubble bubble-other bubble-shadow ring-1 ring-slate-200';
    if (opts.tail) bubbleCls += isMine ? ' bubble-tail-right' : ' bubble-tail-left';
    const name = m.sender?.alias || shortId(m.sender_device_id) || '未命名设备';
    const time = new Date(m.created_at).toLocaleString();
    const textHTML = renderMarkdownWithCards(m.text || '');
    const fileBlocks = renderFilePreviews(m.files || []);
    return `
      <div class="w-full flex ${row}" id="message-${m.id}">
        <div class="max-w-[80%] min-w-0 flex flex-col ${align}">
          <div class="${bubbleCls} text-sm leading-relaxed ${opts.tight ? 'mt-0.5' : ''}">
            ${textHTML}
            ${fileBlocks}
            <div class="mt-2 flex items-center justify-end">
              <button class="text-[11px] text-slate-500 hover:text-slate-700 underline" data-copy-mid="${m.id}" title="复制文本">复制</button>
            </div>
          </div>
          ${opts.showMeta ? `<div class="text-[11px] text-slate-400 mt-1">${escapeHTML(name)} · ${time}</div>` : ''}
        </div>
      </div>
    `;
  }

  function shortId(id) {
    if (!id) return '';
    return String(id).slice(0, 4) + '…' + String(id).slice(-4);
  }

  let __md = null;
  function getMarkdownRenderer() {
    if (__md) return __md;
    if (window.markdownit) {
      __md = window.markdownit({
        html: false,
        linkify: false,
        breaks: true,
        highlight: function (str, lang) {
          try {
            if (lang && window.hljs?.getLanguage(lang)) {
              return window.hljs.highlight(str, { language: lang }).value;
            }
            return window.hljs?.highlightAuto ? window.hljs.highlightAuto(str).value : str;
          } catch (_) { return str; }
        }
      });
      return __md;
    }
    return null;
  }

  function renderWithMarked(text) {
    try {
      if (!window.marked) return null;
      window.marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: function(code, lang) {
          try {
            if (lang && window.hljs?.getLanguage(lang)) {
              return window.hljs.highlight(code, { language: lang }).value;
            }
            return window.hljs?.highlightAuto ? window.hljs.highlightAuto(code).value : code;
          } catch (_) { return code; }
        }
      });
      return window.marked.parse(text || '');
    } catch (_) {
      return null;
    }
  }

  function renderMarkdownWithCards(text) {
    try {
      const md = getMarkdownRenderer();
      let raw = md ? md.render(text || '') : null;
      if (!raw) raw = renderWithMarked(text);
      if (!raw || !window.DOMPurify) return escapeHTML(text).replace(/\n/g, '<br/>');
      // external links open new tab
      raw = raw.replace(/<a\s+/g, '<a target="_blank" rel="noreferrer noopener" ');
      const clean = window.DOMPurify.sanitize(raw, { ALLOWED_ATTR: ['href','title','target','rel','src','alt','class'] });
      const html = `<div class=\"md-body\">${clean}</div>`;
      
      return html;
    } catch (_) {
      return escapeHTML(text).replace(/\n/g, '<br/>');
    }
  }

  // 链接卡片相关逻辑已移除

  function renderFilePreviews(files) {
    if (!files.length) return '';
    const blocks = files.map(f => {
      const url = `/file/${f.id}`;
      const downloadUrl = `/file/${f.id}?download=1`;
      if (isImage(f)) {
        return `
          <div class="mt-2">
            <img src="${url}" alt="${escapeHTML(f.original_name)}" class="max-h-64 rounded object-contain" />
            <div class="text-xs mt-1"><a class="underline" href="${downloadUrl}" target="_blank">下载 (${escapeHTML(f.original_name)})</a></div>
          </div>
        `;
      }
      if (isVideo(f)) {
        return `
          <div class="mt-2">
            <video class="max-h-64 rounded" src="${url}" controls playsinline></video>
            <div class="text-xs mt-1"><a class="underline" href="${downloadUrl}" target="_blank">下载 (${escapeHTML(f.original_name)})</a></div>
          </div>
        `;
      }
      return `<div class="mt-2 text-xs"><a class="underline" href="${downloadUrl}" target="_blank">📎 ${escapeHTML(f.original_name)} (${formatBytes(f.size)})</a></div>`;
    }).join('');
    return blocks;
  }
  function isImage(f) {
    const mt = (f.mime_type || '').toLowerCase();
    if (mt.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.original_name || '');
  }
  function isVideo(f) {
    const mt = (f.mime_type || '').toLowerCase();
    if (mt.startsWith('video/')) return true;
    return /\.(mp4|webm|ogg|mov|m4v)$/i.test(f.original_name || '');
  }

  function escapeHTML(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function formatBytes(n) {
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n/1024).toFixed(1) + 'KB';
    return (n/1024/1024).toFixed(1) + 'MB';
  }

  // Ensure messages area accounts for fixed composer height
  function ensureLayoutSpacing() {
    const msg = qs('#messages');
    const comp = qs('#composer');
    if (!msg || !comp) return;
    const h = comp.offsetHeight || 0;
    msg.style.paddingBottom = (h + 12) + 'px';
  }

  // Add files into hidden input (merge existing)
  function addFilesToInput(newFiles = []) {
    const fileInput = qs('#fileInput');
    if (!fileInput) return;
    const dt = new DataTransfer();
    const existing = Array.from(fileInput.files || []);
    const incoming = Array.from(newFiles || []);
    const sizeLimit = (state.config?.fileSizeLimitMB || 5) * 1024 * 1024;
    let added = 0; const skipped = [];
    for (const f of existing) dt.items.add(f);
    for (const f of incoming) {
      if (f && typeof f.size === 'number' && f.size > sizeLimit) { skipped.push(f.name || ''); continue; }
      if (f) { dt.items.add(f); added++; }
    }
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
    ensureLayoutSpacing();
    if (added) toast(`已添加 ${added} 个文件`, 'success');
    if (skipped.length) toast(`超出大小限制：${skipped.join(', ')}`, 'warn');
  }

  function bindChat() {
    qs('#logoutBtn').addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message, 'error'); }
    });

    const fileInput = qs('#fileInput');
    const selectedFiles = qs('#selectedFiles');
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      const over = files.filter(f => f.size > state.config.fileSizeLimitMB * 1024 * 1024);
      if (over.length) {
        toast(`部分文件超过大小限制 ${state.config.fileSizeLimitMB}MB：` + over.map(f => f.name).join(', '), 'warn');
      }
      selectedFiles.innerHTML = files.map(f => `${escapeHTML(f.name)} (${formatBytes(f.size)})`).join(', ');
      ensureLayoutSpacing();
    });

    const composer = qs('#composer');
    const textInput = qs('#textInput');
    textInput.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        composer.requestSubmit();
      }
    });

    // 自适应高度 up to 5 lines
    const maxRows = 5;
    const syncHeight = () => {
      textInput.style.height = 'auto';
      const lineHeight = parseFloat(getComputedStyle(textInput).lineHeight) || 20;
      const padding = parseFloat(getComputedStyle(textInput).paddingTop) + parseFloat(getComputedStyle(textInput).paddingBottom);
      const max = lineHeight * maxRows + padding;
      textInput.style.height = Math.min(textInput.scrollHeight, max) + 'px';
      ensureLayoutSpacing();
    };
    ['input','change'].forEach(evt => textInput.addEventListener(evt, syncHeight));
    setTimeout(syncHeight, 0);

    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      const files = Array.from(fileInput.files || []);
      if (!text && files.length === 0) return; // nothing to send
      // client-side size check
      for (const f of files) {
        if (f.size > state.config.fileSizeLimitMB * 1024 * 1024) {
          toast(`文件 ${f.name} 超过大小限制 ${state.config.fileSizeLimitMB}MB`, 'warn');
          return;
        }
      }
      const fd = new FormData();
      fd.append('text', text);
      for (const f of files) fd.append('files', f);
      try {
        const res = await fetch('/message', { method: 'POST', body: fd });
        if (res.status === 401) {
          if (location.pathname !== '/') {
            try { await fetch('/logout', { method: 'POST' }); } catch (_) {}
            location.replace('/');
          }
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || '发送失败');
        }
        textInput.value = '';
        fileInput.value = '';
        selectedFiles.textContent = '';
        syncHeight();
        ensureLayoutSpacing();
        setTimeout(scrollToBottom, 50);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // 移动端键盘/视口变化时，尽量保持在底部
    textInput.addEventListener('focus', () => setTimeout(() => { ensureLayoutSpacing(); scrollToBottom(); }, 100));
    if (window.visualViewport) {
      const onVV = () => setTimeout(() => { ensureLayoutSpacing(); scrollToBottom(); }, 50);
      window.visualViewport.addEventListener('resize', onVV);
      window.addEventListener('orientationchange', () => setTimeout(scrollToBottom, 300));
    }

    // 修改设备别名（自定义弹窗）
    qs('#aliasBtn').addEventListener('click', async () => {
      const current = state.me?.device?.alias || '';
      const alias = await showPrompt('设置设备别名：', current);
      if (alias === null) return; // cancelled
      try {
        const res = await api('/device/alias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias }) });
        state.me.device = res.device;
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    // 拖拽上传到窗口
    if (!state._dndBound) {
      state._dndBound = true;
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      ['dragenter','dragover','dragleave','drop'].forEach(evt => document.addEventListener(evt, prevent));
      document.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) addFilesToInput(files);
      });
    }

    // 粘贴上传（图片/文件）
    if (!state._pasteBound) {
      state._pasteBound = true;
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

    // 窗口尺寸变化时，更新底部间距
    if (!state._resizeBound) {
      state._resizeBound = true;
      window.addEventListener('resize', () => ensureLayoutSpacing());
    }

    // 全屏编辑器
    qs('#fsEditBtn').addEventListener('click', () => openFullscreenEditor(textInput.value));

    // 全局复制按钮事件（事件委托）
    if (!state._copyBound) {
      state._copyBound = true;
      document.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-copy-mid]');
        if (!btn) return;
        e.preventDefault();
        const id = parseInt(btn.getAttribute('data-copy-mid'), 10);
        const msg = state.messages.find(x => x.id === id);
        const text = (msg?.text || '').toString();
        if (!text) { toast('无可复制文本', 'warn'); return; }
        try {
          await copyToClipboard(text);
          toast('已复制', 'success');
        } catch (_) {
          toast('复制失败', 'error');
        }
      });
    }
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // 兼容回退
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand copy failed'));
      } catch (err) { reject(err); }
    });
  }

  function openFullscreenEditor(initialText = '') {
    const overlay = document.createElement('div');
    overlay.id = 'fs-editor';
    overlay.className = 'fixed inset-0 z-50 bg-white flex flex-col';
    overlay.innerHTML = `
      <header class="p-3 border-b">
        <div class="flex items-center justify-between">
          <div class="font-medium">Markdown 全屏编辑</div>
          <div class="flex items-center gap-2">
            <button id=\"fsSend\" class=\"btn btn-primary pressable\">发送 (Ctrl+Enter)</button>
            <button id=\"fsClose\" class=\"btn pressable\">关闭 (Esc)</button>
          </div>
        </div>
        <div id=\"mdToolbar\" class=\"mt-2 flex flex-wrap items-center gap-1\">
          <button data-tool=\"bold\" class=\"btn pressable\" title=\"粗体 (Ctrl+B)\"><b>B</b></button>
          <button data-tool=\"italic\" class=\"btn pressable\" title=\"斜体 (Ctrl+I)\"><i>I</i></button>
          <button data-tool=\"h1\" class=\"btn pressable\" title=\"标题 H1\">H1</button>
          <button data-tool=\"h2\" class=\"btn pressable\" title=\"标题 H2\">H2</button>
          <button data-tool=\"ul\" class=\"btn pressable\" title=\"无序列表\">• List</button>
          <button data-tool=\"ol\" class=\"btn pressable\" title=\"有序列表\">1. List</button>
          <button data-tool=\"task\" class=\"btn pressable\" title=\"任务列表\">[ ] Task</button>
          <button data-tool=\"quote\" class=\"btn pressable\" title=\"引用\">“”</button>
          <button data-tool=\"code\" class=\"btn pressable\" title=\"行内代码\">\`code\`</button>
          <button data-tool=\"codeblock\" class=\"btn pressable\" title=\"代码块\">Code Block</button>
          <button data-tool=\"link\" class=\"btn pressable\" title=\"插入链接\">Link</button>
          <button data-tool=\"image\" class=\"btn pressable\" title=\"插入图片\">Image</button>
          <button data-tool=\"hr\" class=\"btn pressable\" title=\"分割线\">―</button>
        </div>
      </header>
      <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
        <div class="p-3 border-r flex flex-col">
          <textarea id="fsInput" class="flex-1 border rounded p-3 resize-none" placeholder="在此输入 Markdown..."></textarea>
        </div>
        <div class="p-3 overflow-auto">
          <div id="fsPreview" class="md-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('overflow-hidden');
    const input = overlay.querySelector('#fsInput');
    const preview = overlay.querySelector('#fsPreview');
    const closeBtn = overlay.querySelector('#fsClose');
    const sendBtn = overlay.querySelector('#fsSend');
    input.value = initialText;
    const update = () => {
      preview.innerHTML = renderMarkdownWithCards(input.value);
    };
    input.addEventListener('input', update);
    update();
    const close = () => {
      document.body.classList.remove('overflow-hidden');
      overlay.remove();
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const mainInput = qs('#textInput');
        if (mainInput) {
          mainInput.value = input.value;
          const composer = qs('#composer');
          composer?.requestSubmit();
          close();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyToolbar('bold', input, update); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyToolbar('italic', input, update); }
    });
    sendBtn.addEventListener('click', () => {
      const mainInput = qs('#textInput');
      if (mainInput) {
        mainInput.value = input.value;
        qs('#composer')?.requestSubmit();
        close();
      }
    });
    overlay.querySelectorAll('#mdToolbar [data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool');
        applyToolbar(tool, input, update);
      });
    });
    input.focus();
  }

  async function applyToolbar(tool, textarea, onChanged) {
    const t = textarea;
    const start = t.selectionStart || 0;
    const end = t.selectionEnd || 0;
    const value = t.value || '';
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const set = (text, cursorDelta = 0) => {
      t.value = text;
      const pos = start + cursorDelta;
      t.setSelectionRange(pos, pos);
      t.focus();
      if (typeof onChanged === 'function') onChanged();
    };
    const surround = (prefix, suffix = prefix) => {
      if (!selected) return set(before + prefix + suffix + after, prefix.length);
      return set(before + prefix + selected + suffix + after, (prefix + selected + suffix).length);
    };
    const lineOperate = (prefix, numbered = false) => {
      const sel = selected || '';
      const lines = sel.split('\n');
      const newLines = lines.map((line, i) => {
        if (numbered) return `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`;
        return `${prefix} ${line.replace(/^(?:[-*+]\s|>\s|\[\]\s|\[[xX]\]\s)?/, '')}`.trimEnd();
      });
      const text = before + newLines.join('\n') + after;
      set(text, (newLines.join('\n')).length);
    };
    switch (tool) {
      case 'bold': return surround('**');
      case 'italic': return surround('*');
      case 'h1': return set(before + '# ' + selected + after, (('# ' + selected).length));
      case 'h2': return set(before + '## ' + selected + after, (('## ' + selected).length));
      case 'ul': return lineOperate('-');
      case 'ol': return lineOperate('', true);
      case 'task': return lineOperate('- [ ]');
      case 'quote': return lineOperate('>');
      case 'code': return surround('`');
      case 'codeblock': {
        const block = '```\n' + (selected || '') + '\n```\n';
        const text = before + block + after;
        return set(text, block.length - 4);
      }
      case 'link': {
        const url = await showPrompt('输入链接地址：', 'https://');
        if (!url) return;
        const title = selected || '链接标题';
        const md = `[${title}](${url})`;
        return set(before + md + after, (md.length));
      }
      case 'image': {
        const url = await showPrompt('输入图片地址：', 'https://');
        if (!url) return;
        const alt = selected || '图片说明';
        const md = `![${alt}](${url})`;
        return set(before + md + after, (md.length));
      }
      case 'hr': {
        const md = (before.endsWith('\n') ? '' : '\n') + '---\n';
        return set(before + md + after, md.length);
      }
      default:
        return;
    }
  }

  function scrollToBottom() {
    const el = qs('#messages');
    if (!el) return;
    ensureLayoutSpacing();
    const fn = () => { el.scrollTop = el.scrollHeight; };
    // double RAF to ensure post-layout
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  // 全局自定义通知（替代 alert）
  function ensureToastRoot() {
    let el = qs('#toast-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-root';
      el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2 w-[92%] max-w-md';
      document.body.appendChild(el);
    }
    return el;
  }
  function toast(message, type = 'info') {
    const root = ensureToastRoot();
    const div = document.createElement('div');
    const color = type === 'error' ? 'bg-red-600' : type === 'warn' ? 'bg-amber-600' : type === 'success' ? 'bg-emerald-600' : 'bg-slate-900';
    div.className = `toast-enter ${color} text-white px-3 py-2 rounded shadow`;
    div.textContent = message;
    root.appendChild(div);
    requestAnimationFrame(() => {
      div.classList.remove('toast-enter');
      div.classList.add('toast-enter-active');
    });
    const t = setTimeout(() => close(), 3000);
    function close() {
      clearTimeout(t);
      div.classList.add('toast-leave-active');
      setTimeout(() => div.remove(), 200);
    }
    div.addEventListener('click', close);
  }

  // 自定义弹窗（Confirm/Prompt）
  function ensureModalRoot() {
    let el = qs('#modal-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'modal-root';
      el.className = 'fixed inset-0 z-50 flex items-center justify-center p-3';
      document.body.appendChild(el);
    }
    return el;
  }
  function closeModal(root, overlay) {
    try { overlay.classList.add('opacity-0'); } catch (_) {}
    setTimeout(() => { try { root.innerHTML = ''; } catch (_) {} }, 150);
  }
  function showConfirm(message, { title = '确认', confirmText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      const root = ensureModalRoot();
      const overlay = document.createElement('div');
      overlay.className = 'absolute inset-0 bg-black/30 transition-opacity';
      const card = document.createElement('div');
      card.className = 'relative bg-white rounded shadow-lg border w-full max-w-md p-4 space-y-3 anim-fadeIn';
      card.innerHTML = `
        <div class="text-base font-medium text-slate-800">${escapeHTML(title)}</div>
        <div class="text-sm text-slate-700">${escapeHTML(String(message||''))}</div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <button class="btn pressable" data-act="cancel">${escapeHTML(cancelText)}</button>
          <button class="btn btn-primary pressable" data-act="ok">${escapeHTML(confirmText)}</button>
        </div>`;
      root.innerHTML = '';
      root.appendChild(overlay);
      root.appendChild(card);
      const onCancel = () => { closeModal(root, overlay); resolve(false); };
      const onOk = () => { closeModal(root, overlay); resolve(true); };
      card.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
      card.querySelector('[data-act="ok"]').addEventListener('click', onOk);
      const onKey = (e) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onOk(); };
      setTimeout(() => document.addEventListener('keydown', onKey, { once: true }), 0);
      overlay.addEventListener('click', onCancel);
    });
  }
  function showPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
      const root = ensureModalRoot();
      const overlay = document.createElement('div');
      overlay.className = 'absolute inset-0 bg-black/30 transition-opacity';
      const card = document.createElement('div');
      card.className = 'relative bg-white rounded shadow-lg border w-full max-w-md p-4 space-y-3 anim-fadeIn';
      card.innerHTML = `
        <div class="text-base font-medium text-slate-800">${escapeHTML(String(message||''))}</div>
        <div><input id="_promptInput" class="w-full border rounded px-3 py-2" value="${escapeHTML(String(defaultValue||''))}" /></div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <button class="btn pressable" data-act="cancel">取消</button>
          <button class="btn btn-primary pressable" data-act="ok">确定</button>
        </div>`;
      root.innerHTML = '';
      root.appendChild(overlay);
      root.appendChild(card);
      const input = card.querySelector('#_promptInput');
      const onCancel = () => { closeModal(root, overlay); resolve(null); };
      const onOk = () => { const v = input.value; closeModal(root, overlay); resolve(v); };
      card.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
      card.querySelector('[data-act="ok"]').addEventListener('click', onOk);
      const onKey = (e) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onOk(); };
      setTimeout(() => { input.focus(); input.select(); document.addEventListener('keydown', onKey, { once: true }); }, 0);
      overlay.addEventListener('click', onCancel);
    });
  }

  async function loadBasics() {
    const cfg = await api('/config');
    state.config = cfg;
    const me = await api('/me');
    state.me = me;
    const devices = await api('/devices');
    state.devices = devices.devices || [];
    if (me?.user?.needsPasswordChange && !state.shownPwdPrompt) {
      state.shownPwdPrompt = true;
      toast('您仍在使用默认密码，请前往“设置”修改。', 'warn');
    }
  }

  async function loadInitialMessages() {
    const result = await api('/messages?limit=100');
    state.messages = result.messages || [];
  }

  function openWS() {
    if (state.ws) try { state.ws.close(); } catch(_) {}
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    state.ws = ws;
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'message') {
          state.messages.push(msg.data);
          // If new device shows up later, refresh device list lazily
          const senderId = msg.data.sender_device_id;
          if (!state.devices.find(d => d.device_id === senderId) && msg.data.sender) {
            state.devices.unshift(msg.data.sender);
          }
          render();
          scrollToBottom();
        } else if (msg.type === 'force-logout') {
          // 被管理员强制下线
          toast('已被管理员下线', 'warn');
          fetch('/logout', { method: 'POST' }).finally(() => { location.reload(); });
        }
      } catch (_) {}
    });
    ws.addEventListener('open', () => {});
    ws.addEventListener('close', () => {});
  }

  (async function init() {
    try {
      await loadBasics();
      await loadInitialMessages();
      render();
      openWS();
      setTimeout(() => { ensureLayoutSpacing(); scrollToBottom(); }, 50);
    } catch (_) {
      // not logged in yet
      render();
    }
  })();
})();
