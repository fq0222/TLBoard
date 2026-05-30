/**
 * 用户端支付回调路由。
 * 仅负责挂载 VMQ 回调与同步跳转入口，并将业务逻辑分发给 payment controller。
 */

const express = require('express');
const paymentController = require('../../controllers/user/payment-controller');

const router = express.Router();

router.get('/notify', paymentController.handleVmqNotify);
router.post('/notify', express.urlencoded({ extended: true }), paymentController.handleVmqNotify);
router.get('/return', paymentController.handleReturn);

module.exports = router;
