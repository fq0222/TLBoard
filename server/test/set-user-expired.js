/**
 * 设置指定用户的 expire_at。
 *
 * 职责：辅助本地测试续费和过期巡检流程，默认把 yueka02@qq.com 设置为 1 天前过期。
 * 关键参数：--email 指定用户邮箱，--days 指定过期到几天前，--after-minutes 指定几分钟后过期，--dry-run 仅预览不写库。
 * 核心分支：dry-run 只查询目标用户；正常执行只更新 expire_at，不修改 enabled/disable_reason。
 */

const { Pool } = require('pg');
const config = require('../config');

function parseArgs(argv) {
  const options = {
    email: 'yueka02@qq.com',
    days: 1,
    afterMinutes: null,
    daysProvided: false,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--email') {
      options.email = argv[index + 1] || options.email;
      index++;
    } else if (arg === '--days') {
      options.days = Number(argv[index + 1] || options.days);
      options.daysProvided = true;
      index++;
    } else if (arg === '--after-minutes') {
      options.afterMinutes = Number(argv[index + 1]);
      options.days = null;
      index++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  if (!options.email || !options.email.includes('@')) {
    throw new Error('请提供有效邮箱，例如：--email yueka02@qq.com');
  }

  if (options.afterMinutes !== null && options.daysProvided) {
    throw new Error('--days 和 --after-minutes 不能同时使用');
  }

  if (options.afterMinutes !== null
    && (!Number.isFinite(options.afterMinutes) || options.afterMinutes <= 0)) {
    throw new Error('请提供大于 0 的未来过期分钟数，例如：--after-minutes 3');
  }

  if (options.afterMinutes === null && (!Number.isFinite(options.days) || options.days <= 0)) {
    throw new Error('请提供大于 0 的过期天数，例如：--days 1');
  }

  delete options.daysProvided;
  return options;
}

function calculateTargetExpireAt(nowSeconds, options) {
  if (options.afterMinutes !== null && options.afterMinutes !== undefined) {
    return nowSeconds + Math.floor(Number(options.afterMinutes) * 60);
  }

  return nowSeconds - Math.floor(Number(options.days) * 24 * 60 * 60);
}

function formatDateTime(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool(config.database);
  const targetExpireAt = calculateTargetExpireAt(Math.floor(Date.now() / 1000), options);

  try {
    const sql = options.dryRun
      ? 'SELECT id, email, expire_at, enabled, disable_reason FROM users WHERE email = $1'
      : 'UPDATE users SET expire_at = $1 WHERE email = $2 RETURNING id, email, expire_at, enabled, disable_reason';
    const params = options.dryRun ? [options.email] : [targetExpireAt, options.email];
    const result = await pool.query(sql, params);

    if (result.rowCount !== 1) {
      throw new Error(`未找到唯一用户: ${options.email}, rowCount=${result.rowCount}`);
    }

    const row = result.rows[0];
    console.log(options.dryRun ? '预览用户当前状态:' : '已写入用户到期时间:');
    console.table([{
      id: row.id,
      email: row.email,
      expire_at: row.expire_at,
      expire_time: formatDateTime(row.expire_at),
      enabled: row.enabled,
      disable_reason: row.disable_reason
    }]);

    if (!options.dryRun) {
      console.log(`目标到期时间: ${targetExpireAt} (${formatDateTime(targetExpireAt)})`);
    } else {
      console.log(`本次目标到期时间: ${targetExpireAt} (${formatDateTime(targetExpireAt)})`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`设置用户到期时间失败: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  calculateTargetExpireAt,
  formatDateTime,
  main
};
