// UI 组件和通知相关

// Toast 通知
function ensureToastRoot() {
  let el = window.MyDropUtils.qs('#toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-root';
    el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2 w-[92%] max-w-md';
    document.body.appendChild(el);
  }
  return el;
}

function formatError(err, tip = '') {
  try {
    const msg = (err && err.message) ? String(err.message) : '请求失败';
    const code = (err && typeof err.status === 'number') ? ` (代码: ${err.status})` : '';
    return tip ? `${tip}：${msg}${code}` : `${msg}${code}`;
  } catch (_) {
    return tip ? `${tip}：请求失败` : '请求失败';
  }
}

function toast(message, type = 'info') {
  const root = ensureToastRoot();
  const div = document.createElement('div');
  const t = (type === 'error' || type === 'warn' || type === 'success') ? type : 'info';
  div.className = `toast toast-enter toast--${t}`;
  div.textContent = message;
  root.appendChild(div);
  requestAnimationFrame(() => {
    div.classList.remove('toast-enter');
    div.classList.add('toast-enter-active');
  });
  const timer = setTimeout(() => close(), 3000);
  function close() {
    clearTimeout(timer);
    div.classList.add('toast-leave-active');
    setTimeout(() => div.remove(), 200);
  }
  div.addEventListener('click', close);
}

// 模态框相关
function ensureModalRoot() {
  let el = window.MyDropUtils.qs('#modal-root');
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
    overlay.className = 'absolute inset-0 bg-black/30 transition-opacity';
    const card = document.createElement('div');
    card.className = 'relative modal-card rounded shadow-lg border w-full max-w-md p-4 space-y-3 anim-fadeIn';
    card.innerHTML = `
      <div class="text-base font-medium text-slate-800">${window.MyDropUtils.escapeHTML(title)}</div>
      <div class="text-sm text-slate-700">${window.MyDropUtils.escapeHTML(String(message||''))}</div>
      <div class="flex items-center justify-end gap-2 pt-1">
        <button class="btn pressable" data-act="cancel">${window.MyDropUtils.escapeHTML(cancelText)}</button>
        <button class="btn btn-primary pressable" data-act="ok">${window.MyDropUtils.escapeHTML(confirmText)}</button>
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

function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 bg-black/30 transition-opacity';
    const card = document.createElement('div');
    card.className = 'relative modal-card rounded shadow-lg border w-full max-w-md p-4 space-y-3 anim-fadeIn';
    card.innerHTML = `
      <div class="text-base font-medium text-slate-800">${window.MyDropUtils.escapeHTML(String(message||''))}</div>
      <div><input id="_promptInput" class="w-full border rounded px-3 py-2" value="${window.MyDropUtils.escapeHTML(String(defaultValue||''))}" /></div>
      <div class="flex items-center justify-end gap-2 pt-1">
        <button class="btn pressable" data-act="cancel">取消</button>
        <button class="btn btn-primary pressable" data-act="ok">确定</button>
      </div>`;
    root.innerHTML = '';
    root.appendChild(overlay);
    root.appendChild(card);
    const input = card.querySelector('#_promptInput');

    const now = (window.performance && performance.now) ? performance.now() : Date.now();
    const acceptAfter = now + 240;
    let armed = false; setTimeout(() => { armed = true; }, 180);
    const detach = () => document.removeEventListener('keydown', onKey);
    const onCancel = () => { detach(); closeModal(root, overlay); resolve(null); };
    const onOk = () => { const v = input.value; detach(); closeModal(root, overlay); resolve(v); };
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
    setTimeout(() => { input.focus(); input.select(); document.addEventListener('keydown', onKey); }, 0);
    overlay.addEventListener('click', () => { if (!armed || ((window.performance && performance.now?performance.now():Date.now()) < acceptAfter)) return; onCancel(); });
  });
}

// 剪贴板
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
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

window.MyDropUI = {
  toast,
  formatError,
  showConfirm,
  showPrompt,
  copyToClipboard
};
