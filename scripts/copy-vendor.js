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
// Remove heavy artifacts we no longer ship
try { fs.rmSync(path.join(vendor, 'markdown-it.min.js'), { force: true }); } catch (_) {}

// marked (Markdown parser)
copy(path.join(root, 'node_modules', 'marked', 'marked.min.js'), path.join(vendor, 'marked.min.js'));

// DOMPurify
copy(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), path.join(vendor, 'dompurify.min.js'));

// SweetAlert2 (optional)
copy(path.join(root, 'node_modules', 'sweetalert2', 'dist', 'sweetalert2.all.min.js'), path.join(vendor, 'sweetalert2.all.min.js'));
copy(path.join(root, 'node_modules', 'sweetalert2', 'dist', 'sweetalert2.min.css'), path.join(vendor, 'sweetalert2.min.css'));

// Remove highlight.js related artifacts if present (we do not ship code highlighting)
try { fs.rmSync(path.join(vendor, 'highlight.min.js'), { force: true }); } catch (_) {}
try { fs.rmSync(path.join(vendor, 'highlight.css'), { force: true }); } catch (_) {}
try { fs.rmSync(path.join(vendor, 'highlight-init.mjs'), { force: true }); } catch (_) {}
try { fs.rmSync(path.join(vendor, 'hljs'), { recursive: true, force: true }); } catch (_) {}

console.log('[copy-vendor] Vendor assets prepared under templates/static/vendor');
