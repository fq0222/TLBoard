/** 管理端 API 日志安全回归：真实执行 Axios，仅用失败适配器替换外部网络。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'

vi.mock('element-plus/es/components/message/index.mjs', () => ({ ElMessage: { error: vi.fn() } }))

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
  localStorage.setItem('admin_token', 'fixture-bearer-secret')
  responseStatus = 400
  businessCode = 1001
  // config 含 Axios 转换后的密码和令牌，响应及 request 分别模拟任意服务端文本与底层数据。
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
  api = (await import('../src/api/index.js')).default.admin
  vi.mocked(ElMessage.error).mockClear()
})

afterEach(() => {
  axios.defaults.adapter = originalAdapter
  localStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  ['管理员登录', api => api.login({ password: 'fixture-password-secret' })],
  ['修改密码', api => api.changePassword({ old_password: 'fixture-password-secret', new_password: 'fixture-new-password-secret' })],
  ['修改用户', api => api.updateUser(1, { password: 'fixture-password-secret' })]
])('%s失败仅记录安全状态码，控制台不接收密码和令牌', async (_name, request) => {
  const caught = await request(api).catch(error => error)
  expect(caught).toBe(failure)

  expect(failure.config.headers.Authorization).toBe('Bearer fixture-bearer-secret')
  expect(failure.config.data).toContain('fixture-password-secret')
  const log = JSON.stringify(consoleError.mock.calls)
  for (const secret of ['password', 'new-password', 'bearer', 'server', 'error', 'request']) {
    expect(log).not.toContain(`fixture-${secret}-secret`)
  }
  expect(consoleError.mock.calls).toEqual([['响应拦截器错误:', { status: 400, code: 1001 }]])
  expect(ElMessage.error).toHaveBeenCalledWith('fixture-server-secret')
})

it('页面自行提示的 Passkey 错误仍安全记录，且保留弹窗抑制', async () => {
  const caught = await api.getPasskeys({ keyword: 'fixture-query-secret' }).catch(error => error)
  expect(caught).toBe(failure)

  expect(consoleError.mock.calls).toEqual([['响应拦截器错误:', { status: 400, code: 1001 }]])
  expect(ElMessage.error).not.toHaveBeenCalled()
})

it('服务端非数值 code 和含密钥的 URL 不进入日志，已有弹窗文案保持不变', async () => {
  responseStatus = 502
  businessCode = { secret: 'fixture-code-secret' }
  const caught = await api.updateUser('fixture-path-secret?token=fixture-query-secret#fixture-hash-secret', {}).catch(error => error)
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
