const express = require('express');

function createConfigRouter(options) {
  const { limits, features = {}, db, settings } = options;
  const router = express.Router();

  // Public config endpoint
  router.get('/config', async (req, res) => {
    try {
      let qrEnabled = false;
      try { const user = await db.getFirstUser(); qrEnabled = !!(user && user.qr_login_enabled); } catch (_) {}
      const cfg = settings && settings.getAllSync ? settings.getAllSync() : { headerAutoHide: !!features.autoHideHeader, maxFiles: limits.maxFiles, fileSizeLimitMB: limits.fileSizeLimitMB };
      res.json({
        maxFiles: Number(cfg.maxFiles || limits.maxFiles) | 0,
        fileSizeLimitMB: Number(cfg.fileSizeLimitMB || limits.fileSizeLimitMB) | 0,
        headerAutoHide: !!cfg.headerAutoHide,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: !!qrEnabled,
      });
    } catch (_) {
      const cfg = settings && settings.getAllSync ? settings.getAllSync() : { headerAutoHide: !!features.autoHideHeader, maxFiles: limits.maxFiles, fileSizeLimitMB: limits.fileSizeLimitMB };
      res.json({
        maxFiles: Number(cfg.maxFiles || limits.maxFiles) | 0,
        fileSizeLimitMB: Number(cfg.fileSizeLimitMB || limits.fileSizeLimitMB) | 0,
        headerAutoHide: !!cfg.headerAutoHide,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: false,
      });
    }
  });

  return router;
}

module.exports = createConfigRouter;
