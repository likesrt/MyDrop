// moved to templates/admin.js
(() => {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
  let currentDeviceId = null;

  async function api(path, opts={}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = res.status === 401 ? '未登录' : '请求失败';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_){}
      if (res.status === 401) { location.href = '/'; }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function formatError(err, tip='') {
    try {
      const msg = (err && err.message) ? String(err.message) : '请求失败';
      const code = (err && typeof err.status === 'number') ? ` (代码: ${err.status})` : '';
      return tip ? `${tip}：${msg}${code}` : `${msg}${code}`;
    } catch (_) { return tip ? `${tip}：请求失败` : '请求失败'; }
  }

  function toast(message, type='info') { try { window.MyDropUI.toast(message, type); } catch (_) { alert(String(message||'')); } }

  // 自定义弹窗（与前台一致）
  function showConfirm(message, { title = '确认', confirmText = '确定', cancelText = '取消' } = {}) {
    if (window.MyDropUI && window.MyDropUI.showConfirm) return window.MyDropUI.showConfirm(message, { title, confirmText, cancelText });
    return Promise.resolve(window.confirm(String(message||'确认操作？')));
  }

  async function init() {
    try {
      try { await window.MyDropTemplates.preloadTemplates(); } catch (_) {}
      // 读取公共配置（管理页不启用 Header 自动隐藏）
      try { await api('/config'); } catch(_) {}
      const me = await api('/me');
      qs('#currentUsername').textContent = me.user.username;
      currentDeviceId = me?.device?.device_id || null;
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
        const resp = await api('/admin/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (resp?.loggedOut) {
          toast('密码已修改，请重新登录', 'success');
          setTimeout(() => { location.href = '/'; }, 600);
          return;
        }
        toast('保存成功', 'success');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        toast(formatError(err, '保存失败'), 'error');
      }
    });

    // MFA + Passkeys
    try { await setupMFAAndPasskeys(); } catch (_) {}
  }

  function bindTabs() {
    const buttons = qsa('[data-tab]');
    buttons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab'))));
  }

  function switchTab(name) {
    const sections = ['dashboard','settings','devices','messages','cache'];
    sections.forEach(id => {
      const el = qs(`#tab-${id}`);
      if (!el) return;
      if (id === name) el.classList.remove('hidden'); else el.classList.add('hidden');
    });
    qsa('[data-tab]').forEach(b => {
      if (b.getAttribute('data-tab') === name) b.classList.add('btn-primary'); else b.classList.remove('btn-primary');
    });
    if (name === 'devices') renderDevices();
    if (name === 'messages') renderMessages();
    if (name === 'cache') bindCacheTools();
  }

  async function setupMFAAndPasskeys() {
    // Load status
    let me = null;
    try { me = await api('/me'); } catch (_) { return; }
    const totpStatus = qs('#totpStatus');
    const enableBtn = qs('#totpEnableBtn');
    const disableBtn = qs('#totpDisableBtn');
    const updateTotpUI = () => {
      const on = !!(me?.user?.totpEnabled);
      if (totpStatus) totpStatus.textContent = on ? '已开启' : '未开启';
      if (enableBtn) enableBtn.disabled = on;
      if (disableBtn) disableBtn.disabled = !on;
    };
    updateTotpUI();

    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        try {
          const { value: password } = await Swal.fire({ title: '验证密码以开启', input: 'password', inputAttributes: { autocapitalize: 'off' }, showCancelButton: true, confirmButtonText: '继续', cancelButtonText: '取消' });
          if (!password) return;
          const begun = await api('/mfa/totp/begin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
          const secret = begun.secret;
          const otpauth = begun.otpauth;
          await Swal.fire({ title: '在认证器中添加账号', html: `<div class="text-left text-sm"><div class="mx-auto" style="width:220px"><img src="/mfa/totp/qr?otpauth=${encodeURIComponent(otpauth)}" alt="QR"/></div><div class="mt-3">密钥：<code>${secret}</code></div><div class="break-all">URI：<code>${otpauth}</code></div><div class="mt-2 text-slate-500">提示：扫描二维码或复制密钥到您的认证器，随后输入显示的6位验证码。</div></div>`, confirmButtonText: '我已添加，下一步' });
          const { value: code } = await Swal.fire({ title: '输入验证码', input: 'text', inputAttributes: { inputmode: 'numeric', autocapitalize: 'off', autocorrect: 'off' }, showCancelButton: true, confirmButtonText: '启用', cancelButtonText: '取消' });
          if (!code) return;
          await api('/mfa/totp/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, code }) });
          me.user.totpEnabled = true;
          updateTotpUI();
          toast('已开启二步验证', 'success');
        } catch (e) {
          toast(formatError(e, '开启失败'), 'error');
        }
      });
    }
    if (disableBtn) {
      disableBtn.addEventListener('click', async () => {
        try {
          const { value: password } = await Swal.fire({ title: '验证密码以关闭', input: 'password', showCancelButton: true, confirmButtonText: '关闭', cancelButtonText: '取消' });
          if (!password) return;
          await api('/mfa/totp/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
          me.user.totpEnabled = false;
          updateTotpUI();
          toast('已关闭二步验证', 'success');
        } catch (e) { toast(formatError(e, '关闭失败'), 'error'); }
      });
    }

    // Passkeys
    const passkeyBtn = qs('#passkeyRegisterBtn');
    if (passkeyBtn && 'PublicKeyCredential' in window) {
      passkeyBtn.addEventListener('click', async () => {
        try {
          const start = await api('/webauthn/register/start', { method: 'POST' });
          const pub = start.publicKey;
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: Uint8Array.from(atob(pub.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
            rp: pub.rp,
            user: { id: new Uint8Array(pub.user.id?.data || pub.user.id || []), name: pub.user.name, displayName: pub.user.displayName },
            pubKeyCredParams: pub.pubKeyCredParams,
            timeout: pub.timeout || 60000,
            attestation: pub.attestation || 'none',
            authenticatorSelection: pub.authenticatorSelection || { residentKey: 'preferred', userVerification: 'preferred' },
          }});
          const attObj = new Uint8Array(cred.response.attestationObject);
          const clientDataJSON = new Uint8Array(cred.response.clientDataJSON);
          // Parse attestation to get public key (PEM) and signCount
          const parsed = parseAttestation(attObj);
          const pubkeyPem = coseToPEM(parsed.credentialPublicKey);
          await api('/webauthn/register/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId: start.flowId, credentialId: cred.id, publicKeyPem: pubkeyPem, signCount: parsed.signCount }) });
          toast('通行密钥注册成功', 'success');
          await renderPasskeys();
        } catch (e) {
          toast(formatError(e, '注册失败'), 'error');
        }
      });
    } else if (passkeyBtn) {
      passkeyBtn.disabled = true;
      passkeyBtn.title = '此浏览器不支持通行密钥';
    }

    await renderPasskeys();
  }

  async function renderPasskeys() {
    const root = qs('#passkeyList');
    if (!root) return;
    try {
      const list = await api('/webauthn/credentials');
      const items = list.credentials || [];
      if (!items.length) { root.innerHTML = '<div class="text-sm text-slate-500 py-2">暂无通行密钥</div>'; return; }
      root.innerHTML = items.map(c => {
        const created = c.created_at ? new Date(c.created_at).toLocaleString() : '';
        return `<div class="py-2 flex items-center justify-between"><div class="min-w-0"><div class="font-medium text-slate-800 truncate">${c.id}</div><div class="text-xs text-slate-500">创建时间：${created}${c.sign_count?` · 计数：${c.sign_count}`:''}</div></div><div class="shrink-0"><button class="btn pressable" data-del="${c.id}">删除</button></div></div>`;
      }).join('');
      root.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-del');
        const ok = await showConfirm('确认删除该通行密钥？');
        if (!ok) return;
        try { await api('/webauthn/credential/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); toast('已删除', 'success'); renderPasskeys(); } catch (e) { toast(formatError(e, '删除失败'), 'error'); }
      }));
    } catch (_) {
      root.innerHTML = '<div class="text-sm text-slate-500 py-2">无法读取通行密钥</div>';
    }
  }

  // Minimal CBOR/COSE helpers for parsing attestation
  function readUInt(buf, off, len) { let v = 0; for (let i=0;i<len;i++) v = (v<<8) | buf[off+i]; return v >>> 0; }
  function cborDecodeFirst(input, offset=0) {
    const buf = (input instanceof Uint8Array) ? input : new Uint8Array(input);
    function dec(off) {
      const first = buf[off++];
      const major = first >> 5;
      let addl = first & 0x1f;
      function readLen(a) {
        if (a < 24) return [a, off];
        if (a === 24) return [buf[off++], off];
        if (a === 25) { const v = (buf[off]<<8)|buf[off+1]; off+=2; return [v, off]; }
        if (a === 26) { const v = (buf[off]<<24)|(buf[off+1]<<16)|(buf[off+2]<<8)|buf[off+3]; off+=4; return [v>>>0, off]; }
        throw new Error('CBOR: len too large');
      }
      if (major === 0) { const [val,nOff]=readLen(addl); return [val, nOff]; }
      if (major === 1) { const [val,nOff]=readLen(addl); return [-(val+1), nOff]; }
      if (major === 2) { const [len,nOff]=readLen(addl); const v=buf.slice(nOff,nOff+len); return [v, nOff+len]; }
      if (major === 3) { const [len,nOff]=readLen(addl); const v=new TextDecoder().decode(buf.slice(nOff,nOff+len)); return [v, nOff+len]; }
      if (major === 4) { const [len,nOff]=readLen(addl); let arr=[]; let o=nOff; for(let i=0;i<len;i++){ const [v,no]=dec(o); arr.push(v); o=no;} return [arr, o]; }
      if (major === 5) { const [len,nOff]=readLen(addl); let obj={}; let o=nOff; for(let i=0;i<len;i++){ const [k,ko]=dec(o); const [v,vo]=dec(ko); obj[k]=v; o=vo;} return [obj, o]; }
      if (major === 6) { const [_,nOff]=readLen(addl); const [v,no]=dec(nOff); return [v, no]; }
      if (major === 7) { if (addl===20) return [false, off]; if (addl===21) return [true, off]; if (addl===22) return [null, off]; if (addl===23) return [undefined, off]; throw new Error('CBOR simple not supported'); }
      throw new Error('CBOR major not supported');
    }
    return dec(offset);
  }

  function parseAttestation(att) {
    const [obj] = cborDecodeFirst(att, 0);
    const authData = obj.authData || obj[ 'authData' ];
    const view = new Uint8Array(authData);
    const rpIdHash = view.slice(0, 32);
    const flags = view[32];
    const signCount = readUInt(view, 33, 4);
    let off = 37;
    const aaguid = view.slice(off, off+16); off += 16;
    const credIdLen = readUInt(view, off, 2); off += 2;
    const credId = view.slice(off, off+credIdLen); off += credIdLen;
    const [coseKey, keyEnd] = cborDecodeFirst(view, off);
    // No need to use keyEnd here
    return { flags, signCount, aaguid, credentialId: credId, credentialPublicKey: coseKey, rpIdHash };
  }

  function derLen(len) {
    if (len < 128) return Uint8Array.of(len);
    const bytes = [];
    let v = len;
    while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
    return Uint8Array.of(0x80 | bytes.length, ...bytes);
  }

  function coseToPEM(cose) {
    // COSE keys use numeric labels: 1:kty(2=EC2), 3:alg(-7=ES256), -1:crv(1=P-256), -2:x, -3:y
    const x = cose[-2];
    const y = cose[-3];
    const pub = new Uint8Array(1 + x.length + y.length);
    pub[0] = 0x04; // uncompressed
    pub.set(x, 1);
    pub.set(y, 1 + x.length);
    // AlgorithmIdentifier: SEQ(OID ecPublicKey, OID prime256v1)
    const oidEc = Uint8Array.from([0x06,0x07,0x2A,0x86,0x48,0xCE,0x3D,0x02,0x01]);
    const oidP256 = Uint8Array.from([0x06,0x08,0x2A,0x86,0x48,0xCE,0x3D,0x03,0x01,0x07]);
    const algSeqInner = new Uint8Array([ ...oidEc, ...oidP256 ]);
    const algSeq = new Uint8Array([0x30, ...derLen(algSeqInner.length), ...algSeqInner]);
    const bitStringInner = new Uint8Array([0x00, ...pub]);
    const bitString = new Uint8Array([0x03, ...derLen(bitStringInner.length), ...bitStringInner]);
    const spkiInner = new Uint8Array([ ...algSeq, ...bitString ]);
    const spki = new Uint8Array([0x30, ...derLen(spkiInner.length), ...spkiInner]);
    // to PEM
    const b64 = btoa(String.fromCharCode.apply(null, spki));
    const wrapped = b64.replace(/(.{64})/g, '$1\n');
    return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
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

      const html = await window.MyDropTemplates.getTemplate('admin-dashboard-cards', {
        deviceCount,
        lastDevice: deviceLabel(lastDevice),
        msgCount,
        lastMsgTime,
        fileSizeLimit: cfg.fileSizeLimitMB,
        maxFiles: cfg.maxFiles,
        currentUsername: (qs('#currentUsername')?.textContent || '')
      });
      qs('#dashboardCards').innerHTML = html;
    } catch (e) {
      // ignore dashboard if API fails
    }
  }

  function bindCacheTools() {
    const btn = qs('#clearCacheBtn');
    if (!btn) return;
    // 防重复绑定
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', async () => {
      try {
        const ok = await showConfirm('清除本地静态资源缓存？\n不会清除登录状态或设备信息。', { title: '确认', confirmText: '清除', cancelText: '取消' });
        if (!ok) return;
        let removed = 0;
        if ('caches' in window) {
          const keys = await caches.keys();
          const targets = keys.filter(k => k.startsWith('mydrop-static-v'));
          await Promise.all(targets.map(async k => { const ok = await caches.delete(k); if (ok) removed++; }));
        }
        // 提醒 SW 立即激活（如存在新版本）
        try { navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
        toast(`已清除 ${removed} 个缓存条目`, 'success');
      } catch (e) {
        toast(formatError(e, '清理失败'), 'error');
      }
    });
  }

  async function renderDevices() {
    try {
      const data = await api('/devices');
      const list = data.devices || [];
      const root = qs('#deviceList');
      root.innerHTML = list.map(d => {
        const short = (s) => (s ? (String(s).slice(0,4)+'…'+String(s).slice(-4)) : '');
        const last = new Date(d.last_seen_at).toLocaleString();
        const isCurrent = currentDeviceId && d.device_id === currentDeviceId;
        const badge = isCurrent
          ? '<span class="ml-2 inline-block text-[11px] text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5 align-middle">当前设备</span>'
          : '';
        return `
          <div class="py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium text-slate-800">${(d.alias || short(d.device_id) || '未命名设备')}${badge}</div>
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
          const ok = await showConfirm('确认删除该设备？');
          if (!ok) return;

          // 添加小延迟确保前一个弹窗完全关闭
          await new Promise(resolve => setTimeout(resolve, 200));

          const also = await showConfirm('是否同时删除该设备相关消息与文件？"确定"删除，"取消"保留');
          try {
            await api('/admin/device/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, removeMessages: also }) });
            toast('已删除设备' + (also ? '并清理消息' : ''), 'success');
            renderDevices();
          } catch (e) {
            toast(formatError(e, '删除设备失败'), 'error');
          }
        });
      });
    } catch (e) {
      // ignore
    }
  }

  async function renderMessages() {
    try {
      const [msgsRes, devRes] = await Promise.all([
        api('/messages?limit=1000'),
        api('/devices')
      ]);
      const items = (msgsRes.messages || []).slice().sort((a,b) => (b.created_at||0) - (a.created_at||0));
      const devices = devRes.devices || [];
      const root = qs('#messageListAdmin');
      const searchBox = qs('#searchInput');
      const deviceSel = qs('#deviceFilter');

      const shortId = (id) => (id ? (String(id).slice(0,4)+'…'+String(id).slice(-4)) : '');
      const deviceLabel = (d) => (d?.alias || (d?.device_id ? shortId(d.device_id) : '已删除设备'));

      // populate device filter options
      if (deviceSel) {
        const options = ['<option value="">全部设备</option>'].concat(
          devices.map(d => `<option value="${d.device_id}">${deviceLabel(d)}</option>`) 
        );
        deviceSel.innerHTML = options.join('');
      }
      const clearBtn = qs('#clearAllMessagesBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          const ok1 = await showConfirm('确认清空所有消息与文件？此操作不可恢复');
          if (!ok1) return;
          const ok2 = await showConfirm('再次确认：清空全部消息与文件');
          if (!ok2) return;
          try {
            await api('/admin/messages/clear', { method: 'POST' });
            toast('已清空所有消息', 'success');
            renderMessages();
          } catch (e) { toast(formatError(e, '清空失败'), 'error'); }
        }, { once: true });
      }

      const renderList = async () => {
        const q = (searchBox.value || '').toLowerCase().trim();
        const selectedDid = (deviceSel?.value || '').trim();
        let filtered = items;
        if (selectedDid) filtered = filtered.filter(m => (m.sender_device_id || '') === selectedDid);
        if (q) {
          filtered = filtered.filter(m => (m.text || '').toLowerCase().includes(q) || (m.files||[]).some(f => (f.original_name||'').toLowerCase().includes(q)));
        }
        filtered = filtered.slice().sort((a,b) => (b.created_at||0) - (a.created_at||0));
        // legacy render disabled (using templates below)
        if (false) root.innerHTML = filtered.map(m => {
          const time = new Date(m.created_at).toLocaleString();
          const sLabel = deviceLabel(m.sender);
          const files = (m.files||[]).map(f => `<div class=\"text-xs text-slate-600 flex items-center gap-2\">📎 ${f.original_name} <button class=\"btn pressable\" data-action=\"file-del\" data-id=\"${f.id}\">删除文件</button></div>`).join('');
          const preview = (m.text || '').slice(0, 80).replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return `
            <div class=\"card p-3 cursor-pointer\" id=\"message-${m.id}\" data-mid=\"${m.id}\" title=\"点击跳转至聊天\"> 
              <div class=\"flex items-start justify-between gap-3\">
                <div class=\"min-w-0\">
                  <div class=\"font-medium text-slate-800\">消息 #${m.id} · ${time} · 设备：${sLabel}</div>
                  <div class=\"text-sm text-slate-700 break-words\">${preview || '<span class=\"text-slate-400\">(无文本)</span>'}</div>
                  ${files ? `<div class=\"mt-1 space-y-1\">${files}</div>` : ''}
                </div>
                <div class=\"shrink-0\"><button class=\"btn pressable\" data-action=\"msg-del\" data-id=\"${m.id}\">删除消息</button></div>
              </div>
            </div>`;
        }).join('');
        // template-based render (overrides legacy for consistency)
        try {
          const rows = await Promise.all(filtered.map(async (m) => {
            const time = new Date(m.created_at).toLocaleString();
            const sLabel = deviceLabel(m.sender);
            const preview = (m.text || '').slice(0, 80).replace(/</g,'&lt;').replace(/>/g,'&gt;') || '<span class="text-slate-400">(无文本)</span>';
            const files = (m.files||[]).map(f => `<div class=\"text-xs card-desc flex items-center gap-2\">📎 ${f.original_name} <button class=\"btn pressable\" data-action=\"file-del\" data-id=\"${f.id}\">删除文件</button></div>`).join('');
            const filesHTML = files ? `<div class=\"mt-1 space-y-1\">${files}</div>` : '';
            return await window.MyDropTemplates.getTemplate('admin-message-item', { id: m.id, time, senderLabel: sLabel, previewHTML: preview, filesHTML });
          }));
          root.innerHTML = rows.join('');
        } catch (_) {}

        // bind actions
        root.querySelectorAll('[data-action="msg-del"]').forEach(b => b.addEventListener('click', async () => {
          const id = parseInt(b.getAttribute('data-id'), 10);
          const ok = await showConfirm(`确认删除消息 #${id}？`);
          if (!ok) return;
          try {
            await api('/admin/message/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: id }) });
            toast('已删除消息', 'success');
            // remove locally
            const idx = items.findIndex(x => x.id === id);
            if (idx >= 0) items.splice(idx, 1);
            renderList();
          } catch (e) { toast(formatError(e, '删除消息失败'), 'error'); }
        }));
        root.querySelectorAll('[data-action="file-del"]').forEach(b => b.addEventListener('click', async () => {
          const id = parseInt(b.getAttribute('data-id'), 10);
          const ok = await showConfirm(`确认删除文件 #${id}？`);
          if (!ok) return;
          try {
            await api('/admin/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: id }) });
            toast('已删除文件', 'success');
            // remove locally
            for (const m of items) {
              const i = (m.files||[]).findIndex(f => f.id === id);
              if (i >= 0) { m.files.splice(i,1); break; }
            }
            renderList();
          } catch (e) { toast(formatError(e, '删除文件失败'), 'error'); }
        }));

        // 点击消息卡片跳转到聊天页对应锚点
        root.querySelectorAll('.card[data-mid]').forEach(card => {
          card.addEventListener('click', (ev) => {
            const isBtn = ev.target.closest('button');
            if (isBtn) return;
            const mid = card.getAttribute('data-mid');
            if (mid) { location.href = '/#message-' + mid; }
          });
        });
      };

      if (searchBox) {
        searchBox.removeEventListener('_search', ()=>{});
        searchBox.addEventListener('input', renderList);
      }
      if (deviceSel) {
        deviceSel.addEventListener('change', renderList);
      }
      renderList();
    } catch (e) {
      // ignore
    }
  }

  init();
})();
