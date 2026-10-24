import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ui = vi.hoisted(() => ({
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))
const apiState = vi.hoisted(() => ({ replaceSubscriptionLink: vi.fn() }))
const profile = vi.hoisted(() => ({
  email: 'user@example.com',
  enabled: true,
  payment_count: 2,
  sync_status: 2,
  subscription_ready: true,
  subscription_url: 'https://old.example/sub',
  clash_url: 'https://old.example/clash',
  v2ray_url: 'https://old.example/v2ray',
  onboarding_completed: true
}))
const store = vi.hoisted(() => ({
  userInfo: { ...profile },
  fetchUserProfile: vi.fn(async () => ({ success: true, data: { ...profile } }))
}))

vi.mock('element-plus', async importOriginal => ({
  ...await importOriginal(),
  ElMessage: { success: ui.success, error: ui.error, warning: ui.warning },
  ElMessageBox: { confirm: ui.confirm }
}))
vi.mock('vue-router', async importOriginal => ({
  ...await importOriginal(),
  onBeforeRouteLeave: vi.fn()
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => store }))
vi.mock('@/api', () => ({
  default: {
    user: {
      replaceSubscriptionLink: apiState.replaceSubscriptionLink,
      getPublicSettings: vi.fn(async () => ({ code: 0, data: {} })),
      getReferralSummary: vi.fn(async () => ({ code: 0, data: {} })),
      getAnnouncements: vi.fn(async () => ({ code: 0, data: { list: [] } })),
      getLatestAnnouncementPopup: vi.fn(async () => ({ code: 0, data: {} }))
    }
  }
}))

const { default: Profile } = await import('../src/views/user/Profile.vue')
const wrappers = []
let consoleErrorSpy

/** 挂载真实 Profile 逻辑，外部接口仅在 HTTP/UI 边界替换。 */
async function mountProfile() {
  const wrapper = shallowMount(Profile, {
    global: {
      stubs: {
        RouterLink: true,
        ReferralPosterDialog: true,
        'el-icon': true,
        'el-tag': true,
        'el-progress': true,
        'el-button': true,
        'el-empty': true,
        'el-dialog': { template: '<div><slot /></div>' },
        'el-alert': true,
        'el-tour': true,
        'el-tour-step': true
      },
      directives: { loading: {} }
    }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

/** 创建可手动完成的 Promise，用于观察请求期间的真实 loading 文案。 */
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.clearAllMocks()
  Object.assign(store, {
    userInfo: { ...profile },
    fetchUserProfile: vi.fn(async () => ({ success: true, data: { ...profile } }))
  })
  ui.confirm.mockResolvedValue('confirm')
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  consoleErrorSpy.mockRestore()
})

describe('Profile 更换订阅凭证', () => {
  it('确认风险同时说明旧链接和节点凭证失效，请求期间展示同步节点', async () => {
    const pending = deferred()
    apiState.replaceSubscriptionLink.mockReturnValue(pending.promise)
    const wrapper = await mountProfile()

    await wrapper.get('.replace-subscription-button').trigger('click')
    await flushPromises()

    const [message, title, options] = ui.confirm.mock.calls[0]
    expect(message).toBe(
      '<strong style="font-size: 16px;">更换后，旧订阅链接和客户端中已导入的节点都将失效。</strong><br><br>'
      + '请在更换后完成以下操作：<br>'
      + '1. 删除客户端中已导入的旧订阅链接。<br>'
      + '2. 从网站复制新的订阅链接，并重新导入客户端。<br>'
      + '3. 更换订阅链接的操作每小时只能执行一次。'
    )
    expect(title).toBe('更换订阅链接')
    expect(options.dangerouslyUseHTMLString).toBe(true)
    expect(wrapper.text()).toContain('正在同步节点')

    pending.resolve({ code: 0, data: {
      subscription_url: 'https://new.example/sub',
      clash_url: 'https://new.example/clash',
      v2ray_url: 'https://new.example/v2ray',
      pending_server_ids: [],
      pending_server_names: [],
      retry_scheduled: false
    } })
    await flushPromises()
  })

  it('全部同步成功时保存三个新链接并提示重新导入', async () => {
    apiState.replaceSubscriptionLink.mockResolvedValue({ code: 0, data: {
      subscription_url: 'https://new.example/sub',
      clash_url: 'https://new.example/clash',
      v2ray_url: 'https://new.example/v2ray',
      pending_server_ids: [],
      pending_server_names: [],
      retry_scheduled: false
    } })
    const wrapper = await mountProfile()
    await wrapper.get('.replace-subscription-button').trigger('click')
    await flushPromises()

    expect(store.userInfo.subscription_url).toBe('https://new.example/sub')
    expect(store.userInfo.clash_url).toBe('https://new.example/clash')
    expect(store.userInfo.v2ray_url).toBe('https://new.example/v2ray')
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('重新导入'))
  })

  it('部分服务器待重试时仍保存新链接并提示后台更新', async () => {
    apiState.replaceSubscriptionLink.mockResolvedValue({ code: 0, data: {
      subscription_url: 'https://partial.example/sub',
      clash_url: 'https://partial.example/clash',
      v2ray_url: 'https://partial.example/v2ray',
      pending_server_ids: [2],
      pending_server_names: ['香港'],
      retry_scheduled: true
    } })
    const wrapper = await mountProfile()
    await wrapper.get('.replace-subscription-button').trigger('click')
    await flushPromises()

    expect(store.userInfo.subscription_url).toBe('https://partial.example/sub')
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('部分节点后台更新'))
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('新链接已可用'))
  })

  it('429 冷却时展示服务端提示且保留页面现有链接', async () => {
    apiState.replaceSubscriptionLink.mockRejectedValue(Object.assign(new Error('request failed'), {
      response: { status: 429, data: { code: 3004, message: '一小时内只能更换一次，请稍后再试' } }
    }))
    const wrapper = await mountProfile()
    await wrapper.get('.replace-subscription-button').trigger('click')
    await flushPromises()

    expect(store.userInfo.subscription_url).toBe('https://old.example/sub')
    expect(store.userInfo.clash_url).toBe('https://old.example/clash')
    expect(store.userInfo.v2ray_url).toBe('https://old.example/v2ray')
    expect(ui.error).toHaveBeenCalledWith('一小时内只能更换一次，请稍后再试')
  })
})

