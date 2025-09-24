// 登录认证相关

async function renderLogin() {
  return await window.MyDropTemplates.getTemplate('login-form');
}

function b64url(buf) {
  const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function handleTotpFlow(mfaToken) {
  try {
    const { value: code } = await Swal.fire({
      title: '请输入二步验证码',
      input: 'text',
      inputLabel: '认证器上的6位数字',
      inputPlaceholder: '123456',
      inputAttributes: { autocapitalize: 'off', autocorrect: 'off', inputmode: 'numeric' },
      showCancelButton: true,
      confirmButtonText: '验证',
      cancelButtonText: '取消'
    });
    if (!code) return;
    await window.MyDropAPI.api('/login/totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken, code }) });
    await window.MyDropAPI.loadBasics();
    await window.MyDropApp.render();
    window.MyDropWebSocket.openWS();
    await window.MyDropAPI.loadInitialMessages();
    await window.MyDropApp.render();
  } catch (err) {
    window.MyDropUI.toast(window.MyDropUI.formatError(err, '二步验证失败'), 'error');
  }
}

async function passkeyLogin(alias, remember) {
  try {
    const start = await window.MyDropAPI.api('/webauthn/login/start', { method: 'POST' });
    const pub = start.publicKey;
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: Uint8Array.from(atob(pub.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
      rpId: pub.rpId,
      timeout: pub.timeout || 60000,
      userVerification: pub.userVerification || 'preferred'
    }});
    const resp = cred.response;
    const payload = {
      flowId: start.flowId,
      id: cred.id,
      deviceId: window.MyDropUtils.getDeviceId(),
      alias: alias || '',
      remember: !!remember,
      response: {
        clientDataJSON: b64url(resp.clientDataJSON),
        authenticatorData: b64url(resp.authenticatorData),
        signature: b64url(resp.signature),
        userHandle: resp.userHandle ? b64url(resp.userHandle) : null
      }
    };
    await window.MyDropAPI.api('/webauthn/login/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await window.MyDropAPI.loadBasics();
    await window.MyDropApp.render();
    window.MyDropWebSocket.openWS();
    await window.MyDropAPI.loadInitialMessages();
    await window.MyDropApp.render();
  } catch (err) {
    window.MyDropUI.toast(window.MyDropUI.formatError(err, '通行密钥登录失败'), 'error');
  }
}

function bindLogin() {
  const form = window.MyDropUtils.qs('#loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      username: fd.get('username'),
      password: fd.get('password'),
      alias: fd.get('alias') || '',
      deviceId: window.MyDropUtils.getDeviceId(),
      remember: !!fd.get('remember')
    };
    try {
      const resp = await window.MyDropAPI.api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (resp && resp.mfaRequired === 'totp' && resp.mfaToken) {
        await handleTotpFlow(resp.mfaToken);
        return;
      }
      await window.MyDropAPI.loadBasics();
      await window.MyDropApp.render();
      window.MyDropWebSocket.openWS();
      await window.MyDropAPI.loadInitialMessages();
      await window.MyDropApp.render();
    } catch (err) {
      window.MyDropUI.toast(window.MyDropUI.formatError(err, '登录失败'), 'error');
    }
  });

  // Passkey button: always toast reasons on click (no static hints)
  (async () => {
    const passkeyBtn = window.MyDropUtils.qs('#passkeyLoginBtn');
    const qrBtn = window.MyDropUtils.qs('#qrLoginBtn');
    if (!passkeyBtn) return;
    // Always show the button; handle capability checks on click
    passkeyBtn.classList.remove('hidden');

    passkeyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const alias = (window.MyDropUtils.qs('#loginAlias')?.value || '').toString();
      const remember = !!(window.MyDropUtils.qs('#rememberMe')?.checked);

      // Security context first: prefer域名/协议提示而非浏览器不支持
      const isHttps = location.protocol === 'https:';
      const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
      const secureOK = (window.isSecureContext === true) && (isHttps || isLocal);
      if (!secureOK) {
        try { window.MyDropUI.toast('当前域名/协议不支持通行密钥，请使用 HTTPS 或 localhost', 'warn'); } catch (_) { alert('当前域名/协议不支持通行密钥，请使用 HTTPS 或 localhost'); }
        return;
      }

      // Browser support
      if (!('PublicKeyCredential' in window)) {
        try { window.MyDropUI.toast('当前浏览器不支持通行密钥', 'warn'); } catch (_) { alert('当前浏览器不支持通行密钥'); }
        return;
      }

      // Platform authenticator availability (best-effort)
      let platformOK = true;
      try {
        if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
          platformOK = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        }
      } catch (_) { platformOK = true; }
      if (!platformOK) {
        try { window.MyDropUI.toast('当前设备不支持通行密钥', 'warn'); } catch (_) { alert('当前设备不支持通行密钥'); }
        return;
      }

      // Proceed with passkey login (handles its own toasts on error)
      await passkeyLogin(alias, remember);
    });

    if (qrBtn) {
      qrBtn.addEventListener('click', async () => {
        try {
          const start = await window.MyDropAPI.api('/login/qr/start', { method: 'POST' });
          const rid = start.rid; const code = start.code; const expiresAt = start.expiresAt || 0;
          const alias = (window.MyDropUtils.qs('#loginAlias')?.value || '').toString();
          const remember = !!(window.MyDropUtils.qs('#rememberMe')?.checked);
          const deviceId = window.MyDropUtils.getDeviceId();
          const imgUrl = `/login/qr/svg?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;
          const endAt = expiresAt ? new Date(expiresAt) : null;

          let timer = null; let closed = false;
          const poll = async () => {
            if (closed) return;
            try {
              const st = await window.MyDropAPI.api(`/login/qr/status?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`);
              if (st && st.approved && !st.consumed) {
                const body = { rid, code, deviceId, alias, remember };
                await window.MyDropAPI.api('/login/qr/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                closed = true;
                try { Swal.close(); } catch (_) {}
                await window.MyDropAPI.loadBasics();
                await window.MyDropApp.render();
                window.MyDropWebSocket.openWS();
                await window.MyDropAPI.loadInitialMessages();
                await window.MyDropApp.render();
                return;
              }
            } catch (_) { /* ignore transient */ }
            timer = setTimeout(poll, 1500);
          };

          try {
            await Swal.fire({
              title: '扫码登录',
              html: `<div class="space-y-2"><img alt="二维码" src="${imgUrl}" class="mx-auto border rounded" /><div class="text-xs text-slate-500">请使用已登录设备扫描二维码进行授权${endAt?`，有效期至：${endAt.toLocaleTimeString()}`:''}</div></div>`,
              showConfirmButton: false,
              showCancelButton: true,
              cancelButtonText: '取消',
              didOpen: () => { poll(); },
              willClose: () => { closed = true; try { if (timer) clearTimeout(timer); } catch (_) {} },
            });
          } finally {
            closed = true; try { if (timer) clearTimeout(timer); } catch (_) {}
          }
        } catch (err) {
          window.MyDropUI.toast(window.MyDropUI.formatError(err, '无法开始扫码登录'), 'error');
        }
      });
    }
  })();
}

window.MyDropAuth = {
  renderLogin,
  bindLogin
};
