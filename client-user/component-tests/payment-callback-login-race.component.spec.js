import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiState = vi.hoisted(() => ({ getPublicOrderStatus: vi.fn() }))
const store = vi.hoisted(() => ({
  isLoggedIn: false,
  login: vi.fn()
}))
const router = vi.hoisted(() => ({ push: vi.fn() }))
const route = vi.hoisted(() => ({
  query: {
    order_id: 'ORD-RACE-1',
    payment_url: 'https://pay.example.test/order',
    pay_type: '1'
  }
}))

vi.mock('@/api', () => ({
  default: { user: { getPublicOrderStatus: apiState.getPublicOrderStatus } }
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => store }))
vi.mock('vue-router', () => ({
  useRouter: () => router,
  useRoute: () => route
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,test') }
}))
vi.mock('element-plus', () => ({ ElMessage: {} }))

const { default: PaymentCallback } = await import('../src/views/PaymentCallback.vue')
let wrapper

/** 创建可由测试精确完成的查单请求，确保两个响应同时进入 paid 分支。 */
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  sessionStorage.setItem('pending_payment_login', JSON.stringify({
    email: 'race@example.test',
    password: 'password123'
  }))
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible'
  })
  store.isLoggedIn = false
  store.login.mockResolvedValue({ success: true })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('PaymentCallback 支付成功自动登录', () => {
  it('两个并发查单都返回 paid 时只登录并安排跳转一次', async () => {
    const first = deferred()
    const second = deferred()
    apiState.getPublicOrderStatus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    wrapper = shallowMount(PaymentCallback, {
      global: {
        stubs: {
          'el-icon': true,
          'el-button': true,
          Loading: true,
          CircleCheck: true,
          Wallet: true
        }
      }
    })
    await Promise.resolve()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiState.getPublicOrderStatus).toHaveBeenCalledTimes(2)

    const paid = { code: 0, data: { status: 'paid' } }
    first.resolve(paid)
    second.resolve(paid)
    await flushPromises()

    expect(store.login).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('支付成功，已自动登录。')

    await vi.advanceTimersByTimeAsync(2000)
    expect(router.push).toHaveBeenCalledTimes(1)
  })

  it('单次自动登录失败时保留手动登录提示和待登录凭据', async () => {
    apiState.getPublicOrderStatus.mockResolvedValueOnce({ code: 0, data: { status: 'paid' } })
    store.login.mockResolvedValueOnce({ success: false, message: '密码校验失败' })

    wrapper = shallowMount(PaymentCallback, {
      global: {
        stubs: {
          'el-icon': true,
          'el-button': true,
          Loading: true,
          CircleCheck: true,
          Wallet: true
        }
      }
    })
    await flushPromises()

    expect(store.login).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('支付成功，请手动登录后查看订阅信息。')
    expect(sessionStorage.getItem('pending_payment_login')).not.toBeNull()
  })
})
