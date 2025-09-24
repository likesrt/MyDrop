const express = require('express');

function createConfigRouter(options) {
  const { limits, features = {} } = options;
  const router = express.Router();

  // Public config endpoint
  router.get('/config', (req, res) => {
    res.json({
      maxFiles: limits.maxFiles,
      fileSizeLimitMB: limits.fileSizeLimitMB,
      headerAutoHide: !!features.autoHideHeader,
      assetVersion: features.assetVersion || null,
    });
  });

  return router;
}

module.exports = createConfigRouter;
