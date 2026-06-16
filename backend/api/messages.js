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

      // 删除关联文件（磁盘 + 统计）
      let removedFiles = 0;
      try {
        const files = Array.isArray(full.files) ? full.files : [];
        for (const f of files) {
          try { await fs.promises.unlink(path.join(uploadDir, f.stored_name)); removedFiles++; } catch (_) {}
        }
      } catch (_) {}

      await db.deleteMessage(messageId);
      try {
        await db.incrementStat('cleaned_messages_total', 1);
        if (removedFiles > 0) await db.incrementStat('cleaned_files_total', removedFiles);
      } catch (_) {}
      logger.info('admin.message.delete', { message_id: messageId, removed_files: removedFiles });
      res.json({ ok: true, removed_files: removedFiles });
    } catch (err) {
      logger.error('admin.message.delete.error', { err });
      res.status(500).json({ error: '删除消息失败' });
    }
  });

  // Clear all messages (admin)
  router.post('/admin/messages/clear', requireAuth, async (req, res) => {
    try {
      // 使用事务保证数据库和磁盘文件的一致性
      let files = [];
      let removedMsgs = 0;
      try {
        db.rawDb().prepare('BEGIN IMMEDIATE').run();

        // 先从数据库读取文件列表和消息数
        files = await db.listAllFiles();
        const msgCountBefore = await db.countMessages();

        // 清空数据库记录（由于外键级联，files 表也会被清空）
        removedMsgs = await db.clearAllMessages();

        db.rawDb().prepare('COMMIT').run();
      } catch (err) {
        try { db.rawDb().prepare('ROLLBACK').run(); } catch (_) {}
        throw err;
      }

      // 数据库已清空，现在删除磁盘文件（失败不影响一致性，因为孤立文件可手动清理）
      let removedFileCount = 0;
      try {
        for (const f of files) {
          const p = path.join(uploadDir, f.stored_name);
          try {
            await fs.promises.unlink(p);
            removedFileCount++;
          } catch (_) {}
        }
      } catch (_) {}

      // 更新统计
      try {
        if (files && files.length) await db.incrementStat('cleaned_files_total', files.length);
        if (removedMsgs) await db.incrementStat('cleaned_messages_total', removedMsgs);
      } catch (_) {}

      logger.info('admin.messages.clear', { cleared_messages: removedMsgs, file_count: files.length, removed_files: removedFileCount });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.messages.clear.error', { err });
      res.status(500).json({ error: '清空消息失败' });
    }
  });

  return router;
}

module.exports = createMessagesRouter;
