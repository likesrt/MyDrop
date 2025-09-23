const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function copy(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

const root = path.join(__dirname, '..');
const pub = path.join(root, 'frontend', 'templates', 'static');
const vendor = path.join(pub, 'vendor');
ensureDir(vendor);

// markdown-it
copy(path.join(root, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'), path.join(vendor, 'markdown-it.min.js'));

// marked (fallback)
copy(path.join(root, 'node_modules', 'marked', 'marked.min.js'), path.join(vendor, 'marked.min.js'));

// DOMPurify
copy(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), path.join(vendor, 'dompurify.min.js'));

// highlight.js js
if (!copy(path.join(root, 'node_modules', 'highlight.js', 'build', 'highlight.min.js'), path.join(vendor, 'highlight.min.js'))) {
  // try alternative path
  copy(path.join(root, 'node_modules', 'highlight.js', 'lib', 'highlight.js'), path.join(vendor, 'highlight.min.js'));
}
// highlight.js css theme
if (!copy(path.join(root, 'node_modules', 'highlight.js', 'styles', 'github.min.css'), path.join(vendor, 'highlight.css'))) {
  copy(path.join(root, 'node_modules', 'highlight.js', 'styles', 'github.css'), path.join(vendor, 'highlight.css'));
}

console.log('[copy-vendor] Vendor assets prepared under public/vendor');
