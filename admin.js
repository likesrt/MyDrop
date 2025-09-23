(() => {
  const qs = (s, el = document) => el.querySelector(s);

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

  init();
})();

