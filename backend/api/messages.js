const express = require('express');
const { logger } = require('../services/logger');

function createMessagesRouter(options) {
  const { db, broadcast, requireAuth } = options;
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

      await db.deleteMessage(messageId);
      logger.info('admin.message.delete', { message_id: messageId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.message.delete.error', { err });
      res.status(500).json({ error: '删除消息失败' });
    }
  });

  return router;
}

module.exports = createMessagesRouter;