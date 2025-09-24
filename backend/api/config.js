const express = require('express');

function createConfigRouter(options) {
  const { limits, features = {}, db, settings } = options;
  const router = express.Router();

  // Public config endpoint
  router.get('/config', async (req, res) => {
    try {
      let qrEnabled = false;
      try { const user = await db.getFirstUser(); qrEnabled = !!(user && user.qr_login_enabled); } catch (_) {}
      const cfg = settings && settings.getAllSync ? settings.getAllSync() : { headerAutoHide: !!features.autoHideHeader };
      res.json({
        // demo分支：限制默认上传配额，单文件 5MB，总计 50
        maxFiles: 50,
        fileSizeLimitMB: 5,
        headerAutoHide: !!cfg.headerAutoHide,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: !!qrEnabled,
      });
    } catch (_) {
      const cfg = settings && settings.getAllSync ? settings.getAllSync() : { headerAutoHide: !!features.autoHideHeader };
      res.json({
        maxFiles: 50,
        fileSizeLimitMB: 5,
        headerAutoHide: !!cfg.headerAutoHide,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: false,
      });
    }
  });

  return router;
}

module.exports = createConfigRouter;
