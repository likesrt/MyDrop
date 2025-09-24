const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { logger } = require('../services/logger');

function createFilesRouter(options) {
  const { db, uploadDir, limits, broadcast, requireAuth } = options;
  const router = express.Router();

  // File handling utilities
  function decodeUploadName(name) {
    try {
      // busboy/multer gives latin1 for non-ASCII; convert to UTF-8
      return Buffer.from(String(name || ''), 'latin1').toString('utf8');
    } catch (_) { return String(name || ''); }
  }

  function sanitizeFilenamePreserve(name) {
    let base = path.basename(name || '');
    // remove control chars; replace path separators
    base = base.replace(/[\x00-\x1F\x7F]/g, '').replace(/[\\/]/g, '_');
    if (base === '' || base === '.' || base === '..') base = '_';
    // limit length to avoid filesystem issues
    if (base.length > 200) {
      const p = path.parse(base);
      const stem = p.name.slice(0, 180);
      base = stem + (p.ext || '').slice(0, 20);
    }
    return base;
  }

  function ensureUniqueFilename(dir, desired) {
    let p = path.join(dir, desired);
    if (!fs.existsSync(p)) return desired;
    const parsed = path.parse(desired);
    let i = 2;
    while (true) {
      const cand = `${parsed.name} (${i})${parsed.ext}`;
      p = path.join(dir, cand);
      if (!fs.existsSync(p)) return cand;
      i++;
      if (i > 9999) return `${parsed.name}-${Date.now()}${parsed.ext}`; // fallback
    }
  }

  // Multer configuration
  const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
      const decoded = decodeUploadName(file.originalname);
      const safe = sanitizeFilenamePreserve(decoded);
      const unique = ensureUniqueFilename(uploadDir, safe);
      cb(null, unique);
    },
  });
  const upload = multer({ storage, limits: { fileSize: limits.fileSizeLimitMB * 1024 * 1024 } });

  // Send message with files
  router.post('/message', requireAuth, upload.array('files'), async (req, res) => {
    try {
      const senderDeviceId = req.device_id;
      const text = (req.body.text || '').toString();

      const currentFileCount = await db.countFiles();
      const incoming = (req.files || []).length;
      if (incoming > 0 && currentFileCount + incoming > limits.maxFiles) {
        for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (_) {} }
        logger.warn('message.file_limit_reached', { incoming, current: currentFileCount, max: limits.maxFiles });
        return res.status(400).json({ error: `File limit reached. Max ${limits.maxFiles} files.` });
      }

      const msg = await db.createMessage({ senderDeviceId, text });
      if (req.files && req.files.length) {
        let totalSize = 0;
        for (const f of req.files) {
          totalSize += f.size || 0;
          await db.addFile({
            messageId: msg.id,
            storedName: path.basename(f.filename),
            originalName: decodeUploadName(f.originalname),
            mimeType: f.mimetype,
            size: f.size,
          });
        }
        logger.info('message.sent', { message_id: msg.id, device_id: senderDeviceId, text_len: text.length, file_count: req.files.length, total_size: totalSize });
      } else {
        logger.info('message.sent', { message_id: msg.id, device_id: senderDeviceId, text_len: text.length, file_count: 0, total_size: 0 });
      }

      const full = await db.getMessage(msg.id);
      if (typeof broadcast === 'function') broadcast(full);
      res.json({ ok: true, message: full });
    } catch (err) {
      logger.error('file.upload.error', { err });
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // Stream/download file
  router.get('/file/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const file = await db.getFile(id);
      if (!file) return res.status(404).send('Not found');

      const filePath = path.join(uploadDir, file.stored_name);
      if (!fs.existsSync(filePath)) return res.status(404).send('File missing');

      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
      }

      logger.info('file.stream', { file_id: id, mime: file.mime_type, size: file.size, download: req.query.download === '1' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      logger.error('file.error', { err });
      res.status(500).send('Download failed');
    }
  });

  // Delete file (admin)
  router.post('/admin/file/delete', requireAuth, async (req, res) => {
    try {
      const { fileId } = req.body || {};
      if (!fileId) return res.status(400).json({ error: '缺少文件ID' });

      const file = await db.getFile(fileId);
      if (file) {
        const p = path.join(uploadDir, file.stored_name);
        try { await fs.promises.unlink(p); } catch (_) {}
        await db.deleteFile(fileId);
        try { await db.incrementStat('cleaned_files_total', 1); } catch (_) {}
      }

      logger.info('admin.file.delete', { file_id: fileId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.file.delete.error', { err });
      res.status(500).json({ error: '删除文件失败' });
    }
  });

  return router;
}

module.exports = createFilesRouter;
