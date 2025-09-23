// WebSocket 相关（含心跳与自动重连）

function openWS() {
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
    const max = 20000; // 20s
    const delay = Math.min(base * Math.pow(2, st.retry), max);
    st.retry = Math.min(st.retry + 1, 10);
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

  ws.addEventListener('open', () => {
    st.retry = 0;
    clearTimers();
    st.hbIntervalId = setInterval(sendPing, 20000);
    // 立即发送一次以建立心跳节奏
    setTimeout(sendPing, 200);
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
        if (!window.MyDropState.messages.some(m => m.id === incoming.id)) {
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

  ws.addEventListener('close', () => {
    clearTimers();
    scheduleReconnect();
  });
}

window.MyDropWebSocket = { openWS };
