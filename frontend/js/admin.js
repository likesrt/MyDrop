// moved to templates/admin.js
(() => {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
  let currentDeviceId = null;

  async function api(path, opts={}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = res.status === 401 ? '未登录' : '请求失败';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_){}
      if (res.status === 401) { location.href = '/'; }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

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
  function formatError(err, tip='') {
    try {
      const msg = (err && err.message) ? String(err.message) : '请求失败';
      const code = (err && typeof err.status === 'number') ? ` (代码: ${err.status})` : '';
      return tip ? `${tip}：${msg}${code}` : `${msg}${code}`;
    } catch (_) { return tip ? `${tip}：请求失败` : '请求失败'; }
  }

  function toast(message, type='info') {
    const root = ensureToastRoot();
    const div = document.createElement('div');
    const t = (type === 'error' || type === 'warn' || type === 'success') ? type : 'info';
    div.className = `toast toast--${t}`;
    div.textContent = message;
    root.appendChild(div);
    setTimeout(() => { try { div.remove(); } catch(_){} }, 3000);
  }

  // 自定义弹窗（与前台一致）
  function ensureModalRoot() {
    let el = qs('#modal-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'modal-root';
      el.className = 'fixed inset-0 z-50 flex items-center justify-center p-3';
      document.body.appendChild(el);
    }
    try { el.style.pointerEvents = 'auto'; el.style.display = ''; } catch (_) {}
    return el;
  }
  function closeModal(root, overlay) {
    try { if (overlay) overlay.classList.add('opacity-0'); } catch (_) {}
    setTimeout(() => { try { root.remove(); } catch (_) {} }, 120);
  }
  function showConfirm(message, { title = '确认', confirmText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      const root = ensureModalRoot();
      const overlay = document.createElement('div');
      overlay.className = 'absolute inset-0 bg-black/50 transition-opacity';
      const card = document.createElement('div');
      card.className = 'relative modal-card rounded shadow-lg border w-full max-w-md p-4 space-y-3';
      card.innerHTML = `
        <div class="text-base font-medium text-slate-800">${String(title)}</div>
        <div class="text-sm text-slate-700">${String(message)}</div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <button class="btn pressable" data-act="cancel">${cancelText}</button>
          <button class="btn btn-primary pressable" data-act="ok">${confirmText}</button>
        </div>`;
      root.innerHTML = '';
      root.appendChild(overlay);
      root.appendChild(card);
      const now = (window.performance && performance.now) ? performance.now() : Date.now();
      const acceptAfter = now + 240;
      let armed = false; setTimeout(() => { armed = true; }, 180);
      const detach = () => document.removeEventListener('keydown', onKey);
      const onCancel = () => { detach(); closeModal(root, overlay); resolve(false); };
      const onOk = () => { detach(); closeModal(root, overlay); resolve(true); };
      card.addEventListener('click', (e) => e.stopPropagation());
      card.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
      card.querySelector('[data-act="ok"]').addEventListener('click', onOk);
      const onKey = (e) => {
        const t = (window.performance && performance.now) ? performance.now() : Date.now();
        if (!armed || t < acceptAfter) return;
        if (e.repeat) return;
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') onOk();
      };
      setTimeout(() => document.addEventListener('keydown', onKey), 0);
      overlay.addEventListener('click', () => { if (!armed || ((window.performance && performance.now?performance.now():Date.now()) < acceptAfter)) return; onCancel(); });
    });
  }

  async function init() {
    try {
      try { await window.MyDropTemplates.preloadTemplates(); } catch (_) {}
      const me = await api('/me');
      qs('#currentUsername').textContent = me.user.username;
      currentDeviceId = me?.device?.device_id || null;
      const notice = qs('#notice');
      if (me.user.needsPasswordChange) {
        notice.textContent = '检测到您仍在使用默认密码，请尽快修改。';
        notice.classList.remove('hidden');
      }
    } catch (e) {
      location.href = '/';
      return;
    }

    bindTabs();
    await renderDashboard();
    switchTab('dashboard');

    qs('#userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const username = (fd.get('username') || '').toString().trim();
      const oldPassword = (fd.get('oldPassword') || '').toString();
      const password = (fd.get('password') || '').toString();
      const password2 = (fd.get('password2') || '').toString();
      if (!oldPassword) return toast('请填写旧密码', 'warn');
      if (password || password2) {
        if (password !== password2) return toast('两次输入的新密码不一致', 'warn');
        if (password.length < 4) return toast('新密码过短', 'warn');
      }
      try {
        const body = { oldPassword };
        if (username) body.username = username;
        if (password) body.password = password;
        const resp = await api('/admin/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (resp?.loggedOut) {
          toast('密码已修改，请重新登录', 'success');
          setTimeout(() => { location.href = '/'; }, 600);
          return;
        }
        toast('保存成功', 'success');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        toast(formatError(err, '保存失败'), 'error');
      }
    });
  }

  function bindTabs() {
    const buttons = qsa('[data-tab]');
    buttons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab'))));
  }

  function switchTab(name) {
    const sections = ['dashboard','settings','devices','messages'];
    sections.forEach(id => {
      const el = qs(`#tab-${id}`);
      if (!el) return;
      if (id === name) el.classList.remove('hidden'); else el.classList.add('hidden');
    });
    qsa('[data-tab]').forEach(b => {
      if (b.getAttribute('data-tab') === name) b.classList.add('btn-primary'); else b.classList.remove('btn-primary');
    });
    if (name === 'devices') renderDevices();
    if (name === 'messages') renderMessages();
  }

  async function renderDashboard() {
    try {
      const [cfg, devices, msgs] = await Promise.all([
        api('/config'),
        api('/devices'),
        api('/messages?limit=1000')
      ]);
      const deviceCount = (devices.devices || []).length;
      const deviceLabel = (d) => (d?.alias || (d?.device_id ? (String(d.device_id).slice(0,4)+'…'+String(d.device_id).slice(-4)) : '未命名设备'));
      const lastDevice = (devices.devices || [])[0];
      const msgCount = (msgs.messages || []).length;
      const lastMsg = (msgs.messages || [])[msgCount - 1];
      const lastMsgTime = lastMsg ? new Date(lastMsg.created_at).toLocaleString() : '—';

      const html = await window.MyDropTemplates.getTemplate('admin-dashboard-cards', {
        deviceCount,
        lastDevice: deviceLabel(lastDevice),
        msgCount,
        lastMsgTime,
        fileSizeLimit: cfg.fileSizeLimitMB,
        maxFiles: cfg.maxFiles,
        currentUsername: (qs('#currentUsername')?.textContent || '')
      });
      qs('#dashboardCards').innerHTML = html;
    } catch (e) {
      // ignore dashboard if API fails
    }
  }

  async function renderDevices() {
    try {
      const data = await api('/devices');
      const list = data.devices || [];
      const root = qs('#deviceList');
      root.innerHTML = list.map(d => {
        const short = (s) => (s ? (String(s).slice(0,4)+'…'+String(s).slice(-4)) : '');
        const last = new Date(d.last_seen_at).toLocaleString();
        const isCurrent = currentDeviceId && d.device_id === currentDeviceId;
        const badge = isCurrent
          ? '<span class="ml-2 inline-block text-[11px] text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5 align-middle">当前设备</span>'
          : '';
        return `
          <div class="py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium text-slate-800">${(d.alias || short(d.device_id) || '未命名设备')}${badge}</div>
              <div class="text-xs text-slate-500">ID：${d.device_id}</div>
              <div class="text-xs text-slate-500">最近活跃：${last}</div>
              <div class="text-xs text-slate-500 truncate">UA：${(d.user_agent || '')}</div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <button class="btn pressable" data-action="delete" data-id="${d.device_id}">删除</button>
            </div>
          </div>`;
      }).join('');

      root.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const deviceId = btn.getAttribute('data-id');
          const ok = await showConfirm('确认删除该设备？');
          if (!ok) return;

          // 添加小延迟确保前一个弹窗完全关闭
          await new Promise(resolve => setTimeout(resolve, 200));

          const also = await showConfirm('是否同时删除该设备相关消息与文件？"确定"删除，"取消"保留');
          try {
            await api('/admin/device/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, removeMessages: also }) });
            toast('已删除设备' + (also ? '并清理消息' : ''), 'success');
            renderDevices();
          } catch (e) {
            toast(formatError(e, '删除设备失败'), 'error');
          }
        });
      });
    } catch (e) {
      // ignore
    }
  }

  async function renderMessages() {
    try {
      const [msgsRes, devRes] = await Promise.all([
        api('/messages?limit=1000'),
        api('/devices')
      ]);
      const items = (msgsRes.messages || []).slice().sort((a,b) => (b.created_at||0) - (a.created_at||0));
      const devices = devRes.devices || [];
      const root = qs('#messageListAdmin');
      const searchBox = qs('#searchInput');
      const deviceSel = qs('#deviceFilter');

      const shortId = (id) => (id ? (String(id).slice(0,4)+'…'+String(id).slice(-4)) : '');
      const deviceLabel = (d) => (d?.alias || (d?.device_id ? shortId(d.device_id) : '已删除设备'));

      // populate device filter options
      if (deviceSel) {
        const options = ['<option value="">全部设备</option>'].concat(
          devices.map(d => `<option value="${d.device_id}">${deviceLabel(d)}</option>`) 
        );
        deviceSel.innerHTML = options.join('');
      }
      const renderList = async () => {
        const q = (searchBox.value || '').toLowerCase().trim();
        const selectedDid = (deviceSel?.value || '').trim();
        let filtered = items;
        if (selectedDid) filtered = filtered.filter(m => (m.sender_device_id || '') === selectedDid);
        if (q) {
          filtered = filtered.filter(m => (m.text || '').toLowerCase().includes(q) || (m.files||[]).some(f => (f.original_name||'').toLowerCase().includes(q)));
        }
        filtered = filtered.slice().sort((a,b) => (b.created_at||0) - (a.created_at||0));
        // legacy render (kept for fallback)
        root.innerHTML = filtered.map(m => {
          const time = new Date(m.created_at).toLocaleString();
          const sLabel = deviceLabel(m.sender);
          const files = (m.files||[]).map(f => `<div class=\"text-xs text-slate-600 flex items-center gap-2\">📎 ${f.original_name} <button class=\"btn pressable\" data-action=\"file-del\" data-id=\"${f.id}\">删除文件</button></div>`).join('');
          const preview = (m.text || '').slice(0, 80).replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return `
            <div class=\"card p-3 cursor-pointer\" id=\"message-${m.id}\" data-mid=\"${m.id}\" title=\"点击跳转至聊天\"> 
              <div class=\"flex items-start justify-between gap-3\">
                <div class=\"min-w-0\">
                  <div class=\"font-medium text-slate-800\">消息 #${m.id} · ${time} · 设备：${sLabel}</div>
                  <div class=\"text-sm text-slate-700 break-words\">${preview || '<span class=\"text-slate-400\">(无文本)</span>'}</div>
                  ${files ? `<div class=\"mt-1 space-y-1\">${files}</div>` : ''}
                </div>
                <div class=\"shrink-0\"><button class=\"btn pressable\" data-action=\"msg-del\" data-id=\"${m.id}\">删除消息</button></div>
              </div>
            </div>`;
        }).join('');
        // template-based render (overrides legacy for consistency)
        try {
          const rows = await Promise.all(filtered.map(async (m) => {
            const time = new Date(m.created_at).toLocaleString();
            const sLabel = deviceLabel(m.sender);
            const preview = (m.text || '').slice(0, 80).replace(/</g,'&lt;').replace(/>/g,'&gt;') || '<span class="text-slate-400">(无文本)</span>';
            const files = (m.files||[]).map(f => `<div class=\"text-xs card-desc flex items-center gap-2\">📎 ${f.original_name} <button class=\"btn pressable\" data-action=\"file-del\" data-id=\"${f.id}\">删除文件</button></div>`).join('');
            const filesHTML = files ? `<div class=\"mt-1 space-y-1\">${files}</div>` : '';
            return await window.MyDropTemplates.getTemplate('admin-message-item', { id: m.id, time, senderLabel: sLabel, previewHTML: preview, filesHTML });
          }));
          root.innerHTML = rows.join('');
        } catch (_) {}

        // bind actions
        root.querySelectorAll('[data-action="msg-del"]').forEach(b => b.addEventListener('click', async () => {
          const id = parseInt(b.getAttribute('data-id'), 10);
          const ok = await showConfirm(`确认删除消息 #${id}？`);
          if (!ok) return;
          try {
            await api('/admin/message/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: id }) });
            toast('已删除消息', 'success');
            // remove locally
            const idx = items.findIndex(x => x.id === id);
            if (idx >= 0) items.splice(idx, 1);
            renderList();
          } catch (e) { toast(formatError(e, '删除消息失败'), 'error'); }
        }));
        root.querySelectorAll('[data-action="file-del"]').forEach(b => b.addEventListener('click', async () => {
          const id = parseInt(b.getAttribute('data-id'), 10);
          const ok = await showConfirm(`确认删除文件 #${id}？`);
          if (!ok) return;
          try {
            await api('/admin/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: id }) });
            toast('已删除文件', 'success');
            // remove locally
            for (const m of items) {
              const i = (m.files||[]).findIndex(f => f.id === id);
              if (i >= 0) { m.files.splice(i,1); break; }
            }
            renderList();
          } catch (e) { toast(formatError(e, '删除文件失败'), 'error'); }
        }));

        // 点击消息卡片跳转到聊天页对应锚点
        root.querySelectorAll('.card[data-mid]').forEach(card => {
          card.addEventListener('click', (ev) => {
            const isBtn = ev.target.closest('button');
            if (isBtn) return;
            const mid = card.getAttribute('data-mid');
            if (mid) { location.href = '/#message-' + mid; }
          });
        });
      };

      if (searchBox) {
        searchBox.removeEventListener('_search', ()=>{});
        searchBox.addEventListener('input', renderList);
      }
      if (deviceSel) {
        deviceSel.addEventListener('change', renderList);
      }
      renderList();
    } catch (e) {
      // ignore
    }
  }

  init();
})();
