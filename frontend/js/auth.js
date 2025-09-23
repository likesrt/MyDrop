// 登录认证相关

async function renderLogin() {
  return await window.MyDropTemplates.getTemplate('login-form');
}

function bindLogin() {
  window.MyDropUtils.qs('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      username: fd.get('username'),
      password: fd.get('password'),
      alias: fd.get('alias') || '',
      deviceId: window.MyDropUtils.getDeviceId(),
    };
    try {
      await window.MyDropAPI.api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await window.MyDropAPI.loadBasics();
      await window.MyDropApp.render();
      window.MyDropWebSocket.openWS();
      await window.MyDropAPI.loadInitialMessages();
      await window.MyDropApp.render();
    } catch (err) {
      window.MyDropUI.toast(window.MyDropUI.formatError(err, '登录失败'), 'error');
    }
  });
}

window.MyDropAuth = {
  renderLogin,
  bindLogin
};
