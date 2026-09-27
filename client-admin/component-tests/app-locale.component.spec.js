import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '@/App.vue'

describe('管理端 Element Plus 语言配置', () => {
  it('为日期选择器等组件提供简体中文语言环境', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          RouterView: true
        }
      }
    })

    const provider = wrapper.findComponent({ name: 'ElConfigProvider' })
    expect(provider.exists()).toBe(true)
    expect(provider.props('locale').name).toBe('zh-cn')
  })
})
