// 主题切换（light / dark / auto），默认跟随系统（auto）
(() => {
  const KEY = 'theme'; // values: 'auto' | 'light' | 'dark'

  function get() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; }
  }

  function save(mode) {
    try { localStorage.setItem(KEY, mode); } catch (_) {}
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === 'dark') root.setAttribute('data-theme', 'dark');
    else if (mode === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme'); // auto -> follow system
    updateToggleBtn(mode);
  }

  function systemIsDark() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return false; }
  }

  function nextMode(curr) {
    if (curr === 'auto') return 'dark';
    if (curr === 'dark') return 'light';
    return 'auto';
  }

  function iconSVG(mode) {
    if (mode === 'dark') {
      return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
    } else if (mode === 'light') {
      return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10 10h2v-3h-2v3zM4.96 19.36l1.41 1.41 1.8-1.79-1.42-1.42-1.79 1.8zM20 13h3v-2h-3v2zm-1.95 7.78l1.41-1.41-1.79-1.8-1.41 1.42 1.79 1.79zM13 1h-2v3h2V1zm4.24 3.05l-1.42 1.42 1.8 1.79 1.41-1.41-1.79-1.8zM12 6a6 6 0 100 12A6 6 0 0012 6z"/></svg>';
    } else {
      // auto: show A + current system icon cue
      const sysDark = systemIsDark();
      const cue = sysDark
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="opacity:.7;margin-left:2px"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="opacity:.7;margin-left:2px"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10 10h2v-3h-2v3zM4.96 19.36l1.41 1.41 1.8-1.79-1.42-1.42-1.79 1.8zM20 13h3v-2h-3v2zm-1.95 7.78l1.41-1.41-1.79-1.8-1.41 1.42 1.79 1.79zM13 1h-2v3h2V1zm4.24 3.05l-1.42 1.42 1.8 1.79 1.41-1.41-1.79-1.8zM12 6a6 6 0 100 12A6 6 0 0012 6z"/></svg>';
      return '<span style="font-weight:600">A</span>' + cue;
    }
  }

  function updateToggleBtn(mode) {
    try {
      const btn = document.getElementById('themeToggleBtn');
      if (!btn) return;
      btn.innerHTML = iconSVG(mode);
      const label = mode === 'auto' ? '自动（跟随系统）' : (mode === 'dark' ? '深色模式' : '浅色模式');
      btn.setAttribute('title', '切换主题：' + label);
      btn.setAttribute('aria-label', '切换主题：' + label);
    } catch (_) {}
  }

  function init() {
    const mode = get();
    apply(mode);
    // if auto, update on system change
    try {
      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener ? mq.addEventListener('change', () => { if (get() === 'auto') apply('auto'); }) : mq.addListener && mq.addListener(() => { if (get() === 'auto') apply('auto'); });
      }
    } catch (_) {}
  }

  // expose
  window.MyDropTheme = { get, set: (m)=>{ save(m); apply(m); }, apply, next: nextMode, init };

  // auto-init
  try { init(); } catch (_) {}
})();

