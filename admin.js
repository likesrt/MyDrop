(() => {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  async function api(path, opts={}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = '请求失败';
      try { const j = await res.json(); msg = j.error || msg; } catch(_){}
      throw new Error(msg);
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
  function toast(message, type='info') {
    const root = ensureToastRoot();
    const div = document.createElement('div');
    const color = type === 'error' ? 'bg-red-600' : type === 'warn' ? 'bg-amber-600' : type === 'success' ? 'bg-emerald-600' : 'bg-slate-900';
    div.className = `${color} text-white px-3 py-2 rounded shadow`;
    div.textContent = message;
    root.appendChild(div);
    setTimeout(() => { div.remove(); }, 3000);
  }

  async function init() {
    try {
      const me = await api('/me');
      qs('#currentUsername').textContent = me.user.username;
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
        await api('/admin/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        toast('保存成功', 'success');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        toast(err.message, 'error');
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

      const html = `
        <div class="card p-3 anim-fadeInUp" style="animation-delay:.1s">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="card-icon" aria-hidden="true"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5h12v8H3zM9 17h12v2H9zM15 9h6v4h-6z"/></svg></div>
              <div><div class="card-title">设备</div><div class="card-desc">已注册设备数</div></div>
            </div>
            <div class="text-xl font-semibold text-slate-800">${deviceCount}</div>
          </div>
          <div class="card-meta mt-2">最近活跃：${deviceLabel(lastDevice)}</div>
        </div>

        <div class="card p-3 anim-fadeInUp" style="animation-delay:.2s">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="card-icon" aria-hidden="true"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h10M4 17h7"/></svg></div>
              <div><div class="card-title">消息</div><div class="card-desc">本地显示的消息数</div></div>
            </div>
            <div class="text-xl font-semibold text-slate-800">${msgCount}</div>
          </div>
          <div class="card-meta mt-2">最新时间：${lastMsgTime}</div>
        </div>

        <div class="card p-3 anim-fadeInUp" style="animation-delay:.3s">
          <div class="flex items-center gap-2">
            <div class="card-icon" aria-hidden="true"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12M6 12h12"/></svg></div>
            <div><div class="card-title">上传限制</div><div class="card-desc">单个文件 ≤ ${cfg.fileSizeLimitMB}MB</div></div>
          </div>
          <div class="card-meta mt-2">全局文件上限：${cfg.maxFiles} 个</div>
        </div>

        <div class="card p-3 anim-fadeInUp" style="animation-delay:.4s">
          <div class="flex items-center gap-2 justify-between">
            <div class="flex items-center gap-2">
              <div class="card-icon" aria-hidden="true"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4z"/></svg></div>
              <div><div class="card-title">安全状态</div><div class="card-desc">当前用户：${qs('#currentUsername')?.textContent || ''}</div></div>
            </div>
            <a class="btn btn-primary pressable" href="/admin.html" aria-label="前往设置">设置</a>
          </div>
          <div class="card-meta mt-2">建议：使用强密码并妥善保管设备</div>
        </div>`;

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
        return `
          <div class="py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium text-slate-800">${(d.alias || short(d.device_id) || '未命名设备')}</div>
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
          if (!confirm('确认删除该设备？')) return;
          const also = confirm('是否同时删除该设备相关消息与文件？“确定”删除，“取消”保留');
          try {
            await api('/admin/device/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, removeMessages: also }) });
            toast('已删除设备' + (also ? '并清理消息' : ''), 'success');
            renderDevices();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      // ignore
    }
  }

  init();
})();
