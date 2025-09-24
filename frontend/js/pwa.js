// PWA install prompt handling
(function(){
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    try { e.preventDefault(); } catch(_) {}
    deferredPrompt = e;
    try { showInstallUI(true); } catch(_) {}
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { showInstallUI(false); } catch(_) {}
  });

  function showInstallUI(visible) {
    try {
      const btn = document.getElementById('installBtn');
      if (!btn) return;
      if (visible) btn.classList.remove('hidden'); else btn.classList.add('hidden');
    } catch (_) {}
  }

  async function requestInstall() {
    if (!deferredPrompt) return false;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      showInstallUI(false);
      return outcome === 'accepted';
    } catch (_) { return false; }
  }

  function bindInstall() {
    const btn = document.getElementById('installBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const ok = await requestInstall();
      try { if (ok) window.MyDropUI?.toast('已发送安装请求', 'success'); } catch(_) {}
    }, { once: false });
    // If event already captured earlier, reveal button now
    showInstallUI(!!deferredPrompt);
  }

  window.MyDropPWA = { bindInstall };
})();

