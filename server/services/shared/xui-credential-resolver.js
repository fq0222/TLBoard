const crypto = require('crypto');
const { isValidXuiAuth, generateXuiAuth } = require('../../utils/xui-auth');

/**
 * 从同一用户、同一服务器的本地节点配置中确定主凭证。
 * 本地记录冲突时固定选择最小 inbound_id，避免 3X-UI 返回顺序改变凭证。
 * @param {Array<Object>} localConfigs - user_node_configs 查询结果
 * @returns {Object|null} 本地主凭证记录
 */
function selectCanonicalLocalConfig(localConfigs = []) {
  return [...localConfigs]
    .filter((config) => config)
    .sort((left, right) => Number(left.inbound_id) - Number(right.inbound_id))[0] || null;
}

/**
 * 将节点级 subId 归一化为 3X-UI 接受的 16 位十六进制值。
 * @param {*} value - 本地、远端或显式覆盖的 subId
 * @returns {string} 合法 subId；非法时返回空字符串
 */
function normalizeNodeSubId(value) {
  const subId = String(value || '').trim();
  return /^[0-9a-f]{16}$/i.test(subId) ? subId.toLowerCase() : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const DEFAULT_GENERATORS = Object.freeze({
  uuid: () => crypto.randomUUID(),
  password: () => crypto.randomBytes(8).toString('hex'),
  auth: () => generateXuiAuth(),
  subId: () => crypto.randomBytes(8).toString('hex')
});

/**
 * 解析 3X-UI 服务器级 client 凭证，本地存在时禁止远端覆盖本地字段。
 * @param {Object} options - 本地配置、远端 client、本地用户邮箱及可选字段生成器
 * @returns {{uuid:string,password:string,auth:string,subId:string,source:string,generatedFields:string[]}}
 */
function resolveServerClientCredentials({
  localConfigs = [],
  remoteClient = null,
  expectedEmail = '',
  overrideSubId = '',
  generators = DEFAULT_GENERATORS
}) {
  const local = selectCanonicalLocalConfig(localConfigs);
  const remote = remoteClient || {};
  const hasLocalConfig = !!local;
  const normalizedOverrideSubId = normalizeNodeSubId(overrideSubId);
  const generatedFields = [];

  if (
    !hasLocalConfig &&
    remoteClient &&
    normalizeEmail(remote.email) !== normalizeEmail(expectedEmail)
  ) {
    throw new Error(`远端 client 与本地用户 email 不一致，禁止收编: expected=${expectedEmail}`);
  }

  const generateField = (field) => {
    generatedFields.push(field);
    return generators[field]();
  };

  const uuid = String(local?.uuid || '').trim()
    || (!hasLocalConfig ? String(remote.uuid || remote.id || '').trim() : '')
    || generateField('uuid');
  const password = String(local?.password || '').trim()
    || (!hasLocalConfig ? String(remote.password || '').trim() : '')
    || generateField('password');
  const auth = isValidXuiAuth(local?.auth)
    ? local.auth
    : (!hasLocalConfig && isValidXuiAuth(remote.auth) ? remote.auth : generateField('auth'));
  const subId = normalizedOverrideSubId
    || normalizeNodeSubId(local?.sub_id)
    || (!hasLocalConfig ? normalizeNodeSubId(remote.subId) : '')
    || generateField('subId');

  return {
    uuid,
    password,
    auth,
    subId,
    source: hasLocalConfig
      ? (generatedFields.length > 0 ? 'local-repaired' : 'local')
      : (remoteClient ? 'remote-adopted' : 'generated'),
    generatedFields
  };
}

module.exports = {
  normalizeNodeSubId,
  resolveServerClientCredentials,
  selectCanonicalLocalConfig
};
