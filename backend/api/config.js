const express = require('express');

function createConfigRouter(options) {
  const { limits } = options;
  const router = express.Router();

  // Public config endpoint
  router.get('/config', (req, res) => {
    res.json({
      maxFiles: limits.maxFiles,
      fileSizeLimitMB: limits.fileSizeLimitMB
    });
  });

  return router;
}

module.exports = createConfigRouter;