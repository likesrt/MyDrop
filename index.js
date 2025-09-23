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
    scrollToBottom();
  }

  function renderLogin() {
    return `
      <div class="flex-1 flex items-center justify-center p-4">
        <div class="bg-white shadow rounded-lg p-6 w-full max-w-sm">
          <h1 class="text-xl font-semibold mb-4">登录</h1>
          <form id="loginForm" class="space-y-4">
            <div>
              <label class="block text-sm text-slate-600 mb-1">用户名</label>
              <input name="username" class="w-full border rounded px-3 py-2" value="admin" />
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1">密码</label>
              <input name="password" type="password" class="w-full border rounded px-3 py-2" value="admin" />
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1">设备别名（可选）</label>
              <input name="alias" class="w-full border rounded px-3 py-2" placeholder="例如：办公室电脑" />
            </div>
            <button class="w-full bg-slate-900 text-white rounded py-2 hover:bg-slate-800">登录</button>
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
    return `
      <header class="border-b bg-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div class="font-semibold">MyDrop</div>
        <div class="flex items-center gap-3">
          <div class="text-sm text-slate-600">本设备：<span class="font-medium">${deviceLabel(state.me.device)}</span></div>
          <button id="aliasBtn" class="text-xs px-2 py-1 border rounded hover:bg-slate-50">设备名称</button>
          <a href="/admin.html" class="inline-flex items-center justify-center w-9 h-9 border rounded hover:bg-slate-50" title="设置" aria-label="设置">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M10.325 4.317a1.5 1.5 0 012.35 0l.334.446a1.5 1.5 0 001.64.555l.528-.142a1.5 1.5 0 011.828 1.06l.142.528a1.5 1.5 0 00.555 1.64l.446.334a1.5 1.5 0 010 2.35l-.446.334a1.5 1.5 0 00-.555 1.64l.142.528a1.5 1.5 0 01-1.06 1.828l-.528.142a1.5 1.5 0 00-1.64.555l-.334.446a1.5 1.5 0 01-2.35 0l-.334-.446a1.5 1.5 0 00-1.64-.555l-.528.142a1.5 1.5 0 01-1.828-1.06l-.142-.528a1.5 1.5 0 00-.555-1.64l-.446-.334a1.5 1.5 0 010-2.35l.446-.334a1.5 1.5 0 00.555-1.64l-.142-.528A1.5 1.5 0 017.795 5.176l.528.142a1.5 1.5 0 001.64-.555l.334-.446z"/><circle cx="12" cy="12" r="3"/></svg>
          </a>
          <button id="logoutBtn" class="text-sm text-slate-700 hover:text-black">退出</button>
        </div>
      </header>
      <main class="flex-1 flex flex-col min-h-0">
        <div id="messages" class="flex-1 overflow-auto p-4 scroll-smooth">
          <div class="flex flex-col gap-2 min-h-full justify-end" id="messageList">
            ${state.messages.map((m, i) => renderMessageWithGrouping(i)).join('')}
          </div>
        </div>
        <form id="composer" class="border-t bg-white p-3 pb-safe sticky bottom-0 left-0 right-0 flex flex-col gap-2">
          <div class="flex gap-2 items-end">
            <textarea id="textInput" rows="1" class="flex-1 border rounded px-3 py-2 resize-none max-h-40 overflow-auto" placeholder="输入消息... (Enter 换行, Ctrl+Enter 发送)"></textarea>
            <label class="shrink-0 inline-flex items-center justify-center w-10 h-10 border rounded cursor-pointer bg-slate-50 hover:bg-slate-100 select-none" title="添加文件" aria-label="添加文件">
              <input id="fileInput" type="file" class="hidden" multiple />
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20.5 12.5l-7.778 7.778a5.5 5.5 0 11-7.778-7.778L12.5 5.222a3.5 3.5 0 114.95 4.95L9.672 17.95a1.5 1.5 0 11-2.122-2.122L14.56 8.818"/></svg>
            </label>
            <button type="button" id="fsEditBtn" class="shrink-0 inline-flex items-center justify-center w-10 h-10 border rounded hover:bg-slate-50" title="全屏编辑" aria-label="全屏编辑">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            </button>
            <button class="shrink-0 bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800">发送</button>
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
    const align = isMine ? 'items-end text-right' : 'items-start text-left';
    let bubbleCls = isMine ? 'bubble bubble-mine bubble-shadow' : 'bubble bubble-other bubble-shadow ring-1 ring-slate-200';
    if (opts.tail) bubbleCls += isMine ? ' bubble-tail-right' : ' bubble-tail-left';
    const name = m.sender?.alias || shortId(m.sender_device_id) || '未命名设备';
    const time = new Date(m.created_at).toLocaleString();
    const textHTML = renderMarkdownWithCards(m.text || '');
    const fileBlocks = renderFilePreviews(m.files || []);
    return `
      <div class="w-full flex ${row}">
        <div class="max-w-[80%] flex flex-col ${align}">
          <div class="${bubbleCls} text-sm leading-relaxed ${opts.tight ? 'mt-0.5' : ''}">
            ${textHTML}
            ${fileBlocks}
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

  function renderMarkdownWithCards(text) {
    try {
      if (!window.marked || !window.DOMPurify || !window.hljs) return escapeHTML(text).replace(/\n/g, '<br/>');
      // Configure marked + code highlight
      window.marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: function(code, lang) {
          try {
            if (lang && window.hljs.getLanguage(lang)) {
              return window.hljs.highlight(code, { language: lang }).value;
            }
            return window.hljs.highlightAuto(code).value;
          } catch (_) { return code; }
        }
      });
      let raw = window.marked.parse(text);
      // Sanitize and tweak links
      // force external links open new tab
      raw = raw.replace(/<a\s+/g, '<a target="_blank" rel="noreferrer noopener" ');
      const clean = window.DOMPurify.sanitize(raw, { ALLOWED_ATTR: ['href','title','target','rel','src','alt','class'] });
      const html = `<div class="md-body">${clean}</div>`;
      // Extract URLs for simple cards
      const urls = extractUrls(text);
      const cards = urls.length ? `<div class="mt-2 space-y-2">${urls.map(renderUrlCard).join('')}</div>` : '';
      return html + cards;
    } catch (_) {
      return escapeHTML(text).replace(/\n/g, '<br/>');
    }
  }

  function urlRegex() {
    return /(https?:\/\/[^\s<>"]+)/g;
  }
  function extractUrls(text) {
    const r = urlRegex();
    const found = [];
    let m;
    while ((m = r.exec(text)) !== null) {
      let u = m[1];
      // trim trailing punctuation
      u = u.replace(/[),.;!?]+$/, '');
      found.push(u);
    }
    return Array.from(new Set(found));
  }
  function renderUrlCard(url) {
    try {
      const u = new URL(url);
      const host = u.host;
      const path = u.pathname + (u.search || '');
      return `
        <a class="block border rounded-lg p-3 bg-white text-slate-800 no-underline hover:bg-slate-50" href="${url}" target="_blank" rel="noreferrer noopener">
          <div class="text-sm font-medium truncate">${escapeHTML(host)}</div>
          <div class="text-xs text-slate-500 truncate">${escapeHTML(path || '/')}</div>
        </a>
      `;
    } catch {
      return `<a class="underline break-all" href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`;
    }
  }

  function renderFilePreviews(files) {
    if (!files.length) return '';
    const blocks = files.map(f => {
      const url = `/file/${f.id}`;
      const downloadUrl = `/file/${f.id}?download=1`;
      if (isImage(f)) {
        return `
          <div class="mt-2">
            <img src="${url}" alt="${escapeHTML(f.original_name)}" class="max-h-64 rounded-lg object-contain" />
            <div class="text-xs mt-1"><a class="underline" href="${downloadUrl}" target="_blank">下载 (${escapeHTML(f.original_name)})</a></div>
          </div>
        `;
      }
      if (isVideo(f)) {
        return `
          <div class="mt-2">
            <video class="max-h-64 rounded-lg" src="${url}" controls playsinline></video>
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
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || '发送失败');
        }
        textInput.value = '';
        fileInput.value = '';
        selectedFiles.textContent = '';
        syncHeight();
        setTimeout(scrollToBottom, 50);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // 移动端键盘/视口变化时，尽量保持在底部
    textInput.addEventListener('focus', () => setTimeout(scrollToBottom, 100));
    if (window.visualViewport) {
      const onVV = () => setTimeout(scrollToBottom, 50);
      window.visualViewport.addEventListener('resize', onVV);
      window.addEventListener('orientationchange', () => setTimeout(scrollToBottom, 300));
    }

    // 修改设备别名
    qs('#aliasBtn').addEventListener('click', async () => {
      const current = state.me?.device?.alias || '';
      const alias = prompt('设置设备别名：', current) || '';
      try {
        const res = await api('/device/alias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias }) });
        state.me.device = res.device;
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    // 全屏编辑器
    qs('#fsEditBtn').addEventListener('click', () => openFullscreenEditor(textInput.value));
  }

  function openFullscreenEditor(initialText = '') {
    const overlay = document.createElement('div');
    overlay.id = 'fs-editor';
    overlay.className = 'fixed inset-0 z-50 bg-white flex flex-col';
    overlay.innerHTML = `
      <header class="p-3 border-b flex items-center justify-between">
        <div class="font-medium">Markdown 全屏编辑</div>
        <div class="flex items-center gap-2">
          <button id="fsSend" class="bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800">发送 (Ctrl+Enter)</button>
          <button id="fsClose" class="border rounded px-3 py-1.5 hover:bg-slate-50">关闭 (Esc)</button>
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
    });
    sendBtn.addEventListener('click', () => {
      const mainInput = qs('#textInput');
      if (mainInput) {
        mainInput.value = input.value;
        qs('#composer')?.requestSubmit();
        close();
      }
    });
    input.focus();
  }

  function scrollToBottom() {
    const el = qs('#messages');
    if (!el) return;
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
    } catch (_) {
      // not logged in yet
      render();
    }
  })();
})();
