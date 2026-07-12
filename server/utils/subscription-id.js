const crypto = require('crypto');

/**
 * 生成公开订阅链接使用的用户级 sub_id。
 * 职责：只用于 users.sub_id / user_subscriptions.sub_id，不用于节点级 user_node_configs.sub_id。
 *
 * @returns {string} 32 位十六进制订阅 ID
 */
function generatePublicSubscriptionId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  generatePublicSubscriptionId
};
