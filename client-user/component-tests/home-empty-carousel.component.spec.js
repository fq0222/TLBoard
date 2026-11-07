/** 首页套餐空状态轮播的真实组件分支与配置回归测试。 */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiState = vi.hoisted(() => ({ getPlans: vi.fn(), recordReferralClick: vi.fn() }))
vi.mock('@/api', () => ({ default: { user: apiState } }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ isLoggedIn: false }) }))
const { default: Home } = await import('../src/views/Home.vue')

// 保留轮播内容及公开属性，隔离 Element Plus 在 jsdom 中的计时和布局行为。
const CarouselStub = defineComponent({
  name: 'ElCarousel',
  props: ['interval', 'autoplay', 'pauseOnHover', 'arrow', 'indicatorPosition'],
  template: '<div><slot /></div>'
})
const CarouselItemStub = defineComponent({ template: '<div><slot /></div>' })
let wrapper

/** 按指定动态效果偏好挂载首页；套餐请求由每个测试单独控制。 */
async function mountHome(reducedMotion = false, mediaQuery = null) {
  window.matchMedia = vi.fn().mockReturnValue(mediaQuery || { matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Home }, { path: '/login', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  wrapper = mount(Home, { global: { plugins: [router], stubs: { ElCarousel: CarouselStub, ElCarouselItem: CarouselItemStub, 'el-icon': true, 'el-button': true } } })
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('首页成功空套餐轮播', () => {
  it('全部套餐为空时替换套餐区域并按数字顺序展示目录图片', async () => {
    apiState.getPlans.mockResolvedValue({ code: 0, data: { plans: [] } })
    await mountHome()
    expect(wrapper.find('.section-head').exists()).toBe(false)
    expect(wrapper.find('.plan-filter').exists()).toBe(false)
    expect(wrapper.find('.plans-state').exists()).toBe(false)
    const carousel = wrapper.getComponent(CarouselStub)
    expect(carousel.props()).toMatchObject({ interval: 5000, autoplay: true, pauseOnHover: true, arrow: 'never', indicatorPosition: 'none' })
    const images = wrapper.findAll('.home-carousel-image')
    const imageNumbers = images.map(image => Number(image.attributes('src').match(/(\d+)\.webp/)[1]))
    expect(imageNumbers.length).toBeGreaterThan(0)
    expect(imageNumbers).toEqual([...imageNumbers].sort((left, right) => left - right))
    expect(images[0].attributes('loading')).toBe('eager')
    expect(images.slice(1).every(image => image.attributes('loading') === 'lazy')).toBe(true)
    expect(images.every(image => image.attributes('alt'))).toBe(true)
    expect(wrapper.find('.home-empty-carousel a').exists()).toBe(false)
  })

  it('请求尚未完成时显示骨架，不显示轮播', async () => {
    apiState.getPlans.mockReturnValue(new Promise(() => {}))
    await mountHome()
    expect(wrapper.find('.plans-loading').exists()).toBe(true)
    expect(wrapper.find('.home-empty-carousel').exists()).toBe(false)
  })

  it('请求失败时显示错误，不显示轮播', async () => {
    apiState.getPlans.mockRejectedValue(new Error('网络错误'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountHome()
    expect(wrapper.text()).toContain('套餐加载失败')
    expect(wrapper.find('.home-empty-carousel').exists()).toBe(false)
  })

  it('仅所选分类为空时保留分类空状态', async () => {
    apiState.getPlans.mockResolvedValue({ code: 0, data: { plans: [{ id: 1, name: '限时套餐', price_text: '10', traffic_text: '10 GB', duration_days: 30, plan_type: 'timed', is_soldout: false }] } })
    await mountHome()
    await wrapper.findAll('.filter-button')[2].trigger('click')
    expect(wrapper.text()).toContain('当前分类暂无套餐')
    expect(wrapper.find('.home-empty-carousel').exists()).toBe(false)
  })

  it('系统关闭动画效果时仍按首页配置自动播放', async () => {
    apiState.getPlans.mockResolvedValue({ code: 0, data: { plans: [] } })
    await mountHome(true)
    expect(wrapper.getComponent(CarouselStub).props('autoplay')).toBe(true)
  })
})
