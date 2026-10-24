/** API 日志安全回归：仅替换网络边界，真实执行 Axios 转换、鉴权和错误拦截器。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))

let axios
let api
let apiClient
let consoleError
let originalAdapter
let failure
let responseStatus
let businessCode

beforeEach(async () => {
  vi.resetModules()
  axios = (await import('axios')).default
  originalAdapter = axios.defaults.adapter
  const create = axios.create.bind(axios)
  // 捕获真实实例以注入上游失败；保留 axios.create 的实际行为。
  vi.spyOn(axios, 'create').mockImplementation(config => {
    apiClient = create(config)
    return apiClient
  })
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.setItem('user_token', 'fixture-bearer-secret')
  responseStatus = 400
  businessCode = 1001
  // 失败响应保留真实 config/data/Authorization，并附带服务端任意文本和底层 request。
  axios.defaults.adapter = async config => {
    const response = responseStatus === undefined ? undefined : {
      status: responseStatus,
      statusText: 'Fixture error',
      headers: {},
      config,
      data: { code: businessCode, message: 'fixture-server-secret' }
    }
    failure = new axios.AxiosError('fixture-error-secret', 'ERR_NETWORK', config,
      { body: 'fixture-request-secret' }, response)
    throw failure
  }
  api = (await import('../src/api/index.js')).default.user
  vi.mocked(ElMessage.error).mockClear()
})

afterEach(() => {
  axios.defaults.adapter = originalAdapter
  localStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  ['密码登录', api => api.login({ password: 'fixture-password-secret' })],
  ['绑定密码复验', api => api.getPasskeyRegistrationOptions({ password: 'fixture-password-secret' })],
  ['删除密码复验', api => api.deletePasskey(1, { password: 'fixture-password-secret' })],
  ['Passkey 登录', api => api.verifyPasskeyLogin({ ceremony_id: 'fixture-ceremony-secret', response: { authenticatorData: 'fixture-webauthn-secret' } })],
  ['Passkey 绑定', api => api.verifyPasskeyRegistration({ ceremony_id: 'fixture-ceremony-secret', response: { clientDataJSON: 'fixture-webauthn-secret' } })]
])('%s失败仅记录安全状态码，拒绝向控制台传递认证数据', async (_name, request) => {
  const caught = await request(api).catch(error => error)
  expect(caught).toBe(failure)

  // 确认敏感数据确实经过 Axios，避免空请求或未触发拦截器造成假通过。
  expect(failure.config.headers.Authorization).toBe('Bearer fixture-bearer-secret')
  expect(failure.config.data).toMatch(/fixture-(?:password|webauthn)-secret/)
  const log = JSON.stringify(consoleError.mock.calls)
  for (const secret of ['password', 'bearer', 'webauthn', 'ceremony', 'server', 'error', 'request']) {
    expect(log).not.toContain(`fixture-${secret}-secret`)
  }
  expect(consoleError.mock.calls).toEqual([['响应拦截器错误:', { status: 400, code: 1001 }]])
  expect(failure.userMessage).toBe('fixture-server-secret')
  expect(ElMessage.error).not.toHaveBeenCalled()
})

it('服务端非数值 code 和含密钥的 URL 不进入日志，已有弹窗文案保持不变', async () => {
  responseStatus = 502
  businessCode = 'fixture-code-secret'
  const caught = await api.getPublicOrderStatus('fixture-path-secret?token=fixture-query-secret#fixture-hash-secret').catch(error => error)
  expect(caught).toBe(failure)
  expect(failure.config.url).toContain('fixture-path-secret?token=fixture-query-secret#fixture-hash-secret')

  expect(consoleError.mock.calls).toEqual([['响应拦截器错误:', { status: 502 }]])
  expect(ElMessage.error).toHaveBeenCalledWith('fixture-server-secret')
})

it('无响应的网络错误只输出固定标签，保留网络错误提示', async () => {
  responseStatus = undefined
  const caught = await api.login({ password: 'fixture-password-secret' }).catch(error => error)
  expect(caught).toBe(failure)

  expect(consoleError.mock.calls).toEqual([['响应拦截器错误:', {}]])
  expect(ElMessage.error).toHaveBeenCalledWith('网络连接失败')
})

it('更换订阅链接的 429 由页面独占提示，拦截器不重复弹出通用错误', async () => {
  responseStatus = 429
  businessCode = 3004

  const caught = await api.replaceSubscriptionLink().catch(error => error)

  expect(caught).toBe(failure)
  expect(failure.config.skipGlobalError).toBe(true)
  expect(failure.config.timeout).toBe(5 * 60 * 1000)
  expect(failure.userMessage).toBe('fixture-server-secret')
  expect(ElMessage.error).not.toHaveBeenCalled()
})

it('上游请求拦截器失败经过请求和响应错误处理时均不泄露原始错误', async () => {
  const requestFailure = new axios.AxiosError('fixture-error-secret', 'ERR_NETWORK', {
    data: { password: 'fixture-password-secret' }, headers: { Authorization: 'fixture-bearer-secret' }
  })
  apiClient.interceptors.request.use(() => { throw requestFailure })

  const caught = await api.login({ password: 'fixture-password-secret' }).catch(error => error)

  expect(caught).toBe(requestFailure)
  expect(consoleError.mock.calls).toEqual([
    ['请求拦截器错误:', {}], ['响应拦截器错误:', {}]
  ])
})
