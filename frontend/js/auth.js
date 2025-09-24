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

async function passkeyLogin(alias) {
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

  // Setup Passkey button with clear UX on insecure context
  (async () => {
    const passkeyBtn = window.MyDropUtils.qs('#passkeyLoginBtn');
    if (!passkeyBtn) return;
    if (!('PublicKeyCredential' in window)) {
      // Not supported by browser; keep hidden
      return;
    }
    // Ensure button visible
    passkeyBtn.classList.remove('hidden');

    // Add hint area below button
    let hint = document.getElementById('passkeyHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'passkeyHint';
      hint.className = 'text-xs text-slate-500 text-center mt-2';
      passkeyBtn.insertAdjacentElement('afterend', hint);
    }

    const isHttps = location.protocol === 'https:';
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const secureOK = (window.isSecureContext === true) && (isHttps || isLocal);

    // Detect platform authenticator availability (best-effort)
    let platformOK = true;
    try {
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        platformOK = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch (_) { platformOK = true; }

    if (!secureOK) {
      passkeyBtn.setAttribute('disabled', 'true');
      passkeyBtn.title = '通行密钥需要 HTTPS 或 localhost';
      hint.textContent = '通行密钥需要 HTTPS 或 localhost，当前连接不支持。';
      return;
    }
    if (!platformOK) {
      passkeyBtn.setAttribute('disabled', 'true');
      passkeyBtn.title = '当前设备不支持通行密钥';
      hint.textContent = '当前设备不支持通行密钥。';
      return;
    }

    // All good: enable click handler
    passkeyBtn.removeAttribute('disabled');
    passkeyBtn.title = '';
    hint.textContent = '';
    passkeyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const alias = (window.MyDropUtils.qs('#loginAlias')?.value || '').toString();
      await passkeyLogin(alias);
    });
  })();
}

window.MyDropAuth = {
  renderLogin,
  bindLogin
};
