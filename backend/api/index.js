const express = require('express');
const createAuthRouter = require('./auth');
const createMessagesRouter = require('./messages');
const createFilesRouter = require('./files');
const createAdminRouter = require('./admin');
const createConfigRouter = require('./config');

function createApiRouter(options) {
  const mainRouter = express.Router();

  // Config (public)
  const configRouter = createConfigRouter(options);
  mainRouter.use(configRouter);

  // Auth routes
  const { router: authRouter, requireAuth } = createAuthRouter(options);
  mainRouter.use(authRouter);

  // Pass requireAuth to other routers
  const messagesRouter = createMessagesRouter({ ...options, requireAuth });
  const filesRouter = createFilesRouter({ ...options, requireAuth });
  const adminRouter = createAdminRouter({ ...options, requireAuth });

  mainRouter.use(messagesRouter);
  mainRouter.use(filesRouter);
  mainRouter.use(adminRouter);

  return mainRouter;
}

module.exports = createApiRouter;