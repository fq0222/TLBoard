const crypto = require('crypto');

const XUI_AUTH_LENGTH = 10;
const XUI_AUTH_PATTERN = /^[A-Za-z0-9]{10}$/;
const XUI_AUTH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 判断 auth 是否符合 3X-UI 对 hysteria/hy2 密码的格式要求。
 *
 * @param {string} auth - 待校验的 auth
 * @returns {boolean} 是否为 10 位纯字母数字
 */
function isValidXuiAuth(auth) {
  return XUI_AUTH_PATTERN.test(String(auth || ''));
}

/**
 * 生成符合 3X-UI 要求的 hy2 auth。
 *
 * @returns {string} 10 位纯字母数字 auth
 */
function generateXuiAuth() {
  let result = '';
  for (let i = 0; i < XUI_AUTH_LENGTH; i += 1) {
    result += XUI_AUTH_ALPHABET[crypto.randomInt(0, XUI_AUTH_ALPHABET.length)];
  }
  return result;
}

module.exports = {
  XUI_AUTH_LENGTH,
  XUI_AUTH_PATTERN,
  isValidXuiAuth,
  generateXuiAuth
};
