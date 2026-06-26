// WebSocket 相关（含心跳与自动重连）

/**
 * 打开 WebSocket 连接并设置事件处理
 * 包含心跳机制和自动重连
 */
function openWS() {
  // 检测浏览器是否支持 WebSocket
  if (!window.WebSocket) {
    try {
      window.MyDropUI.toast('您的浏览器不支持实时通信，请升级浏览器', 'error', { timer: 5000 });
    } catch (_) {
      alert('您的浏览器不支持 WebSocket，请升级到现代浏览器');
    }
    return;
  }

  try { if (window.MyDropState.ws) window.MyDropState.ws.close(); } catch(_) {}

  const st = window.MyDropState._wsState || (window.MyDropState._wsState = { retry: 0, hbIntervalId: null, hbTimeoutId: null, reconnectId: null });
  const clearTimers = () => {
    try { if (st.hbIntervalId) clearInterval(st.hbIntervalId); } catch(_) {}
    try { if (st.hbTimeoutId) clearTimeout(st.hbTimeoutId); } catch(_) {}
    st.hbIntervalId = null; st.hbTimeoutId = null;
  };
  const scheduleReconnect = () => {
    if (st.reconnectId) return;
    const base = 1000; // 1s
    const max = 60000; // 60s（增长到 60s 减少服务器频繁重连压力）
    const delay = Math.min(base * Math.pow(2, st.retry), max);
    st.retry = Math.min(st.retry + 1, 20);
    st.reconnectId = setTimeout(() => { st.reconnectId = null; openWS(); }, delay);
  };

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  window.MyDropState.ws = ws;

  const sendPing = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch (_) {}
    try { if (st.hbTimeoutId) clearTimeout(st.hbTimeoutId); } catch(_) {}
    st.hbTimeoutId = setTimeout(() => {
      try { ws.close(); } catch (_) {}
    }, 12000);
  };

  ws.addEventListener('open', async () => {
    st.retry = 0;
    clearTimers();
    st.hbIntervalId = setInterval(sendPing, 20000);
    // 立即发送一次以建立心跳节奏
    setTimeout(sendPing, 200);

    // 重连后拉取断线期间的增量消息，避免丢失
    try {
      const msgs = window.MyDropState?.messages || [];
      const lastId = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
      if (lastId && typeof lastId === 'number') {
        const result = await window.MyDropAPI.api(`/messages?sinceId=${encodeURIComponent(lastId)}&limit=200`);
        const incoming = (result && result.messages) || [];
        const existingIds = new Set(msgs.map(m => m.id));
        for (const m of incoming) {
          if (m.id != null && !existingIds.has(m.id)) {
            window.MyDropState.messages.push(m);
            existingIds.add(m.id);
            try { await window.MyDropChat.appendMessageToList(m); } catch (_) {}
          }
        }
      }
    } catch (_) {
      // 增量拉取失败不影响已有消息
    }
  });

  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'pong') {
        try { if (st.hbTimeoutId) clearTimeout(st.hbTimeoutId); } catch(_) {}
        return;
      }
      if (msg.type === 'message') {
        const incoming = msg.data;

        // 验证消息 ID 有效性，拒绝 null/undefined（但允许数字 0）
        if (!incoming || incoming.id === null || incoming.id === undefined || (typeof incoming.id !== 'number' && typeof incoming.id !== 'string')) {
          return; // 忽略无效消息
        }

        // If an optimistic temp message exists for my own send, replace it instead of pushing
        try {
          const myDid = window.MyDropState?.me?.device?.device_id || null;
          if (myDid && incoming.sender_device_id === myDid) {
            const tmpIdx = window.MyDropState.messages.findIndex(m => typeof m.id === 'string' && m.id.startsWith('tmp-') && (m.text || '') === (incoming.text || ''));
            if (tmpIdx >= 0) {
              const tmpId = window.MyDropState.messages[tmpIdx].id;
              window.MyDropState.messages[tmpIdx] = incoming;
              try {
                const prevHtml = (tmpIdx - 1 >= 0) ? await window.MyDropRender.renderMessageWithGrouping(tmpIdx - 1) : null;
                const currHtml = await window.MyDropRender.renderMessageWithGrouping(tmpIdx);
                if (prevHtml) {
                  const t = document.createElement('div'); t.innerHTML = prevHtml; const prevNode = t.firstElementChild;
                  const prevOld = document.querySelector('#message-' + window.MyDropState.messages[tmpIdx - 1]?.id);
                  if (prevNode && prevOld) prevOld.replaceWith(prevNode);
                }
                const tempEl = document.querySelector('#message-' + CSS.escape(String(tmpId)));
                if (currHtml && tempEl) {
                  const t2 = document.createElement('div'); t2.innerHTML = currHtml; const newNode = t2.firstElementChild;
                  if (newNode) tempEl.replaceWith(newNode);
                }
              } catch (_) { try { await window.MyDropApp.render(); } catch (_) {} }
              return;
            }
          }
        } catch (_) {}

        // 使用严格相等检查，避免类型转换导致的误匹配
        const existingMsg = window.MyDropState.messages.find(m =>
          m.id != null && incoming.id != null && m.id === incoming.id
        );
        if (!existingMsg) {
          window.MyDropState.messages.push(incoming);
          await window.MyDropChat.appendMessageToList(incoming);
        }
        const senderId = incoming.sender_device_id;
        if (senderId && !window.MyDropState.devices.find(d => d.device_id === senderId) && incoming.sender) {
          window.MyDropState.devices.unshift(incoming.sender);
        }
        return;
      }
      if (msg.type === 'force-logout') {
        window.MyDropUI.toast('已被管理员下线', 'warn');
        fetch('/logout', { method: 'POST' }).finally(() => { location.reload(); });
        return;
      }
    } catch (_) {}
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch (_) {}
  });

  ws.addEventListener('close', (ev) => {
    clearTimers();
    window.MyDropState.ws = null;
    const code = (ev && typeof ev.code === 'number') ? ev.code : 0;
    // Stop reconnect for auth/device issues
    if (code === 4001 || code === 4002 || code === 4003 || code === 1008) {
      st.stop = true;
      try { window.MyDropUI.toast('会话已失效，请重新登录', 'warn', { key: 'ws-expired' }); } catch (_) {}
      try { fetch('/logout', { method: 'POST' }).finally(() => { location.replace('/'); }); } catch (_) { location.replace('/'); }
      return;
    }
    if (!st.stop) scheduleReconnect();
  });
}

window.MyDropWebSocket = { openWS };
