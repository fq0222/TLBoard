import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getTicketActionRequiredCount: vi.fn(),
  getPendingWithdrawalCount: vi.fn()
}))
const routerPush = vi.hoisted(() => vi.fn())
const currentRoute = vi.hoisted(() => ({ path: '/admin', meta: { title: '仪表盘' } }))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))
vi.mock('@/stores/admin', () => ({ useAdminStore: () => ({ username: 'admin', logout: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }), useRoute: () => currentRoute }))
vi.mock('element-plus/es/components/message-box/index.mjs', () => ({ ElMessageBox: { confirm: vi.fn() } }))

import Layout from '../src/views/Layout.vue'

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  }
})

/** 创建可控制完成时机的 Promise，用于复现旧计数响应覆盖新事件的竞态。 */
function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

/** 挂载真实布局，仅用无业务逻辑的 Element Plus 外壳替代浏览器组件。 */
function mountLayout() {
  return mount(Layout, {
    global: {
      stubs: {
        RouterLink: defineComponent({
          inheritAttrs: false,
          setup(_, { attrs, slots }) { return () => h('a', attrs, slots.default?.()) }
        }),
        RouterView: Passthrough,
        ElBreadcrumb: Passthrough,
        ElBreadcrumbItem: Passthrough,
        ElButton: Passthrough,
        ElDropdown: Passthrough,
        ElDropdownMenu: Passthrough,
        ElDropdownItem: Passthrough,
        ElIcon: Passthrough
      }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getTicketActionRequiredCount.mockResolvedValue({ code: 0, data: { count: 0 } })
  apiMocks.getPendingWithdrawalCount.mockResolvedValue({ code: 0, data: { count: 3 } })
})

afterEach(() => {
  document.body.style.overflow = ''
})

describe('Layout 提现提醒', () => {
  it('初始化显示待处理数量，并响应余额页处理后的数量事件', async () => {
    const wrapper = mountLayout()
    await flushPromises()
    await nextTick()

    expect(wrapper.get('.wallet-pending-badge').text()).toBe('3')

    window.dispatchEvent(new CustomEvent('wallet-pending-count-changed', { detail: { count: 1 } }))
    await nextTick()
    expect(wrapper.get('.wallet-pending-badge').text()).toBe('1')

    wrapper.unmount()
  })

  it('余额页的新计数事件不会被更早发起、稍后返回的旧请求覆盖', async () => {
    const staleRequest = deferred()
    apiMocks.getPendingWithdrawalCount.mockReturnValue(staleRequest.promise)
    const wrapper = mountLayout()
    await nextTick()

    window.dispatchEvent(new CustomEvent('wallet-pending-count-changed', { detail: { count: 1 } }))
    await nextTick()
    staleRequest.resolve({ code: 0, data: { count: 3 } })
    await flushPromises()

    expect(wrapper.get('.wallet-pending-badge').text()).toBe('1')
    wrapper.unmount()
  })
})
