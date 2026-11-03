/** Passkey 登录集成契约：保留真实页面、状态管理和 Axios，仅替换网络与浏览器认证边界。 */
import axios from 'axios'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => ({
  browserSupportsPasskeys: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn()
}))
const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => browser)
vi.mock('element-plus', async importOriginal => ({
  ...await importOriginal(),
  ElMessage: messages
}))

const requests = []
const responses = new Map()
const loginData = { token: 'passkey-token', user: { id: 7, email: 'user@example.test' } }
const assertion = { id: 'credential', response: { signature: 'signed' }, type: 'public-key' }
const originalAdapter = axios.defaults.adapter
const passkeyModulePath = '../src/utils/passkey-client.js'
const preloaderModulePath = '../src/utils/user-center-preloader.js'
// API 模块创建客户端之前替换传输层，保留实际 JSON 转换与请求拦截器。
axios.defaults.adapter = async config => {
  requests.push(config)
  const override = responses.get(config.url)
  if (override instanceof Error) throw Object.assign(override, { config })
  const data = override || { code: 0, data: {} }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}
const { default: Login } = await import('../src/views/Login.vue')
const { default: api } = await import('../src/api/index.js')
const { useUserStore } = await import('../src/stores/user.js')
const { default: ElementPlus } = await import('element-plus')
const wrappers = []
const mountHosts = []

/** 挂载真实登录页；query 可选择密码登录后的目的地或注册模式。 */
async function mountLogin(query = {}) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'Login', component: Login },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } }
    ]
  })
  await router.push({ path: '/login', query })
  await router.isReady()
  const host = document.createElement('div')
  document.body.appendChild(host)
  mountHosts.push(host)
  const wrapper = mount(Login, { attachTo: host, global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, store: useUserStore(pinia) }
}

/** 仅提取认证请求，公开设置等页面初始化请求不属于登录提交。 */
function authenticationRequests() {
  return requests.filter(request => request.url.includes('/passkey/login/'))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  requests.length = 0
  responses.clear()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PublicKeyCredential', class PublicKeyCredential {})
  vi.stubGlobal('navigator', { credentials: { get: vi.fn(), create: vi.fn() } })
  // 页面挂载只安排空闲任务，测试显式执行回调，避免实际页面资源加载干扰认证断言。
  vi.stubGlobal('requestIdleCallback', vi.fn())
  browser.browserSupportsPasskeys.mockResolvedValue(true)
  browser.startAuthentication.mockResolvedValue(assertion)
  browser.startRegistration.mockResolvedValue({ id: 'new-key', response: {} })
  responses.set('/auth/passkey/login/options', { code: 0, data: { ceremony_id: 'login-ceremony', options: { challenge: 'challenge' } } })
  responses.set('/auth/passkey/login/verify', { code: 0, data: loginData })
  responses.set('/login', { code: 0, data: loginData })
})

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  mountHosts.splice(0).forEach(host => host.remove())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('原登录按钮区域的双登录入口', () => {
  it.each(['password', 'passkey'])('%s 认证成功后保持锁定，等待真实导航完成才显示成功', async method => {
    const { wrapper, router } = await mountLogin({ redirect: '/user/profile' })
    let finishNavigation
    const navigation = new Promise(resolve => { finishNavigation = resolve })
    router.beforeEach(() => navigation)
    const replace = vi.spyOn(router, 'replace')
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('user@example.test')
    await inputs[1].setValue('password123')
    await wrapper.get(method === 'password' ? '.login-btn' : '.passkey-login-btn').trigger('click')
    await flushPromises()
    const activeButton = wrapper.get(method === 'password' ? '.login-btn' : '.passkey-login-btn')
    expect(activeButton.classes()).toContain('is-loading')
    expect(activeButton.text()).toBe(method === 'password' ? '登录' : 'Passkey 登录')
    expect(wrapper.get('.login-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeDefined()
    expect(messages.success).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/login')
    await wrapper.findAll('input')[1].trigger('keyup.enter')
    expect(requests.filter(request => request.url === '/login')).toHaveLength(method === 'password' ? 1 : 0)
    finishNavigation(true)
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/user/profile')
    expect(router.currentRoute.value.path).toBe('/user/profile')
    expect(messages.success.mock.calls).toEqual([['登录成功']])
    expect(activeButton.classes()).not.toContain('is-loading')
    replace.mockRestore()
  })

  it.each(['password', 'passkey'])('%s 导航拒绝不显示成功，恢复按钮并使用原错误出口', async method => {
    const { wrapper, router } = await mountLogin()
    let rejectNavigation
    router.beforeEach(() => new Promise((resolve, reject) => { rejectNavigation = reject }))
    // 路由错误有监听器时由应用接收，避免 Vue Router 的默认控制台警告。
    router.onError(() => {})
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('user@example.test')
      await inputs[1].setValue('password123')
      await wrapper.get(method === 'password' ? '.login-btn' : '.passkey-login-btn').trigger('click')
      await flushPromises()
      rejectNavigation(new Error('用户中心加载失败'))
      await flushPromises()
      expect(messages.success).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/login')
      expect(wrapper.get('.login-btn').attributes('disabled')).toBeUndefined()
      expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
      expect(wrapper.get('.login-btn').text()).toBe('登录')
      expect(wrapper.get('.passkey-login-btn').text()).toBe('Passkey 登录')
      if (method === 'password') expect(log).toHaveBeenCalledWith('提交表单错误:', expect.any(Error))
      else expect(messages.error).toHaveBeenCalledWith('用户中心加载失败')
    } finally {
      log.mockRestore()
    }
  })

  describe.each(['password', 'passkey'])('%s 导航失败返回值', method => {
    it.each(['aborted', 'cancelled'])('%s 不显示成功，恢复按钮并使用原错误出口', async failure => {
      const { wrapper, router } = await mountLogin()
      let finishNavigation
      router.beforeEach(to => {
        if (to.path !== '/user') return true
        if (failure === 'aborted') return false
        return new Promise(resolve => { finishNavigation = resolve })
      })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const inputs = wrapper.findAll('input')
        await inputs[0].setValue('user@example.test')
        await inputs[1].setValue('password123')
        await wrapper.get(method === 'password' ? '.login-btn' : '.passkey-login-btn').trigger('click')
        await flushPromises()
        if (failure === 'cancelled') {
          // 新导航替代尚未结束的用户中心导航，旧导航 resolve 为 cancelled 而非 reject。
          await router.push('/login?cancelled=1')
          finishNavigation(true)
          await flushPromises()
        }
        expect(messages.success).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/login')
        expect(wrapper.get('.login-btn').attributes('disabled')).toBeUndefined()
        expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
        expect(wrapper.get('.login-btn').classes()).not.toContain('is-loading')
        expect(wrapper.get('.passkey-login-btn').classes()).not.toContain('is-loading')
        if (method === 'password') {
          expect(log).toHaveBeenCalledWith('提交表单错误:', expect.objectContaining({ message: '进入用户中心失败，请重试' }))
        } else {
          expect(messages.error).toHaveBeenCalledWith('进入用户中心失败，请重试')
        }
      } finally {
        log.mockRestore()
      }
    })
  })

  it('仅在原区域按密码、Passkey 顺序显示两个按钮，注册模式保持单按钮', async () => {
    const { wrapper } = await mountLogin()
    const buttons = wrapper.findAll('.login-actions button')
    expect(buttons.map(button => button.text())).toEqual(['登录', 'Passkey 登录'])
    expect(buttons[1].attributes('type')).toBe('button')
    expect(buttons[1].find('svg').exists()).toBe(true)
    expect(wrapper.findAll('.login-form button').filter(button => button.text())).toHaveLength(2)
    expect(wrapper.text()).toContain('激活后才能登录')

    const registration = await mountLogin({ plan_id: '1' })
    expect(registration.wrapper.find('.passkey-login-btn').exists()).toBe(false)
    expect(registration.wrapper.get('.login-btn').text()).toBe('提交并前往支付')
  })

  it('左侧按钮保留密码校验和登录状态写入', async () => {
    const { wrapper, store, router } = await mountLogin()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('user@example.test')
    await inputs[1].setValue('password123')
    await wrapper.get('.login-btn').trigger('click')
    await flushPromises()
    expect(JSON.parse(requests.find(request => request.url === '/login').data)).toEqual({ email: 'user@example.test', password: 'password123' })
    expect(requests.find(request => request.url === '/login').skipGlobalError).toBeUndefined()
    expect(store.token).toBe('passkey-token')
    expect(store.userInfo).toEqual(loginData.user)
    expect(router.currentRoute.value.path).toBe('/user')
  })

  it('空邮箱密码也可直接使用 Passkey，成功复用状态并遵守 redirect', async () => {
    const { wrapper, store, router } = await mountLogin({ redirect: '/user/profile' })
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-form-item__error').exists()).toBe(false)
    expect(requests.some(request => request.url === '/login')).toBe(false)
    expect(authenticationRequests().map(request => JSON.parse(request.data))).toEqual([
      {}, { ceremony_id: 'login-ceremony', response: assertion }
    ])
    expect(authenticationRequests().map(request => request.skipGlobalError)).toEqual([true, true])
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'challenge' } })
    expect(localStorage.getItem('user_token')).toBe('passkey-token')
    expect(store.userInfo).toEqual(loginData.user)
    expect(router.currentRoute.value.path).toBe('/user/profile')
  })

  it('浏览器取消时不提示错误、不写入状态，并恢复按钮', async () => {
    browser.startAuthentication.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'))
    const { wrapper, store, router } = await mountLogin()
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(messages.error).not.toHaveBeenCalled()
    expect(authenticationRequests()).toHaveLength(1)
    expect(store.token).toBe('')
    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
  })

  it('展示服务端错误并恢复按钮，失败不会登录', async () => {
    responses.set('/auth/passkey/login/verify', { code: 1001, message: '凭据已撤销', data: null })
    const { wrapper, store } = await mountLogin()
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(messages.error).toHaveBeenCalledWith('凭据已撤销')
    expect(store.token).toBe('')
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
  })

  describe.each(['options', 'verify'])('Passkey %s 请求失败只有一个可见错误出口', stage => {
    it.each([
      [403, '凭据无权登录'],
      [404, '凭据不存在'],
      [500, '认证服务暂时失败'],
      ['network', '网络连接失败'],
      ['timeout', '请求超时，请检查网络连接']
    ])('%s 仅展示一次正确文案', async (kind, expectedMessage) => {
      const error = new Error('transport failed')
      if (typeof kind === 'number') {
        error.response = { status: kind, data: { code: kind, message: expectedMessage, data: null } }
      } else if (kind === 'timeout') {
        error.code = 'ECONNABORTED'
      }
      responses.set(`/auth/passkey/login/${stage}`, error)
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { wrapper, store } = await mountLogin()
        await wrapper.get('.passkey-login-btn').trigger('click')
        await flushPromises()
        expect(messages.error.mock.calls).toEqual([[expectedMessage]])
        expect(store.token).toBe('')
        expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
      } finally {
        log.mockRestore()
      }
    })
  })

  it('密码请求保留原全局错误处理，不继承 Passkey 错误抑制', async () => {
    const error = Object.assign(new Error('forbidden'), { response: { status: 403, data: { code: 403, message: '拒绝密码请求' } } })
    responses.set('/login', error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(api.user.login({ email: 'user@example.test', password: 'password123' })).rejects.toBe(error)
      expect(messages.error.mock.calls).toEqual([['没有权限访问']])
    } finally {
      log.mockRestore()
    }
  })

  it.each(['unsupported', 'insecure'])('%s 时禁用 Passkey 并以按钮提示原因，密码入口可用', async state => {
    if (state === 'unsupported') vi.stubGlobal('PublicKeyCredential', undefined)
    if (state === 'insecure') vi.stubGlobal('isSecureContext', false)
    const { wrapper } = await mountLogin()
    const button = wrapper.get('.passkey-login-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toMatch(/不支持|安全|HTTPS/)
    expect(wrapper.get('.login-btn').attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(authenticationRequests()).toHaveLength(0)
  })

  describe.each(['unsupported', 'insecure'])('%s 的禁用原因可被发现', state => {
    it.each(['hover', 'keyboard', 'touch-click'])('%s 打开与焦点入口关联的可见说明，不发起登录', async interaction => {
      if (state === 'unsupported') vi.stubGlobal('PublicKeyCredential', undefined)
      if (state === 'insecure') vi.stubGlobal('isSecureContext', false)
      const { wrapper } = await mountLogin()
      const hint = wrapper.get('.passkey-login-hint')
      const button = wrapper.get('.passkey-login-btn')
      expect(hint.attributes('tabindex')).toBe('0')
      expect(hint.attributes('role')).toBe('button')
      expect(hint.attributes('aria-label')).toContain('查看原因')
      expect(button.attributes('disabled')).toBeDefined()
      expect(wrapper.get('.login-btn').attributes('disabled')).toBeUndefined()
      if (interaction === 'keyboard') {
        hint.element.focus()
        expect(document.activeElement).toBe(hint.element)
      } else {
        await hint.trigger(interaction === 'hover' ? 'mouseenter' : 'click')
      }
      await vi.waitFor(() => {
        const id = hint.attributes('aria-describedby')
        expect(id).toBeTruthy()
        const tooltip = document.getElementById(id)
        expect(tooltip?.getAttribute('role')).toBe('tooltip')
        expect(tooltip?.getAttribute('aria-hidden')).toBe('false')
        expect(tooltip?.textContent).toContain(state === 'unsupported' ? '当前浏览器不支持 Passkey 登录' : 'Passkey 登录需要 HTTPS 安全上下文')
      })
      expect(authenticationRequests()).toHaveLength(0)
    })
  })

  it('支持 Passkey 时包装层不增加键盘停靠点，按钮仍可操作', async () => {
    const { wrapper } = await mountLogin()
    expect(wrapper.get('.passkey-login-hint').attributes('tabindex')).toBe('-1')
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
  })

  it('高级能力未知仍显示可用按钮，并允许旧浏览器或外置密钥完成登录', async () => {
    browser.browserSupportsPasskeys.mockResolvedValue(false)
    const { wrapper, store } = await mountLogin()
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(authenticationRequests()).toHaveLength(2)
    expect(store.token).toBe('passkey-token')
  })

  it('认证期间禁止重复请求和密码并行提交，结束后恢复两按钮', async () => {
    let finish
    browser.startAuthentication.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { wrapper } = await mountLogin()
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(wrapper.get('.login-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeDefined()
    await wrapper.get('.passkey-login-btn').trigger('click')
    await wrapper.findAll('input')[1].trigger('keyup.enter')
    expect(authenticationRequests()).toHaveLength(1)
    expect(requests.some(request => request.url === '/login')).toBe(false)
    finish(assertion)
    await flushPromises()
    expect(wrapper.get('.login-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
  })

  it('密码表单校验期间也锁定登录方式，防止同一时刻发起两种认证', async () => {
    const { wrapper } = await mountLogin()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('user@example.test')
    await inputs[1].setValue('password123')
    wrapper.get('.login-btn').element.click()
    wrapper.get('.passkey-login-btn').element.click()
    await flushPromises()
    expect(authenticationRequests()).toHaveLength(0)
    expect(requests.filter(request => request.url === '/login')).toHaveLength(1)
  })
})

describe('用户中心预加载调度', () => {
  it('挂载登录页后安排空闲预加载，不阻塞页面初始化', async () => {
    const { wrapper } = await mountLogin()
    expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.passkey-login-btn').attributes('disabled')).toBeUndefined()
  })

  it('优先在空闲回调执行独立加载任务，不提前加载', async () => {
    const { scheduleUserCenterPreload } = await import(preloaderModulePath)
    const loaded = []
    scheduleUserCenterPreload({ loaders: [() => { loaded.push('layout') }, () => { loaded.push('profile') }] })
    expect(loaded).toEqual([])
    expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1)
    globalThis.requestIdleCallback.mock.calls[0][0]()
    await flushPromises()
    expect(loaded).toEqual(['layout', 'profile'])
  })

  it('无空闲 API 时等待 300ms 再加载', async () => {
    const { scheduleUserCenterPreload } = await import(preloaderModulePath)
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    const loaded = []
    scheduleUserCenterPreload({ loaders: [() => { loaded.push('layout') }, () => { loaded.push('profile') }] })
    await vi.advanceTimersByTimeAsync(299)
    expect(loaded).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(loaded).toEqual(['layout', 'profile'])
  })

  it.each(['rejection', 'throw'])('单个任务 %s 不影响另一个任务或登录，不产生未处理 rejection', async failure => {
    const { scheduleUserCenterPreload } = await import(preloaderModulePath)
    const { wrapper, router } = await mountLogin()
    const loaded = []
    scheduleUserCenterPreload({ loaders: [
      () => {
        if (failure === 'throw') throw new Error('资源不可用')
        return Promise.reject(new Error('资源不可用'))
      },
      () => { loaded.push('profile') }
    ] })
    globalThis.requestIdleCallback.mock.calls[1][0]()
    await flushPromises()
    expect(loaded).toEqual(['profile'])
    await wrapper.get('.passkey-login-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/user')
    expect(messages.success.mock.calls).toEqual([['登录成功']])
  })
})

describe('Passkey 客户端与管理接口', () => {
  it('注册串联服务端 options、浏览器注册及 verify，不泄露复验密码', async () => {
    const { PasskeyClient } = await import(passkeyModulePath)
    responses.set('/auth/passkeys/registration/options', { code: 0, data: { ceremony_id: 'register-ceremony', options: { challenge: 'register-challenge' } } })
    responses.set('/auth/passkeys/registration/verify', { code: 0, data: { id: 8, name: '我的密钥' } })
    const result = await new PasskeyClient({ api, browser }).register({ password: 'password123', name: '我的密钥' })
    expect(result).toEqual({ id: 8, name: '我的密钥' })
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'register-challenge' } })
    expect(requests.map(request => [request.url, JSON.parse(request.data)])).toEqual([
      ['/auth/passkeys/registration/options', { password: 'password123', name: '我的密钥' }],
      ['/auth/passkeys/registration/verify', { ceremony_id: 'register-ceremony', response: { id: 'new-key', response: {} }, name: '我的密钥' }]
    ])
  })

  it('列表与撤销使用鉴权路径，撤销密码放入 DELETE 请求体', async () => {
    localStorage.setItem('user_token', 'session-token')
    await api.user.getPasskeys()
    await api.user.deletePasskey(8, { password: 'password123' })
    expect(requests.map(request => [request.method, request.url])).toEqual([
      ['get', '/auth/passkeys'], ['delete', '/auth/passkeys/8']
    ])
    expect(requests[0].headers.Authorization).toBe('Bearer session-token')
    expect(JSON.parse(requests[1].data)).toEqual({ password: 'password123' })
  })

  it('网络层同名 NotAllowedError 继续抛出，不能当成浏览器取消', async () => {
    const { PasskeyClient } = await import(passkeyModulePath)
    const networkError = Object.assign(new Error('network failed'), { name: 'NotAllowedError' })
    responses.set('/auth/passkey/login/options', networkError)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(new PasskeyClient({ api, browser }).login()).rejects.toBe(networkError)
    } finally {
      log.mockRestore()
    }
  })
})
