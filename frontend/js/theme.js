// 主题切换（light / dark / auto），默认跟随系统（auto）
(() => {
  const KEY = 'theme'; // values: 'auto' | 'light' | 'dark'

  function get() {
    try { return localStorage.getItem(KEY) || 'light'; } catch (_) { return 'light'; }
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
    const cls = 'w-6 h-6 flex-shrink-0';
    const common = `class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"`;
    if (mode === 'dark') {
      // Moon (outline)
      return `<svg ${common}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
    } else if (mode === 'light') {
      // Sun (outline)
      return `<svg ${common}><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/></svg>`;
    } else {
      // Auto: half sun + half moon combined
      return `<svg ${common}><path d="M12 3a9 9 0 100 18 9 9 0 010-18z" opacity="0"/><path d="M12 3a9 9 0 100 18"/><path d="M12 8a4 4 0 104 4" opacity="0.5"/><path d="M12 2v3M12 19v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`;
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
