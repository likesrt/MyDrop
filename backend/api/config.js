const express = require('express');

function createConfigRouter(options) {
  const { limits, features = {}, db } = options;
  const router = express.Router();

  // Public config endpoint
  router.get('/config', async (req, res) => {
    try {
      let qrEnabled = false;
      try { const user = await db.getFirstUser(); qrEnabled = !!(user && user.qr_login_enabled); } catch (_) {}
      res.json({
        maxFiles: limits.maxFiles,
        fileSizeLimitMB: limits.fileSizeLimitMB,
        headerAutoHide: !!features.autoHideHeader,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: !!qrEnabled,
      });
    } catch (_) {
      res.json({
        maxFiles: limits.maxFiles,
        fileSizeLimitMB: limits.fileSizeLimitMB,
        headerAutoHide: !!features.autoHideHeader,
        assetVersion: features.assetVersion || null,
        qrLoginEnabled: false,
      });
    }
  });

  return router;
}

module.exports = createConfigRouter;
