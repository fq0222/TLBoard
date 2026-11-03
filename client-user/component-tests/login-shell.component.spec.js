/** 登录壳集成回归：保留真实路由和表单，仅控制代码分割与 HTTP 边界。 */
import axios from 'axios'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/utils/login-page-loader', () => ({ loadLoginPage: boundary.load }))

let routes
let loginModule
let wrapper
const originalAdapter = axios.defaults.adapter

/** 创建可控加载 Promise；成功返回真实 Login 模块，失败走壳的错误出口。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** 使用生产路由记录创建内存路由，验证导航完成不依赖登录代码下载。 */
async function enterLogin(query = { plan_id: '7' }) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push({ path: '/login', query })
  await router.isReady()
  wrapper = mount(RouterView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  await flushPromises()
  return router
}

beforeAll(async () => {
  axios.defaults.adapter = async config => ({
    data: { code: 0, data: {} }, status: 200, statusText: 'OK', headers: {}, config
  })
  routes = (await import('../src/router/index.js')).default.options.routes
  loginModule = await import('../src/views/Login.vue')
})

beforeEach(() => {
  boundary.load.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  // 保持真实表单的空闲调度入口，不执行与当前测试无关的用户中心下载。
  vi.stubGlobal('requestIdleCallback', vi.fn())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})
afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('同步登录壳', () => {
  it('表单代码 pending 时已进入带套餐参数的登录路由并显示骨架和 loading', async () => {
    expect(typeof routes.find(route => route.path === '/login').component).toBe('object')
    boundary.load.mockReturnValue(deferred().promise)
    const router = await enterLogin()

    expect(router.currentRoute.value.fullPath).toBe('/login?plan_id=7')
    expect(wrapper.find('[data-testid="login-skeleton"]').exists()).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain('加载')
    expect(wrapper.get('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="请输入邮箱"]').exists()).toBe(false)
    expect(globalThis.requestIdleCallback).not.toHaveBeenCalled()
  })

  it('加载成功后使用真实注册表单替换骨架并保留套餐、推广和 redirect 查询参数', async () => {
    const loading = deferred()
    boundary.load.mockReturnValue(loading.promise)
    const router = await enterLogin({
      plan_id: '7', plan_name: '月付套餐', plan_price: '19.00', plan_traffic: '100 GB',
      plan_duration: '30', plan_soldout: '0', ref: 'friend', redirect: '/user/orders?tab=pending'
    })
    const fullPath = router.currentRoute.value.fullPath
    expect(wrapper.find('[data-testid="login-skeleton"]').exists()).toBe(true)
    loading.resolve(loginModule)
    await flushPromises()

    expect(wrapper.find('[data-testid="login-skeleton"]').exists()).toBe(false)
    expect(wrapper.get('input[placeholder="请输入邮箱"]').exists()).toBe(true)
    expect(wrapper.get('input[placeholder="请再次输入密码"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('月付套餐')
    expect(wrapper.text()).toContain('19.00')
    expect(router.currentRoute.value.fullPath).toBe(fullPath)
    expect(router.currentRoute.value.query.redirect).toBe('/user/orders?tab=pending')
    expect(sessionStorage.getItem('referral_code')).toBe('friend')
    expect(globalThis.requestIdleCallback).toHaveBeenCalledOnce()
  })

  it('下载失败显示中文错误和原生刷新重试链接，保留当前完整查询参数且不提供原地重试按钮', async () => {
    const first = deferred()
    boundary.load.mockReturnValueOnce(first.promise)
    const router = await enterLogin({
      plan_id: '7', plan_name: '月付套餐', ref: 'friend', redirect: '/user/orders?tab=pending'
    })
    expect(wrapper.find('[data-testid="login-skeleton"]').exists()).toBe(true)
    first.reject(new Error('chunk unavailable'))
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('登录页面加载失败')
    expect(wrapper.find('input').exists()).toBe(false)
    const link = wrapper.get('[role="alert"] a')
    expect(link.element.tagName).toBe('A')
    expect(link.text()).toBe('刷新重试')
    expect(link.attributes('href')).toBe(router.currentRoute.value.fullPath)
    expect(link.attributes('href')).toBe('/login?plan_id=7&plan_name=%E6%9C%88%E4%BB%98%E5%A5%97%E9%A4%90&ref=friend&redirect=/user/orders?tab=pending')
    expect(wrapper.find('button').exists()).toBe(false)
    // 组件处理后观察事件是否仍保留原生导航，再由测试阻止 jsdom 不支持的整页刷新。
    let nativeNavigationAllowed = false
    wrapper.element.addEventListener('click', event => {
      nativeNavigationAllowed = !event.defaultPrevented
      event.preventDefault()
    }, { once: true })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.element.dispatchEvent(click)
    await flushPromises()
    expect(nativeNavigationAllowed).toBe(true)
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    expect(boundary.load).toHaveBeenCalledOnce()
  })
})
