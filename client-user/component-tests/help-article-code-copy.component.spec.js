import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getHelpArticle: vi.fn()
}))

const messageMocks = vi.hoisted(() => ({
  error: vi.fn()
}))

vi.mock('@/api', () => ({
  default: {
    user: apiMocks
  }
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' } })
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageMocks.error
  }
}))

vi.mock('@element-plus/icons-vue', () => ({
  ArrowLeft: defineComponent({
    setup() {
      return () => h('span')
    }
  })
}))

import HelpArticle from '../src/views/user/HelpArticle.vue'

const wrappers = []

/** 挂载真实帮助文章页，仅替换 HTTP、路由和外部 UI 外壳。 */
function mountHelpArticle() {
  const wrapper = mount(HelpArticle, {
    global: {
      directives: { loading: {} },
      stubs: {
        ElButton: defineComponent({
          emits: ['click'],
          setup(_, { attrs, emit, slots }) {
            return () => h('button', {
              ...attrs,
              onClick: event => emit('click', event)
            }, slots.default?.())
          }
        }),
        ElEmpty: true,
        ElIcon: true,
        ElTag: true
      },
      mocks: {
        $router: { push: vi.fn() }
      }
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

/** 等待文章请求、Markdown 计算和 DOM 增强全部完成。 */
async function settle() {
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getHelpArticle.mockResolvedValue({
    code: 0,
    data: {
      id: 7,
      title: '复制代码测试',
      summary: '测试 Markdown 代码块复制',
      content: '```javascript\nconst answer = 42 < 100\n```',
      category: '教程',
      updated_at: 1700000000
    }
  })
})

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('HelpArticle Markdown 代码复制', () => {
  it('为代码块增加移动端可访问的复制按钮并复制原始代码文本', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    const wrapper = mountHelpArticle()
    await settle()

    const button = wrapper.get('.markdown-code-copy-button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('复制代码')

    await button.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('const answer = 42 < 100\n')
    expect(button.text()).toBe('已复制')

    vi.advanceTimersByTime(1500)
    await nextTick()
    expect(button.text()).toBe('复制')
  })

  it('非安全上下文使用隐藏文本框回退复制且不遗留临时节点', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    })

    const wrapper = mountHelpArticle()
    await settle()
    await wrapper.get('.markdown-code-copy-button').trigger('click')
    await flushPromises()

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('.markdown-copy-fallback')).toBeNull()
    expect(wrapper.get('.markdown-code-copy-button').text()).toBe('已复制')
  })

  it('details 收起时把复制按钮放在折叠正文外并仍可复制完整代码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    apiMocks.getHelpArticle.mockResolvedValue({
      code: 0,
      data: {
        id: 7,
        title: '折叠代码测试',
        summary: '收起时也能复制',
        content: '<details>\n<summary>展开/收起完整脚本</summary>\n\n```javascript\nfunction main() {\n  return true\n}\n```\n\n</details>',
        category: '教程',
        updated_at: 1700000000
      }
    })

    const wrapper = mountHelpArticle()
    await settle()

    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()

    const button = wrapper.get('.markdown-details-code-block > .markdown-code-copy-button')
    expect(details.element.contains(button.element)).toBe(false)

    await button.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('function main() {\n  return true\n}\n')
  })
})
