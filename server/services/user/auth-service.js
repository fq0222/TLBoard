const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const vmqService = require('../vmq-service');
const userRepository = require('../../repositories/user-repository');

/**
 * 用户认证服务。
 * 负责注册下单、登录、资料聚合等用户认证相关业务编排，
 * 保持旧接口的业务语义与错误码兼容。
 */

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, index)).toFixed(2)) + ' ' + sizes[index];
}

function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') {
    return '无限期';
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

async function registerAndPay(db, payload) {
  const {
    email,
    password,
    plan_id: planId
  } = payload;
  const payType = Number(payload.pay_type || config.payment.vmqDefaultType || 2);
  const existingUser = await userRepository.findUserRegisterSnapshotByEmail(db, email);

  if (existingUser) {
    const now = getNowTimestamp();
    const expireAt = Number(existingUser.expire_at) || 0;
    if (existingUser.enabled && (expireAt === 0 || expireAt > now)) {
      throw createLegacyBusinessError('该邮箱已注册，如需续费请先登录', {
        code: 2001
      });
    }
  }

  const plan = await userRepository.findEnabledPlanById(db, planId);
  if (!plan) {
    throw createLegacyBusinessError('套餐不存在或已下架');
  }

  if (plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
    throw createLegacyBusinessError('该套餐已售罄', {
      code: 1002
    });
  }

  const subscriptionToken = crypto.randomUUID();
  const subId = crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  const now = getNowTimestamp();

  const transaction = db.transaction(async (transactionDb) => {
    let userId;
    if (existingUser) {
      await userRepository.updateRegisteredUserForPlan(transactionDb, {
        userId: existingUser.id,
        passwordHash,
        planId,
        subscriptionToken,
        subId,
        trafficLimit: plan.traffic_limit,
        updatedAt: now
      });
      userId = existingUser.id;
    } else {
      const userResult = await userRepository.createRegisteredUser(transactionDb, {
        email,
        passwordHash,
        planId,
        subscriptionToken,
        subId,
        trafficLimit: plan.traffic_limit
      });
      userId = Number(userResult.lastInsertRowid);
    }

    const outTradeNo = `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const orderResult = await userRepository.createPendingOrder(transactionDb, {
      userId,
      email,
      planId,
      amount: plan.price,
      outTradeNo
    });

    return {
      userId,
      orderId: Number(orderResult.lastInsertRowid),
      outTradeNo,
      plan
    };
  });

  const transactionResult = await transaction();
  const amount = (Number(transactionResult.plan.price) / 100).toFixed(2);
  const vmqResult = await vmqService.createOrder({
    payId: transactionResult.outTradeNo,
    param: String(transactionResult.userId),
    type: payType,
    price: amount,
    isHtml: 0
  });

  if (Number(vmqResult.code) !== 1 || !vmqResult.data) {
    await userRepository.markOrderExpiredByOutTradeNo(db, transactionResult.outTradeNo);
    throw createLegacyBusinessError(vmqResult.msg || '创建VMQ支付订单失败', {
      statusCode: 502,
      code: 5002
    });
  }

  if (Number(vmqResult.data.isAuto) === 1) {
    await userRepository.markOrderExpiredByOutTradeNo(db, transactionResult.outTradeNo);

    try {
      await vmqService.closeOrder(vmqResult.data.orderId);
    } catch (error) {
      // 关闭失败仅记录兼容行为，保持主流程返回原业务错误。
    }

    throw createLegacyBusinessError(
      '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
      {
        statusCode: 502,
        code: 5003
      }
    );
  }

  const realAmount = Math.round(Number(vmqResult.data.reallyPrice) * 100);
  await userRepository.updateOrderPaymentInfo(db, {
    outTradeNo: transactionResult.outTradeNo,
    tradeNo: vmqResult.data.orderId,
    paymentUrl: vmqResult.data.payUrl,
    amount: realAmount
  });

  return {
    order_id: transactionResult.orderId,
    user_id: transactionResult.userId,
    out_trade_no: transactionResult.outTradeNo,
    vmq_order_id: vmqResult.data.orderId,
    pay_type: vmqResult.data.payType,
    really_price: vmqResult.data.reallyPrice,
    payment_url: vmqResult.data.payUrl,
    expire_in: Number(vmqResult.data.timeOut || 5) * 60
  };
}

async function login(db, payload) {
  const { email, password } = payload;
  const user = await userRepository.findLoginUserByEmail(db, email);

  if (!user) {
    throw createLegacyBusinessError('邮箱或密码错误', {
      code: 2002
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw createLegacyBusinessError('邮箱或密码错误', {
      code: 2002
    });
  }

  if (!user.enabled) {
    throw createLegacyBusinessError('账号已被禁用，请联系管理员', {
      code: 2003
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      plan_id: user.plan_id
    },
    config.user.jwtSecret,
    { expiresIn: config.user.jwtExpiresIn }
  );

  return {
    token,
    expires_in: 604800,
    user: {
      id: user.id,
      email: user.email,
      plan_name: user.plan_name,
      expire_at: user.expire_at,
      enabled: user.enabled
    }
  };
}

async function getProfile(db, userId) {
  const user = await userRepository.findUserProfileById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const cfOptimized = !!(await userRepository.hasUserCfIps(db, userId));
  const subscriptionReady = cfOptimized && !!(await userRepository.hasUserSubscriptionCache(db, user.sub_id));
  const trafficLimit = Number(user.traffic_limit) || 0;
  const trafficUsed = Number(user.traffic_used) || 0;
  const trafficPercent = trafficLimit > 0
    ? Math.round((trafficUsed / trafficLimit) * 100 * 100) / 100
    : 0;

  return {
    id: user.id,
    email: user.email,
    plan_id: user.plan_id,
    plan_name: user.plan_name,
    sub_id: user.sub_id,
    cf_optimized: cfOptimized,
    subscription_ready: subscriptionReady,
    traffic_used: user.traffic_used,
    traffic_limit: user.traffic_limit,
    traffic_used_text: formatTraffic(user.traffic_used),
    traffic_limit_text: formatTraffic(user.traffic_limit),
    traffic_percent: trafficPercent,
    expire_at: user.expire_at,
    expire_text: formatTime(user.expire_at),
    enabled: user.enabled,
    created_at: user.created_at,
    payment_count: user.payment_count,
    sync_status: user.sync_status
  };
}

module.exports = {
  registerAndPay,
  login,
  getProfile
};
