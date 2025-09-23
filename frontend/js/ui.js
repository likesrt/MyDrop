// UI 组件和通知相关（统一使用 SweetAlert2）

function formatError(err, tip = '') {
  try {
    const msg = (err && err.message) ? String(err.message) : '请求失败';
    const code = (err && typeof err.status === 'number') ? ` (代码: ${err.status})` : '';
    return tip ? `${tip}：${msg}${code}` : `${msg}${code}`;
  } catch (_) {
    return tip ? `${tip}：请求失败` : '请求失败';
  }
}

const _ToastActiveKeys = new Set();
function toast(message, type = 'info', opts = {}) {
  // 自定义顶部居中堆叠提示，避免 SweetAlert2 的互相覆盖问题
  const timer = Number.isFinite(opts.timer) ? Math.max(1000, opts.timer | 0) : 2200;
  const key = opts.key ? String(opts.key) : null;
  if (key && _ToastActiveKeys.has(key)) return Promise.resolve();
  if (key) _ToastActiveKeys.add(key);

  try {
    let container = document.getElementById('mydropToastStackTop');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mydropToastStackTop';
      container.style.position = 'fixed';
      container.style.top = '10px';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center';
      container.style.pointerEvents = 'none'; // 不阻挡点击
      document.body.appendChild(container);
    }

    const item = document.createElement('div');
    item.textContent = String(message || '');
    item.setAttribute('role', 'status');
    item.style.pointerEvents = 'none'; // 不可点击，避免遮挡
    item.style.background = 'var(--surface)';
    item.style.color = 'var(--text)';
    item.style.border = '1px solid var(--border)';
    item.style.padding = '8px 12px';
    item.style.borderRadius = '10px';
    item.style.boxShadow = '0 8px 24px rgba(0,0,0,.12)';
    item.style.marginTop = '8px';
    item.style.fontSize = '13px';
    item.style.maxWidth = '86vw';
    item.style.textAlign = 'center';
    item.style.opacity = '0';
    item.style.transform = 'translateY(-6px)';
    item.style.transition = 'opacity .2s ease, transform .2s ease';
    // 左侧色条区分类型
    const bar = document.createElement('span');
    bar.style.display = 'inline-block';
    bar.style.width = '4px';
    bar.style.height = '1.1em';
    bar.style.marginRight = '8px';
    bar.style.verticalAlign = '-2px';
    bar.style.borderRadius = '2px';
    bar.style.background = (type === 'error') ? '#ef4444' : (type === 'warn' ? '#f59e0b' : (type === 'success' ? '#10b981' : '#3b82f6'));
    const text = document.createElement('span');
    text.textContent = String(message || '');
    // 包裹一层使布局不跳
    const inner = document.createElement('span');
    inner.style.display = 'inline-flex';
    inner.style.alignItems = 'center';
    inner.appendChild(bar);
    inner.appendChild(text);
    item.innerHTML = '';
    item.appendChild(inner);

    container.appendChild(item);
    requestAnimationFrame(() => {
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    });

    const hide = () => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(-6px)';
      setTimeout(() => { try { item.remove(); } catch(_){} }, 220);
      if (key) _ToastActiveKeys.delete(key);
    };
    const tid = setTimeout(hide, timer);
    // 返回一个可等待的 Promise
    return new Promise(res => setTimeout(res, timer)).finally(() => { clearTimeout(tid); if (key) _ToastActiveKeys.delete(key); });
  } catch (_) {
    if (key) _ToastActiveKeys.delete(key);
    alert(String(message || ''));
    return Promise.resolve();
  }
}

function showConfirm(message, { title = '确认', confirmText = '确定', cancelText = '取消' } = {}) {
  if (window.Swal && Swal.fire) {
    return Swal.fire({ title: String(title || '确认'), text: String(message || ''), icon: 'warning', showCancelButton: true, confirmButtonText: String(confirmText || '确定'), cancelButtonText: String(cancelText || '取消') }).then(res => !!res.isConfirmed);
  }
  return Promise.resolve(window.confirm(String(message || '确认操作？')));
}

function showPrompt(message, defaultValue = '') {
  if (window.Swal && Swal.fire) {
    return Swal.fire({ title: String(message || ''), input: 'text', inputValue: String(defaultValue || ''), showCancelButton: true, confirmButtonText: '确定', cancelButtonText: '取消' }).then(res => res.isConfirmed ? res.value : null);
  }
  const v = window.prompt(String(message || ''), String(defaultValue || ''));
  return Promise.resolve(v === null ? null : String(v));
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
  copyToClipboard,
  setupAutoHideHeader,
  showHint
};

// 简易提示：底部堆叠提示，避免与顶部 Toast 冲突
function showHint(message, { duration = 3000 } = {}) {
  try {
    let container = document.getElementById('mydropHintStack');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mydropHintStack';
      container.style.position = 'fixed';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.bottom = '60px'; // 避开底部触发区
      container.style.zIndex = '1000';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center';
      container.style.pointerEvents = 'none';
      document.body.appendChild(container);
    }
    const item = document.createElement('div');
    item.textContent = String(message || '');
    item.style.pointerEvents = 'auto';
    item.style.background = 'rgba(0,0,0,.78)';
    item.style.color = '#fff';
    item.style.padding = '8px 12px';
    item.style.borderRadius = '8px';
    item.style.boxShadow = '0 4px 14px rgba(0,0,0,.18)';
    item.style.marginTop = '8px';
    item.style.fontSize = '13px';
    item.style.maxWidth = '86vw';
    item.style.textAlign = 'center';
    item.style.opacity = '0';
    item.style.transform = 'translateY(6px)';
    item.style.transition = 'opacity .2s ease, transform .2s ease';
    container.appendChild(item);
    requestAnimationFrame(() => {
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    });
    const hide = () => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      setTimeout(() => { try { item.remove(); } catch (_) {} }, 220);
    };
    const tid = setTimeout(hide, Math.max(1000, duration|0));
    item.addEventListener('click', () => { clearTimeout(tid); hide(); });
  } catch (_) {}
}

// 自动隐藏 Header（移动端）
function setupAutoHideHeader(enabled) {
  try {
    const header = document.getElementById('mainHeader');
    if (!header) return;
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    // 清理旧状态
    header.classList.remove('auto-hide');
    header.classList.remove('hidden');
    const oldReveal = document.getElementById('headerReveal');
    if (oldReveal) try { oldReveal.remove(); } catch(_) {}
    if (!enabled || !isMobile) return;

    header.classList.add('auto-hide');
    header.classList.add('hidden');

    // 顶部唤起区域（固定在屏幕顶部 50px 内，点击/移入显示 header）
    const reveal = document.createElement('div');
    reveal.id = 'headerReveal';
    reveal.style.position = 'fixed';
    reveal.style.top = '0';
    reveal.style.left = '0';
    reveal.style.right = '0';
    reveal.style.height = '50px';
    reveal.style.zIndex = '9';
    reveal.style.pointerEvents = 'auto';
    reveal.style.background = 'transparent';
    document.body.appendChild(reveal);

    let hideTimer = null;
    let guardTimer = null;
    const guardMs = 280; // 首次点击仅用于唤起，延迟后再允许点击 header
    const showHeader = () => {
      header.classList.remove('hidden');
      // 首次唤起后短暂保留触发区接管点击，防止同一次点击命中 header 按钮
      try { reveal.style.pointerEvents = 'auto'; } catch(_) {}
      if (guardTimer) { clearTimeout(guardTimer); guardTimer = null; }
      guardTimer = setTimeout(() => { try { reveal.style.pointerEvents = 'none'; } catch(_) {} }, guardMs);
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      hideTimer = setTimeout(() => {
        header.classList.add('hidden');
        // 隐藏后恢复触发区
        try { reveal.style.pointerEvents = 'auto'; } catch(_) {}
        try { toast('点击屏幕顶部显示设置栏', 'info', { position: 'top', timer: 2200, key: 'header-hint' }); } catch (_) {}
      }, 10000);
    };
    const keepOpen = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    };
    const scheduleHide = () => {
      if (hideTimer) { clearTimeout(hideTimer); }
      hideTimer = setTimeout(() => {
        header.classList.add('hidden');
        try { reveal.style.pointerEvents = 'auto'; } catch(_) {}
        try { toast('点击屏幕顶部显示设置栏', 'info', { position: 'top', timer: 2200, key: 'header-hint' }); } catch (_) {}
      }, 10000);
    };

    // 交互：鼠标移入/点击顶部触发；移出后延时隐藏
    reveal.addEventListener('mouseenter', showHeader);
    const onReveal = (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); } catch(_) {}
      showHeader();
    };
    reveal.addEventListener('click', onReveal, true);
    reveal.addEventListener('touchstart', onReveal, { passive: false, capture: true });
    header.addEventListener('mouseenter', keepOpen);
    header.addEventListener('mouseleave', scheduleHide);
    header.addEventListener('touchstart', keepOpen, { passive: true });

    // 页面打开提示（使用去重 key；如已显示则不重复）
    try { toast('点击屏幕顶部显示设置栏', 'info', { position: 'top', timer: 2200, key: 'header-hint' }); } catch (_) {}
  } catch (_) {}
}
