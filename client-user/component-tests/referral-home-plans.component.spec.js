/** 首页套餐的真实组件与路由回归：查询变化刷新列表，过期响应不得覆盖当前页面。 */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiState = vi.hoisted(() => ({ getPlans: vi.fn(), recordReferralClick: vi.fn() }))

vi.mock('@/api', () => ({ default: { user: apiState } }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ isLoggedIn: false }) }))

const { default: Home } = await import('../src/views/Home.vue')
const normalResponse = { code: 0, data: { plans: [{ id: 1, name: '普通套餐', price_text: '10', traffic_text: '10 GB', duration_days: 30, plan_type: 'timed', is_soldout: false }] } }
const referralResponse = { code: 0, data: { plans: [{ id: 2, name: '推广套餐', price_text: '20', traffic_text: '20 GB', duration_days: 30, plan_type: 'timed', is_soldout: false }] } }
let wrapper
let router

/** 控制请求完成顺序；resolve/reject 分别模拟正常响应与网络失败。 */
class PendingRequest {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

/** 挂载真实 RouterView 和 Home；path 为初始 URL，后续导航复用同一组件实例。 */
async function mountHome(path) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/login', name: 'Login', component: defineComponent({ template: '<div />' }) },
      { path: '/user', component: defineComponent({ template: '<div />' }) }
    ]
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(RouterView, {
    global: {
      plugins: [router],
      stubs: {
        'el-icon': true,
        'el-button': defineComponent({ template: '<button><slot /></button>' })
      }
    }
  })
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  apiState.recordReferralClick.mockResolvedValue({ code: 0 })
  apiState.getPlans.mockResolvedValue(normalResponse)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('首页当前 URL 推广套餐', () => {
  it('可购买套餐的主按钮显示购买并注册', async () => {
    await mountHome('/')
    expect(wrapper.find('.buy-btn').text()).toContain('购买并注册')
  })

  it('初始 ref 归一化后仅请求一次，移除 ref 时复用组件并重新加载普通套餐', async () => {
    apiState.getPlans.mockResolvedValueOnce(referralResponse)
    await mountHome('/?ref=%20VALID%20')
    const homeElement = wrapper.find('.home-container').element
    expect(apiState.getPlans.mock.calls).toEqual([['VALID']])
    expect(wrapper.find('.plan-name').text()).toBe('推广套餐')

    await router.push('/')
    await flushPromises()
    expect(wrapper.find('.home-container').element).toBe(homeElement)
    expect(apiState.getPlans.mock.calls).toEqual([['VALID'], ['']])
    expect(wrapper.find('.plan-name').text()).toBe('普通套餐')
    expect(apiState.recordReferralClick.mock.calls).toEqual([['VALID']])
    expect(sessionStorage.getItem('referral_code')).toBe('VALID')
  })

  it('普通页面添加及切换 ref 都刷新套餐，归一化后不变则不重复请求或上报点击', async () => {
    await mountHome('/')
    await router.push('/?ref=VALID')
    await flushPromises()
    await router.push('/?ref=%20VALID%20')
    await flushPromises()
    await router.push('/?ref=OTHER')
    await flushPromises()
    expect(apiState.getPlans.mock.calls).toEqual([[''], ['VALID'], ['OTHER']])
    expect(apiState.recordReferralClick).not.toHaveBeenCalled()
  })

  it('推广请求晚于普通请求成功返回时仍保留普通套餐', async () => {
    const oldRequest = new PendingRequest()
    apiState.getPlans.mockReturnValueOnce(oldRequest.promise)
    await mountHome('/?ref=VALID')
    await router.push('/')
    await flushPromises()
    expect(wrapper.find('.plan-name').exists()).toBe(true)
    expect(wrapper.find('.plan-name').text()).toBe('普通套餐')

    oldRequest.resolve(referralResponse)
    await flushPromises()
    expect(wrapper.find('.plan-name').text()).toBe('普通套餐')
    expect(wrapper.find('.plans-loading').exists()).toBe(false)
  })

  it('旧请求完成时不清除新请求的加载状态', async () => {
    const oldRequest = new PendingRequest()
    const currentRequest = new PendingRequest()
    apiState.getPlans.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise)
    await mountHome('/?ref=VALID')
    await router.push('/')
    await flushPromises()
    oldRequest.resolve(referralResponse)
    await flushPromises()
    expect(wrapper.find('.plans-loading').exists()).toBe(true)
    expect(wrapper.find('.plan-name').exists()).toBe(false)

    currentRequest.resolve(normalResponse)
    await flushPromises()
    expect(wrapper.find('.plan-name').text()).toBe('普通套餐')
  })

  it('过期推广请求失败及重试不会覆盖普通套餐或显示加载失败', async () => {
    const oldRequest = new PendingRequest()
    apiState.getPlans.mockImplementation(ref => ref === 'VALID' ? oldRequest.promise : Promise.resolve(normalResponse))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountHome('/?ref=VALID')
    await router.push('/')
    await flushPromises()
    oldRequest.reject(new Error('旧推广请求失败'))
    await flushPromises()
    expect(apiState.getPlans.mock.calls).toEqual([['VALID'], [''], ['VALID']])
    expect(wrapper.find('.plan-name').text()).toBe('普通套餐')
    expect(wrapper.find('.plans-state').exists()).toBe(false)
  })

  it('当前请求失败保留错误提示，旧推广成功不能覆盖错误状态', async () => {
    const oldRequest = new PendingRequest()
    apiState.getPlans.mockImplementation(ref => ref === 'VALID' ? oldRequest.promise : Promise.reject(new Error('当前请求失败')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountHome('/?ref=VALID')
    await router.push('/')
    await flushPromises()
    expect(wrapper.find('.plans-state').exists()).toBe(true)
    expect(wrapper.find('.plans-state').text()).toContain('套餐加载失败')

    oldRequest.resolve(referralResponse)
    await flushPromises()
    expect(wrapper.find('.plans-state').text()).toContain('套餐加载失败')
    expect(wrapper.find('.plan-name').exists()).toBe(false)
  })
})
