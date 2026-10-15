/** Passkey 浏览器客户端：衔接服务端一次性挑战和系统认证器，不读取页面账号密码。 */
import api from '@/api'
import * as browser from '@simplewebauthn/browser'

export class PasskeyClient {
  /**
   * 注入认证 API 与浏览器适配器，默认使用项目封装及 SimpleWebAuthn。
   * @param {Object} dependencies - api.user 接口集与 browser 认证方法集
   */
  constructor({ api: apiAdapter = api, browser: browserAdapter = browser } = {}) {
    this.api = apiAdapter.user
    this.browser = browserAdapter
  }

  /**
   * 只以安全上下文和基本 WebAuthn API 为硬门槛。
   * 高级平台/混合能力为 unknown 或 false 时仍可能支持外置密钥，不据此禁用认证入口。
   */
  async isSupported() {
    const credentials = globalThis.navigator?.credentials
    return !!globalThis.isSecureContext && typeof globalThis.PublicKeyCredential === 'function' &&
      typeof credentials?.get === 'function' && typeof credentials?.create === 'function'
  }

  /**
   * 提取统一业务响应；业务失败仅保留安全整数错误码供页面判断，不传播响应内容。
   * @param {Object} result - 含 code、message、data 的服务端响应
   * @returns {Object} 成功响应的数据部分
   */
  unwrap(result) {
    if (result.code !== 0) {
      const error = new Error(result.message || 'Passkey 操作失败')
      if (Number.isSafeInteger(result.code)) error.code = result.code
      throw error
    }
    return result.data
  }

  /**
   * 调起认证器；只有此浏览器调用边界的 NotAllowedError 视为静默取消。
   * @param {string} method - startAuthentication 或 startRegistration
   * @param {Object} options - 服务端生成的 WebAuthn JSON 选项
   * @returns {Promise<Object|null>} 凭据响应，用户取消时返回 null
   */
  async getCredential(method, options) {
    try {
      return await this.browser[method]({ optionsJSON: options })
    } catch (error) {
      if (error?.name === 'NotAllowedError') return null
      throw error
    }
  }

  /** 使用匿名挑战完成登录，成功返回与密码登录相同的 token/user，取消返回 null。 */
  async login() {
    const { ceremony_id, options } = this.unwrap(await this.api.getPasskeyLoginOptions())
    const response = await this.getCredential('startAuthentication', options)
    if (!response) return null
    return this.unwrap(await this.api.verifyPasskeyLogin({ ceremony_id, response }))
  }

  /**
   * 复验密码后绑定新凭据；verify 仅发送名称和认证响应，不重复发送密码。
   * @param {Object} optionsPayload - password 复验密码及可选 name 显示名称
   * @returns {Promise<Object|null>} 已保存凭据，取消返回 null
   */
  async register(optionsPayload) {
    const { ceremony_id, options } = this.unwrap(await this.api.getPasskeyRegistrationOptions(optionsPayload))
    const response = await this.getCredential('startRegistration', options)
    if (!response) return null
    return this.unwrap(await this.api.verifyPasskeyRegistration({ ceremony_id, response, name: optionsPayload.name }))
  }
}
