// 全屏编辑器相关




function openFullscreenEditor(initialText = '') {
  const overlay = document.createElement('div');
  overlay.id = 'fs-editor';
  overlay.className = 'fixed inset-0 z-50 bg-white flex flex-col';
  overlay.innerHTML = `
    <header class="p-3 border-b">
      <div class="flex items-center justify-between">
        <div class="font-medium">Markdown 全屏编辑</div>
        <div class="flex items-center gap-2">
          <button id="fsSend" class="btn btn-primary pressable">发送 (Ctrl+Enter)</button>
          <button id="fsClose" class="btn pressable">关闭 (Esc)</button>
        </div>
      </div>
      <div id="mdToolbar" class="mt-2 flex flex-wrap items-center gap-1">
        <button data-tool="bold" class="btn pressable" title="粗体 (Ctrl+B)"><b>B</b></button>
        <button data-tool="italic" class="btn pressable" title="斜体 (Ctrl+I)"><i>I</i></button>
        <button data-tool="h1" class="btn pressable" title="标题 H1">H1</button>
        <button data-tool="h2" class="btn pressable" title="标题 H2">H2</button>
        <button data-tool="quote" class="btn pressable" title="引用">""</button>
        <button data-tool="code" class="btn pressable" title="行内代码">\`code\`</button>
        <button data-tool="codeblock" class="btn pressable" title="代码块">Code Block</button>
        <button data-tool="link" class="btn pressable" title="插入链接">Link</button>
        <button data-tool="image" class="btn pressable" title="插入图片">Image</button>
        <button data-tool="hr" class="btn pressable" title="分割线">―</button>
      </div>
    </header>
    <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
      <div class="p-3 border-r flex flex-col">
        <textarea id="fsInput" class="flex-1 border rounded p-3 resize-none" placeholder="在此输入 Markdown..."></textarea>
      </div>
      <div class="p-3 overflow-auto">
        <div id="fsPreview" class="md-body"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('overflow-hidden');
  const input = overlay.querySelector('#fsInput');
  const preview = overlay.querySelector('#fsPreview');
  const closeBtn = overlay.querySelector('#fsClose');
  const sendBtn = overlay.querySelector('#fsSend');
  input.value = initialText;
  const update = () => {
    preview.innerHTML = window.MyDropRender.renderMarkdownWithCards(input.value);
  };
  input.addEventListener('input', update);
  update();
  const close = () => {
    document.body.classList.remove('overflow-hidden');
    overlay.remove();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const mainInput = window.MyDropUtils.qs('#textInput');
      if (mainInput) {
        mainInput.value = input.value;
        const composer = window.MyDropUtils.qs('#composer');
        composer?.requestSubmit();
        close();
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyToolbar('bold', input, update); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyToolbar('italic', input, update); }
  });
  sendBtn.addEventListener('click', () => {
    const mainInput = window.MyDropUtils.qs('#textInput');
    if (mainInput) {
      mainInput.value = input.value;
      window.MyDropUtils.qs('#composer')?.requestSubmit();
      close();
    }
  });
  overlay.querySelectorAll('#mdToolbar [data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      applyToolbar(tool, input, update);
    });
  });
  input.focus();
}

async function applyToolbar(tool, textarea, onChanged) {
  const t = textarea;
  const start = t.selectionStart || 0;
  const end = t.selectionEnd || 0;
  const value = t.value || '';
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const set = (text, cursorDelta = 0) => {
    t.value = text;
    const pos = start + cursorDelta;
    t.setSelectionRange(pos, pos);
    t.focus();
    if (typeof onChanged === 'function') onChanged();
  };
  const surround = (prefix, suffix = prefix) => {
    if (!selected) return set(before + prefix + suffix + after, prefix.length);
    return set(before + prefix + selected + suffix + after, (prefix + selected + suffix).length);
  };
  const lineOperate = (prefix, numbered = false) => {
    const sel = selected || '';
    const lines = sel.split('\n');
    const newLines = lines.map((line, i) => {
      if (numbered) return `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`;
      return `${prefix} ${line.replace(/^(?:[-*+]\s|>\s|\[\]\s|\[[xX]\]\s)?/, '')}`.trimEnd();
    });
    const text = before + newLines.join('\n') + after;
    set(text, (newLines.join('\n')).length);
  };
  switch (tool) {
    case 'bold': return surround('**');
    case 'italic': return surround('*');
    case 'h1': return set(before + '# ' + selected + after, (('# ' + selected).length));
    case 'h2': return set(before + '## ' + selected + after, (('## ' + selected).length));
    case 'ul': return lineOperate('-');
    case 'ol': return lineOperate('', true);
    case 'task': return lineOperate('- [ ]');
    case 'quote': return lineOperate('>');
    case 'code': return surround('`');
    case 'codeblock': {
      const block = '```\n' + (selected || '') + '\n```\n';
      const text = before + block + after;
      return set(text, block.length - 4);
    }
    case 'link': {
      const url = await window.MyDropUI.showPrompt('输入链接地址：', 'https://');
      if (!url) return;
      const title = selected || '链接标题';
      const md = `[${title}](${url})`;
      return set(before + md + after, (md.length));
    }
    case 'image': {
      const url = await window.MyDropUI.showPrompt('输入图片地址：', 'https://');
      if (!url) return;
      const alt = selected || '图片说明';
      const md = `![${alt}](${url})`;
      return set(before + md + after, (md.length));
    }
    case 'hr': {
      const md = (before.endsWith('\n') ? '' : '\n') + '---\n';
      return set(before + md + after, md.length);
    }
    default:
      return;
  }
}

window.MyDropEditor = {
  openFullscreenEditor,
  applyToolbar
};