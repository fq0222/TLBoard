/**
 * 订阅策略处理服务
 * 
 * 支持两种策略：
 * - cf: 替换地址为 CF 优选 IP，端口为 client_port，host 为 host
 * - direct: 完全不修改，直接使用原始节点信息
 */

/**
 * 从节点备注中判断策略类型
 * @param {string} remark - 节点备注
 * @returns {string} 'cf' 或 'direct'
 */
function getStrategyFromRemark(remark) {
  if (!remark) return 'direct';
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'cf';
  }
  return 'direct';
}

/**
 * 解析节点链接
 * @param {string} link - 节点链接（vless://, vmess://, trojan://）
 * @returns {object|null} 解析后的节点信息
 */
function parseNodeLink(link) {
  if (!link) return null;
  
  const protocolMatch = link.match(/^(vless|vmess|trojan):\/\//);
  if (!protocolMatch) return null;
  
  const protocol = protocolMatch[1];
  const rest = link.substring(protocol.length + 3);
  
  // 分离 remark（# 后面的内容）
  const hashIndex = rest.indexOf('#');
  let mainPart = rest;
  let remark = '';
  if (hashIndex !== -1) {
    mainPart = rest.substring(0, hashIndex);
    remark = decodeURIComponent(rest.substring(hashIndex + 1));
  }
  
  // 分离参数（? 后面的内容）
  const questionIndex = mainPart.indexOf('?');
  let addressPart = mainPart;
  let paramsStr = '';
  if (questionIndex !== -1) {
    addressPart = mainPart.substring(0, questionIndex);
    paramsStr = mainPart.substring(questionIndex + 1);
  }
  
  // 解析地址和端口
  let uuid = '';
  let address = '';
  let port = 0;
  
  if (addressPart.includes('@')) {
    const atIndex = addressPart.indexOf('@');
    uuid = addressPart.substring(0, atIndex);
    const hostPort = addressPart.substring(atIndex + 1);
    const lastColonIndex = hostPort.lastIndexOf(':');
    if (lastColonIndex !== -1) {
      address = hostPort.substring(0, lastColonIndex);
      port = parseInt(hostPort.substring(lastColonIndex + 1)) || 0;
    } else {
      address = hostPort;
    }
  }
  
  // 解析参数
  const params = {};
  if (paramsStr) {
    paramsStr.split('&').forEach(param => {
      const equalIndex = param.indexOf('=');
      if (equalIndex !== -1) {
        const key = decodeURIComponent(param.substring(0, equalIndex));
        const value = decodeURIComponent(param.substring(equalIndex + 1));
        params[key] = value;
      }
    });
  }
  
  return {
    protocol,
    uuid,
    address,
    port,
    params,
    remark
  };
}

/**
 * 构建节点链接
 * @param {object} nodeInfo - 节点信息
 * @returns {string} 节点链接
 */
function buildNodeLink(nodeInfo) {
  const { protocol, uuid, address, port, params, remark } = nodeInfo;
  
  // 构建参数字符串
  const paramsStr = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  // IPv6 地址需要加方括号
  const host = address.includes(':') ? `[${address}]` : address;
  
  // 构建主部分
  const mainPart = `${uuid}@${host}:${port}`;
  
  // 构建完整链接
  let link = `${protocol}://${mainPart}`;
  if (paramsStr) {
    link += `?${paramsStr}`;
  }
  if (remark) {
    link += `#${encodeURIComponent(remark)}`;
  }
  
  return link;
}

/**
 * 应用 cf 策略
 * @param {string} originalLink - 原始节点链接
 * @param {object} cfConfig - CF 配置
 * @param {string} cfConfig.cfIp - CF 优选 IP
 * @param {number} cfConfig.clientPort - 客户端端口
 * @param {string} cfConfig.host - 主机名
 * @returns {string} 处理后的节点链接
 */
function applyCfStrategy(originalLink, cfConfig) {
  const nodeInfo = parseNodeLink(originalLink);
  if (!nodeInfo) return originalLink;
  
  // 替换地址
  if (cfConfig.cfIp) {
    nodeInfo.address = cfConfig.cfIp;
  }
  
  // 替换端口
  if (cfConfig.clientPort) {
    nodeInfo.port = cfConfig.clientPort;
  }
  
  // 替换 host（无条件设置）
  if (cfConfig.host) {
    nodeInfo.params.host = cfConfig.host;
  }
  
  return buildNodeLink(nodeInfo);
}

/**
 * 应用 direct 策略
 * @param {string} originalLink - 原始节点链接
 * @returns {string} 原始节点链接（不修改）
 */
function applyDirectStrategy(originalLink) {
  return originalLink;
}

/**
 * 处理节点链接
 * @param {string} originalLink - 原始节点链接
 * @param {string} strategy - 策略类型（cf 或 direct）
 * @param {object} cfConfig - CF 配置（仅 cf 策略需要）
 * @returns {string} 处理后的节点链接
 */
function processNodeLink(originalLink, strategy, cfConfig = null) {
  if (strategy === 'cf' && cfConfig) {
    return applyCfStrategy(originalLink, cfConfig);
  }
  return applyDirectStrategy(originalLink);
}

module.exports = {
  getStrategyFromRemark,
  parseNodeLink,
  buildNodeLink,
  applyCfStrategy,
  applyDirectStrategy,
  processNodeLink
};
