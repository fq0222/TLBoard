/**
 * 用户端同步状态路由。
 * 负责同步状态轮询接口的鉴权与 controller 映射。
 */

const express = require('express');
const { authenticateUser } = require('../../middleware/auth-user');
const syncStatusController = require('../../controllers/user/sync-status-controller');

const router = express.Router();

router.get('/', authenticateUser, syncStatusController.getSyncStatus);

module.exports = router;
