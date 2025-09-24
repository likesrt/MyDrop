const express = require('express');
const path = require('path');
const fs = require('fs');
const { logger } = require('../services/logger');

function createMessagesRouter(options) {
  const { db, broadcast, requireAuth, uploadDir } = options;
  const router = express.Router();

  // Get messages
  router.get('/messages', requireAuth, async (req, res) => {
    const sinceId = req.query.sinceId ? parseInt(req.query.sinceId, 10) : null;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100;
    const msgs = await db.listMessages(sinceId, limit);
    res.json({ messages: msgs });
  });


  // Delete message (admin)
  router.post('/admin/message/delete', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.body || {};
      if (!messageId) return res.status(400).json({ error: '缺少消息ID' });

      const full = await db.getMessage(messageId);
      if (!full) return res.status(404).json({ error: '消息不存在' });

      // demo分支：限制只能删除当前设备发送的消息
      if (full.sender_device_id !== req.device_id) {
        return res.status(403).json({ error: '演示服务器只允许删除当前设备发送的消息' });
      }

      await db.deleteMessage(messageId);
      logger.info('admin.message.delete', { message_id: messageId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.message.delete.error', { err });
      res.status(500).json({ error: '删除消息失败' });
    }
  });

  // Clear all messages (admin)
  router.post('/admin/messages/clear', requireAuth, async (req, res) => {
    try {
      // demo分支：禁用清空全部消息功能
      return res.status(403).json({ error: '演示服务器已禁用清空全部消息功能' });

      const files = await db.listAllFiles();
      const msgCountBefore = await db.countMessages();
      try {
        for (const f of files) {
          const p = path.join(uploadDir, f.stored_name);
          try { await fs.promises.unlink(p); } catch (_) {}
        }
      } catch (_) {}

      const removedMsgs = await db.clearAllMessages();
      try {
        if (files && files.length) await db.incrementStat('cleaned_files_total', files.length);
        const msgsToCount = removedMsgs || msgCountBefore || 0;
        if (msgsToCount) await db.incrementStat('cleaned_messages_total', msgsToCount);
      } catch (_) {}
      logger.info('admin.messages.clear', { cleared_messages: true, file_count: (files || []).length });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.messages.clear.error', { err });
      res.status(500).json({ error: '清空消息失败' });
    }
  });

  return router;
}

module.exports = createMessagesRouter;
