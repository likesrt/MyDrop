// 工具函数
function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = uuid();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

function shortId(id) {
  if (!id) return '';
  return String(id).slice(0, 4) + '…' + String(id).slice(-4);
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n/1024).toFixed(1) + 'KB';
  return (n/1024/1024).toFixed(1) + 'MB';
}

function isNearBottom(el, threshold = 64) {
  try {
    const maxScroll = el.scrollHeight - el.clientHeight;
    return (maxScroll - el.scrollTop) <= threshold;
  } catch (_) { return true; }
}

const qs = (sel, el = document) => el.querySelector(sel);
const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

window.MyDropUtils = {
  uuid,
  getDeviceId,
  shortId,
  escapeHTML,
  formatBytes,
  isNearBottom,
  qs,
  qsa
};