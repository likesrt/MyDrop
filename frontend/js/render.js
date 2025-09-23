// 渲染相关函数

// Markdown 渲染
let __md = null;
function getMarkdownRenderer() {
  if (__md) return __md;
  if (window.markdownit) {
    __md = window.markdownit({
      html: false,
      linkify: false,
      breaks: true,
      highlight: function (str, lang) {
        try {
          if (lang && window.hljs?.getLanguage(lang)) {
            return window.hljs.highlight(str, { language: lang }).value;
          }
          return window.hljs?.highlightAuto ? window.hljs.highlightAuto(str).value : str;
        } catch (_) { return str; }
      }
    });
    return __md;
  }
  return null;
}

function renderWithMarked(text) {
  try {
    if (!window.marked) return null;
    window.marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: function(code, lang) {
        try {
          if (lang && window.hljs?.getLanguage(lang)) {
            return window.hljs.highlight(code, { language: lang }).value;
          }
          return window.hljs?.highlightAuto ? window.hljs.highlightAuto(code).value : code;
        } catch (_) { return code; }
      }
    });
    return window.marked.parse(text || '');
  } catch (_) {
    return null;
  }
}

function renderMarkdownWithCards(text) {
  try {
    const md = getMarkdownRenderer();
    let raw = md ? md.render(text || '') : null;
    if (!raw) raw = renderWithMarked(text);
    if (!raw || !window.DOMPurify) return window.MyDropUtils.escapeHTML(text).replace(/\n/g, '<br/>');
    raw = raw.replace(/<a\s+/g, '<a target="_blank" rel="noreferrer noopener" ');
    const clean = window.DOMPurify.sanitize(raw, { ALLOWED_ATTR: ['href','title','target','rel','src','alt','class'] });
    const html = `<div class="md-body">${clean}</div>`;
    return html;
  } catch (_) {
    return window.MyDropUtils.escapeHTML(text).replace(/\n/g, '<br/>');
  }
}

// 文件预览
function isImage(f) {
  const mt = (f.mime_type || '').toLowerCase();
  if (mt.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.original_name || '');
}

function isVideo(f) {
  const mt = (f.mime_type || '').toLowerCase();
  if (mt.startsWith('video/')) return true;
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(f.original_name || '');
}

async function renderFilePreviews(files) {
  if (!files.length) return '';
  const parts = await Promise.all(files.map(async (f) => {
    const name = window.MyDropUtils.escapeHTML(f.original_name || '');
    if (isImage(f)) {
      return await window.MyDropTemplates.getTemplate('message-file-image', { id: f.id, name });
    }
    if (isVideo(f)) {
      return await window.MyDropTemplates.getTemplate('message-file-video', { id: f.id, name });
    }
    return await window.MyDropTemplates.getTemplate('message-file-generic', { id: f.id, name, size: window.MyDropUtils.formatBytes(f.size || 0) });
  }));
  return parts.join('');
}

async function renderMessageWithGrouping(i) {
  const m = window.MyDropState.messages[i];
  const prev = window.MyDropState.messages[i - 1];
  const next = window.MyDropState.messages[i + 1];
  const samePrev = prev && prev.sender_device_id && prev.sender_device_id === m.sender_device_id && (m.created_at - prev.created_at) < 3 * 60 * 1000;
  const sameNext = next && next.sender_device_id && next.sender_device_id === m.sender_device_id && (next.created_at - m.created_at) < 3 * 60 * 1000;
  const showMeta = !samePrev;
  return await renderMessage(m, { tail: !sameNext, showMeta, tight: samePrev });
}

async function renderMessage(m, opts = {}) {
  const isMine = window.MyDropState.me?.device?.device_id && m.sender_device_id === window.MyDropState.me.device.device_id;
  const row = isMine ? 'justify-end' : 'justify-start';
  const align = isMine ? 'items-end text-left' : 'items-start text-left';
  const sidePad = isMine ? 'pr-3 sm:pr-0' : 'pl-3 sm:pl-0';
  let bubbleCls = isMine
    ? 'bubble bubble-mine bubble-shadow bubble-tail-right'
    : 'bubble bubble-other bubble-shadow ring-1 ring-slate-200 bubble-tail-left';
  const name = m.sender?.alias || (m.sender_device_id ? window.MyDropUtils.shortId(m.sender_device_id) : null) || '已删除设备';
  const time = new Date(m.created_at).toLocaleString();
  const textHTML = renderMarkdownWithCards(m.text || '');
  const fileBlocks = await renderFilePreviews(m.files || []);
  const metaHTML = opts.showMeta ? `<div class="text-[11px] text-slate-400 mt-1">${window.MyDropUtils.escapeHTML(name)} · ${time}</div>` : '';
  return await window.MyDropTemplates.getTemplate('message-item', {
    id: m.id,
    rowClass: row,
    alignClass: align,
    sidePad,
    bubbleCls,
    tightMargin: opts.tight ? 'mt-0.5' : '',
    textHTML,
    fileBlocks,
    metaHTML,
  });
}

window.MyDropRender = {
  renderMarkdownWithCards,
  renderFilePreviews,
  renderMessage,
  renderMessageWithGrouping
};
