// WebSocket 相关



function openWS() {
  if (window.MyDropState.ws) try { window.MyDropState.ws.close(); } catch(_) {}
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  window.MyDropState.ws = ws;

  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'message') {
        const incoming = msg.data;
        if (!window.MyDropState.messages.some(m => m.id === incoming.id)) {
          window.MyDropState.messages.push(incoming);
          await window.MyDropChat.appendMessageToList(incoming);
        }
        // If new device shows up later, refresh device list lazily
        const senderId = incoming.sender_device_id;
        if (senderId && !window.MyDropState.devices.find(d => d.device_id === senderId) && incoming.sender) {
          window.MyDropState.devices.unshift(incoming.sender);
        }
      } else if (msg.type === 'force-logout') {
        window.MyDropUI.toast('已被管理员下线', 'warn');
        fetch('/logout', { method: 'POST' }).finally(() => { location.reload(); });
      }
    } catch (_) {}
  });

  ws.addEventListener('open', () => {});
  ws.addEventListener('close', () => {});
}

window.MyDropWebSocket = {
  openWS
};