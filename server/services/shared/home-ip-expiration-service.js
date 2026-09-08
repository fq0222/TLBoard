/**
 * 家宽 IP 到期清理服务。
 * 职责：在流量同步定时任务中清理已到期家宽套餐的 routing，并发送一次过期提醒。
 */

const { withUserStatusLock } = require('./user-status-lock');
const trafficRepository = require('../../repositories/traffic-repository');
const homeRoutingService = require('./home-routing-service');
const renewalRequiredEmailService = require('./renewal-required-email-service');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('HOME-IP-EXPIRATION');
const HOME_IP_EXPIRED_REASON = 'home_ip_expired';

/**
 * 安全发送家宽 IP 过期提醒。
 * 核心分支：先领取发送资格并写入尝试时间，后发送邮件；邮件失败不影响定时任务继续处理其他用户。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @param {number} now - 本次提醒尝试时间
 * @returns {Promise<boolean>} 是否领取资格并触发邮件服务
 */
async function sendHomeIpExpiredEmailOnce(db, userId, now) {
  try {
    const claim = await trafficRepository.claimHomeIpExpiredNotice(db, userId, now);
    if (!claim.claimed) {
      return false;
    }

    await renewalRequiredEmailService.sendRenewalRequiredEmail(db, {
      userId,
      reason: HOME_IP_EXPIRED_REASON
    });
    return true;
  } catch (error) {
    logger.error(`家宽 IP 过期提醒邮件调用异常: user=${userId}, error=${error.message}`);
    return false;
  }
}

/**
 * 清理单个用户的到期家宽 routing。
 * 职责：持有用户状态锁期间完成远端 routing 清理与本地过期标记，避免与支付续费并发交错。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 家宽到期用户快照
 * @param {number} now - 当前秒级时间戳
 * @returns {Promise<Object>} 单用户处理结果
 */
async function cleanupExpiredHomeIpUser(db, user, now) {
  const lockedResult = await withUserStatusLock(db, Number(user.id), async () => {
    const cleanupResult = await homeRoutingService.cleanupHomeRoutingForUser(db, user.id, {
      skipCooldown: true,
      throwOnMissing: false,
      throwOnFailure: false,
      now,
      logger
    });

    if (!cleanupResult.success) {
      return {
        success: false,
        action: 'cleanup-failed',
        retryable: cleanupResult.retryable !== false,
        message: cleanupResult.message || '家宽 IP routing 清理失败'
      };
    }

    const markResult = await trafficRepository.markHomeIpExpired(db, user.id, now);
    if (!markResult.expired) {
      return { success: true, action: 'skip-rechecked' };
    }

    return { success: true, action: 'expired' };
  });

  if (lockedResult.success === false) {
    return lockedResult;
  }

  if (lockedResult.retryable) {
    return { action: 'lock-busy', retryable: true };
  }

  if (lockedResult.success && lockedResult.action === 'expired') {
    const emailSent = await sendHomeIpExpiredEmailOnce(db, user.id, now);
    return { action: 'expired', emailSent };
  }

  return lockedResult;
}

/**
 * 清理所有已到期家宽 IP 套餐。
 * 核心分支：只有 routing 清理成功后才标记 expired；清理失败保留 route 供下轮重试。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} [now=Math.floor(Date.now() / 1000)] - 当前秒级时间戳，测试可传固定值
 * @returns {Promise<{expiredCount:number,skippedCount:number,failedCount:number,retryCount:number,emailCount:number}>} 清理统计
 */
async function cleanupExpiredHomeIpPlans(db, now = Math.floor(Date.now() / 1000)) {
  const stats = {
    expiredCount: 0,
    skippedCount: 0,
    failedCount: 0,
    retryCount: 0,
    emailCount: 0
  };

  try {
    const users = await trafficRepository.listExpiredHomeIpUsers(db, now);
    if (users.length === 0) {
      logger.info('没有需要清理的家宽 IP 到期用户');
      return stats;
    }

    logger.info(`开始清理 ${users.length} 个家宽 IP 到期用户`);

    for (const user of users) {
      try {
        const result = await cleanupExpiredHomeIpUser(db, user, now);

        if (result.action === 'expired') {
          stats.expiredCount += 1;
          if (result.emailSent) {
            stats.emailCount += 1;
          }
          logger.info(`家宽 IP 到期清理成功: user=${user.id}, email=${user.email}`);
          continue;
        }

        if (result.retryable) {
          stats.retryCount += 1;
        }

        if (result.success === false || result.action === 'cleanup-failed') {
          stats.failedCount += 1;
          logger.warn(`家宽 IP 到期清理失败: user=${user.id}, email=${user.email}, message=${result.message || ''}`);
        } else {
          stats.skippedCount += 1;
        }
      } catch (error) {
        stats.failedCount += 1;
        stats.retryCount += 1;
        logger.error(`家宽 IP 到期清理异常: user=${user.id}, email=${user.email}, error=${error.message}`);
      }
    }

    logger.info(
      `家宽 IP 到期清理完成，过期 ${stats.expiredCount} 个，跳过 ${stats.skippedCount} 个，失败 ${stats.failedCount} 个，待重试 ${stats.retryCount} 个，邮件 ${stats.emailCount} 封`
    );
    return stats;
  } catch (error) {
    logger.error(`家宽 IP 到期清理任务错误: ${error.message}`);
    return stats;
  }
}

module.exports = {
  HOME_IP_EXPIRED_REASON,
  cleanupExpiredHomeIpPlans,
  __testables: {
    cleanupExpiredHomeIpUser,
    sendHomeIpExpiredEmailOnce
  }
};
